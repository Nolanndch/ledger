// node:sqlite (DatabaseSync) au-dessus de sql.js. La base vit en mémoire et est réécrite dans son fichier
// après chaque modification (flushAll), ou à la fermeture.
import fs from "./fs.js";

let SQL = null;
export const setSqlJs = (s) => { SQL = s; };
const open = new Set();

const norm = (params) => params.map((v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v));
const VACUUM_INTO = /^\s*VACUUM\s+INTO\s+'((?:[^']|'')*)'\s*;?\s*$/i;
const READ_ONLY = /^\s*(SELECT|WITH)\b/i;

export class DatabaseSync {
  constructor(file, opts = {}) {
    if (!SQL) throw new Error("SQLite n'est pas encore chargé.");
    this.file = file && file !== ":memory:" ? String(file) : null;
    this.readOnly = !!opts.readOnly;
    const data = this.file && fs.existsSync(this.file) ? fs.readFileSync(this.file) : null;
    this.db = new SQL.Database(data ? new Uint8Array(data) : undefined);
    this.dirty = !data && !!this.file && !this.readOnly; // une nouvelle base est écrite tout de suite
    open.add(this);
  }
  touch(sql) { if (!READ_ONLY.test(sql)) this.dirty = true; }
  exec(sql) {
    const m = VACUUM_INTO.exec(sql);
    if (m) { fs.writeFileSync(m[1].replace(/''/g, "'"), this.db.export()); return; }
    this.db.exec(sql);
    this.touch(sql);
  }
  prepare(sql) {
    const self = this;
    const each = (params, fn) => {
      const st = self.db.prepare(sql);
      try { st.bind(norm(params)); return fn(st); } finally { st.free(); self.touch(sql); }
    };
    return {
      all: (...p) => each(p, (st) => { const rows = []; while (st.step()) rows.push(st.getAsObject()); return rows; }),
      get: (...p) => each(p, (st) => (st.step() ? st.getAsObject() : undefined)),
      run: (...p) => each(p, (st) => { st.step(); return { changes: self.db.getRowsModified(), lastInsertRowid: 0 }; }),
    };
  }
  function(name, opts, fn) { this.db.create_function(name, typeof opts === "function" ? opts : fn); }
  flush() {
    if (!this.file || !this.dirty || this.readOnly) return;
    fs.writeFileSync(this.file, this.db.export());
    this.dirty = false;
  }
  close() { this.flush(); this.db.close(); open.delete(this); }
}
export const flushAll = () => { for (const d of open) d.flush(); };
export default { DatabaseSync };
