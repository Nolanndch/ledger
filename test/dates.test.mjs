// Tests du calcul des échéances : node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { addPeriod, occurrences, endAfter, firstOnOrAfter, monthlyFactor } from "../public/js/dates.js";

const chain = (start, freq, anchor, interval, n) => {
  const out = [start];
  for (let i = 0; i < n; i++) out.push(addPeriod(out.at(-1), freq, anchor, interval));
  return out;
};

test("trimestriel ancré au 31", () => {
  assert.deepEqual(chain("2026-01-31", "monthly", 31, 3, 4), ["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31", "2027-01-31"]);
});
test("mensuel ancré au 31 traverse février", () => {
  assert.deepEqual(chain("2026-01-31", "monthly", 31, 1, 2), ["2026-01-31", "2026-02-28", "2026-03-31"]);
});
test("annuel un 29 février", () => {
  assert.deepEqual(chain("2028-02-29", "yearly", 29, 1, 4), ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
});
test("hebdomadaire et toutes les 2 semaines", () => {
  assert.equal(addPeriod("2026-12-28", "weekly", 28, 1), "2027-01-04");
  assert.equal(addPeriod("2026-12-28", "weekly", 28, 2), "2027-01-11");
});
test("décembre vers janvier", () => {
  assert.equal(addPeriod("2026-12-15", "monthly", 15, 1), "2027-01-15");
  assert.equal(addPeriod("2026-11-30", "monthly", 30, 3), "2027-02-28");
});
test("occurrences s'arrêtent avant la fin (exclue)", () => {
  assert.deepEqual(occurrences({ start: "2026-01-10", freq: "monthly", interval: 1, end: "2026-04-10" }, "2026-01-01", "2026-12-31"), ["2026-01-10", "2026-02-10", "2026-03-10"]);
});
test("fin calculée pour N paiements", () => {
  assert.equal(endAfter({ start: "2026-01-31", freq: "monthly", interval: 1 }, 3), "2026-04-30");
});
test("reprise à la première échéance future", () => {
  assert.equal(firstOnOrAfter({ start: "2026-01-31", freq: "monthly", interval: 1 }, "2026-03-01"), "2026-03-31");
});
test("facteurs mensuels", () => {
  assert.equal(monthlyFactor("monthly", 3), 1 / 3);
  assert.equal(monthlyFactor("yearly", 1), 1 / 12);
  assert.ok(Math.abs(monthlyFactor("weekly", 1) * 12 * 7 - 365.25) < 1e-9);
});
