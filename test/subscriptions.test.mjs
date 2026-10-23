import { test } from "node:test";
import assert from "node:assert/strict";
import { mrr, mrrHistory, status, upcoming, fixedCosts } from "../public/js/lib/subscriptions.js";

const sub = (id, extra) => ({ id, type: "in", kind: "subscription", amount: 10, freq: "monthly", interval: 1, startDate: "2026-01-01", trialEnd: null, endDate: null, nextDate: "2026-11-01", anchorDay: 1, ...extra });

test("MRR : annuel ramené au mois, essai et résilié exclus", () => {
  const subs = [sub("a"), sub("b", { amount: 120, freq: "yearly" }), sub("c", { trialEnd: "2026-12-01" }), sub("d", { endDate: "2026-10-01" }), sub("e", { type: "out" })];
  const m = mrr(subs, "2026-10-23");
  assert.equal(m.count, 2);
  assert.equal(m.mrr, 20);
  assert.equal(m.arr, 240);
});

test("historique : la somme des mouvements vaut la variation du MRR", () => {
  const subs = [sub("a"), sub("b", { startDate: "2026-03-10" }), sub("c", { endDate: "2026-04-15" }), sub("d", { amount: 20 })];
  const txs = [{ recurringId: "d", date: "2026-02-01", amount: 15 }, { recurringId: "d", date: "2026-05-01", amount: 20 }];
  const h = mrrHistory(subs, txs, ["2026-02", "2026-03", "2026-04", "2026-05"], "2026-10-23");
  for (let i = 1; i < h.length; i++) {
    const net = h[i].added - h[i].churned + h[i].expansion - h[i].contraction;
    assert.ok(Math.abs(net - (h[i].mrr - h[i - 1].mrr)) < 1e-9, h[i].month);
  }
  assert.equal(h[1].newCount, 1);
  assert.equal(h[2].churnCount, 1);
  assert.equal(h[3].expansion, 5);
});

test("statuts", () => {
  assert.equal(status(sub("a", { endDate: "2026-10-01" }), "2026-10-23"), "ended");
  assert.equal(status(sub("a", { endDate: "2026-12-01" }), "2026-10-23"), "ending");
  assert.equal(status(sub("a", { trialEnd: "2026-11-01" }), "2026-10-23"), "trial");
  assert.equal(status(sub("a", { startDate: "2026-11-05" }), "2026-10-23"), "upcoming");
});

test("à venir : retards, en attente et paiements projetés jusqu'à la fin exclue", () => {
  const subs = [sub("a", { nextDate: "2026-11-01", endDate: "2027-01-01" })];
  const txs = [{ id: "t1", status: "pending", type: "in", amount: 50, date: "2026-10-01" }, { id: "t2", status: "pending", type: "in", amount: 70, date: "2026-11-15" }];
  const u = upcoming(subs, txs, "2026-10-23", "2027-03-01");
  assert.deepEqual(u.map((x) => x.date), ["2026-10-01", "2026-11-01", "2026-11-15", "2026-12-01"]);
  assert.equal(u[0].overdue, true);
});

test("charges fixes", () => {
  const f = fixedCosts([sub("x", { type: "out", amount: 30, freq: "monthly", interval: 3 }), sub("y", { type: "out", amount: 12 })], "2026-10-23");
  assert.equal(f.monthly, 22);
});
