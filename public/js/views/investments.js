// Vue Investissements : comptes (PEA, compte-titres, crypto…), positions, PEA, trading, opérations, cours.
import { $, $$, esc, fmt, fmtExact, fmtCents, fmtSignedCents, fmtQty, fmtPct, fmtDate, todayISO, relTime, S, store, api, refresh, mutate, toast, choiceBox, formBox, fillSelects, segVal, setSeg, onClick, onChange, registerView, render, saveSettings, domainById, accountResult, priceMap, ICON } from "../core.js";
import { ACCOUNT_TYPES, OP_TYPES, replay, value as valuate, tradingStats, peaStatus } from "../lib/portfolio.js";

const root = $("#view-investments");
root.innerHTML = `
  <div class="account-bar" id="accountBar"></div>
  <div id="invContent"></div>`;

let selected = store.get("invAccount", "all");
let showClosed = false;
let opFilter = { type: "all", asset: "all" };
const t0 = () => todayISO();
const CLASSES = { action: "Actions", etf: "ETF", crypto: "Crypto", obligation: "Obligations", fonds: "Fonds", autre: "Autres" };
const accById = (id) => S.accounts.find((a) => a.id === id);
const selectedAccounts = () => selected === "all" ? S.accounts.filter((a) => !a.closedOn) : S.accounts.filter((a) => a.id === selected);
const OP_DONE = { ...OP_TYPES, trade: "Trade" };
const FEM = new Set(["sell", "split", "initial"]), PLURAL = new Set(["interest", "fee"]);
const signedOp = (o) => ({ deposit: 1, withdrawal: -1, buy: -1, sell: 1, dividend: 1, interest: 1, fee: -1, tax: -1, trade: 1, initial: 1, split: 0 }[o.type] || 0) * o.amountCents;

function renderBar() {
  const prices = priceMap();
  const open = S.accounts.filter((a) => !a.closedOn), closed = S.accounts.filter((a) => a.closedOn);
  if (selected !== "all" && !accById(selected)) selected = "all";
  const chip = (id, label, sub, active) => `<button class="account-chip" data-inv-account="${id}" aria-pressed="${active}"><span>${label}</span>${sub ? `<small class="num">${sub}</small>` : ""}</button>`;
  $("#accountBar").innerHTML = [
    open.length > 1 ? chip("all", "Tous les comptes", "", selected === "all") : "",
    ...open.map((a) => chip(a.id, `${esc(a.name)} <span class="faint">${ACCOUNT_TYPES[a.type].label === a.name ? "" : ACCOUNT_TYPES[a.type].label}</span>`, fmtCents(accountResult(a, prices).v.total), selected === a.id || (open.length === 1 && selected === "all"))),
    showClosed ? closed.map((a) => chip(a.id, `${esc(a.name)} <span class="faint">clôturé</span>`, "", selected === a.id)).join("") : "",
    closed.length ? `<button class="link-btn" id="toggleClosed">${showClosed ? "Masquer" : "Voir"} les clôturés (${closed.length})</button>` : "",
    `<span class="spacer"></span>`,
    S.accounts.length ? `<button class="btn small" id="pricesBtn">Mettre à jour les cours</button><button class="btn small primary" id="addOpBtn">${ICON.plus.replace("<svg", '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4"')} Opération</button>` : "",
    `<button class="btn small" id="addAccBtn">Nouveau compte</button>`,
  ].join("");
}

function emptyState() {
  $("#invContent").innerHTML = `<div class="panel empty-hero">
    <h2>Suis tes placements</h2>
    <p class="muted">Crée un compte par enveloppe : ton PEA, ton compte-titres de trading, ton portefeuille crypto. Tu peux reprendre un compte existant avec ses positions actuelles sans ressaisir tout l'historique.</p>
    <div class="btn-row" style="justify-content:center">
      <button class="btn primary" data-new-account="pea">Ajouter un PEA</button><button class="btn" data-new-account="cto">Compte-titres / trading</button><button class="btn" data-new-account="crypto">Crypto</button>
    </div>
    <p class="faint" style="font-size:12px">Tout est en euros : pour un actif coté en dollars, saisis les montants en euros de ton relevé.</p></div>`;
}

function positionsTable(rows, groupByAsset) {
  const hideAcc = groupByAsset || selected !== "all";
  if (!rows.length) return `<div class="empty">Aucune position ouverte.</div>`;
  return `<div class="table-wrap"><table class="positions"><thead><tr>
    <th>Actif</th>${hideAcc ? "" : `<th class="hide-sm">Compte</th>`}<th class="r">Quantité</th><th class="r" title="Prix de revient unitaire : prix moyen payé par titre, frais inclus">PRU</th><th class="r">Cours</th><th class="r">Valeur</th><th class="r">Plus-value latente</th></tr></thead>
    <tbody>${rows.map((p) => {
      const asset = S.assets.find((a) => a.symbol === p.asset);
      const pct = p.cost ? p.unrealized / p.cost : null;
      return `<tr><td><b>${esc(p.asset)}</b>${asset?.name ? `<div class="meta">${esc(asset.name)}</div>` : ""}</td>
        ${hideAcc ? "" : `<td class="hide-sm muted">${esc(p.accountName)}</td>`}
        <td class="r num">${fmtQty(p.qty)}</td><td class="r num">${fmtExact(p.avg)}</td>
        <td class="r num">${p.estimated ? `<span class="faint" title="Cours non renseigné : dernier prix d'achat ou de vente">${fmtExact(p.price)}*</span>` : fmtExact(p.price)}</td>
        <td class="r amt">${fmtCents(p.marketValue)}</td>
        <td class="r amt ${p.unrealized >= 0 ? "up" : "down"}">${fmtSignedCents(p.unrealized)} <span class="faint">${fmtPct(pct)}</span></td></tr>`;
    }).join("")}</tbody></table></div>
    ${rows.some((p) => p.estimated) ? `<p class="hint" style="padding:0 18px 12px">* cours estimé : mets-le à jour avec « Mettre à jour les cours ».</p>` : ""}`;
}

function peaCard(acc, r) {
  const s = peaStatus(acc, r, t0());
  if (!s) return "";
  const pct = s.ceiling ? Math.min(100, (s.paid / s.ceiling) * 100) : 0;
  const age = s.years == null ? "date du 1er versement inconnue" : s.years >= 1 ? `${Math.floor(s.years)} an${Math.floor(s.years) > 1 ? "s" : ""} et ${Math.floor((s.years % 1) * 12)} mois` : `${Math.floor(s.years * 12)} mois`;
  return `<div class="panel pea-card"><div class="panel-head"><h2>${esc(acc.name)}</h2>${s.mature ? '<span class="chip paid">Exonéré d\'impôt sur le revenu</span>' : s.milestone ? `<span class="chip pending">5 ans le ${fmtDate(s.milestone)}</span>` : ""}</div>
    <div class="panel-body" style="display:grid;gap:12px">
      <dl class="facts"><dt>Ancienneté fiscale</dt><dd>${age}${s.fiscal ? ` · depuis le ${fmtDate(s.fiscal)}` : ""}</dd>
      <dt>Versé</dt><dd class="num">${fmtCents(s.paid)} sur ${fmtCents(s.ceiling)} de plafond</dd><dt>Reste à verser</dt><dd class="num">${fmtCents(Math.max(0, s.room))}</dd></dl>
      <div class="progress"><div class="p-paid" style="width:${pct}%"></div></div>
      <p class="hint" style="margin:0">${s.mature ? "Retraits partiels possibles sans clôturer le plan. Les prélèvements sociaux restent dus sur les gains. Un retrait ne libère pas de plafond." : "Avant 5 ans, un retrait, même partiel, clôture en principe le PEA (sauf licenciement, invalidité, retraite anticipée ou création d'entreprise)."}</p>
    </div></div>`;
}

function tradingCard(trades) {
  const s = tradingStats(trades);
  if (!s.count) return "";
  const byMonth = new Map();
  for (const t of trades) byMonth.set(t.closedOn.slice(0, 7), (byMonth.get(t.closedOn.slice(0, 7)) || 0) + t.pnl);
  const months = [...byMonth.entries()].sort().slice(-12);
  const max = Math.max(1, ...months.map(([, v]) => Math.abs(v)));
  const journal = [...trades].sort((a, b) => b.closedOn.localeCompare(a.closedOn)).slice(0, 30);
  const days = (t) => Math.max(0, Math.round((Date.parse(t.closedOn) - Date.parse(t.openedOn)) / 864e5));
  return `<div class="panel"><div class="panel-head"><h2>Trading</h2><span class="hint">${s.count} trade${s.count > 1 ? "s" : ""} clôturé${s.count > 1 ? "s" : ""}, depuis le début</span></div>
    <div class="stat-grid">
      <div><div class="kpi-label">Résultat</div><div class="kpi-value ${s.pnl >= 0 ? "up" : "down"}">${fmtSignedCents(s.pnl)}</div></div>
      <div><div class="kpi-label" title="Part des trades gagnants (hors trades à l'équilibre)">Trades gagnants</div><div class="kpi-value">${s.winRate == null ? "—" : Math.round(s.winRate * 100) + " %"}</div><div class="kpi-sub">${s.wins} gagnant${s.wins > 1 ? "s" : ""} · ${s.losses} perdant${s.losses > 1 ? "s" : ""}</div></div>
      <div><div class="kpi-label" title="Total des gains divisé par le total des pertes">Gains ÷ pertes</div><div class="kpi-value">${s.profitFactor == null ? "—" : s.profitFactor.toFixed(2).replace(".", ",")}</div><div class="kpi-sub">moyenne ${s.avgWin != null ? fmtSignedCents(s.avgWin) : "—"} / ${s.avgLoss != null ? fmtSignedCents(s.avgLoss) : "—"}</div></div>
      <div><div class="kpi-label" title="Plus forte baisse du résultat cumulé depuis un sommet">Pire baisse</div><div class="kpi-value down">${s.maxDrawdown ? fmtSignedCents(s.maxDrawdown) : "—"}</div><div class="kpi-sub">durée moyenne ${s.avgDays == null ? "—" : Math.round(s.avgDays) + " j"}</div></div>
    </div>
    ${months.length > 1 ? `<div class="mini-bars">${months.map(([k, v]) => `<div title="${k} : ${fmtSignedCents(v)}"><span style="height:${Math.max(3, (Math.abs(v) / max) * 54)}px;background:${v >= 0 ? "var(--up)" : "var(--down)"}"></span><small>${k.slice(5)}</small></div>`).join("")}</div>` : ""}
    <div class="table-wrap"><table><thead><tr><th>Clôturé le</th><th>Actif</th><th class="hide-sm">Sens</th><th class="hide-sm r">Durée</th><th class="r">Résultat</th></tr></thead><tbody>
      ${journal.map((t) => `<tr><td class="date">${fmtDate(t.closedOn)}</td><td><b>${esc(t.asset || "—")}</b>${t.kind === "trade" ? ' <span class="badge">trade</span>' : ""}</td><td class="hide-sm">${t.side === "short" ? "Vente (short)" : "Achat (long)"}</td><td class="hide-sm r num">${days(t)} j</td><td class="r amt ${t.pnl >= 0 ? "up" : "down"}">${fmtSignedCents(t.pnl)}</td></tr>`).join("")}
    </tbody></table></div></div>`;
}

function opsPanel(accounts) {
  const ids = new Set(accounts.map((a) => a.id));
  let ops = S.operations.filter((o) => ids.has(o.accountId));
  const assets = [...new Set(ops.map((o) => o.asset).filter(Boolean))].sort();
  ops = ops.filter((o) => (opFilter.type === "all" || o.type === opFilter.type) && (opFilter.asset === "all" || o.asset === opFilter.asset))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const shown = ops.slice(0, 200);
  const linked = new Set(S.transactions.filter((t) => t.invOpId).map((t) => t.invOpId));
  const detail = (o) => {
    if (o.type === "buy" || o.type === "sell") return `${fmtQty(o.qty)} × ${fmtExact(o.price || (o.qty ? o.amountCents / 100 / o.qty : 0))}${o.feesCents ? ` · frais ${fmtCents(o.feesCents)}` : ""}`;
    if (o.type === "split") return `division ×${String(o.ratio).replace(".", ",")}`;
    if (o.type === "dividend" && o.feesCents) return `retenues ${fmtCents(o.feesCents)}`;
    if (o.type === "trade") return `${o.side === "short" ? "short" : "long"}${o.qty ? ` · ${fmtQty(o.qty)}` : ""}`;
    if (o.type === "initial") return o.asset ? `${fmtQty(o.qty)} repris` : "liquidités reprises";
    if ((o.type === "deposit" || o.type === "withdrawal") && linked.has(o.id)) return "relié à la trésorerie";
    return "";
  };
  return `<div class="panel"><div class="panel-head"><h2>Opérations</h2><span class="spacer"></span>
      <select class="select small" id="opFilterType"><option value="all">Toutes</option>${Object.entries(OP_TYPES).map(([k, v]) => `<option value="${k}"${opFilter.type === k ? " selected" : ""}>${v}</option>`).join("")}</select>
      <select class="select small" id="opFilterAsset"><option value="all">Tous les actifs</option>${assets.map((a) => `<option${opFilter.asset === a ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></div>
    <div class="rows">${shown.map((o) => {
      const v = signedOp(o);
      return `<div class="row clickable" data-op-edit="${o.id}"><span class="date-pill">${fmtDate(o.date).slice(0, 6)}<small>${o.date.slice(0, 4)}</small></span>
        <div class="grow"><div class="title">${OP_TYPES[o.type]}${o.asset ? ` · <b>${esc(o.asset)}</b>` : ""}${selected === "all" ? ` <span class="faint">${esc(accById(o.accountId)?.name || "")}</span>` : ""}</div><div class="sub">${detail(o)}${o.notes ? ` · ${esc(o.notes)}` : ""}</div></div>
        <span class="amt ${v > 0 ? "up" : v < 0 ? "down" : "faint"}">${o.type === "split" ? "" : (v > 0 ? "+" : v < 0 ? "−" : "") + fmtCents(Math.abs(o.amountCents))}</span>
        <button class="icon-btn del" data-op-del="${o.id}" aria-label="Supprimer">${ICON.del}</button></div>`;
    }).join("") || `<div class="empty">Aucune opération${opFilter.type !== "all" || opFilter.asset !== "all" ? " avec ces filtres" : ""}.</div>`}</div>
    ${ops.length > shown.length ? `<p class="hint" style="padding:8px 18px">200 opérations les plus récentes affichées sur ${ops.length}.</p>` : ""}</div>`;
}

function renderInvestments() {
  renderBar();
  if (!S.accounts.length) return emptyState();
  const accounts = selectedAccounts();
  const prices = priceMap();
  const results = accounts.map((a) => accountResult(a, prices));
  const sum = (f) => results.reduce((x, r) => x + f(r), 0);
  const total = sum((r) => r.v.total), contrib = sum((r) => r.r.contributions), gain = sum((r) => r.v.gain), cash = sum((r) => r.v.cash);
  const realized = sum((r) => r.r.realized), unreal = sum((r) => r.v.unrealized), income = sum((r) => r.r.income), fees = sum((r) => r.r.fees + r.r.taxes);
  const group = S.settings?.investGroup || "account";
  // Positions : par compte ou regroupées par actif (PRU combiné)
  let rows = results.flatMap((r) => r.v.positions.map((p) => ({ ...p, accountName: r.account.name })));
  if (group === "asset") {
    const m = new Map();
    for (const p of rows) {
      const g = m.get(p.asset) || { ...p, qty: 0, cost: 0, marketValue: 0, accountName: "" };
      g.qty += p.qty; g.cost += p.cost; g.marketValue += p.marketValue; g.estimated = g.estimated || p.estimated;
      m.set(p.asset, g);
    }
    rows = [...m.values()].map((g) => ({ ...g, avg: g.cost / 100 / g.qty, unrealized: g.marketValue - g.cost }));
  }
  rows.sort((a, b) => b.marketValue - a.marketValue);
  const closedPos = results.flatMap((r) => r.r.positions.filter((p) => p.qty <= 1e-9 && p.realized).map((p) => ({ ...p, accountName: r.account.name })));
  const trades = results.flatMap((r) => r.r.trades);
  const warnings = results.flatMap((r) => r.r.warnings.map((w) => `${r.account.name} : ${w}`));
  // Répartition
  const byClass = new Map();
  for (const p of rows) { const c = S.assets.find((a) => a.symbol === p.asset)?.class || "autre"; byClass.set(c, (byClass.get(c) || 0) + p.marketValue); }
  if (cash > 0) byClass.set("cash", cash);
  const alloc = [...byClass.entries()].sort((a, b) => b[1] - a[1]);
  const allocTotal = alloc.reduce((a, [, v]) => a + v, 0) || 1;
  const perf = contrib > 0 ? gain / contrib : null;

  $("#invContent").innerHTML = `
    ${warnings.length ? `<div class="banner">${warnings.map(esc).join("<br>")}</div>` : ""}
    <div class="summary-strip four">
      <div><div class="kpi-label">Valeur</div><div class="kpi-value">${fmtCents(total)}</div><div class="kpi-sub">dont ${fmtCents(cash)} de liquidités</div></div>
      <div><div class="kpi-label" title="Versements moins retraits, versements antérieurs inclus">Versé net</div><div class="kpi-value">${fmtCents(contrib)}</div><div class="kpi-sub">depuis l'ouverture</div></div>
      <div><div class="kpi-label">Plus-value totale</div><div class="kpi-value ${gain >= 0 ? "up" : "down"}">${fmtSignedCents(gain)}</div><div class="kpi-sub">${perf != null ? `${fmtPct(perf)} sur le versé` : "—"}</div></div>
      <div><div class="kpi-label">Détail</div><div class="kpi-sub stack"><span>Réalisé <b class="num ${realized >= 0 ? "up" : "down"}">${fmtSignedCents(realized)}</b></span><span>Latent <b class="num ${unreal >= 0 ? "up" : "down"}">${fmtSignedCents(unreal)}</b></span><span>Dividendes et intérêts <b class="num">${fmtCents(income)}</b></span><span>Frais et impôts <b class="num">${fmtCents(fees)}</b></span></div></div>
    </div>
    <div class="panel"><div class="panel-head"><h2>Positions</h2><span class="spacer"></span>
      <div class="seg small" id="invGroup"><button data-v="account">Par compte</button><button data-v="asset">Par actif</button></div>
      ${closedPos.length ? `<label class="check small"><input type="checkbox" id="showClosedPos"${S.settings?.hideClosedPositions === false ? " checked" : ""}>Positions soldées</label>` : ""}</div>
      ${positionsTable(rows, group === "asset")}
      ${closedPos.length && S.settings?.hideClosedPositions === false ? `<div class="rows closed-pos">${closedPos.map((p) => `<div class="row"><div class="grow"><div class="title">${esc(p.asset)} <span class="faint">soldée</span></div><div class="sub">${esc(p.accountName)}</div></div><span class="amt ${p.realized >= 0 ? "up" : "down"}">${fmtSignedCents(p.realized)}</span></div>`).join("")}</div>` : ""}
    </div>
    <div class="grid-2 even">${results.map((r) => peaCard(r.account, r.r)).join("")}</div>
    ${tradingCard(trades)}
    <div class="grid-2">
      ${opsPanel(accounts)}
      <div style="display:grid;gap:20px;align-content:start">
        <div class="panel"><div class="panel-head"><h2>Répartition</h2></div><div class="panel-body">
          ${alloc.map(([k, v]) => `<div class="bar-row"><div class="name"><span>${k === "cash" ? "Liquidités" : CLASSES[k] || "Autres"}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(v / allocTotal) * 100}%;background:var(--accent)"></div></div><div class="val">${Math.round((v / allocTotal) * 100)} %</div></div>`).join("") || `<div class="empty">—</div>`}
        </div></div>
        ${results.length === 1 ? accountFacts(results[0]) : `<div class="panel"><div class="panel-head"><h2>Par compte</h2></div><div class="rows">${results.map((r) => `<button class="row clickable" data-inv-account="${r.account.id}"><div class="grow"><div class="title">${esc(r.account.name)}</div><div class="sub">versé ${fmtCents(r.r.contributions)}</div></div><span class="amt">${fmtCents(r.v.total)}</span><span class="num ${r.v.gain >= 0 ? "up" : "down"}" style="font-size:12px">${fmtSignedCents(r.v.gain)}</span></button>`).join("")}</div></div>`}
      </div>
    </div>`;
  setSeg("invGroup", group);
}

function accountFacts({ account: a }) {
  const d = domainById(a.domainId);
  return `<div class="panel"><div class="panel-head"><h2>Compte</h2><span class="spacer"></span><button class="btn small" data-acc-edit="${a.id}">Modifier</button></div>
    <div class="panel-body" style="display:grid;gap:14px"><dl class="facts">
      <dt>Type</dt><dd>${ACCOUNT_TYPES[a.type].label}</dd>${a.broker ? `<dt>Courtier</dt><dd>${esc(a.broker)}</dd>` : ""}
      <dt>Virements</dt><dd>${d ? esc(d.name) : "Perso"}</dd>${a.closedOn ? `<dt>Clôturé le</dt><dd>${fmtDate(a.closedOn)}</dd>` : ""}</dl>
      <div class="btn-row">${a.closedOn ? `<button class="btn small" data-acc-reopen="${a.id}">Rouvrir</button>` : `<button class="btn small" data-acc-close="${a.id}">Clôturer</button>`}<button class="btn small danger" data-acc-del="${a.id}">Supprimer</button></div></div></div>`;
}

root.addEventListener("click", (e) => {
  if (e.target.id === "toggleClosed") { showClosed = !showClosed; renderInvestments(); }
  if (e.target.id === "addAccBtn") openAccount();
  if (e.target.id === "addOpBtn") openOperation(null, { accountId: selected !== "all" ? selected : undefined });
  if (e.target.id === "pricesBtn") openPrices();
  const g = e.target.closest("#invGroup button");
  if (g) saveSettings({ investGroup: g.dataset.v });
});
root.addEventListener("change", (e) => {
  if (e.target.id === "opFilterType") { opFilter.type = e.target.value; renderInvestments(); }
  if (e.target.id === "opFilterAsset") { opFilter.asset = e.target.value; renderInvestments(); }
  if (e.target.id === "showClosedPos") saveSettings({ hideClosedPositions: !e.target.checked });
});
onClick("invAccount", (id) => { selected = id; store.set("invAccount", id); opFilter = { type: "all", asset: "all" }; renderInvestments(); });
onClick("newAccount", (type) => openAccount(null, type));

// ---------- dialogue compte ----------
const accDialog = document.createElement("dialog");
accDialog.className = "wide";
accDialog.innerHTML = `<form id="accForm" novalidate>
  <h3 id="accTitle">Nouveau compte</h3>
  <div class="seg wrap pick" id="accType">${Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<button type="button" data-v="${k}">${v.label}</button>`).join("")}</div>
  <div class="fields-2">
    <div class="field"><label for="accBroker">Courtier</label><input class="input" id="accBroker" placeholder="Ex. Boursorama, Trade Republic, Binance" autocomplete="off"></div>
    <div class="field"><label for="accName">Nom</label><input class="input" id="accName" autocomplete="off"></div>
  </div>
  <div class="fields-2" id="accPeaFields">
    <div class="field"><label for="accFiscal">Date du 1er versement (date fiscale)</label><input class="input" id="accFiscal" type="date"></div>
    <div class="field"><label for="accCeiling">Plafond des versements</label><select class="select" id="accCeiling"><option value="15000000">150 000 € (PEA)</option><option value="2000000">20 000 € (PEA jeune, rattaché au foyer)</option><option value="22500000">225 000 € (PEA-PME)</option></select></div>
  </div>
  <div class="field"><label for="accDomain">Virements depuis et vers</label><select class="select" id="accDomain" data-fill="domains-perso"></select><span class="hint" id="accDomainHint"></span></div>
  <details class="more" id="accStart"><summary>Reprendre un compte existant</summary>
    <p class="hint">Saisis la situation d'aujourd'hui au lieu de tout l'historique. Ces montants ne touchent pas ta trésorerie.</p>
    <div class="fields-2">
      <div class="field"><label for="accInitContrib">Total déjà versé sur le compte (€)</label><input class="input num" id="accInitContrib" type="number" step="0.01" min="0" placeholder="0"></div>
      <div class="field"><label for="accInitCash">Liquidités actuelles (€)</label><input class="input num" id="accInitCash" type="number" step="0.01" min="0" placeholder="0"></div>
    </div>
    <div class="field" id="accPosField"><span class="label">Positions actuelles</span><div id="accPositions"></div><button type="button" class="link-btn" id="accAddPos">+ Ajouter une position</button></div>
  </details>
  <div class="form-error" id="accError" hidden></div>
  <div class="dialog-actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div>
</form>`;
document.body.appendChild(accDialog);
let editingAcc = null, autoName = true;
const accErr = (m) => { $("#accError").textContent = m; $("#accError").hidden = !m; };
function syncAcc() {
  const type = segVal("accType");
  const pea = type === "pea" || type === "pea_pme";
  $("#accPeaFields").hidden = !pea;
  if (type === "pea_pme") $("#accCeiling").value = "22500000";
  else if (type === "pea" && $("#accCeiling").value === "22500000") $("#accCeiling").value = "15000000";
  if (autoName) $("#accName").value = [ACCOUNT_TYPES[type].label, $("#accBroker").value.trim()].filter(Boolean).join(" ");
  $("#accDomainHint").textContent = pea ? "Un PEA appartient à une personne : un versement depuis un business est un prélèvement perso." : "";
}
const posRow = (p = {}) => `<div class="schedule-row"><input class="input" placeholder="Actif (ex. CW8)" list="assetList" data-pos="asset" value="${esc(p.asset || "")}"><input class="input num" type="number" step="any" min="0" placeholder="Quantité" data-pos="qty"><input class="input num" type="number" step="any" min="0" placeholder="PRU (€)" data-pos="pru"><button type="button" class="icon-btn del" data-pos-del aria-label="Retirer">${ICON.del}</button></div>`;
accDialog.addEventListener("click", (e) => {
  if (e.target.closest("#accType button")) setTimeout(syncAcc);
  if (e.target.id === "accAddPos") $("#accPositions").insertAdjacentHTML("beforeend", posRow());
  if (e.target.closest("[data-pos-del]")) e.target.closest(".schedule-row").remove();
});
$("#accBroker").addEventListener("input", syncAcc);
$("#accName").addEventListener("input", () => { autoName = !$("#accName").value; });

export function openAccount(a, type = "pea") {
  editingAcc = a || null;
  fillSelects(accDialog);
  $("#accTitle").textContent = a ? "Modifier le compte" : "Nouveau compte";
  setSeg("accType", a?.type || type);
  $("#accBroker").value = a?.broker || "";
  $("#accName").value = a?.name || "";
  autoName = !a;
  $("#accFiscal").value = a?.fiscalDate || "";
  $("#accCeiling").value = String(a?.ceilingCents || ((a?.type || type) === "pea_pme" ? 22500000 : 15000000));
  $("#accDomain").value = a?.domainId || "";
  $("#accInitContrib").value = a ? (a.initialContributionsCents / 100 || "") : "";
  $("#accInitCash").value = "";
  $("#accPositions").innerHTML = "";
  $("#accInitCash").closest(".field").hidden = !!a;
  $("#accPosField").hidden = !!a;
  $("#accStart").open = !!(a && a.initialContributionsCents);
  accErr("");
  syncAcc();
  accDialog.showModal();
}
$("#accForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = segVal("accType");
  const pea = type === "pea" || type === "pea_pme";
  const body = {
    type, broker: $("#accBroker").value.trim(), name: $("#accName").value.trim(), domainId: $("#accDomain").value || null,
    fiscalDate: pea ? $("#accFiscal").value || null : null, ceilingCents: pea ? Number($("#accCeiling").value) : null,
    initialContributionsCents: Math.round((parseFloat($("#accInitContrib").value) || 0) * 100),
  };
  const positions = $$("#accPositions .schedule-row").map((row) => ({ asset: $("[data-pos=asset]", row).value.trim().toUpperCase(), qty: parseFloat($("[data-pos=qty]", row).value), pru: parseFloat($("[data-pos=pru]", row).value) })).filter((p) => p.asset);
  if (positions.some((p) => !(p.qty > 0) || !(p.pru >= 0))) return accErr("Chaque position reprise doit avoir une quantité et un PRU.");
  try {
    const acc = await api(editingAcc ? "PUT" : "POST", editingAcc ? `accounts/${editingAcc.id}` : "accounts", body);
    if (!editingAcc) {
      const date = t0();
      const cash = Math.round((parseFloat($("#accInitCash").value) || 0) * 100);
      if (cash > 0) await api("POST", "operations", { accountId: acc.id, date, type: "initial", amountCents: cash, notes: "Reprise du compte" });
      for (const p of positions) await api("POST", "operations", { accountId: acc.id, date, type: "initial", asset: p.asset, qty: p.qty, price: p.pru, amountCents: Math.round(p.qty * p.pru * 100), notes: "Reprise du compte" });
      if (!body.initialContributionsCents && (cash || positions.length)) await api("PUT", `accounts/${acc.id}`, { initialContributionsCents: cash + positions.reduce((a, p) => a + Math.round(p.qty * p.pru * 100), 0) });
      selected = acc.id; store.set("invAccount", acc.id);
    }
    accDialog.close(); await refresh();
    toast(editingAcc ? "Compte modifié" : `Compte « ${acc.name} » créé`);
  } catch (err) { accErr(err.message); }
});
onClick("accEdit", (id) => openAccount(accById(id)));
async function closeAcc(id) {
  const a = accById(id);
  const r = accountResult(a);
  if (r.v.positions.length) return toast(`Il reste des titres sur ce compte (${r.v.positions.map((p) => p.asset).join(", ")}). Enregistre d'abord leur vente.`, null, true);
  const v = await formBox(`Clôturer « ${a.name} » ?`, `
    <p class="muted" style="margin:0;font-size:13px">${r.v.cash > 0 ? `Les ${fmtCents(r.v.cash)} de liquidités seront retirés du compte.` : "Le compte n'a plus de liquidités."} Il restera consultable dans les comptes clôturés.</p>
    <div class="field"><label>Date de clôture</label><input class="input" type="date" name="date" value="${t0()}"></div>
    ${r.v.cash > 0 ? `<label class="check"><input type="checkbox" name="link" checked><span>Reverser sur la trésorerie de</span><select class="select" name="domainId" data-fill="domains-perso"></select></label>` : ""}`, "Clôturer");
  if (v) await mutate("POST", `accounts/${id}/close`, { date: v.date, link: !!v.link, domainId: v.domainId || null }, "Compte clôturé");
}
onClick("accClose", closeAcc);
onClick("accReopen", (id) => mutate("POST", `accounts/${id}/reopen`, null, "Compte rouvert"));
onClick("accDel", async (id) => {
  const a = accById(id);
  const n = S.operations.filter((o) => o.accountId === id).length;
  const tr = S.transactions.filter((t) => t.invOpId && S.operations.some((o) => o.id === t.invOpId && o.accountId === id)).length;
  const c = await choiceBox(`Supprimer « ${a.name} » ?`, n ? `Ses ${n} opérations${tr ? ` et les ${tr} virements reliés dans le grand livre` : ""} seront supprimés. Pour garder l'historique, clôture-le plutôt.` : "Ce compte n'a aucune opération.",
    [...(n ? [{ value: "close", label: "Clôturer plutôt", primary: true }] : []), { value: "delete", label: "Supprimer", danger: true }]);
  if (c === "close") return closeAcc(id);
  if (c === "delete") { selected = "all"; await mutate("DELETE", `accounts/${id}?purge=1`, null, "Compte supprimé"); }
});

// ---------- dialogue opération ----------
const opDialog = document.createElement("dialog");
opDialog.className = "wide";
opDialog.innerHTML = `<form id="opForm" novalidate>
  <div class="dialog-head"><h3 id="opTitle">Nouvelle opération</h3></div>
  <div class="op-types"><div class="seg" id="opType"><button type="button" data-v="buy">Achat</button><button type="button" data-v="sell">Vente</button><button type="button" data-v="deposit">Versement</button><button type="button" data-v="withdrawal">Retrait</button></div>
    <select class="select" id="opOther" aria-label="Autre opération"><option value="">Autre…</option><option value="dividend">Dividende</option><option value="interest">Intérêts</option><option value="fee">Frais</option><option value="tax">Impôt / prélèvement</option><option value="trade">Trade clôturé (CFD, futures…)</option><option value="split">Division d'actions</option><option value="initial">Reprise (position existante)</option></select></div>
  <div class="fields-2">
    <div class="field"><label for="opAccount">Compte</label><select class="select" id="opAccount" data-fill="accounts"></select></div>
    <div class="field"><label for="opDate">Date</label><input class="input" id="opDate" type="date"></div>
  </div>
  <div class="fields-2" data-show="buy sell dividend trade split initial">
    <div class="field"><label for="opAsset">Actif <span class="faint" data-show="dividend initial">(optionnel)</span></label><input class="input" id="opAsset" list="assetList" placeholder="Ex. CW8, AAPL, BTC" autocomplete="off"></div>
    <div class="field" data-show="trade"><span class="label">Sens</span><div class="type-switch" id="opSide"><button type="button" data-v="long">Achat (long)</button><button type="button" data-v="short">Vente (short)</button></div></div>
    <div class="field" data-show="split"><label for="opRatio">Rapport (10 pour une division 10:1)</label><input class="input num" id="opRatio" type="number" step="any" min="0"></div>
  </div>
  <div class="fields-3" data-show="buy sell trade initial">
    <div class="field"><label for="opQty">Quantité</label><input class="input num" id="opQty" type="number" step="any" min="0"></div>
    <div class="field"><label for="opPrice" id="opPriceLabel">Prix unitaire (€)</label><input class="input num" id="opPrice" type="number" step="any" min="0"></div>
    <div class="field" data-show="buy sell trade"><label for="opFees">Frais (€)</label><input class="input num" id="opFees" type="number" step="0.01" min="0"></div>
    <div class="field" data-show="trade"><label for="opExit">Prix de sortie (€)</label><input class="input num" id="opExit" type="number" step="any" min="0"></div>
  </div>
  <div class="fields-2" data-show="dividend">
    <div class="field"><label for="opGross">Montant brut (€)</label><input class="input num" id="opGross" type="number" step="0.01" min="0"></div>
    <div class="field"><label for="opWithholding">Retenues et prélèvements (€)</label><input class="input num" id="opWithholding" type="number" step="0.01" min="0"></div>
  </div>
  <div class="field" data-show="buy sell deposit withdrawal interest fee tax trade initial"><label for="opAmount" id="opAmountLabel">Montant (€)</label>
    <div class="amount-row"><input class="input num amount-input" id="opAmount" type="number" step="0.01" inputmode="decimal"><button type="button" class="link-btn" id="opReset" hidden>recalculer</button></div></div>
  <div class="sub-box" data-show="deposit withdrawal">
    <label class="check"><span class="toggle"><input type="checkbox" id="opLink" checked><span></span></span><span id="opLinkLabel">Prélevé sur la trésorerie de</span></label>
    <select class="select" id="opDomain" data-fill="domains-perso"></select>
  </div>
  <p class="warn" id="opWarn" hidden></p>
  <div class="field"><label for="opNotes">Note</label><input class="input" id="opNotes" autocomplete="off"></div>
  <div class="op-footer" id="opFooter"></div>
  <div class="form-error" id="opError" hidden></div>
  <div class="dialog-actions"><button type="button" class="btn danger left" id="opDelete" hidden>Supprimer</button><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div>
</form>`;
document.body.appendChild(opDialog);

let editingOp = null, amountEdited = false, opType = "buy";
const n = (id) => parseFloat($(id).value) || 0;
const opErr = (m) => { $("#opError").textContent = m; $("#opError").hidden = !m; };
function setOpType(type) {
  opType = type;
  setSeg("opType", ["buy", "sell", "deposit", "withdrawal"].includes(type) ? type : "");
  $("#opOther").value = ["buy", "sell", "deposit", "withdrawal"].includes(type) ? "" : type;
  for (const el of $$("[data-show]", opDialog)) el.hidden = !el.dataset.show.split(" ").includes(type);
  $("#opPriceLabel").textContent = type === "trade" ? "Prix d'entrée (€)" : type === "initial" ? "PRU (€)" : "Prix unitaire (€)";
  $("#opAmountLabel").textContent = { buy: "Montant payé, frais inclus (€)", sell: "Montant reçu, frais déduits (€)", trade: "Résultat, frais déduits (€) · négatif si perte", initial: "Valeur au PRU ou liquidités reprises (€)" }[type] || "Montant (€)";
  $("#opLinkLabel").textContent = type === "deposit" ? "Prélevé sur la trésorerie de" : "Reversé sur la trésorerie de";
  amountEdited = !!editingOp;
  recalc();
}
function defaultAmount() {
  const q = n("#opQty"), p = n("#opPrice"), f = Math.round(n("#opFees") * 100);
  if (opType === "buy") return q && p ? Math.round(q * p * 100) + f : null;
  if (opType === "sell") return q && p ? Math.round(q * p * 100) - f : null;
  if (opType === "initial") return q && p ? Math.round(q * p * 100) : null;
  if (opType === "trade") { const exit = n("#opExit"); return q && p && exit ? Math.round((segVal("opSide") === "short" ? -1 : 1) * (exit - p) * q * 100) - f : null; }
  return null;
}
function draftOp() {
  const type = opType;
  let amount = Math.round(n("#opAmount") * 100), fees = Math.round(n("#opFees") * 100);
  if (type === "dividend") { amount = Math.round((n("#opGross") - n("#opWithholding")) * 100); fees = Math.round(n("#opWithholding") * 100); }
  return {
    accountId: $("#opAccount").value, date: $("#opDate").value, type, asset: $("#opAsset").value.trim().toUpperCase(),
    qty: n("#opQty"), price: n("#opPrice"), feesCents: ["buy", "sell", "trade", "dividend"].includes(type) ? fees : 0, amountCents: amount,
    side: segVal("opSide"), ratio: n("#opRatio"), notes: $("#opNotes").value.trim(),
  };
}
function recalc() {
  if (!amountEdited) { const d = defaultAmount(); if (d != null) $("#opAmount").value = (d / 100).toFixed(2); }
  $("#opReset").hidden = !amountEdited || defaultAmount() == null;
  const acc = accById($("#opAccount").value);
  if (!acc) { $("#opFooter").textContent = ""; return; }
  const draft = { ...draftOp(), id: editingOp?.id || "draft", createdAt: "~" };
  const others = S.operations.filter((o) => o.accountId === acc.id && o.id !== editingOp?.id);
  const before = replay(acc, others, { strict: false });
  const after = replay(acc, [...others, draft], { strict: false });
  const bits = [`Liquidités après : <b class="num ${after.cash < 0 ? "down" : ""}">${fmtCents(after.cash)}</b>`];
  if (opType === "sell" && draft.asset) {
    const p = after.positions.find((x) => x.asset === draft.asset);
    const ev = after.events.find((e) => e.opId === draft.id);
    if (ev) bits.push(`Plus-value réalisée : <b class="num ${ev.pnl >= 0 ? "up" : "down"}">${fmtSignedCents(ev.pnl)}</b>`, `il te restera ${fmtQty(p?.qty || 0)} ${esc(draft.asset)}`);
  }
  $("#opFooter").innerHTML = bits.join(" · ");
  // Avertissements PEA
  const pea = peaStatus(acc, after, t0());
  let warn = "";
  if (after.warnings.length > before.warnings.length) warn = after.warnings.at(-1);
  else if (pea && opType === "withdrawal" && !pea.mature) warn = "Avant 5 ans, un retrait, même partiel, clôture en principe le PEA, sauf licenciement, invalidité, mise à la retraite anticipée (toi, ton conjoint ou partenaire de Pacs) ou création/reprise d'entreprise. Ensuite, plus aucun versement n'est possible.";
  else if (pea && opType === "deposit" && pea.room < 0) warn = `Ce versement dépasse le plafond de ${fmtCents(pea.ceiling)} (${fmtCents(-pea.room)} de trop).`;
  $("#opWarn").textContent = warn;
  $("#opWarn").hidden = !warn;
}
opDialog.addEventListener("input", (e) => { if (e.target.id === "opAmount") amountEdited = true; recalc(); });
opDialog.addEventListener("change", (e) => {
  if (e.target.id === "opOther" && e.target.value) setOpType(e.target.value);
  if (e.target.id === "opAccount") { const a = accById(e.target.value); if (a && !editingOp) $("#opDomain").value = a.domainId || ""; recalc(); }
  if (e.target.id === "opAsset" && !editingOp && !$("#opPrice").value) { const a = S.assets.find((x) => x.symbol === e.target.value.trim().toUpperCase()); if (a?.price) { $("#opPrice").value = a.price; recalc(); } }
});
opDialog.addEventListener("click", (e) => {
  const b = e.target.closest("#opType button");
  if (b) setOpType(b.dataset.v);
  if (e.target.closest("#opSide button")) setTimeout(recalc);
  if (e.target.id === "opReset") { amountEdited = false; recalc(); }
});

export function openOperation(op, prefill = {}) {
  if (!S.accounts.some((a) => !a.closedOn) && !op) return openAccount();
  editingOp = op || null;
  fillSelects(opDialog);
  const src = op || { type: "buy", date: t0(), accountId: prefill.accountId || store.get("lastAccount", null) || S.accounts.find((a) => !a.closedOn)?.id, asset: "", qty: "", price: "", feesCents: 0, amountCents: "", side: "long", ratio: "", notes: "", ...prefill };
  $("#opTitle").textContent = op ? "Modifier l'opération" : "Nouvelle opération";
  if (op && accById(op.accountId)?.closedOn) $("#opAccount").insertAdjacentHTML("beforeend", `<option value="${op.accountId}">${esc(accById(op.accountId).name)}</option>`);
  $("#opAccount").value = src.accountId && accById(src.accountId) ? src.accountId : $("#opAccount").options[0]?.value;
  $("#opDate").value = src.date;
  $("#opAsset").value = src.asset || "";
  $("#opQty").value = src.qty || "";
  $("#opPrice").value = src.price || "";
  $("#opFees").value = src.feesCents ? (src.feesCents / 100).toFixed(2) : "";
  $("#opExit").value = "";
  $("#opRatio").value = src.ratio || "";
  $("#opNotes").value = src.notes || "";
  $("#opAmount").value = src.amountCents !== "" ? (src.amountCents / 100).toFixed(2) : "";
  $("#opGross").value = src.type === "dividend" ? ((src.amountCents + src.feesCents) / 100).toFixed(2) : "";
  $("#opWithholding").value = src.type === "dividend" && src.feesCents ? (src.feesCents / 100).toFixed(2) : "";
  setSeg("opSide", src.side || "long");
  const linked = op && S.transactions.find((t) => t.invOpId === op.id);
  $("#opLink").checked = op ? !!linked : true;
  $("#opDomain").value = linked ? linked.domainId || "" : accById($("#opAccount").value)?.domainId || "";
  $("#opDelete").hidden = !op;
  opErr("");
  setOpType(src.type);
  opDialog.showModal();
}
export function openOperationForTransfer(t) {
  const op = S.operations.find((o) => o.id === t.invOpId);
  if (op) openOperation(op);
  else toast("Ce virement n'est relié à aucune opération.", null, true);
}

$("#opForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = draftOp();
  if (!body.accountId) return opErr("Choisis un compte.");
  if (["deposit", "withdrawal"].includes(body.type)) { body.link = $("#opLink").checked; body.domainId = $("#opDomain").value || null; }
  if (body.type === "dividend" && !(body.amountCents > 0)) return opErr("Indique le montant brut du dividende.");
  try {
    await api(editingOp ? "PUT" : "POST", editingOp ? `operations/${editingOp.id}` : "operations", body);
    store.set("lastAccount", body.accountId);
    opDialog.close(); await refresh();
    toast(editingOp ? "Opération modifiée" : `${OP_DONE[body.type]} enregistré${FEM.has(body.type) ? "e" : PLURAL.has(body.type) ? "s" : ""}`);
  } catch (err) { opErr(err.message); }
});
$("#opDelete").addEventListener("click", () => { const o = editingOp; opDialog.close(); deleteOp(o.id); });

async function deleteOp(id) {
  const op = S.operations.find((o) => o.id === id);
  if (!op) return;
  const r = await mutate("DELETE", `operations/${id}`, null, `${OP_DONE[op.type]} supprimé${FEM.has(op.type) ? "e" : PLURAL.has(op.type) ? "s" : ""}`,
    () => mutate("POST", "operations", { ...op, link: !!r?.transfer, domainId: r?.transfer?.domainId ?? null, transferId: r?.transfer?.id }, "Opération restaurée"));
}
onClick("opEdit", (id) => openOperation(S.operations.find((o) => o.id === id)));
onClick("opDel", (id, el, e) => { e.stopPropagation(); deleteOp(id); });

// ---------- cours ----------
async function openPrices() {
  const held = new Map();
  for (const a of S.accounts.filter((x) => !x.closedOn)) for (const p of accountResult(a).v.positions) held.set(p.asset, p);
  if (!held.size) return toast("Aucune position ouverte.", null, true);
  const rows = [...held.keys()].sort().map((sym) => {
    const a = S.assets.find((x) => x.symbol === sym) || {};
    return `<div class="price-row"><div><b>${esc(sym)}</b><div class="meta">${a.updatedAt && a.price ? `mis à jour ${relTime(a.updatedAt.replace(" ", "T") + "Z")}` : "jamais renseigné"}</div></div>
      <input class="input" name="name_${esc(sym)}" placeholder="Nom (optionnel)" value="${esc(a.name || "")}">
      <select class="select" name="class_${esc(sym)}">${Object.entries(CLASSES).map(([k, v]) => `<option value="${k}"${(a.class || "") === k ? " selected" : ""}>${v}</option>`).join("")}</select>
      <input class="input num" name="price_${esc(sym)}" type="number" step="any" min="0" placeholder="Cours (€)" value="${a.price || ""}"></div>`;
  }).join("");
  const v = await formBox("Mettre à jour les cours", `<p class="hint" style="margin:0">Cours actuel en euros. Pour un actif coté en dollars, saisis le cours converti.</p><div class="price-list">${rows}</div>`, "Enregistrer les cours");
  if (!v) return;
  let changed = 0;
  for (const sym of held.keys()) {
    const a = S.assets.find((x) => x.symbol === sym) || {};
    const price = parseFloat(v[`price_${sym}`]), name = v[`name_${sym}`] || "", cls = v[`class_${sym}`] || "";
    const body = {};
    if (price >= 0 && price !== a.price) body.price = price;
    if (name !== (a.name || "") || cls !== (a.class || "")) { body.name = name; body.class = cls; }
    if (Object.keys(body).length) { await api("PUT", `assets/${encodeURIComponent(sym)}`, body); changed++; }
  }
  await refresh();
  toast(changed ? "Cours mis à jour" : "Aucun changement");
}

registerView("investments", { title: "Investissements", render: renderInvestments, usesScope: false });
export { renderInvestments };
