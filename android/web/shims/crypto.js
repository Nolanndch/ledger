// node:crypto : seulement ce que la synchro utilise, en JavaScript pur (noble) pour rester synchrone.
import { Buffer } from "buffer";
import { scrypt } from "@noble/hashes/scrypt.js";
import { gcm } from "@noble/ciphers/aes.js";

const bytes = (v) => (typeof v === "string" ? new TextEncoder().encode(v) : new Uint8Array(v));
export function randomBytes(n) { const b = Buffer.alloc(n); globalThis.crypto.getRandomValues(b); return b; }
export const scryptSync = (password, salt, keylen) => Buffer.from(scrypt(bytes(password), bytes(salt), { N: 16384, r: 8, p: 1, dkLen: keylen }));

export function createCipheriv(alg, key, iv) {
  if (alg !== "aes-256-gcm") throw new Error(`Chiffrement non pris en charge : ${alg}`);
  const chunks = [];
  let tag;
  return {
    update(d) { chunks.push(bytes(d)); return Buffer.alloc(0); },
    final() { const out = gcm(bytes(key), bytes(iv)).encrypt(Buffer.concat(chunks)); tag = out.slice(-16); return Buffer.from(out.slice(0, -16)); },
    getAuthTag: () => Buffer.from(tag),
  };
}
export function createDecipheriv(alg, key, iv) {
  if (alg !== "aes-256-gcm") throw new Error(`Chiffrement non pris en charge : ${alg}`);
  const chunks = [];
  let tag;
  return {
    setAuthTag(t) { tag = bytes(t); },
    update(d) { chunks.push(bytes(d)); return Buffer.alloc(0); },
    final() { return Buffer.from(gcm(bytes(key), bytes(iv)).decrypt(Buffer.concat([...chunks, tag]))); },
  };
}
export default { randomBytes, scryptSync, createCipheriv, createDecipheriv };
