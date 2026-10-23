// Vue Grand livre
import { $, $$, esc, fmt, fmtSigned, fmtDate, todayISO, monthKey, monthLabel, ICON, S, ui, store, domainById, catById, signed, scopeTx, periodTx, pnl, columnOn, saveSettings, natureBadge, isOverdue, registerView, fillSelects } from "../core.js";

const root = $("#view-ledger");
root.innerHTML = `
  <div class="panel">
    <div class="filters">
      <input class="input search" id="fSearch" type="search" placeholder="Rechercher un libellé, un client…  ( / )" autocomplete="off">
      <select class="select" id="fType"><option value="all">Entrées et sorties</option><option value="in">Entrées</option><option value="out">Sorties</option></select>
      <select class="select" id="fStatus"><option value="all">Tous statuts</option><option value="paid">Payé</option><option value="pending">En attente</option><option value="late">En retard</option></select>
      <select class="select" id="fNature"><option value="all">Toutes natures</option><option value="noTransfer">Hors virements</option><option value="one_time">Paiements uniques</option><option value="subscription">Abonnements</option><option value="installment">Échéances</option><option value="refund">Remboursements</option><option value="transfer">Virements placements</option></select>
      <select class="select" id="fCategory" data-fill="category-filter"></select>
      <div class="col-picker"><button class="btn small" id="colBtn" aria-expanded="false">Colonnes</button>
        <div class="period-pop" id="colPop" hidden>
          ${[["counterparty", "Client / fournisseur", false], ["domain", "Business", true], ["category", "Catégorie", false], ["balance", "Solde", true]].map(([k, l, d]) => `<label class="check"><input type="checkbox" data-col-toggle="${k}" data-def="${d}"><span>${l}</span></label>`).join("")}
        </div></div>
    </div>
    <div class="table-wrap"><table class="ledger">
      <thead id="ledgerHead"></thead><tbody id="txBody"></tbody><tfoot id="txFoot"></tfoot>
    </table></div>
    <div class="empty" id="txEmpty" hidden><b>Aucun mouvement</b>Change la période ou les filtres, ou ajoute un mouvement avec N.</div>
  </div>`;

let showFuture = store.get("ledgerFuture", false);
const COLS = [
  { key: "date", label: "Date", sort: "date", cls: "hide-sm" },
  { key: "desc", label: "Libellé", sort: "desc" },
  { key: "counterparty", label: "Client / fournisseur", sort: "counterparty", cls: "hide-sm", opt: true, def: false },
  { key: "domain", label: "Business", sort: "domain", cls: "hide-sm", opt: true, def: true },
  { key: "category", label: "Catégorie", sort: "category", cls: "hide-sm", opt: true, def: false },
  { key: "status", label: "Statut", sort: "status" },
  { key: "amount", label: "Montant", sort: "amount", cls: "r" },
  { key: "balance", label: "Solde", cls: "r hide-sm", opt: true, def: true, title: "Trésorerie après le mouvement (payés seulement)" },
  { key: "actions", label: "" },
];
const visibleCols = () => COLS.filter((c) => !c.opt || columnOn(c.key, c.def));

function matches(t, f) {
  if (f.type !== "all" && t.type !== f.type) return false;
  if (f.status === "late" ? !isOverdue(t) : f.status !== "all" && t.status !== f.status) return false;
  if (f.cat !== "all" && (f.cat === "none" ? t.categoryId : t.categoryId !== f.cat)) return false;
  switch (f.nature) {
    case "noTransfer": if (t.kind === "transfer") return false; break;
    case "transfer": case "refund": if (t.kind !== f.nature) return false; break;
    case "subscription": if (!t.recurringId) return false; break;
    case "installment": if (t.nature !== "installment") return false; break;
    case "one_time": if (t.kind !== "cash" || t.nature !== "one_time") return false; break;
  }
  if (f.q) {
    const hay = `${t.desc} ${t.counterparty} ${t.amount}`.toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

// Solde de trésorerie après chaque mouvement payé (soldes de départ compris)
function runningBalance() {
  const doms = ui.scope === "all" ? S.domains : S.domains.filter((d) => d.id === ui.scope);
  const opening = new Map(doms.map((d) => [d.id, d.openingDate]));
  let run = doms.reduce((a, d) => a + (d.openingBalance || 0), 0);
  const balance = new Map();
  for (const t of [...scopeTx()].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || "").localeCompare(b.createdAt || ""))) {
    const od = opening.get(t.domainId);
    if (t.status === "paid" && !(od && t.date < od)) run += signed(t);
    balance.set(t.id, run);
  }
  return balance;
}

function row(t, cols, balance) {
  const d = domainById(t.domainId), c = catById(t.categoryId);
  const late = isOverdue(t), transfer = t.kind === "transfer";
  const cell = {
    date: `<td class="date hide-sm">${fmtDate(t.date)}</td>`,
    desc: `<td><div class="desc">${esc(t.desc || "Sans libellé")} ${natureBadge(t)}</div><div class="meta"><span class="show-sm">${fmtDate(t.date)} · </span>${[!columnOn("counterparty", false) && t.counterparty && esc(t.counterparty), !columnOn("category", false) && c && esc(c.name)].filter(Boolean).join(" · ")}</div></td>`,
    counterparty: `<td class="hide-sm muted">${esc(t.counterparty || "")}</td>`,
    domain: `<td class="hide-sm">${d ? `<span class="tag"><span class="dot" style="background:${esc(d.color)}"></span>${esc(d.name)}</span>` : `<span class="faint">—</span>`}</td>`,
    category: `<td class="hide-sm muted">${c ? esc(c.name) : ""}</td>`,
    status: `<td>${transfer ? `<span class="chip neutral">Virement</span>` : `<button class="chip ${late ? "down" : t.status}" data-toggle="${t.id}" title="Changer le statut">${late ? "En retard" : t.status === "pending" ? "En attente" : "Payé"}</button>`}</td>`,
    amount: `<td class="amt r ${t.type === "in" ? "up" : "down"}">${t.type === "in" ? "+" : "−"}${fmt(t.amount)}</td>`,
    balance: `<td class="bal r hide-sm">${t.status === "paid" ? fmt(balance.get(t.id)) : `<span class="faint">—</span>`}</td>`,
    actions: `<td class="r"><span class="actions">${transfer ? `<button class="icon-btn" data-edit="${t.id}" aria-label="Ouvrir l'opération">${ICON.link}</button>` : `<button class="icon-btn" data-edit="${t.id}" aria-label="Modifier">${ICON.edit}</button><button class="icon-btn hide-sm" data-dup="${t.id}" aria-label="Dupliquer">${ICON.copy}</button>${t.kind === "cash" && t.status === "paid" ? `<button class="icon-btn hide-sm" data-refund="${t.id}" aria-label="Rembourser" title="Rembourser">${ICON.refund}</button>` : ""}<button class="icon-btn del hide-sm" data-del="${t.id}" aria-label="Supprimer">${ICON.del}</button>`}</span></td>`,
  };
  return `<tr class="tx ${t.status}${transfer ? " transfer" : ""}" data-row-edit="${t.id}">${cols.map((col) => cell[col.key]).join("")}</tr>`;
}

function renderLedger() {
  fillSelects(root);
  const cols = visibleCols();
  const f = { q: $("#fSearch").value.trim().toLowerCase(), type: $("#fType").value, status: $("#fStatus").value, nature: $("#fNature").value, cat: $("#fCategory").value };
  $$("[data-col-toggle]").forEach((el) => { el.checked = columnOn(el.dataset.colToggle, el.dataset.def === "true"); });
  const { key, dir } = ui.sort;
  $("#ledgerHead").innerHTML = `<tr>${cols.map((c) => `<th${c.sort ? ` data-sort="${c.sort}"` : ""} class="${c.cls || ""}"${c.title ? ` title="${c.title}"` : ""}>${c.label}${c.sort === key ? ` <span class="arrow">${dir > 0 ? "↑" : "↓"}</span>` : ""}</th>`).join("")}</tr>`;
  const balance = runningBalance();
  const t = todayISO();
  const list = periodTx().filter((x) => matches(x, f));
  const future = list.filter((x) => x.date > t), past = list.filter((x) => x.date <= t);
  const val = {
    date: (x) => x.date + (x.createdAt || ""), desc: (x) => (x.desc || "").toLowerCase(), amount: (x) => signed(x), counterparty: (x) => (x.counterparty || "").toLowerCase(),
    domain: (x) => domainById(x.domainId)?.name || "", category: (x) => catById(x.categoryId)?.name || "", status: (x) => x.status,
  }[key];
  const sortList = (l) => l.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  sortList(past); future.sort((a, b) => a.date.localeCompare(b.date));
  const span = cols.length;
  const out = [];
  if (future.length) {
    const s = pnl(future);
    out.push(`<tr class="group future"><td colspan="${span}"><button class="link-btn" id="toggleFuture">${showFuture ? "▾" : "▸"} À venir · ${future.length} mouvement${future.length > 1 ? "s" : ""} prévu${future.length > 1 ? "s" : ""}</button> <span class="num up">+${fmt(s.pRevenue + s.revenue)}</span> <span class="num down">−${fmt(s.pExpenses + s.expenses)}</span></td></tr>`);
    if (showFuture) future.forEach((x) => out.push(row(x, cols, balance)));
  }
  let lastMonth = null;
  const months = {};
  if (key === "date") for (const x of past) (months[monthKey(x.date)] ||= []).push(x);
  for (const x of past) {
    const k = monthKey(x.date);
    if (key === "date" && k !== lastMonth) {
      lastMonth = k;
      const p = pnl(months[k]);
      out.push(`<tr class="month"><td colspan="${span - 3}">${monthLabel(k, true).replace(/^./, (c) => c.toUpperCase())} · ${months[k].length} mouvement${months[k].length > 1 ? "s" : ""}</td><td colspan="3" class="r num ${p.result >= 0 ? "up" : "down"}">${fmtSigned(p.result)}</td></tr>`);
    }
    out.push(row(x, cols, balance));
  }
  $("#txBody").innerHTML = out.join("");
  $("#txEmpty").hidden = list.length > 0;
  const s = pnl(past);
  $("#txFoot").innerHTML = past.length ? `<tr><td colspan="${span - 3}">Total hors virements · ${past.length} mouvement${past.length > 1 ? "s" : ""}${s.pRevenue - s.pExpenses ? ` <span class="faint" style="font-weight:400">(${fmtSigned(s.pRevenue - s.pExpenses)} en attente non compté)</span>` : ""}${s.transfers ? `<div class="faint" style="font-weight:400;font-size:12px">virements vers les placements : ${fmtSigned(-s.transfers)}</div>` : ""}</td><td colspan="3" class="amt r ${s.result >= 0 ? "up" : "down"}"><span>${fmtSigned(s.result)}</span></td></tr>` : "";
}

$("#fSearch").addEventListener("input", renderLedger);
["#fType", "#fStatus", "#fNature", "#fCategory"].forEach((s) => $(s).addEventListener("change", renderLedger));
root.addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (th) {
    const k = th.dataset.sort;
    ui.sort = { key: k, dir: ui.sort.key === k ? -ui.sort.dir : (["desc", "domain", "counterparty", "category"].includes(k) ? 1 : -1) };
    renderLedger();
  }
  if (e.target.id === "toggleFuture") { showFuture = !showFuture; store.set("ledgerFuture", showFuture); renderLedger(); }
  if (e.target.id === "colBtn") { const p = $("#colPop"); p.hidden = !p.hidden; e.target.setAttribute("aria-expanded", String(!p.hidden)); }
});
document.addEventListener("click", (e) => { if (!e.target.closest(".col-picker")) $("#colPop").hidden = true; });
root.addEventListener("change", (e) => {
  const k = e.target.dataset.colToggle;
  if (k) saveSettings({ ledgerColumns: { ...(S.settings.ledgerColumns || {}), [k]: e.target.checked } });
});

registerView("ledger", { title: "Grand livre", render: renderLedger, usesPeriod: true });
