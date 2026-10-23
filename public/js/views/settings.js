// Vue Réglages : business, catégories, base de données, import/export
import { $, $$, esc, fmt, fmtExact, fmtDate, relTime, fmtBytes, store, ICON, S, ui, mutate, toast, confirmBox, formBox, domainById, catById, activeDomains, registerView, render, setScope, onClick, onChange, applyTheme, saveSettings, setDiscreet, display, PERIODS, VIEW_TITLES } from "../core.js";

const root = $("#view-settings");
root.innerHTML = `
  <div class="panel">
    <div class="panel-head"><h2>Affichage</h2><span class="hint">enregistré dans la base, sauf le thème et le mode discret qui sont propres à cet appareil</span></div>
    <div class="settings-grid">
      <div class="field"><span class="label">Thème</span><div class="seg" id="themeSeg"><button data-t="system">Système</button><button data-t="light">Clair</button><button data-t="dark">Sombre</button></div></div>
      <div class="field"><span class="label">Densité des listes</span><div class="seg" id="densitySeg"><button data-density="comfortable">Confortable</button><button data-density="compact">Compacte</button></div></div>
      <div class="field"><label for="setPeriod">Période à l'ouverture</label><select class="select" id="setPeriod">${PERIODS.filter(([k]) => k !== "custom").map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
      <div class="field"><label for="setView">Vue à l'ouverture</label><select class="select" id="setView"><option value="last">La dernière consultée</option><option value="dashboard">Tableau de bord</option><option value="ledger">Grand livre</option><option value="analytics">Analyse</option><option value="subscriptions">Abonnements</option><option value="investments">Investissements</option><option value="objectives">Objectifs</option></select></div>
      <label class="check"><span class="toggle"><input type="checkbox" id="setCents"><span></span></span><span>Afficher les centimes</span></label>
      <label class="check"><span class="toggle"><input type="checkbox" id="setCompare"><span></span></span><span>Comparer à la période précédente</span></label>
      <label class="check"><span class="toggle"><input type="checkbox" id="setDiscreet"><span></span></span><span>Mode discret : masquer les montants <span class="faint">(touche H ou icône œil)</span></span></label>
    </div>
  </div>
  <div class="grid-2 even">
    <div class="panel">
      <div class="panel-head"><h2>Business</h2><span class="hint">un business archivé garde son historique</span></div>
      <div id="domainEdit"></div>
      <form class="add-row" id="addDomainForm"><input class="input" id="newDomain" placeholder="Nouveau business" autocomplete="off"><button class="btn">Ajouter</button></form>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Catégories</h2></div>
      <div id="catEdit"></div>
      <form class="add-row" id="addCatForm"><input class="input" id="newCat" placeholder="Nouvelle catégorie" autocomplete="off"><button class="btn">Ajouter</button></form>
    </div>
  </div>
  <div class="grid-2 even">
    <div class="panel">
      <div class="panel-head"><h2>Base de données</h2><span class="chip paid">SQLite locale</span></div>
      <div class="panel-body" style="display:grid;gap:16px;">
        <dl class="facts" id="dbFacts"></dl>
        <div class="btn-row"><button class="btn small" id="revealBtn">Afficher le fichier</button><button class="btn small" id="backupNowBtn">Sauvegarder maintenant</button></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Import et export</h2></div>
      <div class="panel-body" style="display:grid;gap:14px;">
        <p class="muted" style="margin:0;font-size:13px;">L'export JSON contient tout (mouvements, abonnements, placements, réglages). Un export de Ledger 1.0 s'importe aussi. Importer remplace toutes les données, après une sauvegarde automatique.</p>
        <div class="btn-row">
          <a class="btn small" href="/api/export" download>Exporter JSON</a>
          <a class="btn small" href="/api/export/csv" download>Mouvements (CSV)</a>
          <a class="btn small" href="/api/export/csv-invest" download>Placements (CSV)</a>
          <button class="btn small" id="importBtn">Importer un JSON…</button>
          <input type="file" id="importFile" accept="application/json,.json" hidden>
        </div>
      </div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><h2>Sauvegardes</h2><span class="hint">une par jour, les 30 dernières sont gardées ; celles d'avant une mise à jour sont conservées</span></div>
    <div class="rows" id="backupList"></div>
  </div>`;

export function renderSettings() {
  const doms = S.domains.slice().sort((a, b) => (b.active - a.active) || a.position - b.position);
  $("#domainEdit").innerHTML = doms.map((d, i) => {
    const n = S.transactions.filter((t) => t.domainId === d.id).length;
    return `<div class="edit-row ${d.active ? "" : "archived"}">
      <input class="swatch" type="color" value="${esc(d.color)}" data-dom-color="${d.id}" aria-label="Couleur">
      <input class="input" value="${esc(d.name)}" data-dom-name="${d.id}" aria-label="Nom du business">
      <button class="btn small opening" data-dom-opening="${d.id}" title="Solde de départ de la trésorerie">${d.openingBalance ? fmt(d.openingBalance) : "Solde de départ"}</button>
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
      <dt>Contenu</dt><dd>${i.counts.transactions} mouvements · ${i.counts.recurring} abonnements · ${i.counts.accounts} comptes de placement · ${i.counts.operations} opérations · ${i.counts.domains} business · ${i.counts.objectives} objectifs</dd>
      <dt>Version</dt><dd>Ledger ${esc(i.version)} · schéma ${i.schemaVersion}</dd>
      <dt>Dernière sauvegarde</dt><dd>${i.lastBackup ? relTime(i.lastBackup) : "jamais"}</dd>`;
    $("#backupList").innerHTML = i.backups.length ? i.backups.map((b) => {
      const label = b.kept ? "avant mise à jour" : b.name.replace(/^ledger-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-?/, "").replace(/\.db$/, "").replace(/-/g, " ") || "auto";
      return `<div class="row"><div class="grow"><div class="title">${new Date(b.at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</div><div class="sub num">${esc(b.name)} · ${fmtBytes(b.size)}</div></div>
        <span class="chip neutral">${esc(label)}</span><button class="btn small" data-restore="${esc(b.name)}">Restaurer</button></div>`;
    }).join("") : `<div class="empty">Aucune sauvegarde pour l'instant.</div>`;
  }
  const theme = store.get("theme", "system");
  $$("#themeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === theme)));
  const st = S.settings || {};
  $$("#densitySeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.density === (st.density || "comfortable"))));
  $("#setPeriod").value = st.defaultPeriod || "all";
  $("#setView").value = st.startView || "dashboard";
  $("#setCents").checked = st.showCents !== false;
  $("#setCompare").checked = st.compare !== false;
  $("#setDiscreet").checked = display.discreet;
}

onClick("density", (v) => saveSettings({ density: v }));
$("#setPeriod").addEventListener("change", (e) => saveSettings({ defaultPeriod: e.target.value }, "Période à l'ouverture enregistrée"));
$("#setView").addEventListener("change", (e) => saveSettings({ startView: e.target.value }, "Vue à l'ouverture enregistrée"));
$("#setCents").addEventListener("change", (e) => saveSettings({ showCents: e.target.checked }));
$("#setCompare").addEventListener("change", (e) => saveSettings({ compare: e.target.checked }));
$("#setDiscreet").addEventListener("change", (e) => setDiscreet(e.target.checked));
onClick("domOpening", async (id) => {
  const d = domainById(id);
  const v = await formBox(`Solde de départ · ${d.name}`, `
    <p class="muted" style="margin:0;font-size:13px">L'argent que ce business avait déjà avant les mouvements saisis dans Ledger (solde du compte bancaire à une date). Il s'ajoute à la trésorerie ; les mouvements datés d'avant sont ignorés pour ne pas compter deux fois.</p>
    <div class="fields-2"><div class="field"><label>Solde (€)</label><input class="input num" name="amount" type="number" step="0.01" value="${d.openingBalance || ""}" placeholder="0"></div>
    <div class="field"><label>À la date du</label><input class="input" name="date" type="date" value="${d.openingDate || ""}"></div></div>
    <p class="hint" style="margin:0">Sans date, le solde s'ajoute à tous les mouvements.</p>`, "Enregistrer");
  if (v) await mutate("PUT", `domains/${id}`, { openingBalance: parseFloat(v.amount) || 0, openingDate: v.date || null }, "Solde de départ enregistré");
});


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
