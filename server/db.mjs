// Base SQLite : ouverture, migrations versionnées et petites fonctions d'accès.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./schema.mjs";

const DEFAULT_DATA_DIR = {
  darwin: path.join(os.homedir(), "Library", "Application Support", "Ledger"),
  win32: path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Ledger"),
}[process.platform] || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "ledger");
export const DATA_DIR = process.env.LEDGER_DATA_DIR || DEFAULT_DATA_DIR;
export const DB_PATH = path.join(DATA_DIR, "ledger.db");
export const BACKUP_DIR = path.join(DATA_DIR, "backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });

export let db = null;

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const need = (cond, msg) => { if (!cond) throw new HttpError(400, msg); };

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const cents = (v) => Math.round((Number(v) || 0) * 100);
export const euros = (c) => (c || 0) / 100;
export const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, heure locale
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const nowStamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

let depth = 0;
// Transaction d'écriture. Réentrante : un appel imbriqué rejoint la transaction en cours.
export function tx(fn) {
  if (depth > 0) { depth++; try { return fn(); } finally { depth--; } }
  db.exec("BEGIN IMMEDIATE"); // verrou d'écriture dès le début : deux serveurs sur la même base ne se doublent pas
  depth = 1;
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
  finally { depth = 0; }
}

export function insert(table, cols, id = uid()) {
  const keys = Object.keys(cols);
  run(`INSERT INTO ${table} (id, ${keys.join(",")}) VALUES (?, ${keys.map(() => "?").join(",")})`, id, ...keys.map((k) => cols[k]));
  return id;
}
export function update(table, id, cols) {
  const keys = Object.keys(cols);
  if (keys.length) run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(",")} WHERE id = ?`, ...keys.map((k) => cols[k]), id);
}
export const existsIn = (table, id) => !!(id && get(`SELECT 1 FROM ${table} WHERE id = ?`, id));
export const meta = {
  get: (key) => get("SELECT value FROM meta WHERE key = ?", key)?.value ?? null,
  set: (key, value) => run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, String(value)),
};

export const schemaVersion = () => Number(meta.get("schema_version") || 0);
export const LATEST_SCHEMA = MIGRATIONS.length;

// Ouvre la base et applique les migrations manquantes. `beforeMigrate(from, to)` est appelé avant
// toute migration d'une base qui contient déjà des données (sauvegarde de sécurité).
export function open(beforeMigrate = () => {}) {
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  let version = schemaVersion();
  // Base 1.0 sans numéro de version : elle a déjà la table transactions.
  if (version === 0 && get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transactions'")) version = 1;
  if (version > LATEST_SCHEMA) throw new Error(`Cette base vient d'une version plus récente de Ledger (schéma ${version}). Mets l'application à jour.`);
  if (version > 0 && version < LATEST_SCHEMA) beforeMigrate(version, LATEST_SCHEMA);
  for (let v = version; v < LATEST_SCHEMA; v++) {
    // Les reconstructions de tables se font clés étrangères désactivées, puis on vérifie l'intégrité avant de valider.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      MIGRATIONS[v]({ db, all, get, run, insert, uid, fresh: version === 0 });
      const broken = all("PRAGMA foreign_key_check");
      if (broken.length) throw new Error(`Migration ${v + 1} : ${broken.length} référence(s) cassée(s) (${broken[0].table}).`);
      meta.set("schema_version", v + 1);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      db.exec("PRAGMA foreign_keys = ON");
      throw e;
    }
    db.exec("PRAGMA foreign_keys = ON");
  }
  return db;
}

export function close() {
  if (!db) return;
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* base déjà fermée */ }
  db.close();
  db = null;
}
