// node:fs réduit à ce que Ledger utilise, sur les fichiers privés de l'app (via le pont natif).
import { Buffer } from "buffer";
import { native } from "./native.js";

const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
const enc = (o) => (typeof o === "string" ? o : o?.encoding);

export function readFileSync(p, opts) {
  const b64 = native.readFile(String(p));
  if (b64 == null) throw enoent(p);
  const buf = Buffer.from(b64, "base64");
  return enc(opts) ? buf.toString(enc(opts)) : buf;
}
export function writeFileSync(p, data) {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data);
  if (!native.writeFile(String(p), buf.toString("base64"))) throw new Error(`Écriture impossible : ${p}`);
}
export const existsSync = (p) => native.exists(String(p));
export const mkdirSync = (p) => { native.mkdirs(String(p)); };
export const rmSync = (p, opts = {}) => { if (!native.remove(String(p), !!opts.recursive) && !opts.force && !existsSync(p)) throw enoent(p); };
export function readdirSync(p) {
  const list = native.list(String(p));
  if (list == null) throw enoent(p);
  return JSON.parse(list);
}
export function statSync(p) {
  const s = native.stat(String(p));
  if (s == null) throw enoent(p);
  const { size, mtime, dir } = JSON.parse(s);
  return { size, mtime: new Date(mtime), isDirectory: () => dir, isFile: () => !dir };
}
export const renameSync = (a, b) => { if (!native.rename(String(a), String(b))) throw enoent(a); };
export const copyFileSync = (a, b) => { if (!native.copy(String(a), String(b))) throw enoent(a); };
export const createReadStream = () => { throw new Error("Non disponible dans l'app."); };
export default { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, renameSync, copyFileSync, createReadStream };
