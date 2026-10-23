import { $, $$, store, ui, refresh, VIEW_TITLES, render, go, setScope, closeSide, clickActions, changeActions, onClick, applyTheme } from "./core.js";
// Point d'entrée : charge les vues, branche la navigation et les raccourcis, puis lit la base.
import "./views/dashboard.js";
import "./views/ledger.js";
import "./views/analytics.js";
import "./views/recurring.js";
import "./views/objectives.js";
import "./views/investments.js";
import "./views/settings.js";
import { openTx } from "./dialogs/transaction.js";

onClick("view", (v) => go(v));
onClick("goto", (v) => go(v));
onClick("scope", (id) => setScope(id));
onClick("p", (p) => { ui.period = p; store.set("period", p); render(); });

document.addEventListener("click", async (e) => {
  const el = e.target.closest("button, [data-view], [data-row-edit]");
  if (!el) return;
  for (const [key, value] of Object.entries(el.dataset)) {
    if (clickActions[key]) return clickActions[key](value, el, e);
  }
});
document.addEventListener("change", (e) => {
  for (const [key, value] of Object.entries(e.target.dataset || {})) {
    if (changeActions[key]) return changeActions[key](value, e.target, e);
  }
});

$("#addTxBtn").addEventListener("click", () => openTx());
$("#manageDomainsLink").addEventListener("click", () => go("settings"));
$("#dbPill").addEventListener("click", () => go("settings"));
$("#menuBtn").addEventListener("click", () => { $("#side").classList.add("open"); $("#scrim").classList.add("open"); });
$("#scrim").addEventListener("click", closeSide);
$("#retryBtn").addEventListener("click", refresh);

document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]")) return;
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "n" || e.key === "N") { e.preventDefault(); openTx(); }
  if (e.key === "/") { e.preventDefault(); go("ledger"); $("#fSearch").focus(); }
});

let resizeT;
window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(render, 120); });
// Données fraîches quand on revient sur l'onglet (récurrences du jour, modifications ailleurs)
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

// ================= démarrage =================
applyTheme();
if (/LedgerMac\//.test(navigator.userAgent)) document.documentElement.classList.add("mac-app");
// Commandes appelées par les menus de l'app Mac
window.ledger = { newTx: () => { if (!document.querySelector("dialog[open]")) openTx(); }, go: (v) => VIEW_TITLES[v] && go(v), refresh };
if (!VIEW_TITLES[ui.view]) ui.view = "dashboard";
$$(".view").forEach((s) => (s.hidden = s.id !== "view-" + ui.view));
refresh();
if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !/LedgerMac\//.test(navigator.userAgent)) navigator.serviceWorker.register("sw.js").catch(() => {});
