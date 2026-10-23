// Vue Grand livre
import { $, $$, esc, fmt, fmtSigned, fmtDate, monthKey, monthLabel, ICON, ui, domainById, catById, signed, scopeTx, periodTx, sums, registerView, render } from "../core.js";

export function renderLedger() {
  const q = $("#fSearch").value.trim().toLowerCase();
  const fType = $("#fType").value, fStatus = $("#fStatus").value, fCat = $("#fCategory").value;
  const base = periodTx();
  // Solde courant : cumul encaissé chronologique du business, report inclus
  const chrono = [...scopeTx()].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || "").localeCompare(b.createdAt || ""));
  const balance = new Map(); let run = 0;
  for (const t of chrono) { if (t.status === "paid") run += signed(t); balance.set(t.id, run); }

  let list = base.filter((t) =>
    (fType === "all" || t.type === fType) && (fStatus === "all" || t.status === fStatus) &&
    (fCat === "all" || (fCat === "none" ? !t.categoryId : t.categoryId === fCat)) &&
    (!q || (t.desc || "").toLowerCase().includes(q) || (t.asset || "").toLowerCase().includes(q) || String(t.amount).includes(q)));
  const { key, dir } = ui.sort;
  const val = {
    date: (t) => t.date + (t.createdAt || ""), desc: (t) => (t.desc || "").toLowerCase(), amount: (t) => signed(t),
    domain: (t) => domainById(t.domainId)?.name || "", status: (t) => t.status,
  }[key];
  list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });

  $$("thead th[data-sort]").forEach((th) => {
    th.querySelector(".arrow")?.remove();
    if (th.dataset.sort === key) th.insertAdjacentHTML("beforeend", ` <span class="arrow">${dir > 0 ? "↑" : "↓"}</span>`);
  });

  $("#txEmpty").hidden = list.length > 0;
  const groupByMonth = key === "date";
  const monthSums = {};
  if (groupByMonth) for (const t of list) { const k = monthKey(t.date); (monthSums[k] ||= []).push(t); }
  let lastMonth = null;
  const rows = [];
  for (const t of list) {
    const k = monthKey(t.date);
    if (groupByMonth && k !== lastMonth) {
      lastMonth = k;
      const s = sums(monthSums[k]);
      const lbl = `${monthLabel(k, true).replace(/^./, (c) => c.toUpperCase())} · ${monthSums[k].length} mouvement${monthSums[k].length > 1 ? "s" : ""}`;
      rows.push(`<tr class="month"><td colspan="4" class="hide-sm">${lbl}</td><td colspan="2" class="only-sm">${lbl}</td><td class="r num ${s.net >= 0 ? "up" : "down"}">${fmtSigned(s.net)}</td><td class="hide-sm"></td><td></td></tr>`);
    }
    const d = domainById(t.domainId), c = catById(t.categoryId);
    const meta = [c?.name, t.kind === "invest" ? `${t.qty} ${t.asset} × ${fmt(t.pricePerUnit)}` : "", t.recurringId ? "récurrent" : ""].filter(Boolean).map(esc).join(" · ");
    rows.push(`<tr class="tx ${t.status}" data-row-edit="${t.id}">
      <td class="date hide-sm">${fmtDate(t.date)}</td>
      <td><div class="desc">${esc(t.desc || "Sans libellé")}</div><div class="meta"><span class="show-sm">${fmtDate(t.date)}${meta ? " · " : ""}</span>${meta}</div></td>
      <td class="hide-sm">${d ? `<span class="tag"><span class="dot" style="background:${esc(d.color)}"></span>${esc(d.name)}</span>` : `<span class="faint">—</span>`}</td>
      <td><button class="chip ${t.status}" data-toggle="${t.id}" title="Changer le statut">${t.status === "pending" ? "En attente" : "Payé"}</button></td>
      <td class="amt r ${t.type === "in" ? "up" : "down"}">${t.type === "in" ? "+" : "−"}${fmt(t.amount)}</td>
      <td class="bal r hide-sm">${t.status === "paid" ? fmt(balance.get(t.id)) : `<span class="faint">—</span>`}</td>
      <td class="r"><span class="actions"><button class="icon-btn" data-edit="${t.id}" aria-label="Modifier">${ICON.edit}</button><button class="icon-btn hide-sm" data-dup="${t.id}" aria-label="Dupliquer">${ICON.copy}</button><button class="icon-btn del hide-sm" data-del="${t.id}" aria-label="Supprimer">${ICON.del}</button></span></td>
    </tr>`);
  }
  $("#txBody").innerHTML = rows.join("");
  const s = sums(list);
  const totLbl = `Total · ${list.length} mouvement${list.length > 1 ? "s" : ""}${s.pNet ? ` <span class="faint" style="font-weight:400">(${fmtSigned(s.pNet)} en attente non compté)</span>` : ""}`;
  $("#txFoot").innerHTML = list.length ? `<tr><td colspan="4" class="hide-sm">${totLbl}</td><td colspan="2" class="only-sm">${totLbl}</td><td class="amt r ${s.net >= 0 ? "up" : "down"}"><span>${fmtSigned(s.net)}</span></td><td class="hide-sm"></td><td></td></tr>` : "";
}


$("#fSearch").addEventListener("input", renderLedger);
["#fType", "#fStatus", "#fCategory"].forEach((s) => $(s).addEventListener("change", renderLedger));
$$("thead th[data-sort]").forEach((th) => th.addEventListener("click", () => {
  const k = th.dataset.sort;
  ui.sort = { key: k, dir: ui.sort.key === k ? -ui.sort.dir : (k === "desc" || k === "domain" ? 1 : -1) };
  renderLedger();
}));

registerView("ledger", { title: "Grand livre", render: renderLedger, usesPeriod: true, usesScope: true });
