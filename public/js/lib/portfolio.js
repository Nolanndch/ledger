// Moteur de portefeuille, partagé par le serveur (contrôle des opérations) et l'interface (affichage).
// Tous les montants sont en centimes. Prix de revient unitaire pondéré (PRU) : le montant payé à l'achat,
// frais inclus, entre dans le coût ; le montant reçu à la vente, frais déduits, sort au coût moyen.
// Pas de vente à découvert : une vente ne peut pas dépasser la quantité détenue. Les produits à effet de levier
// (CFD, futures, perps) se saisissent en « trade clôturé » avec leur résultat.

export const ACCOUNT_TYPES = {
  pea: { label: "PEA", ceiling: 15000000, longOnly: true, cashFloor: true, fiscalYears: 5 },
  pea_pme: { label: "PEA-PME", ceiling: 22500000, longOnly: true, cashFloor: true, fiscalYears: 5 },
  cto: { label: "Compte-titres", ceiling: null, longOnly: true, cashFloor: false },
  crypto: { label: "Crypto", ceiling: null, longOnly: true, cashFloor: false },
  autre: { label: "Autre", ceiling: null, longOnly: true, cashFloor: false },
};

export const OP_TYPES = {
  initial: "Reprise", deposit: "Versement", withdrawal: "Retrait", buy: "Achat", sell: "Vente",
  dividend: "Dividende", interest: "Intérêts", fee: "Frais", tax: "Impôt", trade: "Trade clôturé", split: "Division",
};

// Ordre d'application au sein d'une même journée : les achats avant les ventes, les versements avant tout.
const RANK = { initial: 0, deposit: 1, buy: 2, split: 3, dividend: 4, interest: 4, fee: 4, tax: 4, trade: 4, sell: 5, withdrawal: 6 };
export const sortOps = (ops) => [...ops].sort((a, b) =>
  a.date.localeCompare(b.date) || (RANK[a.type] - RANK[b.type]) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id)));

const EPS = 1e-9;
const fmtQty = (q) => Number(q.toPrecision(12)).toLocaleString("fr-FR", { maximumFractionDigits: 8 });

export class PortfolioError extends Error {
  constructor(message, op) { super(message); this.op = op; }
}

// Rejoue les opérations d'un compte. `ops` : {id, date, type, asset, qty, price, feesCents, amountCents, side, ratio, createdAt}.
// Lève PortfolioError si une vente dépasse la quantité détenue, ou si les liquidités d'un PEA deviennent négatives.
export function replay(account, ops, { strict = true } = {}) {
  const type = ACCOUNT_TYPES[account.type] || ACCOUNT_TYPES.autre;
  const st = {
    cash: 0, deposits: 0, withdrawals: 0, income: 0, withholding: 0, fees: 0, taxes: 0, realized: 0,
    positions: new Map(), events: [], trades: [], firstDeposit: null, lastDate: null, warnings: [],
  };
  const pos = (asset) => {
    if (!st.positions.has(asset)) st.positions.set(asset, { asset, qty: 0, cost: 0, realized: 0, openedOn: null, tradePnl: 0, lastPrice: null, lastDate: null });
    return st.positions.get(asset);
  };
  for (const op of sortOps(ops)) {
    const amt = Math.round(op.amountCents || 0);
    const n = Number(op.qty) || 0;
    st.lastDate = op.date;
    switch (op.type) {
      case "initial":
        if (op.asset) { const p = pos(op.asset); if (p.qty <= EPS) p.openedOn = op.date; p.qty += n; p.cost += amt; if (n > 0) p.lastPrice = amt / 100 / n; }
        else st.cash += amt;
        break;
      case "deposit": st.cash += amt; st.deposits += amt; if (!st.firstDeposit) st.firstDeposit = op.date; break;
      case "withdrawal": st.cash -= amt; st.withdrawals += amt; break;
      case "buy": {
        const p = pos(op.asset);
        if (p.qty <= EPS) { p.openedOn = op.date; p.tradePnl = 0; }
        p.qty += n; p.cost += amt; st.cash -= amt; st.fees += op.feesCents || 0;
        p.lastPrice = op.price || (n ? amt / 100 / n : p.lastPrice); p.lastDate = op.date;
        break;
      }
      case "sell": {
        const p = pos(op.asset);
        if (n > p.qty + EPS) {
          const msg = `Le ${op.date}, la vente de ${fmtQty(n)} ${op.asset} dépasse la quantité détenue (${fmtQty(Math.max(0, p.qty))}).`;
          if (strict) throw new PortfolioError(msg, op);
          st.warnings.push(msg);
        }
        const sold = Math.min(n, p.qty);
        const removed = sold >= p.qty - EPS ? p.cost : Math.round(p.cost * sold / p.qty);
        const pnl = amt - removed;
        p.cost -= removed; p.qty -= sold; p.realized += pnl; p.tradePnl += pnl;
        if (Math.abs(p.qty) < EPS) { p.qty = 0; p.cost = 0; }
        st.cash += amt; st.realized += pnl; st.fees += op.feesCents || 0;
        p.lastPrice = op.price || (sold ? amt / 100 / sold : p.lastPrice); p.lastDate = op.date;
        st.events.push({ date: op.date, asset: op.asset, qty: sold, avgCost: sold ? removed / sold : 0, proceeds: amt, pnl, opId: op.id });
        if (p.qty === 0) {
          st.trades.push({ asset: op.asset, side: "long", openedOn: p.openedOn || op.date, closedOn: op.date, pnl: p.tradePnl, kind: "position" });
          p.tradePnl = 0; p.openedOn = null;
        }
        break;
      }
      case "dividend": st.cash += amt; st.income += amt; st.withholding += op.feesCents || 0; break;
      case "interest": st.cash += amt; st.income += amt; break;
      case "fee": st.cash -= amt; st.fees += amt; break;
      case "tax": st.cash -= amt; st.taxes += amt; break;
      case "trade":
        st.cash += amt; st.realized += amt; st.fees += op.feesCents || 0;
        st.trades.push({ asset: op.asset, side: op.side || "long", openedOn: op.openedOn || op.date, closedOn: op.date, pnl: amt, kind: "trade", qty: n, opId: op.id });
        st.events.push({ date: op.date, asset: op.asset, qty: n, pnl: amt, opId: op.id, trade: true });
        break;
      case "split": { const p = pos(op.asset); if (op.ratio > 0) p.qty *= op.ratio; break; }
    }
    if (type.cashFloor && st.cash < -0.5) {
      const msg = `Le ${op.date}, les liquidités du compte deviendraient négatives (${(st.cash / 100).toFixed(2).replace(".", ",")} €). Ajoute d'abord un versement.`;
      if (strict) throw new PortfolioError(msg, op);
      st.warnings.push(msg);
    }
  }
  const initialContrib = Math.round(account.initialContributionsCents || 0);
  return {
    ...st,
    positions: [...st.positions.values()],
    contributions: initialContrib + st.deposits - st.withdrawals, // versé net
    grossContributions: initialContrib + st.deposits, // compte pour le plafond du PEA
  };
}

// Valorisation avec les cours connus (centimes). `prices` : {SYMBOLE: prix en euros}.
export function value(result, prices = {}) {
  let invested = 0, market = 0;
  const positions = result.positions.filter((p) => p.qty > EPS).map((p) => {
    const known = prices[p.asset];
    const price = known ?? p.lastPrice ?? (p.qty ? p.cost / 100 / p.qty : 0);
    const mv = Math.round(p.qty * price * 100);
    invested += p.cost; market += mv;
    return { ...p, price, estimated: known == null, marketValue: mv, unrealized: mv - p.cost, avg: p.cost / 100 / p.qty };
  });
  const total = result.cash + market;
  return { positions, invested, market, cash: result.cash, total, unrealized: market - invested, gain: total - result.contributions };
}

// Statistiques de trading sur les positions soldées et les trades clôturés.
export function tradingStats(trades) {
  const closed = trades.filter((t) => t.closedOn);
  const wins = closed.filter((t) => t.pnl >= 1), losses = closed.filter((t) => t.pnl <= -1);
  const gross = wins.reduce((a, t) => a + t.pnl, 0), lost = losses.reduce((a, t) => a + t.pnl, 0);
  let peak = 0, cum = 0, drawdown = 0;
  for (const t of [...closed].sort((a, b) => a.closedOn.localeCompare(b.closedOn))) {
    cum += t.pnl; peak = Math.max(peak, cum); drawdown = Math.min(drawdown, cum - peak);
  }
  const days = closed.map((t) => (Date.parse(t.closedOn) - Date.parse(t.openedOn)) / 864e5).filter((d) => d >= 0);
  return {
    count: closed.length, wins: wins.length, losses: losses.length, breakeven: closed.length - wins.length - losses.length,
    winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null,
    pnl: gross + lost + closed.filter((t) => t.pnl > -1 && t.pnl < 1).reduce((a, t) => a + t.pnl, 0),
    avgWin: wins.length ? gross / wins.length : null, avgLoss: losses.length ? lost / losses.length : null,
    profitFactor: losses.length ? gross / -lost : null, expectancy: closed.length ? (gross + lost) / closed.length : null,
    best: closed.reduce((b, t) => (!b || t.pnl > b.pnl ? t : b), null), worst: closed.reduce((b, t) => (!b || t.pnl < b.pnl ? t : b), null),
    maxDrawdown: drawdown, avgDays: days.length ? days.reduce((a, d) => a + d, 0) / days.length : null,
  };
}

// Plafond de versements et ancienneté fiscale d'un PEA.
export function peaStatus(account, result, today) {
  const t = ACCOUNT_TYPES[account.type];
  if (!t?.fiscalYears) return null;
  const fiscal = account.fiscalDate || result.firstDeposit;
  const ceiling = account.ceilingCents ?? t.ceiling;
  let years = null, milestone = null;
  if (fiscal) {
    const [y, m, d] = fiscal.split("-").map(Number);
    milestone = `${y + t.fiscalYears}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    years = (Date.parse(today) - Date.parse(fiscal)) / (365.25 * 864e5);
  }
  return { fiscal, milestone, years, mature: milestone ? today >= milestone : false, ceiling, paid: result.grossContributions, room: ceiling != null ? ceiling - result.grossContributions : null };
}
