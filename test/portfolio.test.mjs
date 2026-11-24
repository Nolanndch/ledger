import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, value, tradingStats, peaStatus, PortfolioError } from "../public/js/lib/portfolio.js";

const op = (date, type, extra = {}) => ({ id: date + type + Math.random(), date, type, asset: "", qty: 0, price: 0, feesCents: 0, amountCents: 0, ...extra });

test("PRU frais inclus, vente partielle, plus-value réalisée", () => {
  const r = replay({ type: "pea" }, [
    op("2026-01-02", "deposit", { amountCents: 100000 }),
    op("2026-01-03", "buy", { asset: "CW8", qty: 2, price: 100, feesCents: 200, amountCents: 20200 }),
    op("2026-01-04", "buy", { asset: "CW8", qty: 2, price: 110, feesCents: 200, amountCents: 22200 }),
    op("2026-02-01", "sell", { asset: "CW8", qty: 1, price: 120, feesCents: 100, amountCents: 11900 }),
  ]);
  const p = r.positions[0];
  assert.equal(p.qty, 3);
  assert.equal(p.cost, 42400 - 10600);
  assert.equal(r.realized, 11900 - 10600);
  assert.equal(r.cash, 100000 - 20200 - 22200 + 11900);
  assert.equal(r.fees, 500);
});

test("identité : plus-value = réalisé + latent + revenus − frais − impôts", () => {
  const r = replay({ type: "cto" }, [
    op("2026-01-02", "deposit", { amountCents: 50000 }),
    op("2026-01-03", "buy", { asset: "AAPL", qty: 3, amountCents: 30000 }),
    op("2026-03-01", "dividend", { amountCents: 450, feesCents: 150 }),
    op("2026-03-02", "fee", { amountCents: 300 }),
    op("2026-04-01", "sell", { asset: "AAPL", qty: 1, amountCents: 12000 }),
    op("2026-04-02", "withdrawal", { amountCents: 5000 }),
  ]);
  const v = value(r, { AAPL: 130 });
  assert.equal(v.gain, r.realized + v.unrealized + r.income - r.fees - r.taxes);
});

test("vente supérieure à la quantité détenue refusée", () => {
  assert.throws(() => replay({ type: "cto" }, [op("2026-01-01", "sell", { asset: "BTC", qty: 1, amountCents: 100 })]), PortfolioError);
});

test("liquidités négatives refusées sur un PEA, acceptées sur un compte-titres", () => {
  const ops = [op("2026-01-03", "buy", { asset: "CW8", qty: 1, amountCents: 10000 })];
  assert.throws(() => replay({ type: "pea" }, ops), /liquidités/);
  assert.equal(replay({ type: "cto" }, ops).cash, -10000);
});

test("achat et vente le même jour : l'ordre de saisie ne compte pas", () => {
  const r = replay({ type: "crypto" }, [
    op("2026-05-01", "sell", { asset: "ETH", qty: 1, amountCents: 300000, createdAt: "a" }),
    op("2026-05-01", "buy", { asset: "ETH", qty: 1, amountCents: 290000, createdAt: "b" }),
  ]);
  assert.equal(r.realized, 10000);
  assert.equal(r.trades.length, 1);
});

test("trades : une position fermée en plusieurs ventes compte pour un trade", () => {
  const r = replay({ type: "cto" }, [
    op("2026-01-01", "buy", { asset: "X", qty: 3, amountCents: 3000 }),
    op("2026-01-02", "sell", { asset: "X", qty: 1, amountCents: 1500 }),
    op("2026-01-03", "sell", { asset: "X", qty: 2, amountCents: 2500 }),
    op("2026-01-04", "trade", { asset: "DAX", side: "short", amountCents: -2500 }),
  ]);
  const s = tradingStats(r.trades);
  assert.equal(s.count, 2);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.pnl, 1000 - 2500);
});

test("division : la quantité change, pas le coût", () => {
  const r = replay({ type: "cto" }, [
    op("2026-01-01", "buy", { asset: "NVDA", qty: 1, amountCents: 100000 }),
    op("2026-06-10", "split", { asset: "NVDA", ratio: 10 }),
  ]);
  assert.equal(r.positions[0].qty, 10);
  assert.equal(r.positions[0].cost, 100000);
});

test("reprise : position et versements antérieurs", () => {
  const acc = { type: "pea", initialContributionsCents: 1000000 };
  const r = replay(acc, [op("2026-01-01", "initial", { asset: "CW8", qty: 10, amountCents: 900000 }), op("2026-01-01", "initial", { amountCents: 100000 })]);
  assert.equal(r.cash, 100000);
  assert.equal(r.contributions, 1000000);
  const s = peaStatus({ type: "pea", fiscalDate: "2021-03-15" }, r, "2026-10-23");
  assert.equal(s.milestone, "2026-03-15");
  assert.equal(s.mature, true);
  assert.equal(s.room, 15000000 - 1000000);
});

test("suivi en valeur : dernier relevé et versements postérieurs, historique détaillé ignoré, plafond inchangé", () => {
  const acc = { type: "pea", tracking: "value", initialContributionsCents: 100000 };
  const r = replay(acc, [
    op("2026-01-05", "deposit", { amountCents: 50000 }),
    op("2026-01-05", "buy", { asset: "CW8", qty: 1, amountCents: 50000 }),
    op("2026-01-31", "valuation", { amountCents: 160000 }),
    op("2026-02-05", "deposit", { amountCents: 20000 }),
  ]);
  assert.equal(r.cash, 180000);
  assert.equal(r.valuedOn, "2026-01-31");
  assert.equal(r.positions.length, 0);
  const v = value(r);
  assert.deepEqual([v.total, v.cash, v.gain, v.estimated], [180000, 0, 10000, false]);
  assert.equal(peaStatus(acc, r, "2026-03-01").paid, 170000);
});

test("suivi en valeur : estimée au versé sans relevé ; relevé du jour pris après le versement du jour", () => {
  const r = replay({ type: "pea", tracking: "value" }, [op("2026-01-05", "deposit", { amountCents: 10000 })]);
  assert.deepEqual([r.cash, r.estimated], [10000, true]);
  const same = replay({ type: "pea", tracking: "value" }, [op("2026-02-01", "valuation", { amountCents: 30000 }), op("2026-02-01", "deposit", { amountCents: 5000 })]);
  assert.equal(same.cash, 30000);
});

test("suivi en valeur : un retrait au-delà de la valeur relevée avertit sans bloquer", () => {
  const r = replay({ type: "pea", tracking: "value" }, [op("2026-01-01", "deposit", { amountCents: 10000 }), op("2026-01-02", "valuation", { amountCents: 9000 }), op("2026-01-03", "withdrawal", { amountCents: 9500 })]);
  assert.equal(r.cash, -500);
  assert.equal(r.warnings.length, 1);
});

test("suivi détaillé : les relevés de valeur sont ignorés", () => {
  const r = replay({ type: "cto" }, [op("2026-01-01", "deposit", { amountCents: 10000 }), op("2026-01-02", "valuation", { amountCents: 99999 })]);
  assert.equal(value(r).total, 10000);
});

test("aperçu : un brouillon daté du jour (createdAt 9999) passe après les opérations enregistrées le même jour", () => {
  const saved = op("2026-11-24", "valuation", { amountCents: 100, createdAt: "2026-11-24 10:00:00" });
  const draft = op("2026-11-24", "valuation", { amountCents: 200, createdAt: "9999" });
  assert.equal(replay({ type: "pea", tracking: "value" }, [draft, saved]).cash, 200);
});
