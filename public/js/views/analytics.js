// Vue Analyse
import { $, esc, fmt, fmtSigned, fmtShort, fmtCents, monthKey, monthLabel, S, ui, catById, domainById, periodTx, periodBounds, inPeriod, pnl, monthRange, registerView, netChart, chartFrame, scaleY, xLabels, attachTip, accountResult } from "../core.js";

const root = $("#view-analytics");
root.innerHTML = `
  <div class="summary-strip four" id="anaFacts"></div>
  <div class="panel"><div class="panel-head"><h2>D'où viennent les revenus</h2><span class="hint">encaissé par mois, remboursements déduits</span></div><div class="panel-body"><div class="chart" id="natureChart"></div></div></div>
  <div class="panel"><div class="panel-head"><h2>Résultat par mois</h2><span class="hint">entrées moins sorties, hors virements vers les placements</span></div><div class="panel-body"><div class="chart" id="netChart"></div></div></div>
  <div class="panel"><div class="panel-head"><h2>Rentabilité par business</h2></div>
    <div class="table-wrap"><table><thead><tr><th>Business</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Résultat</th><th class="r">Marge</th><th class="r hide-sm" title="Plus-values réalisées, dividendes et intérêts, moins frais et impôts, des comptes reliés au business">Placements</th><th class="r hide-sm">Part du CA</th></tr></thead><tbody id="domainTable"></tbody></table></div></div>
  <div class="grid-2 even">
    <div class="panel"><div class="panel-head"><h2>Meilleurs clients</h2></div><div class="panel-body" id="topClients"></div></div>
    <div class="panel"><div class="panel-head"><h2>Principaux fournisseurs</h2></div><div class="panel-body" id="topSuppliers"></div></div>
  </div>
  <div class="grid-2 even">
    <div class="panel"><div class="panel-head"><h2>Entrées par catégorie</h2></div><div class="panel-body" id="catIn"></div></div>
    <div class="panel"><div class="panel-head"><h2>Sorties par catégorie</h2></div><div class="panel-body" id="catOut"></div></div>
  </div>`;

const NATURE_COLORS = { subscription: "var(--accent)", recurring: "var(--up)", one_time: "var(--wait)" };
const NATURE_LABELS = { subscription: "Abonnements", recurring: "Autres récurrents", one_time: "Paiements uniques et échéances" };
const bucket = (t) => t.nature === "subscription" ? "subscription" : t.nature === "recurring" ? "recurring" : "one_time";

function stackedChart(el, rows) {
  const { W, H, m } = chartFrame(el, 220);
  const keys = ["subscription", "recurring", "one_time"];
  const max = Math.max(10, ...rows.map((r) => keys.reduce((a, k) => a + Math.max(0, r[k]), 0)));
  const { ticks, y } = scaleY(0, max, m.t, H - m.b);
  const n = rows.length, iw = W - m.l - m.r, band = iw / n, bw = Math.min(34, band * 0.6);
  const cx = (i) => m.l + band * i + band / 2;
  const bars = rows.map((r, i) => {
    let acc = 0;
    return `<g data-col="${i}">${keys.map((k) => { const v = Math.max(0, r[k]); if (!v) return ""; const y0 = y(acc), y1 = y(acc + v); acc += v; return `<rect x="${cx(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(1, y0 - y1)}" fill="${NATURE_COLORS[k]}"/>`; }).join("")}</g>`;
  }).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenus par nature">
    <g class="grid">${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? "zero" : ""}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmtShort(t)}</text>`).join("")}</g>
    ${bars}${xLabels(n, cx, H - 6, rows.map((r) => r.k), iw)}</svg>
    <div class="legend">${keys.map((k) => `<span><i style="background:${NATURE_COLORS[k]}"></i>${NATURE_LABELS[k]}</span>`).join("")}</div>`;
  attachTip(el, el.querySelector("svg"), rows.map((r, i) => ({ x: cx(i), y: y(keys.reduce((a, k) => a + Math.max(0, r[k]), 0)) })),
    (i) => `<b>${monthLabel(rows[i].k, true)}</b><span class="num">${keys.map((k) => `${NATURE_LABELS[k]} : ${fmt(rows[i][k])}`).join("<br>")}</span>`);
}

// Résultat des placements reliés à un business, sur la période (date des ventes, dividendes, frais).
function investResultByDomain() {
  const b = periodBounds(), out = new Map();
  for (const a of S.accounts) {
    if (!a.domainId) continue;
    const { r } = accountResult(a);
    let v = r.events.filter((e) => inPeriod(e.date, b)).reduce((x, e) => x + e.pnl, 0);
    for (const o of S.operations.filter((o) => o.accountId === a.id && inPeriod(o.date, b))) {
      if (o.type === "dividend" || o.type === "interest") v += o.amountCents;
      if (o.type === "fee" || o.type === "tax") v -= o.amountCents;
    }
    out.set(a.domainId, (out.get(a.domainId) || 0) + v);
  }
  return out;
}

function topList(list, type) {
  const map = new Map();
  for (const t of list) {
    if (t.kind === "transfer" || !t.counterparty) continue;
    const sign = t.kind === "refund" ? (t.type === type ? 0 : -1) : t.type === type ? 1 : 0;
    if (!sign) continue;
    map.set(t.counterparty, (map.get(t.counterparty) || 0) + sign * t.amount);
  }
  const arr = [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total = [...map.values()].filter((v) => v > 0).reduce((a, v) => a + v, 0), max = Math.max(1, ...arr.map(([, v]) => v));
  if (!arr.length) return `<div class="empty">Renseigne le champ « ${type === "in" ? "Client" : "Fournisseur"} » de tes mouvements pour voir ce classement.</div>`;
  return arr.map(([name, v]) => `<div class="bar-row"><div class="name"><span>${esc(name)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%;background:${type === "in" ? "var(--up)" : "var(--down)"};opacity:.8"></div></div><div class="val">${fmt(v)} <span class="faint">${Math.round((v / total) * 100)}%</span></div></div>`).join("");
}

function renderAnalytics() {
  const list = periodTx();
  const paid = list.filter((t) => t.status === "paid" && t.kind !== "transfer");
  const months = monthRange();
  const monthly = months.map((k) => ({ k, ...pnl(paid.filter((t) => monthKey(t.date) === k)) }));
  const active = monthly.filter((r) => r.revenue || r.expenses);
  const p = pnl(list);
  const best = active.reduce((b, r) => (!b || r.result > b.result ? r : b), null);
  const avgIn = active.length ? active.reduce((a, r) => a + r.revenue, 0) / active.length : 0;
  const incoming = paid.filter((t) => t.type === "in" && t.kind === "cash");
  const recurringShare = incoming.length ? incoming.filter((t) => t.recurringId).reduce((a, t) => a + t.amount, 0) / Math.max(1, incoming.reduce((a, t) => a + t.amount, 0)) : 0;
  $("#anaFacts").innerHTML = [
    ["Marge nette", p.revenue ? `${Math.round((p.result / p.revenue) * 100)} %` : "—", `${fmt(p.result)} sur ${fmt(p.revenue)} d'entrées`],
    ["Revenus récurrents", `${Math.round(recurringShare * 100)} %`, "part du chiffre d'affaires encaissé"],
    ["CA moyen / mois actif", fmt(avgIn), `${active.length} mois avec activité`],
    ["Meilleur mois", best ? fmtSigned(best.result) : "—", best ? monthLabel(best.k, true) : ""],
  ].map(([l, v, sub]) => `<div><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div><div class="kpi-sub">${esc(sub)}</div></div>`).join("");

  const natureRows = months.map((k) => {
    const r = { k, subscription: 0, recurring: 0, one_time: 0 };
    for (const t of paid.filter((t) => monthKey(t.date) === k)) {
      if (t.type === "in" && t.kind === "cash") r[bucket(t)] += t.amount;
      if (t.type === "out" && t.kind === "refund") { const o = S.transactions.find((x) => x.id === t.refundOf); r[o ? bucket(o) : "one_time"] -= t.amount; }
    }
    return r;
  });
  stackedChart($("#natureChart"), natureRows);
  netChart($("#netChart"), monthly.map((r) => ({ k: r.k, v: r.result })));

  const inv = investResultByDomain();
  const doms = S.domains.slice().sort((a, b) => a.position - b.position).filter((d) => (d.active || list.some((t) => t.domainId === d.id)) && (ui.scope === "all" || d.id === ui.scope));
  const totalRevenue = p.revenue;
  const rows = doms.map((d) => ({ d, p: pnl(list.filter((t) => t.domainId === d.id)), inv: inv.get(d.id) || 0 })).sort((a, b) => b.p.result - a.p.result);
  $("#domainTable").innerHTML = rows.map(({ d, p: q, inv: iv }) => `<tr>
      <td><button class="tag" data-scope="${d.id}"><span class="dot" style="background:${esc(d.color)}"></span>${esc(d.name)}${d.active ? "" : ' <span class="faint">(archivé)</span>'}</button></td>
      <td class="amt r up">${fmt(q.revenue)}</td><td class="amt r down">${fmt(q.expenses)}</td>
      <td class="amt r ${q.result >= 0 ? "" : "down"}">${fmtSigned(q.result)}</td>
      <td class="r">${q.revenue > 0 ? `<span class="chip ${q.result >= 0 ? "paid" : "down"}">${Math.round((q.result / q.revenue) * 100)} %</span>` : '<span class="faint">—</span>'}</td>
      <td class="amt r hide-sm ${iv > 0 ? "up" : iv < 0 ? "down" : "faint"}">${iv ? (iv > 0 ? "+" : "−") + fmtCents(Math.abs(iv)) : "—"}</td>
      <td class="r num hide-sm muted">${totalRevenue > 0 ? Math.round((Math.max(0, q.revenue) / totalRevenue) * 100) + " %" : "—"}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">Aucune donnée sur la période.</td></tr>`;

  $("#topClients").innerHTML = topList(list.filter((t) => t.status === "paid"), "in");
  $("#topSuppliers").innerHTML = topList(list.filter((t) => t.status === "paid"), "out");

  const catBars = (type) => {
    const map = new Map();
    for (const t of paid) {
      const sign = t.kind === "refund" ? (t.type === type ? 0 : -1) : t.type === type ? 1 : 0;
      if (sign) map.set(t.categoryId || "", (map.get(t.categoryId || "") || 0) + sign * t.amount);
    }
    const arr = [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const total = arr.reduce((a, [, v]) => a + v, 0), max = Math.max(1, ...arr.map(([, v]) => v));
    if (!arr.length) return `<div class="empty">Aucune ${type === "in" ? "entrée" : "sortie"} sur la période.</div>`;
    return arr.map(([id, v]) => { const c = catById(id); return `<div class="bar-row"><div class="name"><span class="dot" style="background:${c ? esc(c.color) : "var(--ink-3)"}"></span><span>${esc(c?.name || "Sans catégorie")}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%;background:${type === "in" ? "var(--up)" : "var(--down)"};opacity:.8"></div></div><div class="val">${fmt(v)} <span class="faint">${Math.round((v / total) * 100)}%</span></div></div>`; }).join("");
  };
  $("#catIn").innerHTML = catBars("in");
  $("#catOut").innerHTML = catBars("out");
}

registerView("analytics", { title: "Analyse", render: renderAnalytics, usesPeriod: true });
