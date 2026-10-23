// Vue Abonnements : revenus récurrents (MRR), charges fixes, échéancier, et le dialogue d'abonnement.
import { $, $$, esc, fmt, fmtExact, fmtShort, fmtDate, todayISO, monthLabel, addMonths, S, ui, api, refresh, mutate, toast, choiceBox, formBox, fillSelects, segVal, setSeg, onClick, registerView, render, domainById, catById, activeDomains, chartFrame, scaleY, xLabels, attachTip, ICON } from "../core.js";
import { FREQUENCIES, frequencyKey, frequencyLabel, addDays, endAfter, occurrences, firstOnOrAfter } from "../dates.js";
import { mrr, mrrHistory, fixedCosts, status, STATUS_LABEL, monthly, upcoming, isRevenueSub, billingStart } from "../lib/subscriptions.js";

const root = $("#view-subscriptions");
root.innerHTML = `
  <div class="view-tabs"><div class="seg" id="subTab" role="tablist">
    <button data-v="revenue">Revenus</button><button data-v="costs">Charges</button><button data-v="schedule">Échéancier</button>
  </div><span class="spacer"></span><button class="btn small primary" id="addSubBtn">${ICON.plus.replace("<svg", '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4"')} Nouvel abonnement</button></div>
  <div id="subContent"></div>`;

let tab = "revenue";
let showEnded = false;
const today = () => todayISO();
const scoped = () => S.recurring.filter((r) => ui.scope === "all" || r.domainId === ui.scope);
const perMonth = (r) => r.freq === "monthly" && r.interval === 1 ? "" : ` <span class="faint">· ${fmt(monthly(r))}/mois</span>`;
const STATUS_CHIP = { active: "paid", trial: "accent", upcoming: "neutral", ending: "pending", ended: "neutral" };

function subRow(r) {
  const st = status(r, today());
  const d = domainById(r.domainId), c = catById(r.categoryId);
  const paid = S.transactions.filter((t) => t.recurringId === r.id).length;
  const when = st === "ended" ? `terminé le ${fmtDate(r.endDate)}` : st === "trial" ? `essai jusqu'au ${fmtDate(r.trialEnd)}`
    : st === "ending" ? `dernier paiement avant le ${fmtDate(r.endDate)}` : `prochain le ${fmtDate(r.nextDate)}`;
  const meta = [r.counterparty && esc(r.counterparty), frequencyLabel(r.freq, r.interval), d && esc(d.name), c && esc(c.name), `${paid} paiement${paid > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  return `<div class="row${st === "ended" ? " ended" : ""}">
    <span class="dot" style="background:${d ? esc(d.color) : "var(--ink-3)"}"></span>
    <div class="grow"><div class="title">${esc(r.name)}${r.plan ? ` <span class="faint">${esc(r.plan)}</span>` : ""}${r.amountVariable ? ' <span class="badge">montant variable</span>' : ""}${r.kind === "other" && r.type === "in" ? ' <span class="badge" title="Non compté dans le MRR">hors MRR</span>' : ""}</div>
      <div class="sub">${meta}</div></div>
    <div class="row-side"><span class="chip ${STATUS_CHIP[st]}">${STATUS_LABEL[st]}</span><span class="faint" style="font-size:12px">${when}</span></div>
    <span class="amt ${r.type === "in" ? "up" : "down"}">${r.type === "in" ? "+" : "−"}${fmt(r.amount)}${perMonth(r)}</span>
    <span class="row-actions">
      <button class="icon-btn" data-sub-edit="${r.id}" aria-label="Modifier">${ICON.edit}</button>
      ${st === "ended" || st === "ending" ? `<button class="btn small" data-sub-reactivate="${r.id}">Réactiver</button>` : `<button class="btn small" data-sub-cancel="${r.id}">Résilier</button>`}
      <button class="icon-btn del" data-sub-del="${r.id}" aria-label="Supprimer">${ICON.del}</button>
    </span></div>`;
}

function listBlock(subs, emptyHtml) {
  const live = subs.filter((r) => status(r, today()) !== "ended").sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const ended = subs.filter((r) => status(r, today()) === "ended").sort((a, b) => b.endDate.localeCompare(a.endDate));
  if (!subs.length) return `<div class="empty">${emptyHtml}</div>`;
  return `<div class="rows">${live.map(subRow).join("") || `<div class="empty">Aucun abonnement en cours.</div>`}</div>
    ${ended.length ? `<button class="link-btn more-toggle" id="toggleEnded">${showEnded ? "Masquer" : "Afficher"} les terminés (${ended.length})</button>${showEnded ? `<div class="rows">${ended.map(subRow).join("")}</div>` : ""}` : ""}`;
}

function mrrChart(el, hist) {
  const { W, H, m } = chartFrame(el, 200);
  const vals = hist.map((h) => h.mrr);
  const { ticks, y } = scaleY(0, Math.max(10, ...vals), m.t, H - m.b);
  const n = hist.length, iw = W - m.l - m.r;
  const x = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const line = hist.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.mrr).toFixed(1)}`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenu mensuel récurrent sur 12 mois">
    <g class="grid">${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? "zero" : ""}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmtShort(t)}</text>`).join("")}</g>
    <path d="${line}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="var(--accent-soft)"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>
    ${hist.map((h, i) => `<circle data-col="${i}" cx="${x(i)}" cy="${y(h.mrr)}" r="${i === n - 1 ? 4.5 : 2.5}" fill="${i === n - 1 ? "var(--accent)" : "var(--sheet)"}" stroke="var(--accent)" stroke-width="1.6"/>`).join("")}
    ${xLabels(n, x, H - 6, hist.map((h) => h.month), iw)}</svg>`;
  attachTip(el, el.querySelector("svg"), hist.map((h, i) => ({ x: x(i), y: y(h.mrr) })), (i) => {
    const h = hist[i];
    return `<b>${monthLabel(h.month, true)}</b><span class="num">${fmt(h.mrr)}/mois · ${h.count} abonné${h.count > 1 ? "s" : ""}<br>${h.newCount ? `+${h.newCount} nouveau${h.newCount > 1 ? "x" : ""} (${fmt(h.added)})<br>` : ""}${h.churnCount ? `−${h.churnCount} résilié${h.churnCount > 1 ? "s" : ""} (${fmt(h.churned)})<br>` : ""}${h.expansion ? `hausse de prix +${fmt(h.expansion)}<br>` : ""}${h.contraction ? `baisse de prix −${fmt(h.contraction)}` : ""}</span>`;
  });
}

function renderRevenue() {
  const subs = scoped().filter((r) => r.type === "in");
  const t = today();
  const m = mrr(subs, t);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(t.slice(0, 7), i - 11));
  const hist = mrrHistory(subs, S.transactions, months, t);
  const last3 = hist.slice(-4, -1);
  const churns = last3.reduce((a, h) => a + h.churnCount, 0);
  const startCount = hist.length >= 4 ? hist[hist.length - 5]?.count ?? hist[0].count : 0;
  const ids = new Set(subs.map((r) => r.id));
  const monthTx = S.transactions.filter((x) => ids.has(x.recurringId) && x.date.slice(0, 7) === t.slice(0, 7));
  const cashed = monthTx.filter((x) => x.status === "paid").reduce((a, x) => a + x.amount, 0);
  const unpaid = S.transactions.filter((x) => ids.has(x.recurringId) && x.status === "pending" && x.date <= t).reduce((a, x) => a + x.amount, 0);
  $("#subContent").innerHTML = `
    <div class="summary-strip four">
      <div><div class="kpi-label" title="MRR : somme des abonnements clients en cours, ramenés au mois">Revenu mensuel récurrent</div><div class="kpi-value up">${fmt(m.mrr)}</div><div class="kpi-sub">MRR · encaissé ce mois : ${fmt(cashed)}</div></div>
      <div><div class="kpi-label" title="ARR : MRR × 12">Sur 12 mois</div><div class="kpi-value">${fmt(m.arr)}</div><div class="kpi-sub">ARR, au rythme actuel</div></div>
      <div><div class="kpi-label">Clients abonnés</div><div class="kpi-value">${m.count}</div><div class="kpi-sub">${churns ? `${churns} résiliation${churns > 1 ? "s" : ""} sur 3 mois${m.count >= 10 && startCount ? ` (${Math.round((churns / startCount) * 100)} %)` : ""}` : "aucune résiliation sur 3 mois"}</div></div>
      <div><div class="kpi-label" title="ARPU : MRR ÷ nombre d'abonnés">Revenu moyen par client</div><div class="kpi-value">${fmt(m.arpu)}</div><div class="kpi-sub ${unpaid ? "down" : ""}">${unpaid ? `${fmt(unpaid)} d'abonnements impayés` : "aucun impayé"}</div></div>
    </div>
    ${subs.length ? `<div class="panel"><div class="panel-head"><h2>Revenu mensuel récurrent</h2><span class="hint">12 derniers mois · calculé sur les montants saisis</span></div><div class="panel-body"><div class="chart" id="mrrChart"></div></div></div>` : ""}
    <div class="panel"><div class="panel-head"><h2>Abonnements clients</h2><span class="hint">un abonnement par client et par formule</span></div>
      ${listBlock(subs, `<b>Aucun abonnement client</b>Ajoute tes clients SaaS ou tes contrats mensuels : les paiements se créent tout seuls et le MRR se calcule.`)}</div>`;
  if (subs.length) mrrChart($("#mrrChart"), hist);
}

function renderCosts() {
  const subs = scoped().filter((r) => r.type === "out");
  const t = today();
  const f = fixedCosts(subs, t);
  const soon = upcoming(subs, [], addDays(t, 1), addDays(t, 30)).filter((u) => u.projected);
  const byCat = new Map();
  for (const r of f.list) byCat.set(r.categoryId || "", (byCat.get(r.categoryId || "") || 0) + monthly(r));
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map(([, v]) => v));
  $("#subContent").innerHTML = `
    <div class="summary-strip four">
      <div><div class="kpi-label">Charges fixes / mois</div><div class="kpi-value down">${fmt(f.monthly)}</div><div class="kpi-sub">${f.count} abonnement${f.count > 1 ? "s" : ""} en cours</div></div>
      <div><div class="kpi-label">Sur 12 mois</div><div class="kpi-value">${fmt(f.yearly)}</div><div class="kpi-sub">au rythme actuel</div></div>
      <div><div class="kpi-label">Dans les 30 jours</div><div class="kpi-value">${fmt(soon.reduce((a, u) => a + u.amount, 0))}</div><div class="kpi-sub">${soon.length} prélèvement${soon.length > 1 ? "s" : ""} prévu${soon.length > 1 ? "s" : ""}</div></div>
      <div><div class="kpi-label">Plus grosse charge</div><div class="kpi-value">${f.list.length ? fmt(Math.max(...f.list.map((r) => monthly(r)))) : "—"}</div><div class="kpi-sub">${f.list.length ? esc([...f.list].sort((a, b) => monthly(b) - monthly(a))[0].name) + " · par mois" : ""}</div></div>
    </div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h2>Abonnements et charges fixes</h2></div>
        ${listBlock(subs, `<b>Aucune charge fixe</b>Ajoute tes abonnements (logiciels, hébergement, nom de domaine, loyer…) pour voir ce qu'ils coûtent par mois et quand ils sont prélevés.`)}</div>
      <div style="display:grid;gap:20px">
        <div class="panel"><div class="panel-head"><h2>Prochains prélèvements</h2><span class="hint">30 jours</span></div>
          <div class="rows">${soon.length ? soon.map((u) => `<div class="row"><span class="date-pill">${fmtDate(u.date).slice(0, 6)}</span><div class="grow"><div class="title">${esc(u.label)}</div><div class="sub">${u.variable ? "montant estimé" : u.counterparty ? esc(u.counterparty) : ""}</div></div><span class="amt down">−${fmt(u.amount)}</span></div>`).join("") : `<div class="empty">Rien de prévu dans les 30 jours.</div>`}</div></div>
        <div class="panel"><div class="panel-head"><h2>Par catégorie</h2><span class="hint">par mois</span></div><div class="panel-body">
          ${cats.length ? cats.map(([id, v]) => { const c = catById(id); return `<div class="bar-row"><div class="name"><span class="dot" style="background:${c ? esc(c.color) : "var(--ink-3)"}"></span><span>${esc(c?.name || "Sans catégorie")}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%;background:var(--down);opacity:.8"></div></div><div class="val">${fmt(v)}</div></div>`; }).join("") : `<div class="empty">—</div>`}
        </div></div>
      </div>
    </div>`;
}

function renderSchedule() {
  const t = today();
  const subs = scoped();
  const txs = S.transactions.filter((x) => ui.scope === "all" || x.domainId === ui.scope);
  const items = upcoming(subs, txs, t, addDays(addMonths(t.slice(0, 7), 12) + "-01", -1));
  const overdue = items.filter((i) => i.overdue);
  const byMonth = new Map();
  for (const i of items.filter((i) => !i.overdue)) { const k = i.date.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(i); }
  const line = (i) => `<div class="row"><span class="date-pill">${fmtDate(i.date).slice(0, 6)}</span><div class="grow"><div class="title">${esc(i.label || "Sans libellé")}${i.projected ? ` <span class="badge">${ICON.repeat}prévu</span>` : ""}${i.variable ? ' <span class="badge">estimé</span>' : ""}${i.trialEnd ? ' <span class="badge">fin d\'essai</span>' : ""}</div><div class="sub">${[i.counterparty && esc(i.counterparty), domainById(i.domainId) && esc(domainById(i.domainId).name)].filter(Boolean).join(" · ")}</div></div>
    <span class="amt ${i.type === "in" ? "up" : "down"}">${i.type === "in" ? "+" : "−"}${fmt(i.amount)}</span>${i.txId ? `<button class="btn small" data-pay="${i.txId}">${i.type === "in" ? "Encaissé" : "Payé"}</button>` : ""}</div>`;
  const total = (list, ty) => list.filter((i) => i.type === ty).reduce((a, i) => a + i.amount, 0);
  $("#subContent").innerHTML = `
    <p class="muted" style="margin:0;font-size:13px">Tout ce qui est attendu sur 12 mois : paiements en attente (échéances, factures) et prochains paiements de tes abonnements.</p>
    ${overdue.length ? `<div class="panel alert"><div class="panel-head"><h2>En retard</h2><span class="hint">${fmt(total(overdue, "in"))} à recevoir · ${fmt(total(overdue, "out"))} à payer</span></div><div class="rows">${overdue.map(line).join("")}</div></div>` : ""}
    ${[...byMonth.entries()].map(([k, list]) => `<div class="panel"><div class="panel-head"><h2>${monthLabel(k, true).replace(/^./, (c) => c.toUpperCase())}</h2><span class="spacer"></span><span class="num up">+${fmt(total(list, "in"))}</span><span class="num down">−${fmt(total(list, "out"))}</span></div><div class="rows">${list.map(line).join("")}</div></div>`).join("")
      || `<div class="panel empty"><b>Rien de prévu</b>Les abonnements et les paiements en attente apparaîtront ici.</div>`}`;
}

function renderSubscriptions() {
  setSeg("subTab", tab);
  ({ revenue: renderRevenue, costs: renderCosts, schedule: renderSchedule })[tab]();
}

root.addEventListener("click", (e) => {
  const b = e.target.closest("#subTab button");
  if (b) { tab = b.dataset.v; renderSubscriptions(); }
  if (e.target.id === "toggleEnded") { showEnded = !showEnded; renderSubscriptions(); }
});
$("#addSubBtn").addEventListener("click", () => openSubscription(null, { type: tab === "costs" ? "out" : "in" }));

// ---------- dialogue ----------
const dialog = document.createElement("dialog");
dialog.className = "wide";
dialog.innerHTML = `
  <form id="subForm" novalidate>
    <h3 id="subTitle">Nouvel abonnement</h3>
    <div class="type-switch" id="subType"><button type="button" data-v="in">Revenu (client)</button><button type="button" data-v="out">Charge (fournisseur)</button></div>
    <div class="fields-2">
      <div class="field"><label for="subName">Nom</label><input class="input" id="subName" placeholder="Ex. Abonnement Pro – Café Lumen" autocomplete="off"></div>
      <div class="field"><label for="subCounterparty" id="subCounterpartyLabel">Client</label><input class="input" id="subCounterparty" list="counterpartyList" autocomplete="off"></div>
    </div>
    <div class="fields-2">
      <div class="field"><label for="subAmount">Montant (€)</label><input class="input num amount-input" id="subAmount" type="number" step="0.01" min="0" inputmode="decimal"></div>
      <div class="field"><label for="subFreq">Fréquence</label><select class="select" id="subFreq">${FREQUENCIES.map((f) => `<option value="${f.key}">${f.label}</option>`).join("")}</select></div>
    </div>
    <div class="fields-2">
      <div class="field"><label for="subStart">Début</label><input class="input" id="subStart" type="date"></div>
      <div class="field"><label for="subDomain">Business</label><select class="select" id="subDomain" data-fill="domains-none"></select></div>
    </div>
    <div class="field"><label for="subCategory">Catégorie</label><select class="select" id="subCategory" data-fill="categories"></select></div>
    <p class="hint" id="subPreview"></p>
    <label class="check" id="subCatchUpRow" hidden><input type="checkbox" id="subCatchUp" checked><span id="subCatchUpLabel"></span></label>
    <details class="more" id="subMore"><summary>Plus d'options</summary>
      <div class="fields-2">
        <div class="field"><label for="subTrial">Essai gratuit — 1er paiement le</label><input class="input" id="subTrial" type="date"></div>
        <div class="field"><label for="subCount">Nombre de paiements (fin automatique)</label><input class="input num" id="subCount" type="number" min="1" max="600" placeholder="Illimité"></div>
      </div>
      <div class="fields-2">
        <div class="field" id="subPlanField"><label for="subPlan">Formule</label><input class="input" id="subPlan" placeholder="Ex. Pro, Starter" autocomplete="off"></div>
        <div class="field"><span class="label">Paiements créés comme</span><div class="type-switch" id="subStatus"><button type="button" data-v="paid">Payé</button><button type="button" data-v="pending">En attente</button></div></div>
      </div>
      <label class="check" id="subMrrRow"><span class="toggle"><input type="checkbox" id="subMrr" checked><span></span></span>Compter dans le revenu mensuel récurrent (MRR)</label>
      <label class="check"><span class="toggle"><input type="checkbox" id="subVariable"><span></span></span>Montant variable (ex. facturation à l'usage) : paiements créés en attente, montant confirmé au paiement</label>
      <div class="field"><label for="subNotes">Notes</label><input class="input" id="subNotes" autocomplete="off"></div>
    </details>
    <div class="sub-box" id="subPriceBox" hidden>
      <label class="check"><input type="checkbox" id="subApply"><span>Mettre aussi à jour les paiements déjà créés depuis le</span><input class="input" type="date" id="subApplyFrom" style="max-width:150px"></label>
    </div>
    <div class="form-error" id="subError" hidden></div>
    <div class="dialog-actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary" id="subSubmit">Enregistrer</button></div>
  </form>`;
document.body.appendChild(dialog);

let editingSub = null;
let editingSubHadCount = false;
const freqOf = () => FREQUENCIES.find((f) => f.key === $("#subFreq").value) || FREQUENCIES[2];
const subErr = (m) => { $("#subError").textContent = m; $("#subError").hidden = !m; };

function computeEnd() {
  const n = parseInt($("#subCount").value);
  if (!(n > 0)) return null;
  const f = freqOf();
  return endAfter({ start: $("#subTrial").value || $("#subStart").value, freq: f.freq, interval: f.interval }, n);
}

function subPreview() {
  const isIn = segVal("subType") === "in";
  $("#subCounterpartyLabel").textContent = isIn ? "Client" : "Fournisseur";
  $("#subMrrRow").hidden = !isIn;
  $("#subPlanField").hidden = !isIn;
  const start = $("#subStart").value, trial = $("#subTrial").value;
  if (!start) { $("#subPreview").textContent = ""; return; }
  const f = freqOf(), first = trial || start, t = today();
  const amt = parseFloat($("#subAmount").value) || 0;
  const end = computeEnd();
  const perMonth = amt * ({ daily: 365.25 / 12, weekly: 365.25 / 7 / 12, monthly: 1, yearly: 1 / 12 }[f.freq] / f.interval);
  const bits = [];
  if (editingSub) bits.push(`Prochain paiement : ${fmtDate(editingSub.nextDate)}`);
  else bits.push(first > t ? `Premier paiement le ${fmtDate(first)}` : `Prochain paiement le ${fmtDate(firstOnOrAfter({ start: first, freq: f.freq, interval: f.interval }, addDays(t, 1)))}`);
  if (amt && !(f.freq === "monthly" && f.interval === 1)) bits.push(`soit ${fmtExact(perMonth)} par mois`);
  if (end) bits.push(`dernier paiement avant le ${fmtDate(end)}`);
  $("#subPreview").textContent = bits.join(" · ");
  const past = !editingSub && first <= t ? occurrences({ start: first, freq: f.freq, interval: f.interval, end }, first, t).length : 0;
  $("#subCatchUpRow").hidden = !past;
  $("#subCatchUpLabel").textContent = past === 1 ? `Créer le paiement du ${fmtDate(first)}` : `Créer les ${past} paiements passés (depuis le ${fmtDate(first)})`;
  const changed = editingSub && amt && amt !== editingSub.amount && S.transactions.some((x) => x.recurringId === editingSub.id);
  $("#subPriceBox").hidden = !changed;
}
dialog.addEventListener("input", subPreview);
dialog.addEventListener("click", (e) => { if (e.target.closest("#subType button")) setTimeout(subPreview); });

export function openSubscription(r, prefill = {}) {
  editingSub = r || null;
  const src = r || { type: "in", name: "", amount: "", freq: "monthly", interval: 1, startDate: today(), counterparty: "", domainId: ui.scope !== "all" ? ui.scope : activeDomains()[0]?.id || "", categoryId: "", trialEnd: null, endDate: null, plan: "", notes: "", status: "paid", kind: "subscription", amountVariable: false, ...prefill };
  fillSelects(dialog);
  $("#subTitle").textContent = r ? "Modifier l'abonnement" : "Nouvel abonnement";
  setSeg("subType", src.type);
  setSeg("subStatus", src.status === "pending" ? "pending" : "paid");
  $("#subName").value = src.name || "";
  $("#subCounterparty").value = src.counterparty || "";
  $("#subAmount").value = src.amount || "";
  $("#subFreq").value = frequencyKey(src.freq, src.interval) || "monthly";
  $("#subStart").value = src.startDate;
  $("#subDomain").value = src.domainId || "";
  $("#subCategory").value = src.categoryId || "";
  $("#subTrial").value = src.trialEnd || "";
  $("#subCount").value = "";
  editingSubHadCount = false;
  if (r?.endDate) {
    // Une fin qui tombe pile sur une échéance vient d'un nombre de paiements : on l'affiche comme tel.
    const first = billingStart(r);
    const n = occurrences({ start: first, freq: r.freq, interval: r.interval, anchorDay: r.anchorDay, end: r.endDate }, first, "9999-12-31").length;
    if (endAfter({ start: first, freq: r.freq, interval: r.interval }, n) === r.endDate) { $("#subCount").value = n; editingSubHadCount = true; }
  }
  $("#subPlan").value = src.plan || "";
  $("#subMrr").checked = src.kind !== "other";
  $("#subVariable").checked = !!src.amountVariable;
  $("#subNotes").value = src.notes || "";
  $("#subCatchUp").checked = true;
  $("#subApply").checked = false;
  $("#subApplyFrom").value = today().slice(0, 8) + "01";
  $("#subMore").open = !!(src.trialEnd || src.endDate || src.plan || src.amountVariable || src.kind === "other" || src.notes);
  subErr("");
  subPreview();
  dialog.showModal();
  setTimeout(() => $("#subName").focus(), 30);
}

$("#subForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = freqOf();
  const type = segVal("subType");
  const body = {
    type, name: $("#subName").value.trim() || ($("#subCounterparty").value.trim() ? `Abonnement ${$("#subCounterparty").value.trim()}` : ""),
    amount: parseFloat($("#subAmount").value), freq: f.freq, interval: f.interval, startDate: $("#subStart").value,
    counterparty: $("#subCounterparty").value.trim(), domainId: $("#subDomain").value || null, categoryId: $("#subCategory").value || null,
    trialEnd: $("#subTrial").value || null, plan: type === "in" ? $("#subPlan").value.trim() : "", notes: $("#subNotes").value.trim(),
    status: segVal("subStatus"), kind: type === "in" && !$("#subMrr").checked ? "other" : "subscription", amountVariable: $("#subVariable").checked,
  };
  if (!body.name) return subErr("Donne un nom à l'abonnement.");
  if (!(body.amount > 0)) return subErr("Indique un montant supérieur à 0.");
  if (!body.startDate) return subErr("Indique la date de début.");
  const end = computeEnd();
  // Sans nombre de paiements, pas de fin, sauf une résiliation déjà enregistrée qu'on garde.
  body.endDate = $("#subCount").value ? end : (editingSub && editingSub.endDate && !editingSubHadCount ? editingSub.endDate : null);
  if (!editingSub) body.catchUp = $("#subCatchUp").checked;
  if (editingSub && !$("#subPriceBox").hidden && $("#subApply").checked) body.applyAmountFrom = $("#subApplyFrom").value;
  try {
    const r = await api(editingSub ? "PUT" : "POST", editingSub ? `recurring/${editingSub.id}` : "recurring", body);
    dialog.close(); await refresh();
    toast(r.created ? `Abonnement enregistré · ${r.created} paiement${r.created > 1 ? "s" : ""} créé${r.created > 1 ? "s" : ""}` : "Abonnement enregistré");
  } catch (err) { subErr(err.message); }
});

// ---------- actions ----------
const subById = (id) => S.recurring.find((r) => r.id === id);
onClick("subEdit", (id) => openSubscription(subById(id)));
async function cancelSub(id) {
  const r = subById(id);
  const created = (date) => S.transactions.filter((x) => x.recurringId === id && x.date >= date).length;
  const v = await formBox(`Résilier « ${r.name} » ?`, `
    <p class="muted" style="margin:0;font-size:13px">Les paiements déjà créés restent dans le grand livre. Plus rien n'est facturé à partir de la date choisie.</p>
    <label class="check"><input type="radio" name="when" value="period" checked><span>À la fin de la période en cours (plus de paiement à partir du ${fmtDate(r.nextDate)})</span></label>
    <label class="check"><input type="radio" name="when" value="date"><span>À partir du</span><input class="input" type="date" name="date" value="${today()}" style="max-width:160px"></label>
    <label class="check"><input type="checkbox" name="deleteAfter"><span>Supprimer les paiements déjà créés à partir de cette date, s'il y en a</span></label>`, "Résilier",
    (v) => v.when === "date" && !v.date ? "Choisis une date." : null);
  if (!v) return;
  const endDate = v.when === "period" ? r.nextDate : v.date;
  const n = v.deleteAfter ? created(endDate) : 0;
  await mutate("POST", `recurring/${id}/cancel`, { endDate, deleteAfter: !!v.deleteAfter }, `« ${r.name} » résilié${n ? ` · ${n} paiement${n > 1 ? "s" : ""} supprimé${n > 1 ? "s" : ""}` : ""}`);
}
onClick("subCancel", cancelSub);
onClick("subReactivate", (id) => mutate("POST", `recurring/${id}/reactivate`, null, "Abonnement réactivé · reprise à la prochaine échéance"));
onClick("subDel", async (id) => {
  const r = subById(id);
  const n = S.transactions.filter((x) => x.recurringId === id).length;
  if (!n) return mutate("DELETE", `recurring/${id}`, null, `« ${r.name} » supprimé`, () => mutate("POST", "recurring", { ...r, catchUp: false }, "Abonnement restauré"));
  const c = await choiceBox(`Supprimer « ${r.name} » ?`, `Cet abonnement a ${n} paiement${n > 1 ? "s" : ""} dans le grand livre. Le résilier garde l'historique et le MRR passé ; le supprimer efface aussi ses paiements.`,
    [{ value: "cancel", label: "Résilier plutôt", primary: true }, { value: "delete", label: `Supprimer avec ses ${n} paiements`, danger: true }]);
  if (c === "cancel") return cancelSub(id);
  if (c === "delete") await mutate("DELETE", `recurring/${id}?withPayments=1`, null, `« ${r.name} » et ses paiements supprimés`);
});

registerView("subscriptions", { title: "Abonnements", render: renderSubscriptions });
export { renderSubscriptions };
