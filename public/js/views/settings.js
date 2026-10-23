// Vue Réglages : business, catégories, base de données, import/export
import { $, $$, esc, relTime, fmtBytes, store, ICON, S, ui, mutate, toast, confirmBox, domainById, catById, activeDomains, registerView, render, setScope, onClick, onChange, applyTheme } from "../core.js";

export function renderSettings() {
  const doms = S.domains.slice().sort((a, b) => (b.active - a.active) || a.position - b.position);
  $("#domainEdit").innerHTML = doms.map((d, i) => {
    const n = S.transactions.filter((t) => t.domainId === d.id).length;
    return `<div class="edit-row ${d.active ? "" : "archived"}">
      <input class="swatch" type="color" value="${esc(d.color)}" data-dom-color="${d.id}" aria-label="Couleur">
      <input class="input" value="${esc(d.name)}" data-dom-name="${d.id}" aria-label="Nom du business">
      <span class="faint num" style="font-size:12px;min-width:28px;text-align:right" title="mouvements">${n}</span>
      ${d.active ? `<button class="icon-btn" data-dom-move="${d.id}" data-dir="-1" aria-label="Monter" ${i === 0 ? "disabled" : ""}>${ICON.up}</button><button class="icon-btn" data-dom-move="${d.id}" data-dir="1" aria-label="Descendre">${ICON.down}</button>` : ""}
      <button class="icon-btn" data-dom-archive="${d.id}" title="${d.active ? "Archiver" : "Réactiver"}" aria-label="${d.active ? "Archiver" : "Réactiver"}">${d.active ? ICON.archive : ICON.restore}</button>
      <button class="icon-btn del" data-dom-del="${d.id}" aria-label="Supprimer">${ICON.del}</button></div>`;
  }).join("") || `<div class="empty">Aucun business.</div>`;

  $("#catEdit").innerHTML = S.categories.map((c) => {
    const n = S.transactions.filter((t) => t.categoryId === c.id).length;
    return `<div class="edit-row">
      <input class="swatch" type="color" value="${esc(c.color)}" data-cat-color="${c.id}" aria-label="Couleur">
      <input class="input" value="${esc(c.name)}" data-cat-name="${c.id}" aria-label="Nom de la catégorie">
      <span class="faint num" style="font-size:12px;min-width:28px;text-align:right" title="mouvements">${n}</span>
      <button class="icon-btn del" data-cat-del="${c.id}" aria-label="Supprimer">${ICON.del}</button></div>`;
  }).join("") || `<div class="empty">Aucune catégorie.</div>`;

  const i = S.info;
  if (i) {
    $("#dbFacts").innerHTML = `
      <dt>Fichier</dt><dd class="num" style="font-size:12px">${esc(i.dbPath)}</dd>
      <dt>Taille</dt><dd>${fmtBytes(i.size)}</dd>
      <dt>Contenu</dt><dd>${i.counts.transactions} mouvements · ${i.counts.domains} business · ${i.counts.categories} catégories · ${i.counts.recurring} récurrences · ${i.counts.objectives} objectifs</dd>
      <dt>Dernière sauvegarde</dt><dd>${i.lastBackup ? relTime(i.lastBackup) : "jamais"}</dd>`;
    $("#backupList").innerHTML = i.backups.length ? i.backups.map((b) => {
      const label = b.name.replace(/^ledger-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-?/, "").replace(/\.db$/, "").replace(/-/g, " ") || "auto";
      return `<div class="row"><div class="grow"><div class="title">${new Date(b.at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</div><div class="sub num">${esc(b.name)} · ${fmtBytes(b.size)}</div></div>
        <span class="chip neutral">${esc(label)}</span><button class="btn small" data-restore="${esc(b.name)}">Restaurer</button></div>`;
    }).join("") : `<div class="empty">Aucune sauvegarde pour l'instant.</div>`;
  }
  const theme = store.get("theme", "system");
  $$("#themeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === theme)));
}


onClick("domMove", (id, el) => {
  const ids = activeDomains().map((d) => d.id);
  const i = ids.indexOf(id), j = i + Number(el.dataset.dir);
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return mutate("POST", "domains/reorder", { ids });
});
onClick("domArchive", (id) => {
  const d = domainById(id);
  if (d.active && ui.scope === d.id) setScope("all");
  return mutate("PUT", `domains/${d.id}`, { active: !d.active }, d.active ? `« ${d.name} » archivé` : `« ${d.name} » réactivé`);
});
onClick("domDel", async (id) => {
  const d = domainById(id);
  if (!(await confirmBox(`Supprimer « ${d.name} » ?`, "Le business sera supprimé définitivement. Ses objectifs passeront sur « Tous les business ».", "Supprimer"))) return;
  return mutate("DELETE", `domains/${d.id}`, null, `« ${d.name} » supprimé`);
});
onClick("catDel", async (id) => {
  const c = catById(id);
  const n = S.transactions.filter((t) => t.categoryId === c.id).length;
  if (!(await confirmBox(`Supprimer « ${c.name} » ?`, n ? `${n} mouvement${n > 1 ? "s passeront" : " passera"} en « Sans catégorie ».` : "Aucun mouvement n'utilise cette catégorie.", "Supprimer"))) return;
  return mutate("DELETE", `categories/${c.id}`, null, `Catégorie « ${c.name} » supprimée`);
});
onClick("restore", async (name) => {
  if (!(await confirmBox("Restaurer cette sauvegarde ?", "Les données actuelles seront remplacées. Une sauvegarde de l'état actuel est faite juste avant.", "Restaurer"))) return;
  return mutate("POST", `backups/${encodeURIComponent(name)}/restore`, null, "Sauvegarde restaurée");
});
onClick("t", (theme) => { store.set("theme", theme); applyTheme(); renderSettings(); });

onChange("domName", (id, el) => { const v = el.value.trim(); if (v && v !== domainById(id)?.name) mutate("PUT", `domains/${id}`, { name: v }, "Business renommé"); });
onChange("domColor", (id, el) => mutate("PUT", `domains/${id}`, { color: el.value }));
onChange("catName", (id, el) => { const v = el.value.trim(); if (v && v !== catById(id)?.name) mutate("PUT", `categories/${id}`, { name: v }, "Catégorie renommée"); });
onChange("catColor", (id, el) => mutate("PUT", `categories/${id}`, { color: el.value }));

$("#addDomainForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#newDomain").value.trim();
  if (!name) return;
  if (await mutate("POST", "domains", { name }, `Business « ${name} » ajouté`)) $("#newDomain").value = "";
});
$("#addCatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#newCat").value.trim();
  if (!name) return;
  const palette = ["#7fae8e", "#b97c7c", "#8ea3b9", "#c9a86a", "#9a8ec9", "#6f9a9a", "#d4876e", "#a3a86f"];
  if (await mutate("POST", "categories", { name, color: palette[S.categories.length % palette.length] }, `Catégorie « ${name} » ajoutée`)) $("#newCat").value = "";
});
export const IS_WIN = /Windows/.test(navigator.userAgent);
$("#revealBtn").textContent = IS_WIN ? "Afficher dans l'Explorateur" : "Afficher dans le Finder";
$("#revealBtn").addEventListener("click", () => mutate("POST", "reveal", null, IS_WIN ? "Ouvert dans l'Explorateur" : "Ouvert dans le Finder"));
$("#backupNowBtn").addEventListener("click", () => mutate("POST", "backups", null, "Sauvegarde créée"));
$("#importBtn").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("Ce fichier n'est pas un JSON valide.", null, true); }
  const n = data.transactions?.length ?? 0;
  if (!(await confirmBox(`Importer ${file.name} ?`, `${n} mouvement${n > 1 ? "s" : ""} trouvé${n > 1 ? "s" : ""}. Toutes les données actuelles seront remplacées (une sauvegarde est faite avant).`, "Importer"))) return;
  await mutate("POST", "import", data, "Import terminé");
});

registerView("settings", { title: "Réglages", render: renderSettings, usesPeriod: false, usesScope: false });
