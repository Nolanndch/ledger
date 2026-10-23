// Investissements : comptes (PEA, compte-titres, crypto…), opérations, cours des actifs.
// Chaque écriture rejoue l'historique du compte dans la même transaction SQL : une modification qui rendrait
// une position négative, ou les liquidités d'un PEA négatives, est refusée et rien n'est enregistré.
import { all, get, run, tx, insert, update, existsIn, need, HttpError, uid, today, isDate, nowStamp } from "./db.mjs";
import { ACCOUNT_TYPES, OP_TYPES, replay, PortfolioError } from "../public/js/lib/portfolio.js";

const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const int = (v) => Math.round(Number(v) || 0);

export const out = {
  accounts: (r) => ({
    id: r.id, name: r.name, type: r.type, broker: r.broker, fiscalDate: r.fiscal_date, ceilingCents: r.ceiling_cents,
    initialContributionsCents: r.initial_contributions_cents, domainId: r.domain_id, closedOn: r.closed_on, position: r.position, createdAt: r.created_at,
  }),
  operations: (r) => ({
    id: r.id, accountId: r.account_id, date: r.date, type: r.type, asset: r.asset, qty: r.qty, price: r.price,
    feesCents: r.fees_cents, amountCents: r.amount_cents, side: r.side, ratio: r.ratio, notes: r.notes, createdAt: r.created_at,
  }),
  assets: (r) => ({ symbol: r.asset, price: r.price, name: r.name, class: r.class, updatedAt: r.updated_at }),
};

function accountSchema(b, prev = {}) {
  const m = { ...prev, ...b };
  need(ACCOUNT_TYPES[m.type], "Type de compte invalide.");
  const name = str(m.name, 80) || [ACCOUNT_TYPES[m.type].label, str(m.broker, 60)].filter(Boolean).join(" ");
  const fiscal = m.fiscalDate || null;
  need(!fiscal || isDate(fiscal), "Date du 1er versement invalide.");
  const ceiling = m.ceilingCents == null || m.ceilingCents === "" ? null : int(m.ceilingCents);
  need(ceiling == null || ceiling > 0, "Plafond invalide.");
  const initial = int(m.initialContributionsCents);
  need(initial >= 0, "Versements antérieurs invalides.");
  return {
    name, type: m.type, broker: str(m.broker, 60), fiscal_date: fiscal, ceiling_cents: ceiling, initial_contributions_cents: initial,
    domain_id: existsIn("domains", m.domainId) ? m.domainId : null,
    position: Number.isFinite(m.position) ? m.position : get("SELECT COUNT(*) n FROM inv_accounts").n,
  };
}

const NEEDS_ASSET = new Set(["buy", "sell", "split", "trade"]);
function opSchema(b, prev = {}) {
  const m = { ...prev, ...b };
  const account = get("SELECT * FROM inv_accounts WHERE id = ?", m.accountId);
  need(account, "Compte introuvable.");
  need(OP_TYPES[m.type], "Type d'opération invalide.");
  need(isDate(m.date), "Date invalide.");
  need(!account.closed_on || m.date <= account.closed_on, `Ce compte est clôturé depuis le ${account.closed_on}.`);
  const asset = str(m.asset, 32).toUpperCase();
  if (NEEDS_ASSET.has(m.type) || (m.type === "initial" && Number(m.qty) > 0)) need(asset, "Indique l'actif (ticker ou nom court).");
  const qty = Number(m.qty) || 0;
  if (m.type === "buy" || m.type === "sell") need(qty > 0, "La quantité doit être supérieure à 0.");
  const amount = int(m.amountCents);
  if (m.type === "trade") need(Number.isFinite(amount), "Résultat invalide.");
  else need(amount >= 0, "Le montant ne peut pas être négatif.");
  if (["deposit", "withdrawal", "dividend", "interest", "fee", "tax"].includes(m.type) || (m.type === "initial" && !asset)) need(amount > 0, "Le montant doit être supérieur à 0.");
  const ratio = m.type === "split" ? Number(m.ratio) : null;
  if (m.type === "split") need(ratio > 0, "Rapport de division invalide.");
  return {
    account_id: account.id, date: m.date, type: m.type, asset: ["deposit", "withdrawal", "fee", "tax", "interest"].includes(m.type) ? "" : asset,
    qty: m.type === "split" ? 0 : qty, price: Number(m.price) || 0, fees_cents: Math.max(0, int(m.feesCents)), amount_cents: amount,
    side: m.type === "trade" ? (m.side === "short" ? "short" : "long") : null, ratio, notes: str(m.notes, 1000),
  };
}

const accountRow = (id) => get("SELECT * FROM inv_accounts WHERE id = ?", id);
const opsOf = (accountId) => all("SELECT * FROM inv_operations WHERE account_id = ?", accountId).map(out.operations);

// Rejoue le compte ; une incohérence annule toute la transaction SQL en cours.
export function checkAccount(accountId) {
  const a = accountRow(accountId);
  if (!a) return;
  try { return replay(out.accounts(a), opsOf(accountId)); }
  catch (e) { if (e instanceof PortfolioError) throw new HttpError(400, e.message); throw e; }
}

// Virement de trésorerie relié à un versement ou un retrait. L'opération en est propriétaire :
// supprimer l'opération (ou le compte) supprime le virement.
function syncTransfer(opId, link) {
  const op = get("SELECT * FROM inv_operations WHERE id = ?", opId);
  const linked = get("SELECT * FROM transactions WHERE inv_op_id = ?", opId);
  const wanted = link?.enabled && (op.type === "deposit" || op.type === "withdrawal");
  if (!wanted) { if (linked) run("DELETE FROM transactions WHERE id = ?", linked.id); return; }
  const account = accountRow(op.account_id);
  const domain = link.domainId !== undefined ? (existsIn("domains", link.domainId) ? link.domainId : null) : (linked ? linked.domain_id : account.domain_id);
  const cols = {
    type: op.type === "deposit" ? "out" : "in", amount_cents: op.amount_cents, domain_id: domain, category_id: null,
    description: `${op.type === "deposit" ? "Versement" : "Retrait"} ${account.name}`, counterparty: account.broker || "", notes: "",
    date: op.date, status: "paid", kind: "transfer", nature: "one_time", inv_op_id: op.id, updated_at: nowStamp(),
  };
  if (linked) update("transactions", linked.id, cols);
  else insert("transactions", cols, link.transferId && !existsIn("transactions", link.transferId) ? str(link.transferId, 64) : uid());
}

export function createAccount(b) {
  return tx(() => {
    const id = b.id && !existsIn("inv_accounts", b.id) ? str(b.id, 64) : uid();
    insert("inv_accounts", accountSchema(b), id);
    return out.accounts(accountRow(id));
  });
}

export function updateAccount(id, b) {
  return tx(() => {
    const a = accountRow(id);
    if (!a) throw new HttpError(404, "Compte introuvable.");
    update("inv_accounts", id, accountSchema(b, out.accounts(a)));
    checkAccount(id);
    // Les virements reliés prennent le nouveau nom du compte
    for (const t of all("SELECT t.id, o.type FROM transactions t JOIN inv_operations o ON o.id = t.inv_op_id WHERE o.account_id = ?", id)) {
      run("UPDATE transactions SET description = ? WHERE id = ?", `${t.type === "deposit" ? "Versement" : "Retrait"} ${accountRow(id).name}`, t.id);
    }
    return out.accounts(accountRow(id));
  });
}

export function deleteAccount(id, { purge = false } = {}) {
  return tx(() => {
    const a = accountRow(id);
    if (!a) throw new HttpError(404, "Compte introuvable.");
    const n = get("SELECT COUNT(*) n FROM inv_operations WHERE account_id = ?", id).n;
    if (n && !purge) throw new HttpError(409, `Ce compte a ${n} opération${n > 1 ? "s" : ""}. Clôture-le plutôt pour garder l'historique.`);
    run("UPDATE objectives SET account_id = NULL WHERE account_id = ?", id);
    run("DELETE FROM inv_accounts WHERE id = ?", id); // opérations et virements reliés suivent en cascade
    return { deleted: out.accounts(a) };
  });
}

// Clôture : il ne doit plus rester de titres ; les liquidités restantes sont retirées.
export function closeAccount(id, b) {
  return tx(() => {
    const a = accountRow(id);
    if (!a) throw new HttpError(404, "Compte introuvable.");
    const date = b.date || today();
    need(isDate(date), "Date invalide.");
    const r = checkAccount(id);
    const open = r.positions.filter((p) => p.qty > 1e-9);
    need(!open.length, `Il reste des titres sur ce compte (${open.map((p) => p.asset).join(", ")}). Enregistre d'abord leur vente.`);
    if (r.cash > 0) {
      const opId = insert("inv_operations", { account_id: id, date, type: "withdrawal", asset: "", qty: 0, price: 0, fees_cents: 0, amount_cents: r.cash, side: null, ratio: null, notes: "Clôture du compte" });
      syncTransfer(opId, { enabled: b.link !== false, domainId: b.domainId });
    }
    run("UPDATE inv_accounts SET closed_on = ? WHERE id = ?", date, id);
    checkAccount(id);
    return out.accounts(accountRow(id));
  });
}

export function reopenAccount(id) {
  run("UPDATE inv_accounts SET closed_on = NULL WHERE id = ?", id);
  return out.accounts(accountRow(id));
}

const linkFrom = (b) => b.link === undefined ? undefined : { enabled: !!b.link, domainId: b.domainId, transferId: b.transferId };

export function createOperation(b) {
  return tx(() => {
    const id = b.id && !existsIn("inv_operations", b.id) ? str(b.id, 64) : uid();
    const cols = opSchema(b);
    if (b.createdAt) cols.created_at = str(b.createdAt, 32);
    insert("inv_operations", cols, id);
    const acc = accountRow(cols.account_id);
    syncTransfer(id, linkFrom(b) ?? { enabled: true, domainId: acc.domain_id });
    if (cols.asset && cols.price > 0 && (cols.type === "buy" || cols.type === "sell")) {
      run("INSERT OR IGNORE INTO asset_prices (asset, price, updated_at) VALUES (?, ?, datetime('now'))", cols.asset, cols.price);
    } else if (cols.asset) run("INSERT OR IGNORE INTO asset_prices (asset, price) VALUES (?, 0)", cols.asset);
    checkAccount(cols.account_id);
    return out.operations(get("SELECT * FROM inv_operations WHERE id = ?", id));
  });
}

export function updateOperation(id, b) {
  return tx(() => {
    const prev = get("SELECT * FROM inv_operations WHERE id = ?", id);
    if (!prev) throw new HttpError(404, "Opération introuvable.");
    const cols = opSchema(b, out.operations(prev));
    update("inv_operations", id, cols);
    const hadLink = !!get("SELECT 1 FROM transactions WHERE inv_op_id = ?", id);
    syncTransfer(id, linkFrom(b) ?? { enabled: hadLink });
    checkAccount(cols.account_id);
    if (cols.account_id !== prev.account_id) checkAccount(prev.account_id);
    return out.operations(get("SELECT * FROM inv_operations WHERE id = ?", id));
  });
}

export function deleteOperation(id) {
  return tx(() => {
    const prev = get("SELECT * FROM inv_operations WHERE id = ?", id);
    if (!prev) throw new HttpError(404, "Opération introuvable.");
    const transfer = get("SELECT * FROM transactions WHERE inv_op_id = ?", id);
    run("DELETE FROM inv_operations WHERE id = ?", id);
    checkAccount(prev.account_id);
    return { deleted: out.operations(prev), transfer: transfer ? { id: transfer.id, domainId: transfer.domain_id } : null };
  });
}

export function putAsset(symbol, b) {
  const s = str(decodeURIComponent(symbol), 32).toUpperCase();
  need(s, "Actif invalide.");
  const prev = get("SELECT * FROM asset_prices WHERE asset = ?", s);
  const price = b.price !== undefined ? Number(b.price) : prev?.price ?? 0;
  need(Number.isFinite(price) && price >= 0, "Cours invalide.");
  run(`INSERT INTO asset_prices (asset, price, name, class, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(asset) DO UPDATE SET price = excluded.price, name = excluded.name, class = excluded.class,
       updated_at = CASE WHEN ? THEN datetime('now') ELSE asset_prices.updated_at END`,
    s, price, str(b.name ?? prev?.name, 80), str(b.class ?? prev?.class, 20), b.price !== undefined ? 1 : 0);
  return out.assets(get("SELECT * FROM asset_prices WHERE asset = ?", s));
}
