// Vue Analyse
import { $, esc, fmt, fmtSigned, monthKey, monthLabel, S, ui, catById, periodTx, sums, monthRange, registerView, render, netChart } from "../core.js";

export function renderAnalytics() {
  const list = periodTx();
  const paid = list.filter((t) => t.status === "paid");
  const months = monthRange();
  const rows = months.map((k) => ({ k, ...sums(paid.filter((t) => monthKey(t.date) === k)) }));
  const active = rows.filter((r) => r.in || r.out);
  const s = sums(list);
  const best = active.reduce((b, r) => (!b || r.net > b.net ? r : b), null);
  const avgIn = active.length ? active.reduce((a, r) => a + r.in, 0) / active.length : 0;
  const avgOut = active.length ? active.reduce((a, r) => a + r.out, 0) / active.length : 0;
  $("#anaFacts").innerHTML = [
    ["Marge nette", s.in ? `${Math.round((s.net / s.in) * 100)} %` : "—", `${fmt(s.net)} sur ${fmt(s.in)} d'entrées`],
    ["CA moyen / mois actif", fmt(avgIn), `${active.length} mois avec activité`],
    ["Dépense moyenne / mois", fmt(avgOut), avgIn ? `${Math.round((avgOut / avgIn) * 100)} % du CA` : ""],
    ["Meilleur mois", best ? fmtSigned(best.net) : "—", best ? monthLabel(best.k, true) : ""],
  ].map(([l, v, sub]) => `<div><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div><div class="kpi-sub">${esc(sub)}</div></div>`).join("");
  netChart($("#netChart"), rows.map((r) => ({ k: r.k, v: r.net })));

  const doms = S.domains.slice().sort((a, b) => a.position - b.position).filter((d) => d.active || paid.some((t) => t.domainId === d.id));
  const tot = paid.filter((t) => t.type === "in").reduce((a, t) => a + t.amount, 0);
  const dRows = doms.map((d) => ({ d, s: sums(paid.filter((t) => t.domainId === d.id)) })).filter((r) => ui.scope === "all" || r.d.id === ui.scope).sort((a, b) => b.s.net - a.s.net);
  $("#domainTable").innerHTML = dRows.map(({ d, s }) => `<tr>
      <td><button class="tag" data-scope="${d.id}"><span class="dot" style="background:${esc(d.color)}"></span>${esc(d.name)}${d.active ? "" : ' <span class="faint">(archivé)</span>'}</button></td>
      <td class="amt r up">${fmt(s.in)}</td><td class="amt r down">${fmt(s.out)}</td>
      <td class="amt r ${s.net >= 0 ? "" : "down"}">${fmtSigned(s.net)}</td>
      <td class="r">${s.in ? `<span class="chip ${s.net >= 0 ? "paid" : "down"}">${Math.round((s.net / s.in) * 100)} %</span>` : '<span class="faint">—</span>'}</td>
      <td class="r num hide-sm muted">${tot ? Math.round((s.in / tot) * 100) + " %" : "—"}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Aucune donnée sur la période.</td></tr>`;

  const catBars = (type) => {
    const map = new Map();
    for (const t of paid.filter((t) => t.type === type)) map.set(t.categoryId || "", (map.get(t.categoryId || "") || 0) + t.amount);
    const arr = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const total = arr.reduce((a, [, v]) => a + v, 0), max = Math.max(1, ...arr.map(([, v]) => v));
    if (!arr.length) return `<div class="empty">Aucune ${type === "in" ? "entrée" : "sortie"} sur la période.</div>`;
    return arr.map(([id, v]) => {
      const c = catById(id);
      return `<div class="bar-row"><div class="name"><span class="dot" style="background:${c ? esc(c.color) : "var(--ink-3)"}"></span><span>${esc(c?.name || "Sans catégorie")}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%;background:${type === "in" ? "var(--up)" : "var(--down)"};opacity:.8"></div></div>
        <div class="val">${fmt(v)} <span class="faint">${Math.round((v / total) * 100)}%</span></div></div>`;
    }).join("");
  };
  $("#catIn").innerHTML = catBars("in");
  $("#catOut").innerHTML = catBars("out");
}


registerView("analytics", { title: "Analyse", render: renderAnalytics, usesPeriod: true, usesScope: true });
