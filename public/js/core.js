// Socle partagé : état, API, formats, période, graphiques, navigation et registre des vues.
import { addPeriod, addDays, daysBetween } from "./dates.js";
import { replay, value as valuate } from "./lib/portfolio.js";
// ================= utilitaires =================
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const eur0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
// Affichage des montants : centimes (réglage partagé) et mode discret (propre à cet appareil).
export const display = { cents: true, discreet: false };
try { display.discreet = localStorage.getItem("ledger.ui.discreet") === "true"; } catch {}
const MASK = "•••• €";
const nb = (s) => s.replace(/\u202f/g, "\u00a0");
export const fmtExact = (n) => nb(eur.format(n || 0));
export const fmt = (n) => display.discreet ? MASK : nb((display.cents ? eur : eur0).format(n || 0));
export const fmtSigned = (n) => display.discreet ? MASK : (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
export const fmtCents = (c) => fmt((c || 0) / 100);
export const fmtSignedCents = (c) => fmtSigned((c || 0) / 100);
export const fmtQty = (q) => display.discreet ? "•••" : Number((q || 0).toPrecision(12)).toLocaleString("fr-FR", { maximumFractionDigits: 8 });
export const fmtPct = (x, digits = 1) => x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(digits).replace(".", ",")} %`;
export const fmtShort = (n) => {
  if (display.discreet) return "•••";
  const a = Math.abs(n);
  if (a >= 1000) return (n < 0 ? "−" : "") + (a / 1000).toLocaleString("fr-FR", { maximumFractionDigits: a >= 10000 ? 0 : 1 }) + " k€";
  return (n < 0 ? "−" : "") + nb(eur0.format(a));
};
export const pad = (n) => String(n).padStart(2, "0");
export const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => localISO(new Date());
export const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const fmtDate = (s) => { const d = parseISO(s); return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
export const monthKey = (s) => s.slice(0, 7);
export const monthLabel = (k, long) => { const [y, m] = k.split("-").map(Number); return long ? `${MONTHS_LONG[m - 1]} ${y}` : MONTHS[m - 1]; };
export const addMonths = (k, n) => { const [y, m] = k.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const relTime = (iso) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return "à l'instant"; if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`; if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
};
export const fmtBytes = (b) => b > 1e6 ? (b / 1e6).toFixed(1) + " Mo" : Math.max(1, Math.round(b / 1e3)) + " ko";
export const store = {
  get(k, d) { try { const v = localStorage.getItem("ledger.ui." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ledger.ui." + k, JSON.stringify(v)); } catch {} },
};
export const ICON = {
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  archive: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/></svg>',
  restore: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  refund: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
};

// ================= état =================
export const S = { domains: [], categories: [], transactions: [], recurring: [], objectives: [], accounts: [], operations: [], assets: [], settings: {}, info: null };
// Remplace le contenu de l'état sans changer l'objet (les modules gardent la même référence)
export function replaceState(data) { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, data); }
export const ui = {
  view: store.get("view", "dashboard"),
  scope: store.get("scope", "all"),
  period: store.get("period", "all"),
  custom: store.get("customPeriod", null),
  sort: { key: "date", dir: -1 },
  online: false,
  lastSync: null,
};

// ================= API =================
export async function api(method, url, body) {
  setDb("busy");
  let res;
  try {
    res = await fetch("/api/" + url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    setDb("off");
    throw new Error("Serveur injoignable. Lance node server.mjs.");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) { setDb("on"); throw new Error(data?.error || `Erreur ${res.status}`); }
  return data;
}
export async function refresh() {
  try {
    const data = await api("GET", "state");
    replaceState(data);
    applySettings();
    ui.lastSync = new Date().toISOString();
    setDb("on");
    render();
  } catch (e) {
    setDb("off");
    if (!S.info) render();
  }
}
// Réglages d'affichage enregistrés dans la base
export function applySettings() {
  const st = S.settings || {};
  display.cents = st.showCents !== false;
  document.documentElement.classList.toggle("density-compact", st.density === "compact");
}
export async function saveSettings(patch, msg) {
  S.settings = { ...S.settings, ...patch };
  applySettings();
  render();
  try { S.settings = await api("PUT", "settings", patch); if (msg) toast(msg); }
  catch (e) { toast(e.message, null, true); refresh(); }
}
export const widgetOn = (key, def = true) => S.settings?.dashboardWidgets?.[key] ?? def;
export const columnOn = (key, def = true) => S.settings?.ledgerColumns?.[key] ?? def;
export function setDiscreet(on) {
  display.discreet = on;
  try { localStorage.setItem("ledger.ui.discreet", String(on)); } catch {}
  document.documentElement.classList.toggle("discreet", on);
  render();
}

// Exécute une mutation puis recharge l'état depuis la base. Renvoie le résultat ou null si erreur (affichée).
export async function mutate(method, url, body, okMsg, undo) {
  try {
    const r = await api(method, url, body);
    await refresh();
    if (okMsg) toast(okMsg, undo);
    return r ?? true;
  } catch (e) { toast(e.message, null, true); return null; }
}

export function setDb(state) {
  const pill = $("#dbPill");
  pill.classList.toggle("off", state === "off");
  pill.classList.toggle("busy", state === "busy");
  ui.online = state !== "off";
  $("#offlineBanner").hidden = state !== "off";
  if (state === "off") { $("#dbTitle").textContent = "Serveur arrêté"; $("#dbSub").textContent = "modifications impossibles"; }
  else if (state === "on") { $("#dbTitle").textContent = "Base locale connectée"; updateDbSub(); }
  else { $("#dbTitle").textContent = "Enregistrement…"; }
}
export function updateDbSub() {
  if (!ui.online || !ui.lastSync) return;
  const n = S.info?.counts?.transactions ?? 0;
  $("#dbSub").textContent = `${n} mouvement${n > 1 ? "s" : ""} · synchro ${relTime(ui.lastSync)}`;
}
setInterval(updateDbSub, 15000);
// Signale au serveur qu'une fenêtre est ouverte (sous Windows, il s'arrête tout seul quand plus personne ne l'utilise)
setInterval(() => fetch("/api/ping").catch(() => {}), 30000);

// ================= toasts & confirmation =================
export function toast(msg, undo, isErr) {
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (undo) {
    const b = document.createElement("button");
    b.textContent = "Annuler";
    b.onclick = () => { el.remove(); undo(); };
    el.appendChild(b);
  }
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), undo ? 7000 : isErr ? 6000 : 2800);
}
export function confirmBox(title, text, okLabel = "Confirmer") {
  const d = $("#confirmDialog");
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  $("#confirmOk").textContent = okLabel;
  d.returnValue = "";
  d.showModal();
  return new Promise((res) => d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true }));
}

// ================= sélecteurs de données =================
export const domainById = (id) => S.domains.find((d) => d.id === id);
export const catById = (id) => S.categories.find((c) => c.id === id);
export const activeDomains = () => S.domains.filter((d) => d.active).sort((a, b) => a.position - b.position);
export const signed = (t) => (t.type === "in" ? t.amount : -t.amount);

// ---------- périodes ----------
export const PERIODS = [
  ["month", "Ce mois"], ["lastMonth", "Mois dernier"], ["3m", "3 derniers mois"], ["year", "Cette année"],
  ["lastYear", "Année dernière"], ["12m", "12 derniers mois"], ["all", "Tout"], ["custom", "Personnalisée"],
];
const lastDay = (k) => { const [y, m] = k.split("-").map(Number); return `${k}-${pad(new Date(y, m, 0).getDate())}`; };
// Bornes incluses de la période choisie. `start` vaut null pour « Tout ». La fin de « Tout » est aujourd'hui :
// les échéances futures restent dans « À venir ».
export function periodBounds(p = ui.period) {
  const t = todayISO(), k = t.slice(0, 7), y = Number(t.slice(0, 4));
  switch (p) {
    case "month": return { start: k + "-01", end: lastDay(k) };
    case "lastMonth": { const m = addMonths(k, -1); return { start: m + "-01", end: lastDay(m) }; }
    case "3m": return { start: addMonths(k, -2) + "-01", end: lastDay(k) };
    case "year": return { start: `${y}-01-01`, end: `${y}-12-31` };
    case "lastYear": return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
    case "12m": return { start: addMonths(k, -11) + "-01", end: lastDay(k) };
    case "custom": {
      const c = ui.custom || {};
      if (c.from && c.to) return c.from <= c.to ? { start: c.from, end: c.to } : { start: c.to, end: c.from };
      return { start: null, end: t };
    }
    default: return { start: null, end: t };
  }
}
export const periodStart = () => periodBounds().start;
const shortDate = (s) => { const d = parseISO(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
export function periodLabel(p = ui.period) {
  if (p === "custom") { const b = periodBounds(p); return b.start ? `du ${shortDate(b.start)} au ${shortDate(b.end)}` : "depuis le début"; }
  return { month: "ce mois-ci", lastMonth: "le mois dernier", "3m": "sur 3 mois", year: "cette année", lastYear: "l'année dernière", "12m": "sur 12 mois", all: "depuis le début" }[p] || "";
}
export const PERIOD_LABEL = new Proxy({}, { get: (_, p) => periodLabel(p) });
export const periodName = (p = ui.period) => (p === "custom" && periodBounds(p).start ? periodLabel(p).replace(/^du /, "Du ") : PERIODS.find(([k]) => k === p)?.[1] || "Tout");
export const inPeriod = (date, b = periodBounds()) => (!b.start || date >= b.start) && date <= b.end;

// Mouvements du business sélectionné (toutes périodes). Les business archivés restent visibles quand on les sélectionne.
export function scopeTx() {
  if (ui.scope === "all") return S.transactions;
  return S.transactions.filter((t) => t.domainId === ui.scope);
}
export function periodTx(list = scopeTx()) {
  const b = periodBounds();
  return list.filter((t) => inPeriod(t.date, b));
}
export function sums(list) {
  const r = { in: 0, out: 0, net: 0, pIn: 0, pOut: 0, pNet: 0 };
  for (const t of list) {
    if (t.status === "pending") { t.type === "in" ? (r.pIn += t.amount) : (r.pOut += t.amount); }
    else { t.type === "in" ? (r.in += t.amount) : (r.out += t.amount); }
  }
  r.net = r.in - r.out; r.pNet = r.pIn - r.pOut;
  return r;
}
// Virements vers les placements : de l'argent déplacé, pas une dépense. Exclus des résultats.
export const isTransfer = (t) => t.kind === "transfer";
export const operating = (list) => list.filter((t) => t.kind !== "transfer");
// Chiffre d'affaires et dépenses, nets des remboursements, hors virements.
export function pnl(list) {
  const r = { revenue: 0, expenses: 0, result: 0, pRevenue: 0, pExpenses: 0, transfers: 0, refunds: 0 };
  for (const t of list) {
    const paid = t.status === "paid", a = t.amount;
    if (t.kind === "transfer") { if (paid) r.transfers += t.type === "out" ? a : -a; continue; }
    if (t.kind === "refund") {
      if (t.type === "out") { if (paid) { r.revenue -= a; r.refunds += a; } else r.pRevenue -= a; }
      else if (paid) r.expenses -= a; else r.pExpenses -= a;
      continue;
    }
    if (t.type === "in") { if (paid) r.revenue += a; else r.pRevenue += a; }
    else if (paid) r.expenses += a; else r.pExpenses += a;
  }
  r.result = r.revenue - r.expenses;
  return r;
}
// Trésorerie : soldes de départ + mouvements payés (virements compris) depuis la date de départ de chaque business.
export function treasury(scope = ui.scope, upTo = todayISO()) {
  const doms = scope === "all" ? S.domains : S.domains.filter((d) => d.id === scope);
  const opening = new Map(doms.map((d) => [d.id, d.openingDate]));
  let total = doms.reduce((a, d) => a + (d.openingDate && d.openingDate > upTo ? 0 : d.openingBalance || 0), 0);
  for (const t of S.transactions) {
    if (t.status !== "paid" || t.date > upTo) continue;
    if (scope !== "all" && t.domainId !== scope) continue;
    const od = opening.get(t.domainId);
    if (od && t.date < od) continue;
    total += signed(t);
  }
  return total;
}
export const hasOpeningBalance = (scope = ui.scope) => S.domains.some((d) => (scope === "all" || d.id === scope) && d.openingBalance);
// Période précédente de même durée, pour comparer. Une période en cours est coupée à aujourd'hui des deux côtés.
function shiftMonths(d, n) {
  const [y, m, day] = d.split("-").map(Number);
  const t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = t % 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(day, last))}`;
}
export function comparisonBounds(p = ui.period) {
  const b = periodBounds(p);
  if (!b.start) return null;
  const t = todayISO();
  if (b.start > t) return null;
  const cur = { start: b.start, end: b.end > t ? t : b.end };
  const months = { month: 1, lastMonth: 1, "3m": 3, "12m": 12, year: 12, lastYear: 12 }[p];
  let prev;
  if (months) prev = { start: shiftMonths(cur.start, -months), end: shiftMonths(cur.end, -months) };
  else { const len = daysBetween(cur.start, cur.end) + 1; prev = { start: addDays(cur.start, -len), end: addDays(cur.start, -1) }; }
  return { cur, prev };
}
export const between = (list, b) => list.filter((t) => t.date >= b.start && t.date <= b.end);

// ---------- placements ----------
export const priceMap = () => Object.fromEntries(S.assets.filter((a) => a.price > 0).map((a) => [a.symbol, a.price]));
export function accountResult(acc, prices = priceMap()) {
  const r = replay(acc, S.operations.filter((o) => o.accountId === acc.id), { strict: false });
  return { account: acc, r, v: valuate(r, prices) };
}
export function portfolio(accounts = S.accounts.filter((a) => !a.closedOn)) {
  const prices = priceMap();
  const list = accounts.map((a) => accountResult(a, prices));
  const sum = (f) => list.reduce((x, a) => x + f(a), 0);
  return {
    accounts: list, value: sum((a) => a.v.total), contributions: sum((a) => a.r.contributions), gain: sum((a) => a.v.gain),
    realized: sum((a) => a.r.realized), unrealized: sum((a) => a.v.unrealized), income: sum((a) => a.r.income), fees: sum((a) => a.r.fees + a.r.taxes),
  };
}

// Mois couverts par la période, jusqu'au mois courant au plus tard (au moins 6 pour garder du contexte)
export function monthRange(minMonths = 6) {
  const cur = todayISO().slice(0, 7);
  const b = periodBounds();
  let last = monthKey(b.end) < cur ? monthKey(b.end) : cur;
  let first;
  if (b.start) first = monthKey(b.start);
  else {
    const dates = scopeTx().map((t) => t.date).filter((d) => d <= b.end).sort();
    first = dates.length ? monthKey(dates[0]) : last;
  }
  const min = addMonths(last, -(minMonths - 1));
  if (first > min) first = min;
  const out = [];
  for (let k = first; k <= last; k = addMonths(k, 1)) out.push(k);
  return out;
}


// ================= rendu =================
// Registre des vues : chaque module de vue s'enregistre avec son titre et sa fonction de rendu.
export const VIEWS = {};
export function registerView(name, def) { VIEWS[name] = { usesPeriod: false, usesScope: true, ...def }; }
export const VIEW_TITLES = new Proxy({}, { get: (_, k) => VIEWS[k]?.title });

export function render() {
  renderNav();
  renderTopbar();
  VIEWS[ui.view]?.render();
  fillSelects();
  updateDbSub();
}

export function renderNav() {
  $$("#nav .nav-item").forEach((b) => b.setAttribute("aria-current", String(b.dataset.view === ui.view)));
  $("#navCountTx").textContent = S.transactions.length || "";
  const today = todayISO();
  $("#navCountRec").textContent = S.recurring.filter((r) => !r.endDate || r.endDate > today).length || "";
  $("#navCountInv").textContent = S.accounts.filter((a) => !a.closedOn).length || "";
  if (ui.scope !== "all" && !domainById(ui.scope)) ui.scope = "all";
  const doms = activeDomains();
  const scoped = ui.scope !== "all" ? domainById(ui.scope) : null;
  if (scoped && !scoped.active) doms.push(scoped);
  const items = [`<button class="nav-item" data-scope="all" aria-current="${ui.scope === "all"}"><span class="dot" style="background:var(--ink-3)"></span><span class="grow">Tous les business</span><span class="count">${fmtShort(treasury("all"))}</span></button>`];
  for (const d of doms) {
    const net = treasury(d.id);
    items.push(`<button class="nav-item" data-scope="${d.id}" aria-current="${ui.scope === d.id}"><span class="dot" style="background:${esc(d.color)}"></span><span class="grow">${esc(d.name)}${d.active ? "" : " (archivé)"}</span><span class="count">${fmtShort(net)}</span></button>`);
  }
  $("#domainNav").innerHTML = items.join("");
}

export function renderTopbar() {
  const view = VIEWS[ui.view] || {};
  $("#viewTitle").textContent = view.title || "";
  const d = ui.scope !== "all" ? domainById(ui.scope) : null;
  const usesPeriod = !!view.usesPeriod;
  const usesScope = !!view.usesScope;
  $("#viewScope").innerHTML = usesScope
    ? (d ? `<span class="dot" style="background:${esc(d.color)}"></span>${esc(d.name)}` : "Tous les business") + (usesPeriod ? ` · ${PERIOD_LABEL[ui.period]}` : "")
    : "";
  $("#discreetBtn")?.setAttribute("aria-pressed", String(display.discreet));
  $("#periodPicker").hidden = !usesPeriod;
  $("#periodBtnLabel").textContent = periodName();
  $$("#periodPop [data-p]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === ui.period)));
}


export function barRow(name, color, value, max, title = "", scopeId) {
  const w = Math.max(2, (Math.abs(value) / max) * 100);
  return `<div class="bar-row" title="${esc(title)}">
    <div class="name">${scopeId ? `<button class="tag" data-scope="${scopeId}">` : `<span class="tag">`}<span class="dot" style="background:${esc(color)}"></span><span>${esc(name)}</span>${scopeId ? "</button>" : "</span>"}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${value >= 0 ? esc(color) : "var(--down)"}"></div></div>
    <div class="val ${value < 0 ? "down" : ""}">${fmtSigned(value)}</div></div>`;
}

export const isOverdue = (t) => t.status === "pending" && t.date < todayISO();
export function txMeta(t) {
  const d = domainById(t.domainId), c = catById(t.categoryId);
  const bits = [fmtDate(t.date)];
  if (t.counterparty) bits.push(esc(t.counterparty));
  if (d) bits.push(esc(d.name));
  if (c) bits.push(esc(c.name));
  return bits.join(" · ");
}
export function natureBadge(t) {
  if (t.kind === "transfer") return `<span class="badge" title="Virement vers un placement">${ICON.link}placement</span>`;
  if (t.kind === "refund") return `<span class="badge">${ICON.refund}remboursement</span>`;
  if (t.nature === "installment") return `<span class="badge" title="Paiement en plusieurs fois">${t.installmentIndex}/${t.installmentCount}</span>`;
  if (t.recurringId) return `<span class="badge" title="Créé par un abonnement">${ICON.repeat}</span>`;
  return "";
}
export function txRow(t, withPay) {
  const d = domainById(t.domainId);
  const late = isOverdue(t);
  return `<div class="row">
    <span class="dot" style="background:${d ? esc(d.color) : "var(--ink-3)"}"></span>
    <div class="grow"><div class="title">${esc(t.desc || "Sans libellé")} ${natureBadge(t)}${late ? ' <span class="chip down">En retard</span>' : ""}</div><div class="sub">${txMeta(t)}</div></div>
    <span class="amt ${t.type === "in" ? "up" : "down"}">${t.type === "in" ? "+" : "−"}${fmt(t.amount)}</span>
    ${withPay ? `<button class="btn small" data-pay="${t.id}">${t.type === "in" ? "Encaissé" : "Payé"}</button>` : `<button class="icon-btn" data-edit="${t.id}" aria-label="Modifier">${ICON.edit}</button>`}
  </div>`;
}


// ---------- graphiques ----------
export function niceStep(range, count) {
  const raw = range / count, mag = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
export function scaleY(min, max, top, bottom, count = 4) {
  if (min === max) { max = min + 100; }
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { ticks, y: (v) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top) };
}
export function chartFrame(el, H) {
  const W = Math.max(280, el.clientWidth || 600);
  return { W, H, m: { t: 14, r: 14, b: 26, l: 58 } };
}
export function attachTip(el, svg, cols, html) {
  let tip = el.querySelector(".tip");
  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
    let best = 0; cols.forEach((c, i) => { if (Math.abs(c.x - x) < Math.abs(cols[best].x - x)) best = i; });
    const c = cols[best];
    if (!tip) { tip = document.createElement("div"); tip.className = "tip"; el.appendChild(tip); }
    tip.innerHTML = html(best);
    tip.style.left = (c.x / svg.viewBox.baseVal.width) * r.width + "px";
    tip.style.top = (c.y / svg.viewBox.baseVal.height) * r.height + "px";
    tip.hidden = false;
    el.querySelectorAll("[data-col]").forEach((n) => n.style.opacity = n.dataset.col == best ? 1 : .55);
  });
  svg.addEventListener("mouseleave", () => { if (tip) tip.hidden = true; el.querySelectorAll("[data-col]").forEach((n) => n.style.opacity = 1); });
}
export function xLabels(n, x, y, keys, width) {
  const every = Math.ceil(n / Math.max(2, Math.min(12, Math.floor(width / 52))));
  return keys.map((k, i) => (i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every)
    ? `<text x="${x(i)}" y="${y}" text-anchor="middle">${monthLabel(k)}${k.endsWith("-01") || i === 0 ? " " + k.slice(2, 4) : ""}</text>` : "").join("");
}
export function lineChart(el, pts) {
  const { W, H, m } = chartFrame(el, 230);
  const vals = pts.map((p) => p.v);
  const { ticks, y } = scaleY(Math.min(0, ...vals), Math.max(0, ...vals), m.t, H - m.b);
  const n = pts.length, iw = W - m.l - m.r;
  const x = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const last = pts.at(-1);
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du solde encaissé">
    <defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? "zero" : ""}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmtShort(t)}</text>`).join("")}</g>
    <path d="${area}" fill="url(#lg)"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `<circle data-col="${i}" cx="${x(i)}" cy="${y(p.v)}" r="${i === n - 1 ? 4.5 : 2.5}" fill="${i === n - 1 ? "var(--accent)" : "var(--sheet)"}" stroke="var(--accent)" stroke-width="1.6"/>`).join("")}
    <text x="${Math.min(x(n - 1), W - m.r)}" y="${Math.max(m.t + 2, y(last.v) - 12)}" text-anchor="end" style="fill:var(--ink);font-weight:600">${fmtShort(last.v)}</text>
    ${xLabels(n, x, H - 6, pts.map((p) => p.k), iw)}
  </svg>`;
  el.innerHTML = svg;
  attachTip(el, el.querySelector("svg"), pts.map((p, i) => ({ x: x(i), y: y(p.v) })), (i) => `<b>Fin ${monthLabel(pts[i].k, true)}</b><span class="num">${fmt(pts[i].v)}</span>`);
}
export function barChart(el, rows) {
  const { W, H, m } = chartFrame(el, 220);
  const max = Math.max(10, ...rows.flatMap((r) => [r.a, r.b]));
  const { ticks, y } = scaleY(0, max, m.t, H - m.b);
  const n = rows.length, iw = W - m.l - m.r, band = iw / n, bw = Math.min(22, band * 0.32);
  const cx = (i) => m.l + band * i + band / 2;
  const bars = rows.map((r, i) => `<g data-col="${i}">
      <rect x="${cx(i) - bw - 1}" y="${y(r.a)}" width="${bw}" height="${Math.max(0, y(0) - y(r.a))}" rx="2.5" fill="var(--up)"/>
      <rect x="${cx(i) + 1}" y="${y(r.b)}" width="${bw}" height="${Math.max(0, y(0) - y(r.b))}" rx="2.5" fill="var(--down)" opacity=".85"/></g>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entrées et sorties par mois">
    <g class="grid">${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? "zero" : ""}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmtShort(t)}</text>`).join("")}</g>
    ${bars}${xLabels(n, cx, H - 6, rows.map((r) => r.k), iw)}</svg>
    <div class="legend"><span><i style="background:var(--up)"></i>Entrées encaissées</span><span><i style="background:var(--down)"></i>Sorties payées</span></div>`;
  attachTip(el, el.querySelector("svg"), rows.map((r, i) => ({ x: cx(i), y: y(Math.max(r.a, r.b)) })),
    (i) => `<b>${monthLabel(rows[i].k, true)}</b><span class="num">+${fmt(rows[i].a)}<br>−${fmt(rows[i].b)}<br>= ${fmtSigned(rows[i].a - rows[i].b)}</span>`);
}
export function netChart(el, rows) {
  const { W, H, m } = chartFrame(el, 220);
  const vals = rows.map((r) => r.v);
  const { ticks, y } = scaleY(Math.min(0, ...vals), Math.max(10, ...vals), m.t, H - m.b);
  const n = rows.length, iw = W - m.l - m.r, band = iw / n, bw = Math.min(34, band * 0.6);
  const cx = (i) => m.l + band * i + band / 2;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Résultat net par mois">
    <g class="grid">${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? "zero" : ""}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmtShort(t)}</text>`).join("")}</g>
    ${rows.map((r, i) => `<rect data-col="${i}" x="${cx(i) - bw / 2}" y="${Math.min(y(r.v), y(0))}" width="${bw}" height="${Math.max(1, Math.abs(y(r.v) - y(0)))}" rx="3" fill="${r.v >= 0 ? "var(--up)" : "var(--down)"}"/>`).join("")}
    ${xLabels(n, cx, H - 6, rows.map((r) => r.k), iw)}</svg>`;
  attachTip(el, el.querySelector("svg"), rows.map((r, i) => ({ x: cx(i), y: Math.min(y(r.v), y(0)) })), (i) => `<b>${monthLabel(rows[i].k, true)}</b><span class="num">${fmtSigned(rows[i].v)}</span>`);
}


// Listes déroulantes déclarées avec data-fill="domains | domains-none | domains-perso | goal-domains | categories | category-filter | accounts"
export function fillSelects(root = document) {
  const domOpts = activeDomains().map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  const catOpts = S.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const fills = {
    "domains": () => domOpts,
    "domains-none": () => `<option value="">Aucun business</option>` + domOpts,
    "domains-perso": () => `<option value="">Perso (aucun business)</option>` + domOpts,
    "goal-domains": () => `<option value="all">Tous les business</option>` + domOpts,
    "categories": () => `<option value="">Sans catégorie</option>` + catOpts,
    "category-filter": () => `<option value="all">Toutes catégories</option><option value="none">Sans catégorie</option>` + catOpts,
    "accounts": () => S.accounts.filter((a) => !a.closedOn).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join(""),
  };
  for (const sel of $$("select[data-fill]", root)) if (fills[sel.dataset.fill]) keepValue(sel, fills[sel.dataset.fill]());
  const lists = {
    descList: [...new Set(S.transactions.map((t) => t.desc).filter(Boolean))].slice(0, 300),
    counterpartyList: [...new Set([...S.transactions, ...S.recurring].map((t) => t.counterparty).filter(Boolean))].slice(0, 300),
    assetList: S.assets.map((a) => a.symbol),
  };
  for (const [id, values] of Object.entries(lists)) { const el = document.getElementById(id); if (el) el.innerHTML = values.map((v) => `<option value="${esc(v)}">`).join(""); }
}
export function keepValue(sel, html) { const v = sel.value; if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; } if ([...sel.options].some((o) => o.value === v)) sel.value = v; }


// ================= navigation =================
export function go(view) {
  ui.view = view; store.set("view", view);
  $$(".view").forEach((s) => (s.hidden = s.id !== "view-" + view));
  closeSide();
  $("#main").scrollTop = 0;
  render();
}
export function setScope(id) { ui.scope = id; store.set("scope", id); closeSide(); render(); }
export function closeSide() { $("#side").classList.remove("open"); $("#scrim").classList.remove("open"); }


// ================= interactions communes =================
export const segVal = (id) => $(`#${id} [aria-pressed="true"]`)?.dataset.v;
export const setSeg = (id, v) => $$(`#${id} button`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));

// Actions déclenchées par un attribut data-* : chaque module enregistre les siennes.
// onClick("recEdit", (id, el, event) => …) réagit à <button data-rec-edit="…">.
export const clickActions = {};
export const changeActions = {};
export function onClick(key, fn) { clickActions[key] = fn; }
export function onChange(key, fn) { changeActions[key] = fn; }

export function applyTheme() {
  const t = store.get("theme", "system");
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

// Fenêtres de dialogue : boutons de sélection, fermeture, clic sur le fond (aussi pour les dialogues créés plus tard)
document.addEventListener("click", (e) => {
  const seg = e.target.closest(".type-switch button, .seg.pick button");
  if (seg && seg.parentElement.id) setSeg(seg.parentElement.id, seg.dataset.v);
  const close = e.target.closest("dialog [data-close]");
  if (close) close.closest("dialog").close();
  if (e.target.tagName === "DIALOG") e.target.close();
});

// Boîte de choix : renvoie la valeur du bouton cliqué, ou null si fermée.
// choices : [{ value, label, primary?, danger? }]
export function choiceBox(title, html, choices) {
  const d = document.createElement("dialog");
  d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><div class="muted" style="font-size:13.5px">${html}</div>
    <div class="dialog-actions">${choices.map((c) => `<button class="btn${c.primary ? " primary" : ""}${c.danger ? " danger" : ""}" value="${esc(c.value)}">${esc(c.label)}</button>`).join("")}</div></form>`;
  document.body.appendChild(d);
  d.showModal();
  return new Promise((res) => d.addEventListener("close", () => { res(d.returnValue || null); d.remove(); }, { once: true }));
}

// Petit formulaire modal : renvoie les valeurs des champs (par name) ou null.
export function formBox(title, fieldsHtml, okLabel = "Enregistrer", validate) {
  const d = document.createElement("dialog");
  d.innerHTML = `<form><h3>${esc(title)}</h3>${fieldsHtml}<div class="form-error" hidden></div>
    <div class="dialog-actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">${esc(okLabel)}</button></div></form>`;
  document.body.appendChild(d);
  d.showModal();
  d.querySelector("input, select, textarea")?.focus();
  return new Promise((res) => {
    let done = false;
    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.target).entries());
      for (const el of d.querySelectorAll("input[type=checkbox][name]")) values[el.name] = el.checked;
      const err = validate ? await validate(values) : null;
      if (err) { const box = d.querySelector(".form-error"); box.textContent = err; box.hidden = false; return; }
      done = true; d.close(); res(values);
    });
    d.addEventListener("close", () => { if (!done) res(null); d.remove(); }, { once: true });
  });
}
