// Dialogue de saisie d'un mouvement et actions sur les mouvements
import { $, todayISO, S, ui, api, refresh, mutate, toast, activeDomains, fillSelects, segVal, setSeg, onClick } from "../core.js";

export let editingTx = null;

export function openTx(t, duplicate) {
  editingTx = t && !duplicate ? t : null;
  const src = t || { type: "in", amount: "", desc: "", domainId: ui.scope !== "all" ? ui.scope : activeDomains()[0]?.id || "", categoryId: "", date: todayISO(), status: "paid", kind: "cash", asset: "", qty: "", pricePerUnit: "" };
  $("#txTitle").textContent = editingTx ? "Modifier le mouvement" : duplicate ? "Dupliquer le mouvement" : "Nouveau mouvement";
  setSeg("txType", src.type); setSeg("txStatus", src.status);
  $("#txAmount").value = src.amount || "";
  $("#txDesc").value = src.desc || "";
  fillSelects();
  $("#txDomain").value = src.domainId || "";
  $("#txCategory").value = src.categoryId || "";
  $("#txDate").value = duplicate ? todayISO() : src.date;
  $("#txInvest").checked = src.kind === "invest";
  $("#txAsset").value = src.asset || ""; $("#txQty").value = src.qty || ""; $("#txPpu").value = src.pricePerUnit || "";
  toggleInvest();
  $("#txDelete").hidden = !editingTx;
  $("#txError").hidden = true;
  $("#txDialog").showModal();
  setTimeout(() => $("#txAmount").focus(), 30);
}
export function toggleInvest() {
  const on = $("#txInvest").checked;
  $("#investBox").hidden = !on;
  $('#txType [data-v="in"]').textContent = on ? "Vente" : "Entrée";
  $('#txType [data-v="out"]').textContent = on ? "Achat" : "Sortie";
}
export function recalcInvest() {
  const q = parseFloat($("#txQty").value), p = parseFloat($("#txPpu").value);
  if (q > 0 && p > 0) $("#txAmount").value = (q * p).toFixed(2);
}
// Remplit business et catégorie depuis un libellé déjà utilisé
$("#txDesc").addEventListener("change", () => {
  if (editingTx) return;
  const prev = [...S.transactions].sort((a, b) => b.date.localeCompare(a.date)).find((t) => t.desc === $("#txDesc").value);
  if (prev) { if (prev.domainId) $("#txDomain").value = prev.domainId; if (prev.categoryId) $("#txCategory").value = prev.categoryId; setSeg("txType", prev.type); }
});
$("#txInvest").addEventListener("change", toggleInvest);
$("#txQty").addEventListener("input", recalcInvest);
$("#txPpu").addEventListener("input", recalcInvest);
$("#txForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const invest = $("#txInvest").checked;
  const type = segVal("txType");
  const body = {
    type, status: segVal("txStatus"), amount: parseFloat($("#txAmount").value), desc: $("#txDesc").value.trim(),
    domainId: $("#txDomain").value || null, categoryId: $("#txCategory").value || null, date: $("#txDate").value,
    kind: invest ? "invest" : "cash", asset: $("#txAsset").value.trim(), qty: parseFloat($("#txQty").value) || 0, pricePerUnit: parseFloat($("#txPpu").value) || 0,
  };
  if (invest && !body.desc) body.desc = `${type === "out" ? "Achat" : "Vente"} ${body.qty} ${body.asset.toUpperCase()}`;
  try {
    await api(editingTx ? "PUT" : "POST", editingTx ? `transactions/${editingTx.id}` : "transactions", body);
    $("#txDialog").close();
    await refresh();
    toast(editingTx ? "Mouvement modifié" : "Mouvement ajouté");
  } catch (err) { $("#txError").textContent = err.message; $("#txError").hidden = false; }
});
$("#txDelete").addEventListener("click", () => { const t = editingTx; $("#txDialog").close(); deleteTx(t.id); });

export async function deleteTx(id) {
  const t = S.transactions.find((x) => x.id === id);
  if (!t) return;
  await mutate("DELETE", `transactions/${id}`, null, `« ${t.desc || "Mouvement"} » supprimé`, () => mutate("POST", "transactions", t, "Mouvement restauré"));
}


export const txById = (id) => S.transactions.find((t) => t.id === id);
onClick("rowEdit", (id) => openTx(txById(id)));
onClick("edit", (id) => openTx(txById(id)));
onClick("dup", (id) => openTx(txById(id), true));
onClick("del", (id) => deleteTx(id));
export const setStatus = (id, status) => mutate("PUT", `transactions/${id}`, { status }, status === "paid" ? "Marqué comme payé" : "Marqué en attente");
onClick("toggle", (id) => setStatus(id, txById(id).status === "paid" ? "pending" : "paid"));
onClick("pay", (id) => setStatus(id, "paid"));
