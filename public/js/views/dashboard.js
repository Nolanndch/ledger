// Vue Tableau de bord
import { $, fmt, fmtSigned, fmtShort, todayISO, monthKey, monthLabel, addMonths, ui, domainById, activeDomains, signed, PERIOD_LABEL, scopeTx, periodTx, sums, monthRange, registerView, render, barRow, txRow, lineChart, barChart } from "../core.js";

export function renderDashboard() {
  const list = periodTx();
  const s = sums(list);
  $("#kNet").textContent = fmt(s.net);
  $("#kNet").className = "kpi-value hero " + (s.net >= 0 ? "" : "down");
  $("#kNetSub").innerHTML = s.pNet ? `${fmtSigned(s.pNet)} attendu en plus` : PERIOD_LABEL[ui.period];
  $("#kIn").textContent = fmt(s.in);
  $("#kInSub").textContent = s.pIn ? `+ ${fmt(s.pIn)} en attente` : `${list.filter((t) => t.type === "in" && t.status === "paid").length} encaissements`;
  $("#kOut").textContent = fmt(s.out);
  $("#kOutSub").textContent = s.pOut ? `+ ${fmt(s.pOut)} à payer` : (s.in ? `${Math.round((s.out / s.in) * 100)} % des entrées` : "—");
  const all = sums(scopeTx());
  $("#kPend").textContent = fmtSigned(all.pNet);
  $("#kPend").className = "kpi-value " + (all.pNet > 0 ? "up" : all.pNet < 0 ? "down" : "");
  $("#kPendSub").textContent = `${fmt(all.pIn)} à recevoir · ${fmt(all.pOut)} à payer`;

  const cur = todayISO().slice(0, 7), prev = addMonths(cur, -1);
  const mNet = sums(scopeTx().filter((t) => monthKey(t.date) === cur)).net;
  const pNet = sums(scopeTx().filter((t) => monthKey(t.date) === prev)).net;
  $("#kMonth").textContent = fmtSigned(mNet);
  $("#kMonth").className = "kpi-value " + (mNet > 0 ? "up" : mNet < 0 ? "down" : "");
  const diff = mNet - pNet;
  $("#kMonthSub").innerHTML = `<span class="delta ${diff >= 0 ? "up" : "down"}">${diff >= 0 ? "▲" : "▼"} ${fmtShort(Math.abs(diff))}</span> vs ${monthLabel(prev)}`;

  // Solde cumulé
  const months = monthRange();
  const paid = scopeTx().filter((t) => t.status === "paid");
  let bal = paid.filter((t) => monthKey(t.date) < months[0]).reduce((a, t) => a + signed(t), 0);
  const points = months.map((k) => { bal += paid.filter((t) => monthKey(t.date) === k).reduce((a, t) => a + signed(t), 0); return { k, v: bal }; });
  $("#balanceHint").textContent = `${monthLabel(months[0], true)} → ${monthLabel(months.at(-1), true)}`;
  lineChart($("#balanceChart"), points);

  // Flux par mois
  const flows = months.map((k) => {
    const m = paid.filter((t) => monthKey(t.date) === k);
    return { k, a: m.filter((t) => t.type === "in").reduce((x, t) => x + t.amount, 0), b: m.filter((t) => t.type === "out").reduce((x, t) => x + t.amount, 0) };
  });
  barChart($("#flowChart"), flows);

  // Par business
  const doms = ui.scope === "all" ? activeDomains() : [domainById(ui.scope)].filter(Boolean);
  const rows = doms.map((d) => ({ d, s: sums(list.filter((t) => t.domainId === d.id)) })).sort((a, b) => b.s.net - a.s.net);
  const orphan = sums(list.filter((t) => !t.domainId || !domainById(t.domainId)?.active));
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.s.net)), Math.abs(ui.scope === "all" ? orphan.net : 0));
  let html = rows.map(({ d, s }) => barRow(d.name, d.color, s.net, max, `${fmt(s.in)} entrées · ${fmt(s.out)} sorties`, d.id)).join("");
  if (ui.scope === "all" && (orphan.in || orphan.out)) html += barRow("Archivés / sans business", "var(--ink-3)", orphan.net, max);
  $("#byDomain").innerHTML = html || `<div class="empty"><b>Aucun business</b>Ajoute-en un dans Réglages.</div>`;

  // En attente
  const pend = scopeTx().filter((t) => t.status === "pending").sort((a, b) => a.date.localeCompare(b.date));
  $("#pendingHint").textContent = pend.length ? `${pend.length} mouvement${pend.length > 1 ? "s" : ""}` : "";
  $("#pendingList").innerHTML = pend.length ? pend.slice(0, 6).map((t) => txRow(t, true)).join("") : `<div class="empty"><b>Rien en attente</b>Tout est encaissé et réglé.</div>`;

  // Récents
  const recent = [...scopeTx()].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 6);
  $("#recentList").innerHTML = recent.length ? recent.map((t) => txRow(t)).join("") : `<div class="empty"><b>Aucun mouvement</b>Appuie sur N pour ajouter le premier.</div>`;
}


registerView("dashboard", { title: "Tableau de bord", render: renderDashboard, usesPeriod: true, usesScope: true });
