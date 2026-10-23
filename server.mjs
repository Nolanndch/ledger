// Ledger — serveur local : sert l'interface et une base SQLite (node:sqlite, sans dépendance).
// Usage : node server.mjs [--import fichier.json] [--port 4747] [--exit-with-parent] [--exit-when-idle secondes]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as DB from "./server/db.mjs";
import { open, close, all, get, run, tx, insert, update, existsIn, need, HttpError, uid, today, DB_PATH, DATA_DIR } from "./server/db.mjs";
import { backup, dailyBackup, keepBeforeMigration, listBackups, restoreBackup } from "./server/backup.mjs";
import * as L from "./server/ledger.mjs";
import * as I from "./server/invest.mjs";
import { getState, exportState, importState, info, csvTransactions, csvOperations } from "./server/io.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PORT = Number(argVal("--port") || process.env.LEDGER_PORT || 4747);
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version; } catch { return "dev"; } })();

const reopen = () => open((from, to) => keepBeforeMigration(DB.db, from, to));

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function send(res, status, body, headers = {}) {
  const raw = Buffer.isBuffer(body) || typeof body === "string";
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(raw ? body : JSON.stringify(body));
}
async function readBody(req) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 20e6) throw new HttpError(413, "Fichier trop volumineux."); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, "JSON invalide."); }
}

// Collections simples (création, modification, suppression génériques)
const SIMPLE = { domains: "domains", categories: "categories", objectives: "objectives" };

async function api(req, res, parts, query) {
  const [resource, id, action] = parts;
  const method = req.method;
  const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(req) : {};
  const ok = (data, status = 200) => send(res, status, data);

  switch (resource) {
    case "state": L.materializeRecurring(); return ok(getState(VERSION));
    case "info": return ok(info(VERSION));
    case "ping": return ok({ ok: true });
    case "settings":
      if (method === "GET") return ok(L.getSettings());
      if (method === "PUT") return ok(L.putSettings(body));
      break;
    case "export": {
      const date = today();
      if (id === "csv") return send(res, 200, csvTransactions(), { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ledger-${date}.csv"` });
      if (id === "csv-invest") return send(res, 200, csvOperations(), { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ledger-placements-${date}.csv"` });
      return send(res, 200, JSON.stringify(exportState(), null, 2), { "Content-Disposition": `attachment; filename="ledger-${date}.json"` });
    }
    case "import":
      if (method === "POST") { importState(body, reopen); return ok({ ok: true }); }
      break;
    case "backups":
      if (method === "GET") return ok(listBackups());
      if (method === "POST" && !id) return ok({ name: backup("manuelle") }, 201);
      if (method === "POST" && parts.at(-1) === "restore") { restoreBackup(decodeURIComponent(parts.slice(1, -1).join("/")), reopen); return ok({ ok: true }); }
      break;
    case "reveal": {
      const [cmd, cmdArgs] = { darwin: ["open", ["-R", DB_PATH]], win32: ["explorer.exe", [`/select,${DB_PATH}`]] }[process.platform] || ["xdg-open", [DATA_DIR]];
      spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" }).unref();
      return ok({ ok: true });
    }

    case "transactions":
      if (id === "bulk" && method === "POST") return ok(L.restoreTransactions(body.rows), 201);
      if (method === "POST" && !id) return ok(L.createTransaction(body), 201);
      if (id && action === "refund" && method === "POST") return ok(L.refund(id, body), 201);
      if (id && method === "PUT") return ok(L.updateTransaction(id, body));
      if (id && method === "DELETE") return ok({ ok: true, deleted: L.deleteTransaction(id) });
      break;
    case "installments":
      if (method === "POST") return ok(L.createInstallments(body), 201);
      if (id && method === "DELETE") return ok({ deleted: L.deleteInstallments(id, Number(query.get("from")) || 1) });
      break;
    case "recurring":
      if (method === "POST" && !id) return ok(L.createRecurring(body), 201);
      if (id && action === "cancel" && method === "POST") return ok(L.cancelRecurring(id, body));
      if (id && action === "reactivate" && method === "POST") return ok(L.reactivateRecurring(id));
      if (id && method === "PUT") return ok(L.updateRecurring(id, body));
      if (id && method === "DELETE") return ok(L.deleteRecurring(id, { force: query.has("force"), withPayments: query.has("withPayments") }));
      break;

    case "accounts":
      if (method === "POST" && !id) return ok(I.createAccount(body), 201);
      if (id && action === "close" && method === "POST") return ok(I.closeAccount(id, body));
      if (id && action === "reopen" && method === "POST") return ok(I.reopenAccount(id));
      if (id && method === "PUT") return ok(I.updateAccount(id, body));
      if (id && method === "DELETE") return ok(I.deleteAccount(id, { purge: query.has("purge") }));
      break;
    case "operations":
      if (method === "POST" && !id) return ok(I.createOperation(body), 201);
      if (id && method === "PUT") return ok(I.updateOperation(id, body));
      if (id && method === "DELETE") return ok(I.deleteOperation(id));
      break;
    case "assets":
      if (id && method === "PUT") return ok(I.putAsset(id, body));
      break;

    case "domains":
      if (id === "reorder" && method === "POST") {
        need(Array.isArray(body.ids), "Liste invalide.");
        tx(() => body.ids.forEach((d, i) => run("UPDATE domains SET position = ? WHERE id = ?", i, d)));
        return ok({ ok: true });
      }
    // fallthrough vers les collections simples
    default:
      if (SIMPLE[resource]) {
        const table = SIMPLE[resource];
        if (method === "POST" && !id) {
          const newId = body.id && !existsIn(table, body.id) ? String(body.id) : uid();
          insert(table, L.schema[table](body), newId);
          return ok(L.fetchOne(table, newId), 201);
        }
        const prev = id && L.fetchOne(table, id);
        if (!prev) throw new HttpError(404, "Élément introuvable.");
        if (method === "PUT") { update(table, id, L.schema[table](body, prev)); return ok(L.fetchOne(table, id)); }
        if (method === "DELETE") {
          if (table === "domains") {
            const n = get("SELECT COUNT(*) n FROM transactions WHERE domain_id = ?", id).n;
            if (n) throw new HttpError(409, `Ce business a ${n} mouvement${n > 1 ? "s" : ""}. Archive-le plutôt pour garder l'historique.`);
            run("UPDATE objectives SET domain_id = NULL WHERE domain_id = ?", id);
          }
          run(`DELETE FROM ${table} WHERE id = ?`, id);
          return ok({ ok: true, deleted: prev });
        }
      }
  }
  throw new HttpError(404, "Route inconnue.");
}

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, pathname === "/" ? "index.html" : decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "Interdit" });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}

// L'API n'écoute que 127.0.0.1, mais une page web ouverte dans le navigateur peut quand même viser ce port.
// On refuse les requêtes venant d'un autre site (CSRF) et les noms d'hôte inconnus (DNS rebinding).
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
function checkOrigin(req) {
  if (!ALLOWED_HOSTS.has(req.headers.host)) throw new HttpError(403, "Hôte non autorisé.");
  if (req.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "Requête d'un autre site refusée.");
  const origin = req.headers.origin;
  if (req.method !== "GET" && origin && !ALLOWED_HOSTS.has(origin.replace(/^http:\/\//, ""))) throw new HttpError(403, "Requête d'un autre site refusée.");
}

// ---------- démarrage ----------
try { reopen(); }
catch (e) {
  console.error(`Impossible d'ouvrir la base (${DB_PATH}) : ${e.message}`);
  process.exit(1);
}

const importFile = argVal("--import");
if (importFile) {
  try { importState(JSON.parse(fs.readFileSync(importFile, "utf8")), reopen); }
  catch (e) { console.error(e.message); process.exit(1); }
  console.log(`Importé : ${importFile} → ${DB_PATH}`);
  close();
  process.exit(0);
}

dailyBackup();
setInterval(() => { try { dailyBackup(); L.materializeRecurring(); } catch (e) { console.error(e); } }, 60 * 60 * 1000).unref();

let lastRequest = Date.now();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  lastRequest = Date.now();
  try {
    if (url.pathname.startsWith("/api/")) {
      checkOrigin(req);
      dailyBackup();
      return await api(req, res, url.pathname.slice(5).split("/").filter(Boolean), url.searchParams);
    }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: status === 500 ? `Erreur interne : ${e.message}` : e.message });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`Ledger ${VERSION} → http://localhost:${PORT}  (base : ${DB_PATH})`));
const shutdown = () => { server.close(); close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Lancé par l'app Mac : s'arrête si l'app disparaît sans avoir pu le fermer (crash, kill).
if (args.includes("--exit-with-parent")) {
  const parent = process.ppid;
  setInterval(() => { try { process.kill(parent, 0); } catch { shutdown(); } }, 2000).unref();
}
// Lancé par le lanceur Windows : s'arrête quand plus aucune fenêtre Ledger ne l'interroge (l'interface envoie un ping régulier).
const idle = Number(argVal("--exit-when-idle"));
if (idle > 0) setInterval(() => { if (Date.now() - lastRequest > idle * 1000) shutdown(); }, 5000).unref();
