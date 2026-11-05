// Ledger — serveur local : sert l'interface et une base SQLite (node:sqlite, sans dépendance).
// Usage : node server.mjs [--import fichier.json] [--port 4747] [--exit-with-parent] [--exit-when-idle secondes]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as DB from "./server/db.mjs";
import { open, close, HttpError, DB_PATH, DATA_DIR } from "./server/db.mjs";
import { dailyBackup, keepBeforeMigration } from "./server/backup.mjs";
import * as L from "./server/ledger.mjs";
import * as Sync from "./server/sync.mjs";
import { importState } from "./server/io.mjs";
import { handle } from "./server/api.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PORT = Number(argVal("--port") || process.env.LEDGER_PORT || 4747);
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version; } catch { return "dev"; } })();

const reopen = () => { open((from, to) => keepBeforeMigration(DB.db, from, to)); Sync.ensure(); };
// Après un import ou une restauration : le contenu de la base vient d'être remplacé.
const reopenReplaced = () => { open((from, to) => keepBeforeMigration(DB.db, from, to)); Sync.ensure({ replaced: true }); };
const CTX = {
  version: VERSION, reopen, reopenReplaced,
  reveal() {
    const [cmd, cmdArgs] = { darwin: ["open", ["-R", DB_PATH]], win32: ["explorer.exe", [`/select,${DB_PATH}`]] }[process.platform] || ["xdg-open", [DATA_DIR]];
    spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" }).unref();
  },
};

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

async function api(req, res, parts, query) {
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
  const r = await handle({ method: req.method, parts, query, body }, CTX);
  send(res, r.status, r.body, r.headers);
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
// Accès depuis le téléphone : Tailscale Serve publie https://<mac>.<tailnet>.ts.net pour tes seuls appareils et relaie vers
// 127.0.0.1. Ces noms pointent vers des adresses Tailscale, jamais vers 127.0.0.1, donc pas de DNS rebinding possible.
const TAILNET_HOST = /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i;
const hostAllowed = (host) => ALLOWED_HOSTS.has(host) || TAILNET_HOST.test(host || "");
function checkOrigin(req) {
  const host = req.headers.host;
  if (!hostAllowed(host)) throw new HttpError(403, "Hôte non autorisé.");
  // Tailscale Funnel ouvrirait l'accès à tout Internet : refusé, même si quelqu'un l'active par erreur.
  if (req.headers["tailscale-funnel-request"]) throw new HttpError(403, "Accès public refusé.");
  if (req.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "Requête d'un autre site refusée.");
  const origin = req.headers.origin;
  if (req.method !== "GET" && origin) {
    let originHost = null;
    try { originHost = new URL(origin).host; } catch {}
    if (originHost !== host) throw new HttpError(403, "Requête d'un autre site refusée.");
  }
}

// ---------- démarrage ----------
try { reopen(); }
catch (e) {
  console.error(`Impossible d'ouvrir la base (${DB_PATH}) : ${e.message}`);
  process.exit(1);
}

const importFile = argVal("--import");
if (importFile) {
  try { importState(JSON.parse(fs.readFileSync(importFile, "utf8")), reopenReplaced); }
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
server.listen(PORT, "127.0.0.1", () => { console.log(`Ledger ${VERSION} → http://localhost:${PORT}  (base : ${DB_PATH})`); Sync.start(); });
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
