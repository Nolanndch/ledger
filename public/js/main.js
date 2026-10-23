import { periodBounds, S, display, setDiscreet, $, $$, store, ui, refresh, VIEW_TITLES, render, go, setScope, closeSide, clickActions, changeActions, onClick, applyTheme } from "./core.js";
// Point d'entrée : charge les vues, branche la navigation et les raccourcis, puis lit la base.
import "./views/dashboard.js";
import "./views/ledger.js";
import "./views/analytics.js";
import "./views/subscriptions.js";
import "./views/objectives.js";
import "./views/investments.js";
import "./views/settings.js";
import { openTx } from "./dialogs/transaction.js";

onClick("view", (v) => go(v));
onClick("goto", (v) => go(v));
onClick("scope", (id) => setScope(id));
function setPeriod(p) { ui.period = p; store.set("period", p); togglePeriodPop(false); render(); }
function togglePeriodPop(open = $("#periodPop").hidden) {
  $("#periodPop").hidden = !open;
  $("#periodBtn").setAttribute("aria-expanded", String(open));
  if (open) {
    const b = periodBounds();
    $("#periodFrom").value = ui.custom?.from || b.start || "";
    $("#periodTo").value = ui.custom?.to || b.end || "";
    $("#periodCustom").classList.toggle("active", ui.period === "custom");
  }
}
onClick("p", (p) => setPeriod(p));
$("#periodBtn").addEventListener("click", () => togglePeriodPop());
$("#periodCustom").addEventListener("submit", (e) => {
  e.preventDefault();
  ui.custom = { from: $("#periodFrom").value, to: $("#periodTo").value };
  store.set("customPeriod", ui.custom);
  setPeriod("custom");
});
document.addEventListener("click", (e) => { if (!$("#periodPop").hidden && !e.target.closest("#periodPicker")) togglePeriodPop(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#periodPop").hidden) togglePeriodPop(false); });

document.addEventListener("click", async (e) => {
  const el = e.target.closest("button, [data-view], [data-row-edit], [data-goto], [data-op-edit], [data-inv-account]");
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
$("#discreetBtn").addEventListener("click", () => setDiscreet(!display.discreet));

document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]")) return;
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "n" || e.key === "N") { e.preventDefault(); openTx(); }
  if (e.key === "/") { e.preventDefault(); go("ledger"); $("#fSearch").focus(); }
  if (e.key === "h" || e.key === "H") { e.preventDefault(); setDiscreet(!display.discreet); }
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
// Au premier chargement : période et vue d'ouverture choisies dans les réglages
refresh().then(() => {
  const st = S.settings || {};
  if (st.defaultPeriod && !sessionStorage.getItem("ledger.opened")) { ui.period = st.defaultPeriod; store.set("period", st.defaultPeriod); }
  if (st.startView && st.startView !== "last" && !sessionStorage.getItem("ledger.opened") && VIEW_TITLES[st.startView]) go(st.startView);
  else render();
  try { sessionStorage.setItem("ledger.opened", "1"); } catch {}
});
if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !/LedgerMac\//.test(navigator.userAgent)) navigator.serviceWorker.register("sw.js").catch(() => {});
