// Socle partagé : état, API, formats, période, graphiques, navigation et registre des vues.
// ================= utilitaires =================
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const eur0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const fmt = (n) => eur.format(n || 0).replace(/ /g, " ");
export const fmtSigned = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
export const fmtShort = (n) => {
  const a = Math.abs(n);
  if (a >= 1000) return (n < 0 ? "−" : "") + (a / 1000).toLocaleString("fr-FR", { maximumFractionDigits: a >= 10000 ? 0 : 1 }) + " k€";
  return (n < 0 ? "−" : "") + eur0.format(a).replace(/ /g, " ");
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
};

// ================= état =================
export const S = { domains: [], categories: [], transactions: [], recurring: [], objectives: [], assetPrices: {}, info: null };
// Remplace le contenu de l'état sans changer l'objet (les modules gardent la même référence)
export function replaceState(data) { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, data); }
export const ui = {
  view: store.get("view", "dashboard"),
  scope: store.get("scope", "all"),
  period: store.get("period", "all"),
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
    ui.lastSync = new Date().toISOString();
    setDb("on");
    render();
  } catch (e) {
    setDb("off");
    if (!S.info) render();
  }
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

export function periodStart() {
  const now = new Date(), k = localISO(now).slice(0, 7);
  switch (ui.period) {
    case "month": return k + "-01";
    case "3m": return addMonths(k, -2) + "-01";
    case "12m": return addMonths(k, -11) + "-01";
    case "year": return now.getFullYear() + "-01-01";
    default: return null;
  }
}
export const PERIOD_LABEL = { month: "ce mois-ci", "3m": "sur 3 mois", year: "cette année", "12m": "sur 12 mois", all: "depuis le début" };

// Mouvements du business sélectionné (toutes périodes). Les business archivés restent visibles quand on les sélectionne.
export function scopeTx() {
  if (ui.scope === "all") return S.transactions;
  return S.transactions.filter((t) => t.domainId === ui.scope);
}
export function periodTx(list = scopeTx()) {
  const start = periodStart();
  return start ? list.filter((t) => t.date >= start) : list;
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
// Mois couverts par la période (au moins 6, jusqu'au mois courant)
export function monthRange() {
  const cur = todayISO().slice(0, 7);
  let first;
  const start = periodStart();
  if (start) first = monthKey(start);
  else {
    const dates = scopeTx().map((t) => t.date).sort();
    first = dates.length ? monthKey(dates[0]) : cur;
  }
  const min = addMonths(cur, -5);
  if (first > min) first = min;
  const out = [];
  for (let k = first; k <= cur; k = addMonths(k, 1)) out.push(k);
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
  const recActive = S.recurring.filter((r) => r.active).length;
  $("#navCountRec").textContent = recActive || "";
  if (ui.scope !== "all" && !domainById(ui.scope)) ui.scope = "all";
  const doms = activeDomains();
  const scoped = ui.scope !== "all" ? domainById(ui.scope) : null;
  if (scoped && !scoped.active) doms.push(scoped);
  const items = [`<button class="nav-item" data-scope="all" aria-current="${ui.scope === "all"}"><span class="dot" style="background:var(--ink-3)"></span><span class="grow">Tous les business</span><span class="count">${fmtShort(sums(S.transactions).net)}</span></button>`];
  for (const d of doms) {
    const net = sums(S.transactions.filter((t) => t.domainId === d.id)).net;
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
  $("#periodSeg").hidden = !usesPeriod;
  $$("#periodSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === ui.period)));
}


export function barRow(name, color, value, max, title = "", scopeId) {
  const w = Math.max(2, (Math.abs(value) / max) * 100);
  return `<div class="bar-row" title="${esc(title)}">
    <div class="name">${scopeId ? `<button class="tag" data-scope="${scopeId}">` : `<span class="tag">`}<span class="dot" style="background:${esc(color)}"></span><span>${esc(name)}</span>${scopeId ? "</button>" : "</span>"}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${value >= 0 ? esc(color) : "var(--down)"}"></div></div>
    <div class="val ${value < 0 ? "down" : ""}">${fmtSigned(value)}</div></div>`;
}

export function txRow(t, withPay) {
  const d = domainById(t.domainId);
  const c = catById(t.categoryId);
  return `<div class="row">
    <span class="dot" style="background:${d ? esc(d.color) : "var(--ink-3)"}"></span>
    <div class="grow"><div class="title">${esc(t.desc || "Sans libellé")}</div><div class="sub">${fmtDate(t.date)}${d ? " · " + esc(d.name) : ""}${c ? " · " + esc(c.name) : ""}</div></div>
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


export function fillSelects() {
  const domOpts = activeDomains().map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  const catOpts = `<option value="">Sans catégorie</option>` + S.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  for (const sel of ["#txDomain", "#recDomain"]) keepValue($(sel), `<option value="">Aucun</option>` + domOpts);
  for (const sel of ["#txCategory", "#recCategory"]) keepValue($(sel), catOpts);
  keepValue($("#goalDomain"), `<option value="all">Tous les business</option>` + domOpts);
  keepValue($("#fCategory"), `<option value="all">Toutes catégories</option><option value="none">Sans catégorie</option>` + S.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join(""));
  $("#descList").innerHTML = [...new Set(S.transactions.map((t) => t.desc).filter(Boolean))].slice(0, 200).map((d) => `<option value="${esc(d)}">`).join("");
  $("#assetList").innerHTML = [...new Set(S.transactions.map((t) => t.asset).filter(Boolean))].map((a) => `<option value="${esc(a)}">`).join("");
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
  const seg = e.target.closest(".type-switch button");
  if (seg && seg.parentElement.id) setSeg(seg.parentElement.id, seg.dataset.v);
  const close = e.target.closest("dialog [data-close]");
  if (close) close.closest("dialog").close();
  if (e.target.tagName === "DIALOG") e.target.close();
});
