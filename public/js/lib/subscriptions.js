// Abonnements et échéances : statuts, revenu mensuel récurrent (MRR), charges fixes, paiements à venir.
// Module pur, testé côté Node. La date de fin d'un abonnement est exclue : rien n'est facturé à partir de ce jour.
import { addPeriod, monthlyFactor, occurrences, endOfMonth } from "../dates.js";

export const billingStart = (r) => r.trialEnd || r.startDate;
export const isRevenueSub = (r) => r.type === "in" && r.kind === "subscription";

export function status(r, today) {
  if (r.endDate && r.endDate <= today) return "ended";
  if (r.startDate > today) return "upcoming";
  if (r.trialEnd && r.trialEnd > today) return "trial";
  if (r.endDate) return "ending";
  return "active";
}
export const STATUS_LABEL = { ended: "Terminé", upcoming: "Démarre bientôt", trial: "Essai", ending: "Se termine", active: "Actif" };

// L'abonnement compte-t-il à la date E (facturé, pas encore terminé) ?
export const activeAt = (r, E) => billingStart(r) <= E && (!r.endDate || r.endDate > E);

// Montant en vigueur à la date E : le dernier paiement créé avant E, sinon le montant actuel.
function amountAt(r, E, byRec) {
  const list = byRec?.get(r.id);
  if (list) for (let i = list.length - 1; i >= 0; i--) if (list[i].date <= E) return list[i].amount;
  return r.amount;
}
const indexTx = (transactions) => {
  const m = new Map();
  for (const t of [...transactions].filter((t) => t.recurringId).sort((a, b) => a.date.localeCompare(b.date))) {
    if (!m.has(t.recurringId)) m.set(t.recurringId, []);
    m.get(t.recurringId).push(t);
  }
  return m;
};

export const monthly = (r, amount = r.amount) => amount * monthlyFactor(r.freq, r.interval);

// MRR aujourd'hui (montants actuels).
export function mrr(subs, today) {
  const list = subs.filter((r) => isRevenueSub(r) && activeAt(r, today));
  const total = list.reduce((a, r) => a + monthly(r), 0);
  return { mrr: total, arr: total * 12, count: list.length, arpu: list.length ? total / list.length : 0, list };
}

// MRR à chaque fin de mois, avec les mouvements calculés par différence entre deux photos successives :
// la somme des mouvements est toujours égale à la variation du MRR.
export function mrrHistory(subs, transactions, monthKeys, today) {
  const byRec = indexTx(transactions);
  const revenue = subs.filter(isRevenueSub);
  const snap = (E, current) => new Map(revenue.filter((r) => activeAt(r, E)).map((r) => [r.id, monthly(r, current ? r.amount : amountAt(r, E, byRec))]));
  const prevKey = (k) => { const [y, m] = k.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
  return monthKeys.map((k) => {
    const E = endOfMonth(k), S = endOfMonth(prevKey(k));
    const cur = k === today.slice(0, 7);
    const now = snap(cur ? today : E, cur), before = snap(S, false);
    let added = 0, churned = 0, expansion = 0, contraction = 0, newCount = 0, churnCount = 0;
    for (const [id, v] of now) {
      if (!before.has(id)) { added += v; newCount++; } else { const d = v - before.get(id); if (d > 0) expansion += d; else contraction -= d; }
    }
    for (const [id, v] of before) if (!now.has(id)) { churned += v; churnCount++; }
    const total = [...now.values()].reduce((a, v) => a + v, 0);
    return { month: k, mrr: total, count: now.size, added, churned, expansion, contraction, newCount, churnCount };
  });
}

// Charges fixes mensuelles (toutes les sorties récurrentes en cours).
export function fixedCosts(subs, today) {
  const list = subs.filter((r) => r.type === "out" && activeAt(r, today));
  const total = list.reduce((a, r) => a + monthly(r), 0);
  return { monthly: total, yearly: total * 12, count: list.length, list };
}

// Prochaines échéances d'un abonnement entre deux dates (incluses), à partir de sa prochaine date.
export function nextOccurrences(r, from, to) {
  return occurrences({ start: r.nextDate, freq: r.freq, interval: r.interval, anchorDay: r.anchorDay, end: r.endDate }, from, to);
}

// Tout ce qui est attendu entre `from` et `to` : mouvements en attente déjà créés et paiements d'abonnements
// pas encore générés. Les retards (en attente, datés avant `from`) sont inclus avec overdue = true.
export function upcoming(subs, transactions, from, to) {
  const items = [];
  for (const t of transactions) {
    if (t.status !== "pending" || t.kind === "transfer" || t.date > to) continue;
    items.push({ date: t.date, type: t.type, amount: t.amount, label: t.desc, counterparty: t.counterparty, domainId: t.domainId, txId: t.id, recurringId: t.recurringId, overdue: t.date < from, projected: false });
  }
  for (const r of subs) {
    for (const date of nextOccurrences(r, from, to)) {
      items.push({ date, type: r.type, amount: r.amount, label: r.name, counterparty: r.counterparty, domainId: r.domainId, recurringId: r.id, projected: true, variable: !!r.amountVariable, trialEnd: r.trialEnd === date });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// Nombre de paiements qu'une création ou modification va générer d'un coup (dates passées).
export function catchUpCount(r, today) {
  return occurrences({ start: r.nextDate, freq: r.freq, interval: r.interval, anchorDay: r.anchorDay, end: r.endDate }, "0000-01-01", today).length;
}

export { addPeriod };
