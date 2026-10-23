// Vue Tableau de bord
import { $, esc, fmt, fmtSigned, fmtShort, fmtCents, fmtSignedCents, fmtPct, fmtDate, todayISO, monthKey, monthLabel, S, ui, store, domainById, activeDomains, periodTx, periodLabel, scopeTx, pnl, treasury, hasOpeningBalance, comparisonBounds, between, monthRange, portfolio, widgetOn, saveSettings, formBox, txRow, barRow, lineChart, barChart, registerView, isOverdue, go, ICON } from "../core.js";
import { addDays, endOfMonth } from "../dates.js";
import { mrr, fixedCosts, upcoming } from "../lib/subscriptions.js";

const WIDGETS = [
  ["balance", "Évolution de la trésorerie", true], ["upcoming", "À venir et en retard", true], ["byDomain", "Par business", true],
  ["subs", "Abonnements", true], ["invest", "Placements", true], ["recent", "Derniers mouvements", true], ["flow", "Entrées et sorties par mois", false],
];
const root = $("#view-dashboard");
root.innerHTML = `
  <div class="ledger-strip" id="kpis"></div>
  <div class="dash-grid" id="dashGrid"></div>
  <div class="dash-foot"><button class="link-btn" id="customizeDash">Personnaliser le tableau de bord</button></div>`;

let horizon = store.get("dashHorizon", 30);

function delta(cur, prev, invert = false) {
  if (!S.settings?.compare || prev == null) return "";
  const d = cur - prev;
  if (Math.abs(d) < 0.005) return `<span class="delta flat">= vs avant</span>`;
  const good = invert ? d < 0 : d > 0;
  return `<span class="delta ${good ? "up" : "down"}" title="Période précédente : ${fmt(prev)}">${d > 0 ? "▲" : "▼"} ${fmtShort(Math.abs(d))}</span>`;
}

function renderKpis() {
  const list = periodTx();
  const p = pnl(list);
  const cmp = comparisonBounds();
  let prev = null;
  if (cmp) prev = pnl(between(scopeTx(), cmp.prev));
  const t = todayISO();
  const scoped = scopeTx();
  const due = scoped.filter((x) => x.status === "pending" && x.type === "in" && x.date <= t && x.kind !== "transfer");
  const late = due.filter((x) => x.date < t).reduce((a, x) => a + x.amount, 0);
  const toPay = scoped.filter((x) => x.status === "pending" && x.type === "out" && x.date <= t).reduce((a, x) => a + x.amount, 0);
  const tres = treasury();
  $("#kpis").innerHTML = `
    <div><div class="kpi-label" title="Soldes de départ + tout ce qui est payé, virements vers les placements compris">Trésorerie</div><div class="kpi-value hero ${tres < 0 ? "down" : ""}">${fmt(tres)}</div>
      <div class="kpi-sub">${hasOpeningBalance() ? "solde de départ inclus" : `<button class="link-btn" data-goto="settings">Indiquer un solde de départ</button>`}</div></div>
    <div><div class="kpi-label">Entrées</div><div class="kpi-value up">${fmt(p.revenue)}</div><div class="kpi-sub">${delta(p.revenue, prev?.revenue)} ${p.pRevenue ? `+ ${fmt(p.pRevenue)} attendu` : periodLabel()}</div></div>
    <div><div class="kpi-label">Sorties</div><div class="kpi-value down">${fmt(p.expenses)}</div><div class="kpi-sub">${delta(p.expenses, prev?.expenses, true)} ${p.transfers > 0 ? `+ ${fmt(p.transfers)} placés` : p.pExpenses ? `+ ${fmt(p.pExpenses)} à payer` : ""}</div></div>
    <div><div class="kpi-label" title="Entrées moins sorties, hors virements vers les placements, remboursements déduits">Résultat</div><div class="kpi-value ${p.result >= 0 ? "" : "down"}">${fmtSigned(p.result)}</div><div class="kpi-sub">${delta(p.result, prev?.result)} ${p.revenue > 0 ? `${Math.round((p.result / p.revenue) * 100)} % de marge` : ""}</div></div>
    <div><div class="kpi-label" title="Paiements clients en attente dont la date est passée ou aujourd'hui">À encaisser</div><div class="kpi-value ${late ? "down" : ""}">${fmt(due.reduce((a, x) => a + x.amount, 0))}</div><div class="kpi-sub">${late ? `<span class="down">dont ${fmt(late)} en retard</span>` : "rien en retard"}${toPay ? ` · ${fmt(toPay)} à payer` : ""}</div></div>`;
}

function widgetBalance() {
  const months = monthRange();
  const pts = months.map((k) => ({ k, v: treasury(ui.scope, endOfMonth(k) < todayISO() ? endOfMonth(k) : todayISO()) }));
  return { cls: "span-2", html: `<div class="panel"><div class="panel-head"><h2>Évolution de la trésorerie</h2><span class="hint">${monthLabel(months[0], true)} → ${monthLabel(months.at(-1), true)}</span></div><div class="panel-body"><div class="chart" id="balanceChart"></div></div></div>`, after: () => lineChart($("#balanceChart"), pts) };
}

function widgetUpcoming() {
  const t = todayISO();
  const subs = S.recurring.filter((r) => ui.scope === "all" || r.domainId === ui.scope);
  const items = upcoming(subs, scopeTx(), t, addDays(t, horizon));
  const overdue = items.filter((i) => i.overdue), next = items.filter((i) => !i.overdue);
  const sum = (l, ty) => l.filter((i) => i.type === ty).reduce((a, i) => a + i.amount, 0);
  const line = (i) => `<div class="row"><span class="date-pill${i.overdue ? " late" : ""}">${fmtDate(i.date).slice(0, 6)}</span>
    <div class="grow"><div class="title">${esc(i.label || "Sans libellé")}${i.projected ? ` <span class="badge" title="Paiement d'abonnement prévu">${ICON.repeat}</span>` : ""}${i.variable ? ' <span class="badge">estimé</span>' : ""}</div><div class="sub">${[i.counterparty && esc(i.counterparty), domainById(i.domainId) && esc(domainById(i.domainId).name)].filter(Boolean).join(" · ") || (i.projected ? "abonnement" : "en attente")}</div></div>
    <span class="amt ${i.type === "in" ? "up" : "down"}">${i.type === "in" ? "+" : "−"}${fmt(i.amount)}</span>
    ${i.txId ? `<button class="btn small" data-pay="${i.txId}">${i.type === "in" ? "Encaissé" : "Payé"}</button>` : ""}</div>`;
  return { html: `<div class="panel"><div class="panel-head"><h2>À venir</h2><span class="hint">+${fmtShort(sum(next, "in"))} · −${fmtShort(sum(next, "out"))}</span><span class="spacer"></span>
      <div class="seg small" id="horizonSeg">${[30, 60, 90].map((h) => `<button data-horizon="${h}" aria-pressed="${h === horizon}">${h} j</button>`).join("")}</div></div>
    ${overdue.length ? `<div class="group-label down">En retard · ${fmt(sum(overdue, "in"))} à recevoir${sum(overdue, "out") ? ` · ${fmt(sum(overdue, "out"))} à payer` : ""}</div><div class="rows">${overdue.map(line).join("")}</div>` : ""}
    <div class="rows">${next.slice(0, 10).map(line).join("") || `<div class="empty">Rien de prévu dans les ${horizon} jours.</div>`}</div>
    ${next.length > 10 ? `<button class="link-btn more-toggle" data-goto="subscriptions">Voir tout l'échéancier (${next.length})</button>` : ""}</div>` };
}

function widgetByDomain() {
  const list = periodTx();
  const doms = ui.scope === "all" ? activeDomains() : [domainById(ui.scope)].filter(Boolean);
  const rows = doms.map((d) => ({ d, p: pnl(list.filter((t) => t.domainId === d.id)) })).filter((r) => r.p.revenue || r.p.expenses || ui.scope !== "all").sort((a, b) => b.p.result - a.p.result);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.p.result)));
  return { html: `<div class="panel"><div class="panel-head"><h2>Par business</h2><span class="hint">résultat ${periodLabel()}</span></div><div class="panel-body">
    ${rows.map(({ d, p }) => barRow(d.name, d.color, p.result, max, `${fmt(p.revenue)} entrées · ${fmt(p.expenses)} sorties`, d.id)).join("") || `<div class="empty">Aucun mouvement sur la période.</div>`}</div></div>` };
}

function widgetSubs() {
  const t = todayISO();
  const subs = S.recurring.filter((r) => ui.scope === "all" || r.domainId === ui.scope);
  if (!subs.length) return { html: `<div class="panel"><div class="panel-head"><h2>Abonnements</h2></div><div class="empty"><b>Aucun abonnement</b><button class="link-btn" data-goto="subscriptions">Ajouter tes abonnements clients et tes charges fixes</button></div></div>` };
  const m = mrr(subs, t), f = fixedCosts(subs, t);
  return { html: `<div class="panel clickable-panel" data-goto="subscriptions"><div class="panel-head"><h2>Abonnements</h2><span class="spacer"></span><span class="hint">voir le détail →</span></div>
    <div class="mini-kpis"><div><span class="kpi-label">Revenu mensuel récurrent</span><b class="num up">${fmt(m.mrr)}</b><small>${m.count} abonné${m.count > 1 ? "s" : ""}</small></div>
    <div><span class="kpi-label">Charges fixes / mois</span><b class="num down">${fmt(f.monthly)}</b><small>${f.count} abonnement${f.count > 1 ? "s" : ""}</small></div>
    <div><span class="kpi-label">Net récurrent / mois</span><b class="num ${m.mrr - f.monthly >= 0 ? "up" : "down"}">${fmtSigned(m.mrr - f.monthly)}</b><small>avant paiements ponctuels</small></div></div></div>` };
}

function widgetInvest() {
  if (!S.accounts.length) return { html: `<div class="panel"><div class="panel-head"><h2>Placements</h2></div><div class="empty"><b>Aucun compte</b><button class="link-btn" data-goto="investments">Ajouter ton PEA, ton compte-titres ou ta crypto</button></div></div>` };
  const pf = portfolio();
  const tres = treasury("all");
  const perf = pf.contributions > 0 ? pf.gain / pf.contributions : null;
  return { html: `<div class="panel clickable-panel" data-goto="investments"><div class="panel-head"><h2>Placements</h2><span class="spacer"></span><span class="hint">voir le détail →</span></div>
    <div class="mini-kpis"><div><span class="kpi-label">Valeur</span><b class="num">${fmtCents(pf.value)}</b><small>versé ${fmtCents(pf.contributions)}</small></div>
    <div><span class="kpi-label">Plus-value</span><b class="num ${pf.gain >= 0 ? "up" : "down"}">${fmtSignedCents(pf.gain)}</b><small>${fmtPct(perf)}</small></div>
    <div><span class="kpi-label" title="Trésorerie de tous les business + valeur des placements">Patrimoine</span><b class="num">${fmt(tres + pf.value / 100)}</b><small>trésorerie + placements</small></div></div></div>` };
}

function widgetRecent() {
  const recent = [...scopeTx()].filter((t) => t.date <= todayISO()).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 7);
  return { html: `<div class="panel"><div class="panel-head"><h2>Derniers mouvements</h2><span class="spacer"></span><button class="btn small" data-goto="ledger">Grand livre</button></div>
    <div class="rows">${recent.map((t) => txRow(t)).join("") || `<div class="empty"><b>Aucun mouvement</b>Appuie sur N pour ajouter le premier.</div>`}</div></div>` };
}

function widgetFlow() {
  const months = monthRange();
  const paid = scopeTx().filter((t) => t.status === "paid" && t.kind !== "transfer");
  const rows = months.map((k) => { const p = pnl(paid.filter((t) => monthKey(t.date) === k)); return { k, a: p.revenue, b: p.expenses }; });
  return { cls: "span-2", html: `<div class="panel"><div class="panel-head"><h2>Entrées et sorties par mois</h2><span class="hint">hors virements vers les placements</span></div><div class="panel-body"><div class="chart" id="flowChart"></div></div></div>`, after: () => barChart($("#flowChart"), rows) };
}

const BUILD = { balance: widgetBalance, upcoming: widgetUpcoming, byDomain: widgetByDomain, subs: widgetSubs, invest: widgetInvest, recent: widgetRecent, flow: widgetFlow };

function renderDashboard() {
  renderKpis();
  const built = WIDGETS.filter(([k, , def]) => widgetOn(k, def)).map(([k]) => ({ k, ...BUILD[k]() }));
  // Les deux encarts courts (abonnements, placements) se rangent l'un sous l'autre
  const stack = built.filter((w) => w.k === "subs" || w.k === "invest");
  const others = built.filter((w) => w.k !== "subs" && w.k !== "invest");
  const parts = [];
  for (const w of others) {
    parts.push(`<div class="dash-cell ${w.cls || ""}">${w.html}</div>`);
    if (w.k === "upcoming" && stack.length) parts.push(`<div class="dash-cell stack">${stack.map((s) => s.html).join("")}</div>`);
  }
  if (!others.some((w) => w.k === "upcoming") && stack.length) parts.push(`<div class="dash-cell stack">${stack.map((s) => s.html).join("")}</div>`);
  $("#dashGrid").innerHTML = parts.join("");
  built.forEach((w) => w.after?.());
}

root.addEventListener("click", (e) => {
  const h = e.target.closest("[data-horizon]");
  if (h) { horizon = Number(h.dataset.horizon); store.set("dashHorizon", horizon); renderDashboard(); }
});
$("#customizeDash").addEventListener("click", async () => {
  const v = await formBox("Personnaliser le tableau de bord", `<p class="hint" style="margin:0">Choisis les encarts à afficher. Les indicateurs du haut restent toujours visibles.</p>
    <div class="check-list">${WIDGETS.map(([k, label, def]) => `<label class="check"><input type="checkbox" name="${k}"${widgetOn(k, def) ? " checked" : ""}><span>${label}</span></label>`).join("")}</div>`, "Enregistrer");
  if (v) saveSettings({ dashboardWidgets: Object.fromEntries(WIDGETS.map(([k]) => [k, !!v[k]])) }, "Tableau de bord mis à jour");
});

registerView("dashboard", { title: "Tableau de bord", render: renderDashboard, usesPeriod: true });
