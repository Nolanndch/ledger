// Les requêtes vers l'autre appareil (synchro) passent par l'app : la page est servie en ledger://, d'où
// WebKit refuserait d'appeler un Mac en http:// sur le réseau local.
import { nativeAsync } from "../../android/web/shims/native.js";

const pageFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (url.origin === location.origin) return pageFetch(input, init);
  const r = await nativeAsync("http", url.href, (init.method || "GET").toUpperCase(), init.body == null ? "" : String(init.body));
  if (r.error) throw new TypeError(r.error);
  return new Response(r.body, { status: r.status });
};
