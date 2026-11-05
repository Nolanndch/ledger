// App Android : le « serveur » de Ledger tourne dans la page. Les appels fetch("/api/…") de l'interface
// sont servis ici par le même code que sur le Mac (server/api.mjs), sur une base SQLite (sql.js) enregistrée
// dans les fichiers privés de l'app.
import "./globals.js";
import initSqlJs from "sql.js/dist/sql-wasm-browser.js";
import { Buffer } from "buffer";
import { setSqlJs, flushAll } from "./shims/sqlite.js";
import { native, nativeAsync } from "./shims/native.js";
import * as DB from "../../server/db.mjs";
import { open, HttpError } from "../../server/db.mjs";
import { dailyBackup, keepBeforeMigration } from "../../server/backup.mjs";
import * as L from "../../server/ledger.mjs";
import * as Sync from "../../server/sync.mjs";
import { handle } from "../../server/api.mjs";

const reopen = () => { open((from, to) => keepBeforeMigration(DB.db, from, to)); Sync.ensure(); };
const reopenReplaced = () => { open((from, to) => keepBeforeMigration(DB.db, from, to)); Sync.ensure({ replaced: true }); };
const CTX = { version: __LEDGER_VERSION__, reopen, reopenReplaced, reveal: null };

const ready = (async () => {
  setSqlJs(await initSqlJs({ locateFile: () => "/sql-wasm-browser.wasm" }));
  Sync.setDefaultName(native.deviceName());
  Sync.setDiscover(async (port, timeout) => nativeAsync("discover", port, timeout));
  reopen();
  dailyBackup();
  L.materializeRecurring();
  flushAll();
  Sync.start();
})();
ready.catch((e) => console.error("Démarrage de Ledger impossible", e));

// Les synchros automatiques modifient la base en arrière-plan : on l'enregistre régulièrement.
setInterval(() => { try { flushAll(); } catch (e) { console.error(e); } }, 2000);
globalThis.ledgerFlush = () => { try { flushAll(); } catch (e) { console.error(e); } };
document.addEventListener("visibilitychange", () => { if (document.hidden) globalThis.ledgerFlush(); });

const json = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
});

async function serve(url, init) {
  try { await ready; } catch (e) { return json(500, { error: `Démarrage impossible : ${e.message}` }); }
  const method = (init.method || "GET").toUpperCase();
  let body = {};
  if (init.body) { try { body = JSON.parse(init.body); } catch { return json(400, { error: "JSON invalide." }); } }
  try {
    dailyBackup();
    const r = await handle({ method, parts: url.pathname.slice(5).split("/").filter(Boolean), query: url.searchParams, body }, CTX);
    return json(r.status, r.body, r.headers);
  } catch (e) {
    const status = e instanceof HttpError || e.status ? e.status : 500;
    if (status === 500) console.error(e);
    return json(status, { error: status === 500 ? `Erreur interne : ${e.message}` : e.message });
  } finally { globalThis.ledgerFlush(); }
}

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return serve(url, init);
  return realFetch(input, init);
};

// Exports (liens « download ») : enregistrés dans le dossier Téléchargements du téléphone.
document.addEventListener("click", async (e) => {
  const a = e.target.closest?.("a[href^='/api/']");
  if (!a) return;
  e.preventDefault();
  const res = await fetch(a.getAttribute("href"));
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "ledger-export.txt";
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  native.saveDownload(name, res.headers.get("Content-Type") || "application/octet-stream", data);
}, true);

// Bouton retour d'Android : ferme d'abord une fenêtre ou le menu.
globalThis.ledgerBack = () => {
  const dialog = document.querySelector("dialog[open]");
  if (dialog) { dialog.close(); return true; }
  const side = document.querySelector("#side.open");
  if (side) { side.classList.remove("open"); document.querySelector("#scrim")?.classList.remove("open"); return true; }
  const pop = document.querySelector("#periodPop:not([hidden])");
  if (pop) { pop.hidden = true; return true; }
  return false;
};

// Barres système de la couleur du fond de l'app (thème clair ou sombre).
const bars = () => { if (document.body) native.setBars(getComputedStyle(document.body).backgroundColor); };
new MutationObserver(bars).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", bars);
document.addEventListener("DOMContentLoaded", () => { document.documentElement.classList.add("android-app"); bars(); });
