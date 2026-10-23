// Sauvegardes : copie quotidienne de la base, sauvegardes avant les opérations risquées, restauration.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { db, open, close, need, meta, HttpError, DB_PATH, BACKUP_DIR, LATEST_SCHEMA } from "./db.mjs";

const KEEP_BACKUPS = 30;
export const KEEP_DIR = path.join(BACKUP_DIR, "keep"); // jamais supprimées automatiquement
fs.mkdirSync(KEEP_DIR, { recursive: true });

const vacuumInto = (conn, file) => conn.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

export function backup(label = "auto") {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  let file = path.join(BACKUP_DIR, `ledger-${stamp}-${label}.db`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(BACKUP_DIR, `ledger-${stamp}-${label}-${i}.db`);
  vacuumInto(db, file);
  for (const f of listBackups().filter((b) => !b.kept).slice(KEEP_BACKUPS)) fs.rmSync(path.join(BACKUP_DIR, f.name), { force: true });
  meta.set("last_backup", new Date().toISOString());
  return path.basename(file);
}

// Sauvegarde conservée avant une migration de schéma, vérifiée avant de continuer.
export function keepBeforeMigration(conn, from, to) {
  const file = path.join(KEEP_DIR, `ledger-schema${from}-avant-v${to}.db`);
  if (fs.existsSync(file)) return;
  vacuumInto(conn, file);
  const check = new DatabaseSync(file, { readOnly: true });
  try { need(check.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "Sauvegarde avant migration illisible."); }
  finally { check.close(); }
}

const stat = (dir, name, kept) => { const s = fs.statSync(path.join(dir, name)); return { name: kept ? `keep/${name}` : name, size: s.size, at: s.mtime.toISOString(), kept }; };
export function listBackups() {
  const list = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".db")).map((n) => stat(BACKUP_DIR, n, false));
  const kept = fs.existsSync(KEEP_DIR) ? fs.readdirSync(KEEP_DIR).filter((f) => f.endsWith(".db")).map((n) => stat(KEEP_DIR, n, true)) : [];
  return [...list, ...kept].sort((a, b) => b.at.localeCompare(a.at));
}

export function dailyBackup() {
  const last = meta.get("last_backup");
  if (!last || last.slice(0, 10) !== new Date().toISOString().slice(0, 10)) backup("auto");
}

// Vérifie qu'un fichier est une base Ledger lisible et pas plus récente que cette version.
function inspect(file) {
  let conn;
  try {
    conn = new DatabaseSync(file, { readOnly: true });
    need(conn.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "Ce fichier est endommagé.");
    need(conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transactions'").get(), "Ce fichier n'est pas une base Ledger.");
    const hasMeta = conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
    const v = hasMeta ? Number(conn.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value || 1) : 1;
    need(v <= LATEST_SCHEMA, "Cette sauvegarde vient d'une version plus récente de Ledger.");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Ce fichier n'est pas une base Ledger lisible.");
  } finally { conn?.close(); }
}

// Remplace la base par `file` puis la rouvre : les migrations mettent à niveau un fichier plus ancien.
// En cas d'échec, la base d'origine est remise en place.
export function replaceDatabase(file, label, reopen) {
  inspect(file);
  const safety = backup(label);
  close();
  const swap = (src) => {
    for (const ext of ["-wal", "-shm"]) fs.rmSync(DB_PATH + ext, { force: true });
    fs.copyFileSync(src, DB_PATH);
  };
  try { swap(file); reopen(); }
  catch (e) {
    try { close(); } catch { /* déjà fermée */ }
    swap(path.join(BACKUP_DIR, safety));
    reopen();
    throw e instanceof HttpError ? e : new HttpError(400, `Restauration impossible : ${e.message}`);
  }
}

export function restoreBackup(name, reopen) {
  need(/^(keep\/)?[\w.-]+\.db$/.test(name), "Nom de sauvegarde invalide.");
  const file = path.join(BACKUP_DIR, name);
  need(fs.existsSync(file), "Sauvegarde introuvable.");
  replaceDatabase(file, "avant-restauration", reopen);
}

export { open };
