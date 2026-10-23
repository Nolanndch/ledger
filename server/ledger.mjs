// Trésorerie : business, catégories, mouvements, paiements en plusieurs fois, remboursements, abonnements,
// objectifs et réglages d'affichage.
import { all, get, run, tx, insert, update, existsIn, need, HttpError, uid, cents, euros, today, isDate, nowStamp } from "./db.mjs";
import { FREQS, firstOnOrAfter, occurrences } from "../public/js/dates.js";

const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const optDate = (v, label) => { if (v == null || v === "") return null; need(isDate(v), `${label} invalide.`); return v; };
const DOMAIN_COLORS = ["#d9a876", "#8b7aa8", "#8ea3b9", "#c9a86a", "#7fae8e", "#b97c7c", "#6f9a9a"];

// ---------- lignes SQL → objets de l'API ----------
export const out = {
  domains: (r) => ({ id: r.id, name: r.name, color: r.color, active: !!r.active, position: r.position, openingBalance: euros(r.opening_cents), openingDate: r.opening_date }),
  categories: (r) => ({ id: r.id, name: r.name, color: r.color }),
  transactions: (r) => ({
    id: r.id, type: r.type, amount: euros(r.amount_cents), domainId: r.domain_id, categoryId: r.category_id,
    desc: r.description, counterparty: r.counterparty, notes: r.notes, date: r.date, status: r.status, kind: r.kind, nature: r.nature,
    recurringId: r.recurring_id, installmentGroup: r.installment_group, installmentIndex: r.installment_index, installmentCount: r.installment_count,
    refundOf: r.refund_of, invOpId: r.inv_op_id, createdAt: r.created_at,
  }),
  recurring: (r) => ({
    id: r.id, name: r.name, type: r.type, kind: r.kind, amount: euros(r.amount_cents), freq: r.freq, interval: r.interval,
    domainId: r.domain_id, categoryId: r.category_id, counterparty: r.counterparty, plan: r.plan, notes: r.notes,
    startDate: r.start_date, trialEnd: r.trial_end, endDate: r.end_date, nextDate: r.next_date, anchorDay: r.anchor_day,
    status: r.status, amountVariable: !!r.amount_variable, createdAt: r.created_at,
  }),
  objectives: (r) => ({ id: r.id, name: r.name, target: euros(r.target_cents), domainId: r.domain_id || "all", deadline: r.deadline, metric: r.metric, accountId: r.account_id }),
};
export const fetchOne = (table, id) => { const r = get(`SELECT * FROM ${table} WHERE id = ?`, id); return r && out[table](r); };

// ---------- validation ----------
export const schema = {
  domains(b, prev = {}) {
    const name = str(b.name ?? prev.name, 80);
    need(name, "Le nom du business est requis.");
    const count = get("SELECT COUNT(*) n FROM domains").n;
    return {
      name, color: b.color || prev.color || DOMAIN_COLORS[count % DOMAIN_COLORS.length],
      active: (b.active ?? prev.active ?? true) ? 1 : 0,
      position: Number.isFinite(b.position) ? b.position : (prev.position ?? count),
      opening_cents: cents(b.openingBalance ?? prev.openingBalance ?? 0),
      opening_date: optDate(b.openingDate !== undefined ? b.openingDate : prev.openingDate, "Date du solde de départ"),
    };
  },
  categories(b, prev = {}) {
    const name = str(b.name ?? prev.name, 80);
    need(name, "Le nom de la catégorie est requis.");
    return { name, color: b.color || prev.color || "#8ea3b9" };
  },
  transactions(b, prev = {}) {
    const m = { ...prev, ...b };
    const amount = cents(m.amount);
    need(amount > 0, "Le montant doit être supérieur à 0.");
    need(m.type === "in" || m.type === "out", "Type invalide.");
    need(isDate(m.date), "Date invalide.");
    return {
      type: m.type, amount_cents: amount,
      domain_id: existsIn("domains", m.domainId) ? m.domainId : null,
      category_id: existsIn("categories", m.categoryId) ? m.categoryId : null,
      description: str(m.desc), counterparty: str(m.counterparty, 120), notes: str(m.notes, 2000), date: m.date,
      status: m.status === "pending" ? "pending" : "paid",
      updated_at: nowStamp(),
    };
  },
  objectives(b, prev = {}) {
    const m = { ...prev, ...b };
    need(str(m.name), "Le nom est requis.");
    need(cents(m.target) > 0, "Le montant cible doit être supérieur à 0.");
    const metric = ["net", "revenue", "mrr", "portfolio"].includes(m.metric) ? m.metric : "net";
    return {
      name: str(m.name, 120), target_cents: cents(m.target), metric,
      domain_id: metric !== "portfolio" && m.domainId && m.domainId !== "all" ? m.domainId : null,
      account_id: metric === "portfolio" && existsIn("inv_accounts", m.accountId) ? m.accountId : null,
      deadline: isDate(m.deadline) ? m.deadline : null,
    };
  },
};

// ---------- mouvements ----------
export function createTransaction(body) {
  need(body.kind !== "transfer", "Un virement vers un placement se crée depuis Investissements.");
  const id = body.id && !existsIn("transactions", body.id) ? str(body.id, 64) : uid();
  insert("transactions", { ...schema.transactions(body), kind: body.kind === "refund" ? "refund" : "cash", nature: "one_time" }, id);
  return fetchOne("transactions", id);
}

function guardLinked(row) {
  if (row.inv_op_id) throw new HttpError(409, "Ce virement est relié à un placement : modifie-le depuis Investissements.");
}

export function updateTransaction(id, body) {
  const row = get("SELECT * FROM transactions WHERE id = ?", id);
  if (!row) throw new HttpError(404, "Mouvement introuvable.");
  guardLinked(row);
  update("transactions", id, schema.transactions(body, out.transactions(row)));
  return fetchOne("transactions", id);
}

export function deleteTransaction(id) {
  const row = get("SELECT * FROM transactions WHERE id = ?", id);
  if (!row) throw new HttpError(404, "Mouvement introuvable.");
  guardLinked(row);
  run("DELETE FROM transactions WHERE id = ?", id);
  return out.transactions(row);
}

// Réinsère des mouvements supprimés (annulation), avec leurs liens d'origine.
export function restoreTransactions(rows) {
  need(Array.isArray(rows) && rows.length <= 500, "Liste invalide.");
  return tx(() => rows.map((t) => {
    need(!t.invOpId && t.kind !== "transfer", "Un virement se restaure depuis Investissements.");
    const id = t.id && !existsIn("transactions", t.id) ? str(t.id, 64) : uid();
    insert("transactions", {
      ...schema.transactions(t), kind: t.kind === "refund" ? "refund" : "cash",
      nature: ["one_time", "subscription", "recurring", "installment"].includes(t.nature) ? t.nature : "one_time",
      recurring_id: existsIn("recurring", t.recurringId) ? t.recurringId : null,
      installment_group: t.installmentGroup || null, installment_index: t.installmentIndex || null, installment_count: t.installmentCount || null,
      refund_of: existsIn("transactions", t.refundOf) ? t.refundOf : null,
    }, id);
    return fetchOne("transactions", id);
  }));
}

// Paiement en plusieurs fois : une ligne par échéance, les échéances futures restent « en attente ».
export function createInstallments(b) {
  const rows = b.rows;
  need(Array.isArray(rows) && rows.length >= 2 && rows.length <= 36, "Il faut entre 2 et 36 échéances.");
  rows.forEach((r, i) => { need(isDate(r.date), `Échéance ${i + 1} : date invalide.`); need(cents(r.amount) > 0, `Échéance ${i + 1} : montant invalide.`); });
  const group = uid(), t = today();
  return tx(() => rows.map((r, i) => {
    const id = insert("transactions", {
      ...schema.transactions({ ...b, amount: r.amount, date: r.date, status: r.date > t ? "pending" : b.status }),
      kind: "cash", nature: "installment", installment_group: group, installment_index: i + 1, installment_count: rows.length,
    });
    return fetchOne("transactions", id);
  }));
}

export function deleteInstallments(group, from = 1) {
  return tx(() => {
    const rows = all("SELECT * FROM transactions WHERE installment_group = ? AND installment_index >= ? AND status = 'pending'", group, from);
    run("DELETE FROM transactions WHERE installment_group = ? AND installment_index >= ? AND status = 'pending'", group, from);
    return rows.map(out.transactions);
  });
}

export function refund(id, b) {
  const orig = get("SELECT * FROM transactions WHERE id = ?", id);
  if (!orig) throw new HttpError(404, "Mouvement introuvable.");
  need(orig.kind === "cash", "Seul un paiement ordinaire peut être remboursé.");
  const done = get("SELECT COALESCE(SUM(amount_cents), 0) s FROM transactions WHERE refund_of = ?", id).s;
  const amount = cents(b.amount ?? euros(orig.amount_cents - done));
  need(amount > 0 && amount <= orig.amount_cents - done, `Le remboursement ne peut pas dépasser ${euros(orig.amount_cents - done).toFixed(2).replace(".", ",")} €.`);
  const date = b.date || today();
  need(isDate(date), "Date invalide.");
  const nid = insert("transactions", {
    type: orig.type === "in" ? "out" : "in", amount_cents: amount, domain_id: orig.domain_id, category_id: orig.category_id,
    description: str(b.desc) || `Remboursement · ${orig.description || "paiement"}`, counterparty: orig.counterparty, notes: "", date,
    status: b.status === "pending" ? "pending" : "paid", kind: "refund", nature: "one_time", refund_of: id, updated_at: nowStamp(),
  });
  return fetchOne("transactions", nid);
}

// ---------- abonnements et récurrences ----------
function recurringSchema(b, prev = null) {
  const m = { ...(prev || {}), ...b };
  need(str(m.name), "Le nom est requis.");
  need(cents(m.amount) > 0, "Le montant doit être supérieur à 0.");
  need(FREQS.includes(m.freq), "Fréquence invalide.");
  const interval = Math.round(Number(m.interval) || 1);
  need(interval >= 1 && interval <= 36, "Intervalle invalide.");
  need(isDate(m.startDate), "Date de début invalide.");
  const trialEnd = optDate(m.trialEnd, "Fin de l'essai");
  need(!trialEnd || trialEnd > m.startDate, "La fin de l'essai doit être après le début.");
  const endDate = optDate(m.endDate, "Date de fin");
  const first = trialEnd || m.startDate;
  need(!endDate || endDate > m.startDate, "La date de fin doit être après le début.");
  const cols = {
    name: str(m.name, 120), type: m.type === "in" ? "in" : "out", kind: m.kind === "other" ? "other" : "subscription",
    amount_cents: cents(m.amount), freq: m.freq, interval,
    domain_id: existsIn("domains", m.domainId) ? m.domainId : null,
    category_id: existsIn("categories", m.categoryId) ? m.categoryId : null,
    counterparty: str(m.counterparty, 120), plan: str(m.plan, 80), notes: str(m.notes, 2000),
    start_date: m.startDate, trial_end: trialEnd, end_date: endDate,
    status: m.status === "pending" ? "pending" : "paid", amount_variable: m.amountVariable ? 1 : 0,
  };
  const anchorOf = (d) => Number(d.slice(8));
  const fresh = (anchor) => (b.catchUp === false && first < today())
    ? firstOnOrAfter({ start: first, freq: m.freq, interval, anchorDay: anchor }, today()) : first;
  if (!prev) {
    cols.anchor_day = anchorOf(first);
    cols.next_date = fresh(cols.anchor_day);
    cols.active = 1;
    cols.created_at = today();
  } else if (b.nextDate && b.nextDate !== prev.nextDate) {
    need(isDate(b.nextDate), "Prochaine échéance invalide.");
    cols.next_date = b.nextDate;
    cols.anchor_day = anchorOf(b.nextDate);
  } else if ((b.startDate && b.startDate !== prev.startDate) || (b.trialEnd !== undefined && (b.trialEnd || null) !== prev.trialEnd)) {
    const linked = get("SELECT COUNT(*) n FROM transactions WHERE recurring_id = ?", prev.id).n;
    if (!linked) { cols.anchor_day = anchorOf(first); cols.next_date = fresh(cols.anchor_day); }
  }
  return cols;
}

// Crée les paiements arrivés à échéance. Idempotent : un paiement déjà présent à la même date n'est pas recréé.
export function materializeRecurring() {
  const t = today();
  let created = 0;
  tx(() => {
    for (const r of all("SELECT * FROM recurring WHERE active = 1 AND next_date <= ? AND (end_date IS NULL OR next_date < end_date)", t)) {
      const dates = occurrences({ start: r.next_date, freq: r.freq, interval: r.interval, anchorDay: r.anchor_day, end: r.end_date }, "0000-01-01", t);
      for (const date of dates) {
        if (get("SELECT 1 FROM transactions WHERE recurring_id = ? AND date = ?", r.id, date)) continue;
        insert("transactions", {
          type: r.type, amount_cents: r.amount_cents, domain_id: r.domain_id, category_id: r.category_id,
          description: r.name, counterparty: r.counterparty, notes: "", date,
          status: r.amount_variable ? "pending" : r.status, kind: "cash", nature: r.kind === "subscription" ? "subscription" : "recurring",
          recurring_id: r.id, updated_at: nowStamp(),
        });
        created++;
      }
      const last = dates.at(-1) || r.next_date;
      const next = occurrences({ start: last, freq: r.freq, interval: r.interval, anchorDay: r.anchor_day }, last, "9999-12-31", 2)[1];
      run("UPDATE recurring SET next_date = ? WHERE id = ?", next, r.id);
    }
  });
  return created;
}

export function createRecurring(body) {
  return tx(() => {
    const id = body.id && !existsIn("recurring", body.id) ? str(body.id, 64) : uid();
    insert("recurring", recurringSchema(body), id);
    const created = materializeRecurring();
    return { ...fetchOne("recurring", id), created };
  });
}

export function updateRecurring(id, body) {
  return tx(() => {
    const prev = fetchOne("recurring", id);
    if (!prev) throw new HttpError(404, "Abonnement introuvable.");
    update("recurring", id, recurringSchema(body, prev));
    // Mettre à jour le prix des paiements déjà créés à partir d'une date (demande explicite)
    if (isDate(body.applyAmountFrom)) {
      run("UPDATE transactions SET amount_cents = ?, updated_at = ? WHERE recurring_id = ? AND date >= ?", cents(body.amount ?? prev.amount), nowStamp(), id, body.applyAmountFrom);
    }
    const created = materializeRecurring();
    return { ...fetchOne("recurring", id), created };
  });
}

// Résiliation : plus rien n'est facturé à partir de `endDate` (exclue). Option : supprimer les paiements déjà
// créés à partir de cette date.
export function cancelRecurring(id, b) {
  return tx(() => {
    const r = fetchOne("recurring", id);
    if (!r) throw new HttpError(404, "Abonnement introuvable.");
    const end = b.endDate || today();
    need(isDate(end), "Date de fin invalide.");
    need(end > r.startDate, "La date de fin doit être après le début.");
    run("UPDATE recurring SET end_date = ? WHERE id = ?", end, id);
    let deleted = [];
    if (b.deleteAfter) {
      deleted = all("SELECT * FROM transactions WHERE recurring_id = ? AND date >= ?", id, end).map(out.transactions);
      run("DELETE FROM transactions WHERE recurring_id = ? AND date >= ?", id, end);
    }
    return { recurring: fetchOne("recurring", id), deleted };
  });
}

// Réactivation : reprend à la prochaine échéance future, sans créer les paiements manqués.
export function reactivateRecurring(id) {
  return tx(() => {
    const r = fetchOne("recurring", id);
    if (!r) throw new HttpError(404, "Abonnement introuvable.");
    const next = r.nextDate < today() ? firstOnOrAfter({ start: r.nextDate, freq: r.freq, interval: r.interval, anchorDay: r.anchorDay }, today()) : r.nextDate;
    run("UPDATE recurring SET end_date = NULL, next_date = ? WHERE id = ?", next, id);
    materializeRecurring();
    return fetchOne("recurring", id);
  });
}

export function deleteRecurring(id, { force = false, withPayments = false } = {}) {
  return tx(() => {
    const r = fetchOne("recurring", id);
    if (!r) throw new HttpError(404, "Abonnement introuvable.");
    const n = get("SELECT COUNT(*) n FROM transactions WHERE recurring_id = ?", id).n;
    if (n && !force && !withPayments) throw new HttpError(409, `Cet abonnement a ${n} paiement${n > 1 ? "s" : ""}. Résilie-le plutôt pour garder l'historique.`);
    const payments = withPayments ? all("SELECT * FROM transactions WHERE recurring_id = ?", id).map(out.transactions) : [];
    if (withPayments) run("DELETE FROM transactions WHERE recurring_id = ?", id);
    run("DELETE FROM recurring WHERE id = ?", id);
    return { deleted: r, payments };
  });
}

// ---------- réglages d'affichage (partagés par la base) ----------
export const SETTINGS = {
  showCents: { def: true, ok: (v) => typeof v === "boolean" },
  density: { def: "comfortable", ok: (v) => ["comfortable", "compact"].includes(v) },
  defaultPeriod: { def: "all", ok: (v) => ["month", "lastMonth", "3m", "year", "lastYear", "12m", "all"].includes(v) },
  startView: { def: "dashboard", ok: (v) => ["dashboard", "ledger", "analytics", "subscriptions", "objectives", "investments", "last"].includes(v) },
  compare: { def: true, ok: (v) => typeof v === "boolean" },
  dashboardWidgets: { def: {}, ok: (v) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "boolean") },
  ledgerColumns: { def: {}, ok: (v) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "boolean") },
  investGroup: { def: "account", ok: (v) => ["account", "asset"].includes(v) },
  hideClosedPositions: { def: true, ok: (v) => typeof v === "boolean" },
};
export function getSettings() {
  const saved = Object.fromEntries(all("SELECT key, value FROM settings").map((r) => { try { return [r.key, JSON.parse(r.value)]; } catch { return [r.key, undefined]; } }));
  return Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, s.ok(saved[k]) ? saved[k] : s.def]));
}
export function putSettings(b) {
  need(b && typeof b === "object", "Réglages invalides.");
  tx(() => {
    for (const [k, v] of Object.entries(b)) {
      need(SETTINGS[k], `Réglage inconnu : ${k}.`);
      need(SETTINGS[k].ok(v) && JSON.stringify(v).length < 10000, `Valeur invalide pour ${k}.`);
      run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", k, JSON.stringify(v));
    }
  });
  return getSettings();
}
