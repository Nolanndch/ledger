// Ledger — serveur local : sert l'interface et une base SQLite (node:sqlite, sans dépendance).
// Usage : node server.mjs [--import fichier.json] [--port 4747] [--exit-with-parent] [--exit-when-idle secondes]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PORT = Number(argVal("--port") || process.env.LEDGER_PORT || 4747);
const DEFAULT_DATA_DIR = {
  darwin: path.join(os.homedir(), "Library", "Application Support", "Ledger"),
  win32: path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Ledger"),
}[process.platform] || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "ledger");
const DATA_DIR = process.env.LEDGER_DATA_DIR || DEFAULT_DATA_DIR;
const DB_PATH = path.join(DATA_DIR, "ledger.db");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEEP_BACKUPS = 30;
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version; } catch { return "dev"; } })();

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recurring (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('in','out')),
    amount_cents INTEGER NOT NULL, freq TEXT NOT NULL CHECK (freq IN ('daily','weekly','monthly','yearly')),
    domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    next_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'paid', active INTEGER NOT NULL DEFAULT 1,
    anchor_day INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('in','out')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    description TEXT NOT NULL DEFAULT '', date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending')),
    kind TEXT NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash','invest')),
    asset TEXT NOT NULL DEFAULT '', qty REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0,
    recurring_id TEXT REFERENCES recurring(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
  CREATE INDEX IF NOT EXISTS tx_domain ON transactions(domain_id);
  CREATE TABLE IF NOT EXISTS objectives (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, target_cents INTEGER NOT NULL,
    domain_id TEXT, deadline TEXT
  );
  CREATE TABLE IF NOT EXISTS asset_prices (
    asset TEXT PRIMARY KEY, price REAL NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------- helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const cents = (v) => Math.round((Number(v) || 0) * 100);
const euros = (c) => (c || 0) / 100;
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, heure locale
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

function tx(fn) {
  db.exec("BEGIN IMMEDIATE"); // verrou d'écriture dès le début : deux serveurs sur la même base ne se doublent pas
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const need = (cond, msg) => { if (!cond) throw new HttpError(400, msg); };

// ---------- mapping row <-> API ----------
const out = {
  domains: (r) => ({ id: r.id, name: r.name, color: r.color, active: !!r.active, position: r.position }),
  categories: (r) => ({ id: r.id, name: r.name, color: r.color }),
  transactions: (r) => ({
    id: r.id, type: r.type, amount: euros(r.amount_cents), domainId: r.domain_id, categoryId: r.category_id,
    desc: r.description, date: r.date, status: r.status, kind: r.kind, asset: r.asset, qty: r.qty,
    pricePerUnit: r.unit_price, recurringId: r.recurring_id, createdAt: r.created_at
  }),
  recurring: (r) => ({
    id: r.id, name: r.name, type: r.type, amount: euros(r.amount_cents), freq: r.freq, domainId: r.domain_id,
    categoryId: r.category_id, nextDate: r.next_date, status: r.status, active: !!r.active, anchorDay: r.anchor_day
  }),
  objectives: (r) => ({ id: r.id, name: r.name, target: euros(r.target_cents), domainId: r.domain_id || "all", deadline: r.deadline }),
};

const DOMAIN_COLORS = ["#d9a876", "#8b7aa8", "#8ea3b9", "#c9a86a", "#7fae8e", "#b97c7c", "#6f9a9a"];
const existsIn = (table, id) => id && get(`SELECT 1 FROM ${table} WHERE id = ?`, id);

// Valide et normalise le corps d'une requête vers les colonnes SQL.
const schema = {
  domains(b, prev = {}) {
    const name = String(b.name ?? prev.name ?? "").trim();
    need(name, "Le nom du business est requis.");
    const count = get("SELECT COUNT(*) n FROM domains").n;
    return {
      name, color: b.color || prev.color || DOMAIN_COLORS[count % DOMAIN_COLORS.length],
      active: (b.active ?? prev.active ?? true) ? 1 : 0,
      position: Number.isFinite(b.position) ? b.position : (prev.position ?? count),
    };
  },
  categories(b, prev = {}) {
    const name = String(b.name ?? prev.name ?? "").trim();
    need(name, "Le nom de la catégorie est requis.");
    return { name, color: b.color || prev.color || "#8ea3b9" };
  },
  transactions(b, prev = {}) {
    const m = { ...prev, ...b };
    const amount = cents(m.amount);
    need(amount > 0, "Le montant doit être supérieur à 0.");
    need(m.type === "in" || m.type === "out", "Type invalide.");
    need(isDate(m.date), "Date invalide.");
    const kind = m.kind === "invest" ? "invest" : "cash";
    if (kind === "invest") {
      need(String(m.asset || "").trim(), "Indique l'actif (ticker ou nom).");
      need(Number(m.qty) > 0, "La quantité doit être supérieure à 0.");
    }
    return {
      type: m.type, amount_cents: amount,
      domain_id: existsIn("domains", m.domainId) ? m.domainId : null,
      category_id: existsIn("categories", m.categoryId) ? m.categoryId : null,
      description: String(m.desc || "").trim(), date: m.date,
      status: m.status === "pending" ? "pending" : "paid", kind,
      asset: kind === "invest" ? String(m.asset).trim().toUpperCase() : "",
      qty: kind === "invest" ? Number(m.qty) : 0,
      unit_price: kind === "invest" ? Number(m.pricePerUnit) || 0 : 0,
      recurring_id: m.recurringId && existsIn("recurring", m.recurringId) ? m.recurringId : null,
      updated_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    };
  },
  recurring(b, prev = {}) {
    const m = { ...prev, ...b };
    need(String(m.name || "").trim(), "Le nom est requis.");
    need(cents(m.amount) > 0, "Le montant doit être supérieur à 0.");
    need(["daily", "weekly", "monthly", "yearly"].includes(m.freq), "Fréquence invalide.");
    need(isDate(m.nextDate), "Date de prochaine échéance invalide.");
    return {
      name: String(m.name).trim(), type: m.type === "in" ? "in" : "out", amount_cents: cents(m.amount), freq: m.freq,
      domain_id: existsIn("domains", m.domainId) ? m.domainId : null,
      category_id: existsIn("categories", m.categoryId) ? m.categoryId : null,
      next_date: m.nextDate, status: m.status === "pending" ? "pending" : "paid", active: m.active === false ? 0 : 1,
      // jour d'origine, pour qu'une échéance du 31 revienne le 31 après un mois court
      anchor_day: b.nextDate && b.nextDate !== prev.nextDate ? Number(b.nextDate.slice(8)) : (prev.anchorDay || Number(m.nextDate.slice(8))),
    };
  },
  objectives(b, prev = {}) {
    const m = { ...prev, ...b };
    need(String(m.name || "").trim(), "Le nom est requis.");
    need(cents(m.target) > 0, "Le montant cible doit être supérieur à 0.");
    return {
      name: String(m.name).trim(), target_cents: cents(m.target),
      domain_id: m.domainId && m.domainId !== "all" ? m.domainId : null,
      deadline: isDate(m.deadline) ? m.deadline : null,
    };
  },
};

function insert(table, cols, id = uid()) {
  const keys = Object.keys(cols);
  run(`INSERT INTO ${table} (id, ${keys.join(",")}) VALUES (?, ${keys.map(() => "?").join(",")})`, id, ...keys.map((k) => cols[k]));
  return id;
}
function update(table, id, cols) {
  const keys = Object.keys(cols);
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(",")} WHERE id = ?`, ...keys.map((k) => cols[k]), id);
}
const fetchOne = (table, id) => { const r = get(`SELECT * FROM ${table} WHERE id = ?`, id); return r && out[table](r); };

// ---------- récurrences : génère les mouvements arrivés à échéance ----------
function addPeriod(dateStr, freq, anchor) {
  const [y, m, d0] = dateStr.split("-").map(Number);
  const d = freq === "monthly" && anchor ? anchor : d0;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (freq === "daily") dt.setUTCDate(dt.getUTCDate() + 1);
  else if (freq === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else if (freq === "yearly") dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  else {
    const target = new Date(Date.UTC(y, m, 1)); // mois suivant, on garde le jour (borné à la fin du mois)
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, last));
    return target.toISOString().slice(0, 10);
  }
  return dt.toISOString().slice(0, 10);
}

function materializeRecurring() {
  const t = today();
  let created = 0;
  tx(() => {
    for (const r of all("SELECT * FROM recurring WHERE active = 1 AND next_date <= ?", t)) {
      let next = r.next_date, guard = 0;
      while (next <= t && guard++ < 1000) {
        insert("transactions", {
          type: r.type, amount_cents: r.amount_cents, domain_id: r.domain_id, category_id: r.category_id,
          description: r.name, date: next, status: r.status, kind: "cash", asset: "", qty: 0, unit_price: 0, recurring_id: r.id,
        });
        created++;
        next = addPeriod(next, r.freq, r.anchor_day);
      }
      run("UPDATE recurring SET next_date = ? WHERE id = ?", next, r.id);
    }
  });
  return created;
}

// ---------- sauvegardes ----------
function backup(label = "auto") {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const file = path.join(BACKUP_DIR, `ledger-${stamp}-${label}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = listBackups();
  for (const f of files.slice(KEEP_BACKUPS)) fs.rmSync(path.join(BACKUP_DIR, f.name), { force: true });
  run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_backup', ?)", new Date().toISOString());
  return path.basename(file);
}
function listBackups() {
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".db"))
    .map((name) => { const s = fs.statSync(path.join(BACKUP_DIR, name)); return { name, size: s.size, at: s.mtime.toISOString() }; })
    .sort((a, b) => b.at.localeCompare(a.at));
}
function dailyBackup() {
  const last = get("SELECT value FROM meta WHERE key = 'last_backup'")?.value;
  if (!last || last.slice(0, 10) !== new Date().toISOString().slice(0, 10)) backup("auto");
}

function restoreBackup(name) {
  need(/^[\w.-]+\.db$/.test(name), "Nom de sauvegarde invalide.");
  const file = path.join(BACKUP_DIR, name);
  need(fs.existsSync(file), "Sauvegarde introuvable.");
  backup("avant-restauration");
  db.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS src`);
  try {
    tx(() => {
      for (const t of ["transactions", "recurring", "objectives", "asset_prices", "categories", "domains"]) run(`DELETE FROM ${t}`);
      for (const t of ["domains", "categories", "recurring", "transactions", "objectives", "asset_prices"]) run(`INSERT INTO ${t} SELECT * FROM src.${t}`);
    });
  } finally { db.exec("DETACH DATABASE src"); }
}

// ---------- import / export JSON (format de l'ancien Ledger compatible) ----------
function exportState() {
  return {
    version: 3, exportedAt: new Date().toISOString(),
    domains: all("SELECT * FROM domains ORDER BY position").map(out.domains),
    categories: all("SELECT * FROM categories ORDER BY name").map(out.categories),
    transactions: all("SELECT * FROM transactions ORDER BY date DESC, created_at DESC").map(out.transactions),
    recurring: all("SELECT * FROM recurring ORDER BY next_date").map(out.recurring),
    objectives: all("SELECT * FROM objectives").map(out.objectives),
    assetPrices: Object.fromEntries(all("SELECT asset, price FROM asset_prices").map((r) => [r.asset, r.price])),
  };
}

function importState(data) {
  need(data && Array.isArray(data.domains) && Array.isArray(data.transactions), "Fichier non reconnu : il faut les listes domains et transactions.");
  backup("avant-import");
  tx(() => {
    for (const t of ["transactions", "recurring", "objectives", "asset_prices", "categories", "domains"]) run(`DELETE FROM ${t}`);
    data.domains.forEach((d, i) => insert("domains", {
      name: String(d.name || "Sans nom"), color: d.color || DOMAIN_COLORS[i % DOMAIN_COLORS.length],
      active: d.active === false ? 0 : 1, position: Number.isFinite(d.position) ? d.position : Number.isFinite(d.order) ? d.order : i,
    }, d.id || uid()));
    (data.categories || []).forEach((c) => insert("categories", schema.categories(c), c.id || uid()));
    (data.recurring || []).forEach((r) => {
      try { insert("recurring", schema.recurring({ nextDate: today(), ...r }), r.id || uid()); } catch { /* entrée ancienne incomplète */ }
    });
    for (const t of data.transactions) {
      const row = schema.transactions({
        ...t, desc: t.desc ?? t.description, date: isDate(t.date) ? t.date : today(),
        type: t.type === "out" ? "out" : "in", amount: Math.abs(Number(t.amount)) || 0.01,
      });
      insert("transactions", row, t.id || uid());
    }
    (data.objectives || []).forEach((o) => insert("objectives", schema.objectives(o), o.id || uid()));
    for (const [asset, price] of Object.entries(data.assetPrices || {})) run("INSERT OR REPLACE INTO asset_prices (asset, price) VALUES (?, ?)", asset.toUpperCase(), Number(price) || 0);
  });
}

function csvExport() {
  const domains = Object.fromEntries(all("SELECT id, name FROM domains").map((r) => [r.id, r.name]));
  const cats = Object.fromEntries(all("SELECT id, name FROM categories").map((r) => [r.id, r.name]));
  const rows = [["Date", "Description", "Business", "Catégorie", "Statut", "Type", "Montant (EUR)", "Actif", "Quantité"]];
  for (const t of all("SELECT * FROM transactions ORDER BY date")) {
    rows.push([t.date, t.description, domains[t.domain_id] || "", cats[t.category_id] || "", t.status === "pending" ? "En attente" : "Payé",
      t.type === "in" ? "Entrée" : "Sortie", ((t.type === "in" ? 1 : -1) * euros(t.amount_cents)).toFixed(2).replace(".", ","), t.asset, t.qty || ""]);
  }
  return "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
}

function info() {
  const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  return {
    app: "ledger", version: VERSION, dbPath: DB_PATH, backupDir: BACKUP_DIR,
    size: size(DB_PATH) + size(DB_PATH + "-wal"),
    lastBackup: get("SELECT value FROM meta WHERE key = 'last_backup'")?.value || null,
    counts: Object.fromEntries(["transactions", "domains", "categories", "recurring", "objectives"].map((t) => [t, get(`SELECT COUNT(*) n FROM ${t}`).n])),
    backups: listBackups(),
  };
}

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body) || typeof body === "string";
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}
async function readBody(req) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 20e6) throw new HttpError(413, "Fichier trop volumineux."); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, "JSON invalide."); }
}

const COLLECTIONS = ["domains", "categories", "transactions", "recurring", "objectives"];

async function api(req, res, parts) {
  const [resource, id, action] = parts;
  const method = req.method;

  if (resource === "state" && method === "GET") {
    materializeRecurring();
    return send(res, 200, { ...exportState(), info: info() });
  }
  if (resource === "info" && method === "GET") return send(res, 200, info());
  if (resource === "ping") return send(res, 200, { ok: true });
  if (resource === "export" && method === "GET") {
    const date = today();
    if (id === "csv") return send(res, 200, csvExport(), { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ledger-${date}.csv"` });
    return send(res, 200, JSON.stringify(exportState(), null, 2), { "Content-Disposition": `attachment; filename="ledger-${date}.json"` });
  }
  if (resource === "import" && method === "POST") { importState(await readBody(req)); return send(res, 200, { ok: true }); }
  if (resource === "backups") {
    if (method === "GET") return send(res, 200, listBackups());
    if (method === "POST" && !id) return send(res, 201, { name: backup("manuelle") });
    if (method === "POST" && action === "restore") { restoreBackup(decodeURIComponent(id)); return send(res, 200, { ok: true }); }
  }
  if (resource === "reveal" && method === "POST") {
    const [cmd, cmdArgs] = { darwin: ["open", ["-R", DB_PATH]], win32: ["explorer.exe", [`/select,${DB_PATH}`]] }[process.platform] || ["xdg-open", [DATA_DIR]];
    spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" }).unref();
    return send(res, 200, { ok: true });
  }
  if (resource === "prices" && id && method === "PUT") {
    const { price } = await readBody(req);
    need(Number.isFinite(Number(price)) && Number(price) >= 0, "Prix invalide.");
    run("INSERT OR REPLACE INTO asset_prices (asset, price, updated_at) VALUES (?, ?, datetime('now'))", decodeURIComponent(id).toUpperCase(), Number(price));
    return send(res, 200, { ok: true });
  }
  if (resource === "domains" && id === "reorder" && method === "POST") {
    const { ids } = await readBody(req);
    need(Array.isArray(ids), "Liste invalide.");
    tx(() => ids.forEach((d, i) => run("UPDATE domains SET position = ? WHERE id = ?", i, d)));
    return send(res, 200, { ok: true });
  }

  if (COLLECTIONS.includes(resource)) {
    if (method === "POST" && !id) {
      const body = await readBody(req);
      const newId = insert(resource, schema[resource](body), body.id && !existsIn(resource, body.id) ? String(body.id) : uid());
      if (resource === "recurring") materializeRecurring();
      return send(res, 201, fetchOne(resource, newId));
    }
    if (!id) throw new HttpError(405, "Méthode non autorisée.");
    const prev = fetchOne(resource, id);
    if (!prev) throw new HttpError(404, "Élément introuvable.");
    if (method === "PUT" || method === "PATCH") {
      update(resource, id, schema[resource](await readBody(req), prev));
      if (resource === "recurring") materializeRecurring();
      return send(res, 200, fetchOne(resource, id));
    }
    if (method === "DELETE") {
      if (resource === "domains") {
        const n = get("SELECT COUNT(*) n FROM transactions WHERE domain_id = ?", id).n;
        if (n > 0) throw new HttpError(409, `Ce business a ${n} mouvement${n > 1 ? "s" : ""}. Archive-le plutôt pour garder l'historique.`);
      }
      if (resource === "domains") run("UPDATE objectives SET domain_id = NULL WHERE domain_id = ?", id);
      run(`DELETE FROM ${resource} WHERE id = ?`, id);
      return send(res, 200, { ok: true, deleted: prev });
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

// ---------- démarrage ----------
const importFile = argVal("--import");
if (importFile) {
  importState(JSON.parse(fs.readFileSync(importFile, "utf8")));
  console.log(`Importé : ${importFile} → ${DB_PATH}`);
  process.exit(0);
}

dailyBackup();
setInterval(() => { dailyBackup(); materializeRecurring(); }, 60 * 60 * 1000).unref();

// L'API n'écoute que 127.0.0.1, mais une page web ouverte dans le navigateur peut quand même viser ce port.
// On refuse les requêtes venant d'un autre site (CSRF) et les noms d'hôte inconnus (DNS rebinding).
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
function checkOrigin(req) {
  if (!ALLOWED_HOSTS.has(req.headers.host)) throw new HttpError(403, "Hôte non autorisé.");
  if (req.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "Requête d'un autre site refusée.");
  const origin = req.headers.origin;
  if (req.method !== "GET" && origin && !ALLOWED_HOSTS.has(origin.replace(/^http:\/\//, ""))) throw new HttpError(403, "Requête d'un autre site refusée.");
}

let lastRequest = Date.now();
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  lastRequest = Date.now();
  try {
    if (pathname.startsWith("/api/")) {
      checkOrigin(req);
      dailyBackup();
      return await api(req, res, pathname.slice(5).split("/").filter(Boolean));
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: e.message || "Erreur serveur" });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`Ledger → http://localhost:${PORT}  (base : ${DB_PATH})`));
const close = () => { server.close(); db.close(); process.exit(0); };
process.on("SIGINT", close);
process.on("SIGTERM", close);
// Lancé par l'app Mac : s'arrête si l'app disparaît sans avoir pu le fermer (crash, kill).
if (args.includes("--exit-with-parent")) {
  const parent = process.ppid;
  setInterval(() => { try { process.kill(parent, 0); } catch { close(); } }, 2000).unref();
}
// Lancé par le lanceur Windows : s'arrête quand plus aucune fenêtre Ledger ne l'interroge (l'interface envoie un ping régulier).
const idle = Number(argVal("--exit-when-idle"));
if (idle > 0) setInterval(() => { if (Date.now() - lastRequest > idle * 1000) close(); }, 5000).unref();
