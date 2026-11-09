// Pont vers le code Swift de l'app (LedgerApp.swift), avec la même forme que celui de l'app Android :
// globalThis.LedgerNative.methode(...args). WKWebView n'a pas d'appel synchrone vers le natif, donc chaque
// appel passe par prompt(), que l'app intercepte et auquel elle répond tout de suite (valeur encodée en JSON).
const call = (method, args) => {
  const r = prompt("ledger-native", JSON.stringify([method, ...args]));
  return r == null ? null : JSON.parse(r);
};
globalThis.LedgerNative = new Proxy({}, { get: (_, m) => (typeof m === "string" ? (...args) => call(m, args) : undefined) });
