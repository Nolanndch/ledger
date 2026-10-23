// Calcul des échéances, partagé tel quel par le serveur (génération des paiements) et l'interface
// (aperçus, « À venir ») pour que les deux donnent toujours les mêmes dates. Module pur, sans DOM.

export const pad2 = (n) => String(n).padStart(2, "0");
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m de 1 à 12
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

// Fréquences proposées à l'utilisateur, chacune traduite en (freq, interval).
export const FREQUENCIES = [
  { key: "weekly", label: "Chaque semaine", freq: "weekly", interval: 1 },
  { key: "biweekly", label: "Toutes les 2 semaines", freq: "weekly", interval: 2 },
  { key: "monthly", label: "Chaque mois", freq: "monthly", interval: 1 },
  { key: "quarterly", label: "Chaque trimestre", freq: "monthly", interval: 3 },
  { key: "semiannual", label: "Chaque semestre", freq: "monthly", interval: 6 },
  { key: "yearly", label: "Chaque année", freq: "yearly", interval: 1 },
  { key: "daily", label: "Chaque jour", freq: "daily", interval: 1 },
];
export const FREQS = ["daily", "weekly", "monthly", "yearly"];
export function frequencyKey(freq, interval = 1) {
  return FREQUENCIES.find((f) => f.freq === freq && f.interval === Number(interval))?.key || null;
}
export function frequencyLabel(freq, interval = 1) {
  const preset = FREQUENCIES.find((f) => f.freq === freq && f.interval === Number(interval));
  if (preset) return preset.label;
  const unit = { daily: "jours", weekly: "semaines", monthly: "mois", yearly: "ans" }[freq];
  return `Tous les ${interval} ${unit}`;
}
export const frequencyAdjective = (freq, interval = 1) =>
  ({ "weekly-1": "hebdomadaire", "weekly-2": "toutes les 2 semaines", "monthly-1": "mensuel", "monthly-3": "trimestriel", "monthly-6": "semestriel", "yearly-1": "annuel", "daily-1": "quotidien" }[`${freq}-${interval}`] || frequencyLabel(freq, interval).toLowerCase());

// Date suivante. Les mois et années gardent le jour d'ancrage (borné à la fin du mois) :
// 31 janv. → 28 févr. → 31 mars, et 29 févr. 2028 → 28 févr. 2029 → … → 29 févr. 2032.
export function addPeriod(dateStr, freq, anchorDay, interval = 1) {
  const n = Math.max(1, Number(interval) || 1);
  const [y, m, d] = dateStr.split("-").map(Number);
  if (freq === "daily" || freq === "weekly") {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + (freq === "weekly" ? 7 * n : n));
    return dt.toISOString().slice(0, 10);
  }
  const months = freq === "yearly" ? 12 * n : n;
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const anchor = Number(anchorDay) || d;
  return iso(ny, nm, Math.min(anchor, daysInMonth(ny, nm)));
}

// Montant ramené au mois (365,25 jours par an pour toutes les fréquences).
export function monthlyFactor(freq, interval = 1) {
  const n = Math.max(1, Number(interval) || 1);
  switch (freq) {
    case "daily": return 365.25 / 12 / n;
    case "weekly": return 365.25 / 7 / 12 / n;
    case "yearly": return 1 / (12 * n);
    default: return 1 / n;
  }
}

// Premier paiement : à la fin de l'essai s'il y en a un, sinon au début.
export const firstBilling = (r) => r.trialEnd || r.startDate;

// Toutes les échéances dans [from, to] (incluses), en partant de `start` et en s'arrêtant avant `end` (exclue).
export function occurrences({ start, freq, interval = 1, anchorDay, end = null }, from, to, limit = 1000) {
  const out = [];
  let d = start, guard = 0;
  const anchor = anchorDay || Number(start.slice(8));
  while (d <= to && guard++ < 100000 && out.length < limit) {
    if (end && d >= end) break;
    if (d >= from) out.push(d);
    d = addPeriod(d, freq, anchor, interval);
  }
  return out;
}

// Première échéance ≥ `date` (pour reprendre sans créer les paiements passés).
export function firstOnOrAfter({ start, freq, interval = 1, anchorDay }, date) {
  let d = start, guard = 0;
  const anchor = anchorDay || Number(start.slice(8));
  while (d < date && guard++ < 100000) d = addPeriod(d, freq, anchor, interval);
  return d;
}

// Date de fin (exclue) pour un nombre de paiements donné : le jour où tomberait le paiement n+1.
export function endAfter({ start, freq, interval = 1, anchorDay }, count) {
  let d = start;
  const anchor = anchorDay || Number(start.slice(8));
  for (let i = 0; i < count; i++) d = addPeriod(d, freq, anchor, interval);
  return d;
}

export const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const endOfMonth = (monthKey) => { const [y, m] = monthKey.split("-").map(Number); return iso(y, m, daysInMonth(y, m)); };
