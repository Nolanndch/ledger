// Vue Récurrents et son dialogue
import { $, esc, fmt, fmtSigned, todayISO, fmtDate, ICON, S, ui, api, refresh, mutate, toast, domainById, catById, activeDomains, registerView, render, fillSelects, segVal, setSeg, onClick, onChange } from "../core.js";

export const FREQ = { daily: "chaque jour", weekly: "chaque semaine", monthly: "chaque mois", yearly: "chaque année" };
export const MONTHLY_FACTOR = { daily: 30.44, weekly: 52 / 12, monthly: 1, yearly: 1 / 12 };
export function renderRecurring() {
  const list = S.recurring.filter((r) => ui.scope === "all" || r.domainId === ui.scope).sort((a, b) => (b.active - a.active) || a.nextDate.localeCompare(b.nextDate));
  const on = list.filter((r) => r.active);
  const mIn = on.filter((r) => r.type === "in").reduce((a, r) => a + r.amount * MONTHLY_FACTOR[r.freq], 0);
  const mOut = on.filter((r) => r.type === "out").reduce((a, r) => a + r.amount * MONTHLY_FACTOR[r.freq], 0);
  $("#recFacts").innerHTML = [
    ["Revenus récurrents / mois", fmt(mIn), "up"], ["Charges fixes / mois", fmt(mOut), "down"], ["Net récurrent / mois", fmtSigned(mIn - mOut), mIn - mOut >= 0 ? "up" : "down"],
  ].map(([l, v, c]) => `<div><div class="kpi-label">${l}</div><div class="kpi-value ${c}">${v}</div></div>`).join("");
  $("#recList").innerHTML = list.length ? list.map((r) => {
    const d = domainById(r.domainId), c = catById(r.categoryId);
    const count = S.transactions.filter((t) => t.recurringId === r.id).length;
    return `<div class="row" style="${r.active ? "" : "opacity:.55"}">
      <label class="toggle" title="${r.active ? "Mettre en pause" : "Réactiver"}"><input type="checkbox" data-rec-toggle="${r.id}" ${r.active ? "checked" : ""} aria-label="Active"><span></span></label>
      <div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${FREQ[r.freq]}${d ? " · " + esc(d.name) : ""}${c ? " · " + esc(c.name) : ""} · ${count} créé${count > 1 ? "s" : ""}</div></div>
      <span class="chip ${r.active ? "neutral" : "neutral"}">${r.active ? "prochaine : " + fmtDate(r.nextDate) : "en pause"}</span>
      <span class="amt ${r.type === "in" ? "up" : "down"}">${r.type === "in" ? "+" : "−"}${fmt(r.amount)}</span>
      <button class="icon-btn" data-rec-edit="${r.id}" aria-label="Modifier">${ICON.edit}</button>
      <button class="icon-btn del" data-rec-del="${r.id}" aria-label="Supprimer">${ICON.del}</button></div>`;
  }).join("") : `<div class="empty"><b>Aucune échéance</b>Ajoute un abonnement, un loyer ou un client mensuel : le mouvement sera créé tout seul à chaque échéance.</div>`;
}


export let editingRec = null;
export function openRec(r) {
  editingRec = r || null;
  const src = r || { type: "out", name: "", amount: "", freq: "monthly", domainId: ui.scope !== "all" ? ui.scope : activeDomains()[0]?.id || "", categoryId: "", nextDate: todayISO(), status: "paid" };
  $("#recTitle").textContent = r ? "Modifier l'échéance" : "Nouvelle échéance";
  setSeg("recType", src.type); setSeg("recStatus", src.status);
  $("#recName").value = src.name; $("#recAmount").value = src.amount; $("#recFreq").value = src.freq;
  fillSelects();
  $("#recDomain").value = src.domainId || ""; $("#recCategory").value = src.categoryId || ""; $("#recNext").value = src.nextDate;
  $("#recError").hidden = true;
  $("#recDialog").showModal();
}
$("#recForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { name: $("#recName").value, type: segVal("recType"), amount: parseFloat($("#recAmount").value), freq: $("#recFreq").value,
    domainId: $("#recDomain").value || null, categoryId: $("#recCategory").value || null, nextDate: $("#recNext").value, status: segVal("recStatus") };
  try {
    const before = S.transactions.length;
    await api(editingRec ? "PUT" : "POST", editingRec ? `recurring/${editingRec.id}` : "recurring", body);
    $("#recDialog").close();
    await refresh();
    const created = S.transactions.length - before;
    toast(created > 0 ? `Échéance enregistrée · ${created} mouvement${created > 1 ? "s" : ""} créé${created > 1 ? "s" : ""}` : "Échéance enregistrée");
  } catch (err) { $("#recError").textContent = err.message; $("#recError").hidden = false; }
});


$("#addRecBtn").addEventListener("click", () => openRec());
onClick("recEdit", (id) => openRec(S.recurring.find((r) => r.id === id)));
onClick("recDel", (id) => {
  const r = S.recurring.find((x) => x.id === id);
  return mutate("DELETE", `recurring/${r.id}`, null, `Échéance « ${r.name} » supprimée (les mouvements déjà créés restent)`, () => mutate("POST", "recurring", r, "Échéance restaurée"));
});
onChange("recToggle", (id, el) => mutate("PUT", `recurring/${id}`, { active: el.checked }, el.checked ? "Échéance réactivée" : "Échéance en pause"));

registerView("recurring", { title: "Récurrents", render: renderRecurring, usesPeriod: false, usesScope: true });
