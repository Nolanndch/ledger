// Dialogue de saisie d'un mouvement (une fois, récurrent, en plusieurs fois) et actions sur les mouvements.
import { $, $$, esc, fmt, fmtExact, fmtDate, todayISO, S, ui, api, refresh, mutate, toast, choiceBox, formBox, fillSelects, segVal, setSeg, onClick, activeDomains, isOverdue } from "../core.js";
import { FREQUENCIES, addPeriod, addDays, occurrences, firstOnOrAfter } from "../dates.js";
import { openSubscription } from "../views/subscriptions.js";
import { openOperationForTransfer } from "../views/investments.js";

const dialog = document.createElement("dialog");
dialog.id = "txDialog";
dialog.className = "wide";
dialog.innerHTML = `
  <form id="txForm" novalidate>
    <div class="dialog-head"><h3 id="txTitle">Nouveau mouvement</h3><div class="seg small pick" id="txMode" role="group" aria-label="Type de paiement">
      <button type="button" data-v="once">Une fois</button><button type="button" data-v="recurring">Récurrent</button><button type="button" data-v="installments">En plusieurs fois</button>
    </div></div>
    <div class="context-note" id="txContext" hidden></div>
    <div class="type-switch" id="txType"><button type="button" data-v="in">Entrée</button><button type="button" data-v="out">Sortie</button></div>
    <div class="field"><label for="txAmount" id="txAmountLabel">Montant (€)</label><input class="input amount-input num" id="txAmount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00"></div>
    <div class="fields-2">
      <div class="field"><label for="txDesc">Libellé</label><input class="input" id="txDesc" list="descList" placeholder="Ex. Création site vitrine" autocomplete="off"></div>
      <div class="field"><label for="txCounterparty" id="txCounterpartyLabel">Client</label><input class="input" id="txCounterparty" list="counterpartyList" placeholder="Optionnel" autocomplete="off"></div>
    </div>
    <div class="fields-2">
      <div class="field"><label for="txDomain">Business</label><select class="select" id="txDomain" data-fill="domains-none"></select></div>
      <div class="field"><label for="txCategory">Catégorie</label><select class="select" id="txCategory" data-fill="categories"></select></div>
    </div>
    <div class="fields-2">
      <div class="field"><label for="txDate" id="txDateLabel">Date</label><input class="input" id="txDate" type="date"></div>
      <div class="field" id="txStatusField"><span class="label" id="txStatusLabel">Statut</span><div class="type-switch" id="txStatus"><button type="button" data-v="paid">Payé</button><button type="button" data-v="pending">En attente</button></div></div>
    </div>

    <div class="sub-box" id="txRecurringBox" hidden>
      <div class="fields-2">
        <div class="field"><label for="txFreq">Fréquence</label><select class="select" id="txFreq">${FREQUENCIES.map((f) => `<option value="${f.key}"${f.key === "monthly" ? " selected" : ""}>${f.label}</option>`).join("")}</select></div>
        <div class="field" id="txMrrField"><span class="label">Revenu récurrent</span><label class="check"><span class="toggle"><input type="checkbox" id="txMrr" checked><span></span></span>Compter dans le MRR</label></div>
      </div>
      <p class="hint" id="txRecurringPreview"></p>
      <label class="check" id="txCatchUpRow" hidden><input type="checkbox" id="txCatchUp" checked><span id="txCatchUpLabel"></span></label>
      <button type="button" class="link-btn" id="txMoreSub">Plus d'options (essai gratuit, fin, montant variable…)</button>
    </div>

    <div class="sub-box" id="txInstallmentsBox" hidden>
      <div class="fields-2">
        <div class="field"><label for="txCount">Nombre d'échéances</label><input class="input num" id="txCount" type="number" min="2" max="24" value="3"></div>
        <div class="field"><label for="txEvery">Espacement</label><select class="select" id="txEvery">
          <option value="monthly-1" selected>Tous les mois</option><option value="weekly-1">Toutes les semaines</option><option value="weekly-2">Toutes les 2 semaines</option><option value="monthly-3">Tous les trimestres</option>
        </select></div>
      </div>
      <div class="schedule" id="txSchedule"></div>
      <p class="hint" id="txScheduleSum"></p>
    </div>

    <div class="form-error" id="txError" hidden></div>
    <div class="dialog-actions">
      <button type="button" class="btn danger left" id="txDelete" hidden>Supprimer</button>
      <button type="button" class="btn" id="txRefund" hidden>Rembourser</button>
      <button type="button" class="btn" data-close>Annuler</button>
      <button type="submit" class="btn primary" id="txSubmit">Enregistrer</button>
    </div>
  </form>`;
document.body.appendChild(dialog);

let editing = null;
let scheduleRows = []; // [{date, amount}] modifiables
let scheduleTouched = false;
const mode = () => segVal("txMode") || "once";
const type = () => segVal("txType") || "in";
const amount = () => parseFloat($("#txAmount").value) || 0;
const recById = (id) => S.recurring.find((r) => r.id === id);
const showError = (msg) => { $("#txError").textContent = msg; $("#txError").hidden = !msg; };

function freqParts() {
  const f = FREQUENCIES.find((x) => x.key === $("#txFreq").value) || FREQUENCIES[2];
  return { freq: f.freq, interval: f.interval };
}

// ---------- échéancier ----------
function computeSchedule() {
  const total = Math.round(amount() * 100), n = Math.max(2, Math.min(24, parseInt($("#txCount").value) || 2));
  const [freq, interval] = $("#txEvery").value.split("-");
  const start = $("#txDate").value || todayISO();
  const dates = [start];
  for (let i = 1; i < n; i++) dates.push(addPeriod(dates[i - 1], freq, Number(start.slice(8)), Number(interval)));
  const base = Math.floor(total / n), first = total - base * (n - 1);
  scheduleRows = dates.map((date, i) => ({ date, amount: (i === 0 ? first : base) / 100 }));
  scheduleTouched = false;
}
function renderSchedule() {
  const t = todayISO();
  $("#txSchedule").innerHTML = scheduleRows.map((r, i) => `
    <div class="schedule-row"><span class="faint num">${i + 1}/${scheduleRows.length}</span>
      <input class="input" type="date" value="${r.date}" data-sch-date="${i}" aria-label="Date de l'échéance ${i + 1}">
      <input class="input num" type="number" step="0.01" min="0" value="${r.amount.toFixed(2)}" data-sch-amount="${i}" aria-label="Montant de l'échéance ${i + 1}">
      <span class="chip ${r.date > t ? "pending" : "paid"}">${r.date > t ? "À venir" : "Échue"}</span></div>`).join("");
  updateScheduleSum();
}
function updateScheduleSum() {
  const sum = scheduleRows.reduce((a, r) => a + Math.round(r.amount * 100), 0) / 100;
  const diff = Math.round((sum - amount()) * 100) / 100;
  $("#txScheduleSum").innerHTML = diff
    ? `<span class="down">La somme des échéances (${fmtExact(sum)}) ne fait pas le total (${fmtExact(amount())}).</span> <button type="button" class="link-btn" id="txResplit">Répartir à nouveau</button>`
    : `Les échéances futures seront créées « en attente ». Tu peux changer les dates et les montants (ex. acompte de 30 %).`;
}
dialog.addEventListener("input", (e) => {
  const i = e.target.dataset.schDate ?? e.target.dataset.schAmount;
  if (i !== undefined) {
    if (e.target.dataset.schDate !== undefined) scheduleRows[i].date = e.target.value;
    else scheduleRows[i].amount = parseFloat(e.target.value) || 0;
    scheduleTouched = true;
    updateScheduleSum();
  }
});
dialog.addEventListener("click", (e) => { if (e.target.id === "txResplit") { computeSchedule(); renderSchedule(); } });

// ---------- aperçu récurrent ----------
function recurringPreview() {
  const start = $("#txDate").value || todayISO();
  const { freq, interval } = freqParts();
  const t = todayISO();
  const past = start <= t ? occurrences({ start, freq, interval }, start, t).length : 0;
  const label = FREQUENCIES.find((f) => f.freq === freq && f.interval === interval)?.label.toLowerCase() || "";
  $("#txRecurringPreview").textContent = start > t
    ? `Premier paiement le ${fmtDate(start)}, puis ${label}.`
    : `Paiements ${label} · prochain le ${fmtDate(firstOnOrAfter({ start, freq, interval }, addDays(t, 1)))}.`;
  $("#txCatchUpRow").hidden = past === 0;
  $("#txCatchUpLabel").textContent = past === 1 ? "Créer le paiement d'aujourd'hui" : `Créer les ${past} paiements depuis le ${fmtDate(start)}`;
}

function syncMode() {
  const m = mode(), isIn = type() === "in";
  $("#txRecurringBox").hidden = m !== "recurring";
  $("#txInstallmentsBox").hidden = m !== "installments";
  $("#txStatusField").hidden = m === "installments";
  $("#txAmountLabel").textContent = m === "installments" ? "Montant total (€)" : "Montant (€)";
  $("#txDateLabel").textContent = m === "once" ? "Date" : m === "recurring" ? "Premier paiement" : "Première échéance";
  $("#txStatusLabel").textContent = m === "recurring" ? "Paiements créés comme" : "Statut";
  $("#txCounterpartyLabel").textContent = isIn ? "Client" : "Fournisseur";
  $("#txMrrField").hidden = !isIn;
  $("#txSubmit").textContent = m === "recurring" ? "Créer l'abonnement" : m === "installments" ? "Créer les échéances" : "Enregistrer";
  if (m === "recurring") recurringPreview();
  if (m === "installments") { if (!scheduleTouched) computeSchedule(); renderSchedule(); }
}
dialog.addEventListener("click", (e) => { if (e.target.closest("#txMode button, #txType button")) setTimeout(syncMode); });
["#txDate", "#txFreq", "#txCount", "#txEvery", "#txAmount"].forEach((s) => $(s).addEventListener("input", () => { scheduleTouched = scheduleTouched && s !== "#txCount" && s !== "#txEvery"; syncMode(); }));

// Remplit business, catégorie et contrepartie depuis un libellé déjà utilisé
$("#txDesc").addEventListener("change", () => {
  if (editing) return;
  const prev = [...S.transactions].sort((a, b) => b.date.localeCompare(a.date)).find((t) => t.desc === $("#txDesc").value && t.kind !== "transfer");
  if (prev) {
    if (prev.domainId) $("#txDomain").value = prev.domainId;
    if (prev.categoryId) $("#txCategory").value = prev.categoryId;
    if (prev.counterparty && !$("#txCounterparty").value) $("#txCounterparty").value = prev.counterparty;
    setSeg("txType", prev.type); syncMode();
  }
});

// ---------- ouverture ----------
export function openTx(t, duplicate) {
  if (t?.kind === "transfer" && !duplicate) return openOperationForTransfer(t);
  editing = t && !duplicate ? t : null;
  const src = t || { type: "in", amount: "", desc: "", counterparty: "", domainId: ui.scope !== "all" ? ui.scope : activeDomains()[0]?.id || "", categoryId: "", date: todayISO(), status: "paid" };
  fillSelects(dialog);
  $("#txTitle").textContent = editing ? "Modifier le mouvement" : duplicate ? "Dupliquer le mouvement" : "Nouveau mouvement";
  $("#txMode").hidden = !!editing;
  setSeg("txMode", "once");
  setSeg("txType", src.type);
  setSeg("txStatus", src.status === "pending" ? "pending" : "paid");
  $("#txAmount").value = src.amount || "";
  $("#txDesc").value = src.desc || "";
  $("#txCounterparty").value = src.counterparty || "";
  $("#txDomain").value = src.domainId || "";
  $("#txCategory").value = src.categoryId || "";
  $("#txDate").value = duplicate ? todayISO() : src.date;
  $("#txCount").value = 3; $("#txEvery").value = "monthly-1"; $("#txFreq").value = "monthly"; $("#txMrr").checked = true; $("#txCatchUp").checked = true;
  scheduleTouched = false;
  // Contexte : paiement d'un abonnement, échéance, remboursement
  const ctx = [];
  const rec = editing?.recurringId && recById(editing.recurringId);
  if (rec) ctx.push(`Créé par l'abonnement « ${esc(rec.name)} ». <button type="button" class="link-btn" id="txOpenSub">Modifier l'abonnement</button>`);
  if (editing?.nature === "installment") {
    const group = S.transactions.filter((x) => x.installmentGroup === editing.installmentGroup);
    ctx.push(`Échéance ${editing.installmentIndex}/${editing.installmentCount} · total ${fmt(group.reduce((a, x) => a + x.amount, 0))}`);
  }
  if (editing?.kind === "refund") { const o = S.transactions.find((x) => x.id === editing.refundOf); ctx.push(`Remboursement${o ? ` de « ${esc(o.desc || "paiement")} » du ${fmtDate(o.date)}` : ""}.`); }
  if (editing) {
    const refunded = S.transactions.filter((x) => x.refundOf === editing.id).reduce((a, x) => a + x.amount, 0);
    if (refunded) ctx.push(`Remboursé : ${fmt(refunded)}${refunded >= editing.amount ? " (en totalité)" : " (en partie)"}.`);
  }
  $("#txContext").innerHTML = ctx.join("<br>");
  $("#txContext").hidden = !ctx.length;
  $("#txDelete").hidden = !editing;
  $("#txRefund").hidden = !(editing && editing.kind === "cash" && editing.status === "paid");
  showError("");
  syncMode();
  dialog.showModal();
  setTimeout(() => $("#txAmount").focus(), 30);
}

dialog.addEventListener("click", (e) => {
  if (e.target.id === "txOpenSub") { const r = recById(editing.recurringId); dialog.close(); openSubscription(r); }
});
$("#txMoreSub").addEventListener("click", () => {
  const { freq, interval } = freqParts();
  const prefill = {
    type: type(), name: $("#txDesc").value, amount: amount() || "", counterparty: $("#txCounterparty").value, domainId: $("#txDomain").value, categoryId: $("#txCategory").value,
    startDate: $("#txDate").value || todayISO(), freq, interval, kind: type() === "in" && !$("#txMrr").checked ? "other" : "subscription", status: segVal("txStatus"),
  };
  dialog.close();
  openSubscription(null, prefill);
});

// ---------- enregistrement ----------
$("#txForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const base = {
    type: type(), amount: amount(), desc: $("#txDesc").value.trim(), counterparty: $("#txCounterparty").value.trim(),
    domainId: $("#txDomain").value || null, categoryId: $("#txCategory").value || null, date: $("#txDate").value, status: segVal("txStatus"),
  };
  if (!(base.amount > 0)) return showError("Indique un montant supérieur à 0.");
  if (!base.date) return showError("Indique une date.");
  try {
    const m = editing ? "once" : mode();
    if (m === "recurring") {
      const { freq, interval } = freqParts();
      const r = await api("POST", "recurring", {
        name: base.desc || (base.counterparty ? `Abonnement ${base.counterparty}` : "Abonnement"), type: base.type, amount: base.amount, freq, interval,
        counterparty: base.counterparty, domainId: base.domainId, categoryId: base.categoryId, startDate: base.date, status: base.status,
        kind: base.type === "in" && !$("#txMrr").checked ? "other" : "subscription", catchUp: $("#txCatchUp").checked,
      });
      dialog.close(); await refresh();
      toast(r.created ? `Abonnement créé · ${r.created} paiement${r.created > 1 ? "s" : ""} ajouté${r.created > 1 ? "s" : ""}` : "Abonnement créé");
      return;
    }
    if (m === "installments") {
      const sum = scheduleRows.reduce((a, r) => a + Math.round(r.amount * 100), 0);
      if (sum !== Math.round(base.amount * 100)) return showError("La somme des échéances doit être égale au montant total.");
      if (scheduleRows.some((r) => !r.date || !(r.amount > 0))) return showError("Chaque échéance doit avoir une date et un montant.");
      const rows = await api("POST", "installments", { ...base, status: "paid", rows: scheduleRows });
      dialog.close(); await refresh();
      toast(`${rows.length} échéances créées`);
      return;
    }
    if (editing) {
      const rec = editing.recurringId && recById(editing.recurringId);
      await api("PUT", `transactions/${editing.id}`, base);
      if (rec && base.amount !== editing.amount && rec.amount !== base.amount) {
        const choice = await choiceBox("Changer aussi le prix de l'abonnement ?", `Ce paiement passe à ${fmt(base.amount)}. Les prochains paiements de « ${esc(rec.name)} » peuvent garder ${fmt(rec.amount)} ou passer à ${fmt(base.amount)}.`,
          [{ value: "keep", label: `Garder ${fmtExact(rec.amount)}` }, { value: "apply", label: `Passer à ${fmtExact(base.amount)}`, primary: true }]);
        if (choice === "apply") await api("PUT", `recurring/${rec.id}`, { amount: base.amount });
      }
    } else await api("POST", "transactions", base);
    dialog.close(); await refresh();
    toast(editing ? "Mouvement modifié" : "Mouvement ajouté");
  } catch (err) { showError(err.message); }
});

$("#txDelete").addEventListener("click", () => { const t = editing; dialog.close(); deleteTx(t.id); });
$("#txRefund").addEventListener("click", () => { const t = editing; dialog.close(); refundTx(t); });

// ---------- actions ----------
export async function deleteTx(id) {
  const t = S.transactions.find((x) => x.id === id);
  if (!t) return;
  if (t.kind === "transfer") return openOperationForTransfer(t);
  if (t.nature === "installment") {
    const rest = S.transactions.filter((x) => x.installmentGroup === t.installmentGroup && x.installmentIndex >= t.installmentIndex && x.status === "pending");
    if (rest.length > 1 || (rest.length === 1 && rest[0].id !== t.id)) {
      const c = await choiceBox("Supprimer l'échéance ?", `Échéance ${t.installmentIndex}/${t.installmentCount} de « ${esc(t.desc || "paiement")} ».`,
        [{ value: "one", label: "Seulement celle-ci" }, { value: "rest", label: `Les ${rest.length} échéances non payées`, danger: true }]);
      if (!c) return;
      if (c === "rest") {
        const r = await mutate("DELETE", `installments/${t.installmentGroup}?from=${t.installmentIndex}`, null, `${rest.length} échéances supprimées`,
          () => mutate("POST", "transactions/bulk", { rows: r.deleted }, "Échéances restaurées"));
        return;
      }
    }
  }
  await mutate("DELETE", `transactions/${id}`, null, `« ${t.desc || "Mouvement"} » supprimé`, () => mutate("POST", "transactions/bulk", { rows: [t] }, "Mouvement restauré"));
}

async function refundTx(t) {
  const done = S.transactions.filter((x) => x.refundOf === t.id).reduce((a, x) => a + x.amount, 0);
  const max = Math.round((t.amount - done) * 100) / 100;
  if (max <= 0) return toast("Ce paiement est déjà remboursé en totalité.", null, true);
  const v = await formBox(t.type === "in" ? "Rembourser le client" : "Remboursement reçu", `
    <p class="muted" style="margin:0;font-size:13px">« ${esc(t.desc || "Paiement")} » · ${fmt(t.amount)} le ${fmtDate(t.date)}. Le remboursement ${t.type === "in" ? "réduit ton chiffre d'affaires" : "réduit tes dépenses"}.</p>
    <div class="fields-2"><div class="field"><label>Montant (€)</label><input class="input num" name="amount" type="number" step="0.01" min="0" max="${max}" value="${max.toFixed(2)}"></div>
    <div class="field"><label>Date</label><input class="input" name="date" type="date" value="${todayISO()}"></div></div>`, "Enregistrer le remboursement",
    (v) => !(parseFloat(v.amount) > 0) || parseFloat(v.amount) > max ? `Le montant doit être compris entre 0 et ${fmtExact(max)}.` : null);
  if (v) await mutate("POST", `transactions/${t.id}/refund`, { amount: parseFloat(v.amount), date: v.date }, "Remboursement enregistré");
}

// Marquer payé : pour un abonnement à montant variable, demander le montant réel.
async function markPaid(t) {
  const rec = t.recurringId && recById(t.recurringId);
  if (rec?.amountVariable) {
    const v = await formBox("Montant réel", `<p class="muted" style="margin:0;font-size:13px">« ${esc(t.desc)} » du ${fmtDate(t.date)} : le montant de cet abonnement varie. Saisis le montant débité.</p>
      <div class="field"><label>Montant (€)</label><input class="input num amount-input" name="amount" type="number" step="0.01" min="0" value="${t.amount.toFixed(2)}"></div>`, "Marquer payé",
      (v) => parseFloat(v.amount) > 0 ? null : "Indique un montant.");
    if (!v) return;
    return mutate("PUT", `transactions/${t.id}`, { status: "paid", amount: parseFloat(v.amount) }, "Marqué comme payé");
  }
  return mutate("PUT", `transactions/${t.id}`, { status: "paid" }, "Marqué comme payé");
}

const txById = (id) => S.transactions.find((t) => t.id === id);
onClick("rowEdit", (id) => openTx(txById(id)));
onClick("edit", (id) => openTx(txById(id)));
onClick("dup", (id) => openTx(txById(id), true));
onClick("del", (id) => deleteTx(id));
onClick("refund", (id) => refundTx(txById(id)));
onClick("toggle", (id) => {
  const t = txById(id);
  if (t.kind === "transfer") return toast("Un virement vers un placement est toujours payé.", null, true);
  return t.status === "paid" ? mutate("PUT", `transactions/${id}`, { status: "pending" }, "Marqué en attente") : markPaid(t);
});
onClick("pay", (id) => markPaid(txById(id)));
export { isOverdue };
