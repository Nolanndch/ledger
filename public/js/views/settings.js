// Vue Réglages : business, catégories, base de données, import/export
import { $, $$, api, refresh, esc, fmt, fmtExact, fmtDate, relTime, fmtBytes, store, ICON, S, ui, mutate, toast, confirmBox, formBox, domainById, catById, activeDomains, registerView, render, setScope, onClick, onChange, applyTheme, saveSettings, setDiscreet, display, PERIODS, VIEW_TITLES } from "../core.js";

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
  <div class="panel">
    <div class="panel-head"><h2>Synchronisation</h2><span class="hint">directe entre tes appareils sur le même Wi-Fi, sans serveur intermédiaire</span></div>
    <div class="panel-body" id="syncBody" style="display:grid;gap:14px;"></div>
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
  loadSync();
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

// ---------- synchronisation ----------
let syncState = null;
async function loadSync() {
  try { syncState = await (await fetch("/api/sync")).json(); } catch { return; }
  renderSync();
}
function renderSync() {
  const st = syncState, box = $("#syncBody");
  if (!st || !box) return;
  if (st.role === "host") {
    const clients = st.clients.length ? st.clients.map((c) => `${esc(c.name)} <span class="faint">· ${relTime(c.lastSync)}</span>`).join("<br>") : `<span class="faint">aucun pour l'instant</span>`;
    box.innerHTML = `
      <dl class="facts">
        <dt>Code de jumelage</dt><dd><code class="sync-code">${esc(st.code)}</code></dd>
        <dt>Adresse</dt><dd class="num" style="font-size:12.5px">${st.addresses.map(esc).join("<br>") || esc(st.hostname + ":" + st.port)}</dd>
        <dt>Appareils reliés</dt><dd>${clients}</dd>
      </dl>
      ${st.listening ? "" : `<p class="warn">${esc(st.listenError || "L'écoute sur le réseau n'a pas démarré.")}</p>`}
      <p class="hint">Sur le téléphone : Réglages → Synchronisation → Rejoindre, puis saisis ce code. L'adresse est trouvée toute seule sur le Wi-Fi. Les changements arrivent ici dans la minute.</p>
      <div class="btn-row"><button class="btn small" data-sync-code>Nouveau code</button><button class="btn small danger" data-sync-stop>Arrêter la synchronisation</button></div>`;
  } else if (st.role === "client") {
    box.innerHTML = `
      <dl class="facts">
        <dt>Relié à</dt><dd>${esc(st.hostName || "?")} <span class="faint num" style="font-size:12px">${esc(st.url.replace(/^http:\/\//, ""))}</span></dd>
        <dt>Dernière synchro</dt><dd>${st.lastSync ? relTime(st.lastSync) : "jamais"}</dd>
      </dl>
      ${st.lastError ? `<p class="warn">${esc(st.lastError)}</p>` : ""}
      <p class="hint">Synchro automatique toutes les 30 secondes quand les deux appareils sont sur le même Wi-Fi, et à chaque ouverture de l'app.</p>
      <div class="btn-row"><button class="btn small primary" data-sync-now>Synchroniser maintenant</button><button class="btn small" data-sync-replace>Reprendre toutes les données de ${esc(st.hostName || "l'hôte")}…</button><button class="btn small danger" data-sync-stop>Arrêter</button></div>`;
  } else {
    box.innerHTML = `
      <p class="muted" style="margin:0;font-size:13px">Relie ce Mac et ton téléphone : dès qu'ils sont sur le même Wi-Fi, ils s'échangent les changements directement, chiffrés avec un code de jumelage. Le Mac est l'hôte, le téléphone le rejoint.</p>
      <div class="btn-row"><button class="btn small primary" data-sync-host>Cet appareil est l'hôte (Mac)</button><button class="btn small" data-sync-join>Rejoindre un appareil (téléphone)…</button></div>`;
  }
}
async function syncCall(action, okMsg) {
  try { syncState = await api("POST", "sync/" + action); renderSync(); await refresh(); if (okMsg) toast(okMsg); return true; }
  catch (e) { toast(e.message, null, true); loadSync(); return false; }
}
onClick("syncHost", () => syncCall("host", "Synchronisation activée : saisis le code sur le téléphone"));
onClick("syncCode", async () => {
  if (await confirmBox("Changer le code ?", "Les appareils déjà reliés devront saisir le nouveau code.", "Changer")) syncCall("new-code", "Nouveau code créé");
});
onClick("syncStop", async () => {
  if (await confirmBox("Arrêter la synchronisation ?", "Les données restent sur chaque appareil. Il faudra refaire le jumelage pour synchroniser à nouveau.", "Arrêter")) syncCall("stop", "Synchronisation arrêtée");
});
onClick("syncNow", async (_, el) => {
  el.disabled = true;
  try { const r = await api("POST", "sync/now"); syncState = r; await refresh(); toast(`Synchronisé : ${r.result.sent} envoyé${r.result.sent > 1 ? "s" : ""}, ${r.result.received} reçu${r.result.received > 1 ? "s" : ""}`); }
  catch (e) { toast(e.message, null, true); loadSync(); }
  finally { el.disabled = false; }
});
onClick("syncReplace", async () => {
  if (await confirmBox(`Reprendre les données de ${syncState?.hostName || "l'hôte"} ?`, "Toutes les données de cet appareil sont remplacées par celles de l'autre (une sauvegarde est faite avant). Les changements pas encore synchronisés seront perdus.", "Remplacer")) syncCall("replace", "Données reprises");
});
onClick("syncJoin", async () => {
  const ok = await formBox("Rejoindre un appareil", `
    <p class="muted" style="margin:0;font-size:13px">Sur le Mac : Réglages → Synchronisation → « Cet appareil est l'hôte ». Les deux appareils doivent être sur le même Wi-Fi.</p>
    <div class="field"><label>Code de jumelage</label><input class="input num" name="code" placeholder="ABCD-EFGH-JKMN-PQRS-TUVW" autocapitalize="characters" autocomplete="off" spellcheck="false" required></div>
    <div class="field"><label>Adresse du Mac <span class="faint">(facultatif)</span></label><input class="input num" name="url" placeholder="trouvée automatiquement" autocomplete="off" inputmode="url"></div>
    <label class="check"><input type="checkbox" name="replace" checked><span>Remplacer les données de cet appareil par celles du Mac <span class="faint">(conseillé pour un nouveau téléphone ; sinon les deux sont fusionnées)</span></span></label>`,
  "Relier", async (v) => {
    try { syncState = await api("POST", "sync/join", { code: v.code, url: v.url, replace: v.replace }); return null; }
    catch (e) { return e.message; }
  });
  if (!ok) return;
  renderSync();
  await refresh();
  toast(`Relié à ${syncState.hostName || "l'hôte"}`);
});

registerView("settings", { title: "Réglages", render: renderSettings, usesPeriod: false, usesScope: false });
