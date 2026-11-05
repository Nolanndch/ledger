// Pont vers le code Java de l'app (MainActivity.Bridge). Les appels sont synchrones, sauf discover.
export const native = globalThis.LedgerNative;
const pending = new Map();
let next = 1;
globalThis.__ledgerNativeResolve = (id, json) => { const p = pending.get(id); pending.delete(id); p?.(JSON.parse(json)); };
export function nativeAsync(method, ...args) {
  return new Promise((resolve) => { const id = String(next++); pending.set(id, resolve); native[method](id, ...args); });
}
