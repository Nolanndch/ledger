// Test de bout en bout de l'API sur une base temporaire.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-api-"));
const PORT = 4890 + Math.floor(Math.random() * 50);
let proc;
const api = async (method, url, body) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/${url}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data };
};
const state = async () => (await api("GET", "state")).data;
const today = new Date().toLocaleDateString("sv-SE");
const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toLocaleDateString("sv-SE"); };

before(async () => {
  // Base 1.0 importée depuis le fichier de démo (contient des investissements « invest » à migrer)
  const imp = spawn(process.execPath, [path.join(ROOT, "server.mjs"), "--import", path.join(ROOT, "test/fixtures/ledger-v1.json")], { env: { ...process.env, LEDGER_DATA_DIR: DIR } });
  await new Promise((r) => imp.on("exit", r));
  proc = spawn(process.execPath, [path.join(ROOT, "server.mjs"), "--port", String(PORT)], { env: { ...process.env, LEDGER_DATA_DIR: DIR }, stdio: "pipe" });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/ping`); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
after(() => { proc?.kill(); fs.rmSync(DIR, { recursive: true, force: true }); });

test("import 1.0 : investissements migrés en comptes, trésorerie intacte", async () => {
  const s = await state();
  assert.equal(s.info.schemaVersion, 2);
  assert.ok(s.accounts.length >= 1);
  const transfers = s.transactions.filter((t) => t.kind === "transfer");
  assert.equal(transfers.length, 4);
  assert.ok(transfers.every((t) => t.invOpId));
  assert.ok(s.operations.some((o) => o.type === "buy" && o.asset === "BTC"));
});

let subId;
test("abonnement : paiements passés créés, résiliation, réactivation", async () => {
  const r = await api("POST", "recurring", { name: "Client Pro", type: "in", amount: 29, freq: "monthly", interval: 1, startDate: shift(-65), counterparty: "ACME" });
  assert.equal(r.status, 201);
  subId = r.data.id;
  assert.ok(r.data.created >= 2 && r.data.created <= 3);
  let s = await state();
  assert.equal(s.transactions.filter((t) => t.recurringId === subId).length, r.data.created);
  assert.ok(s.transactions.filter((t) => t.recurringId === subId).every((t) => t.nature === "subscription" && t.counterparty === "ACME"));
  const again = await state(); // idempotent
  assert.equal(again.transactions.filter((t) => t.recurringId === subId).length, r.data.created);
  const del = await api("DELETE", `recurring/${subId}`);
  assert.equal(del.status, 409);
  const c = await api("POST", `recurring/${subId}/cancel`, { endDate: today });
  assert.equal(c.data.recurring.endDate, today);
  const re = await api("POST", `recurring/${subId}/reactivate`);
  assert.equal(re.data.endDate, null);
  assert.ok(re.data.nextDate > today);
});

test("abonnement sans rattrapage des paiements passés", async () => {
  const r = await api("POST", "recurring", { name: "Outil", type: "out", amount: 12, freq: "monthly", startDate: shift(-100), catchUp: false });
  assert.equal(r.data.created, 0);
  assert.ok(r.data.nextDate >= today);
});

test("paiement en plusieurs fois, suppression des échéances restantes, annulation", async () => {
  const r = await api("POST", "installments", { type: "in", desc: "Site vitrine", counterparty: "Café", rows: [{ date: today, amount: 300 }, { date: shift(31), amount: 700 }] });
  assert.equal(r.status, 201);
  assert.equal(r.data[0].status, "paid");
  assert.equal(r.data[1].status, "pending");
  assert.equal(r.data[1].installmentIndex, 2);
  const d = await api("DELETE", `installments/${r.data[0].installmentGroup}?from=1`);
  assert.equal(d.data.deleted.length, 1);
  const back = await api("POST", "transactions/bulk", { rows: d.data.deleted });
  assert.equal(back.data[0].installmentGroup, r.data[0].installmentGroup);
});

test("remboursement plafonné au montant payé", async () => {
  const t = (await api("POST", "transactions", { type: "in", amount: 100, date: today, desc: "Vente" })).data;
  assert.equal((await api("POST", `transactions/${t.id}/refund`, { amount: 150 })).status, 400);
  const r = await api("POST", `transactions/${t.id}/refund`, { amount: 40 });
  assert.equal(r.data.kind, "refund");
  assert.equal(r.data.type, "out");
  assert.equal(r.data.refundOf, t.id);
  assert.equal((await api("POST", "transactions", { type: "out", amount: 5, date: today, kind: "transfer" })).status, 400);
});

test("PEA : versement relié à la trésorerie, contrôles, cascade", async () => {
  const s0 = await state();
  const dom = s0.domains[0].id;
  const acc = (await api("POST", "accounts", { type: "pea", broker: "Boursorama", domainId: dom })).data;
  assert.equal(acc.name, "PEA Boursorama");
  const buyFirst = await api("POST", "operations", { accountId: acc.id, date: today, type: "buy", asset: "cw8", qty: 1, price: 500, amountCents: 50000 });
  assert.equal(buyFirst.status, 400);
  assert.match(buyFirst.data.error, /liquidités/);
  const dep = (await api("POST", "operations", { accountId: acc.id, date: today, type: "deposit", amountCents: 100000 })).data;
  let s = await state();
  const tr = s.transactions.find((t) => t.invOpId === dep.id);
  assert.equal(tr.kind, "transfer");
  assert.equal(tr.amount, 1000);
  assert.equal(tr.domainId, dom);
  assert.equal((await api("PUT", `transactions/${tr.id}`, { amount: 1 })).status, 409);
  const buy = await api("POST", "operations", { accountId: acc.id, date: today, type: "buy", asset: "cw8", qty: 2, price: 400, feesCents: 100, amountCents: 80100 });
  assert.equal(buy.status, 201);
  assert.equal(buy.data.asset, "CW8");
  assert.equal((await api("POST", "operations", { accountId: acc.id, date: today, type: "sell", asset: "CW8", qty: 3, amountCents: 1 })).status, 400);
  assert.equal((await api("DELETE", `operations/${dep.id}`)).status, 400); // le PEA passerait en négatif
  await api("PUT", `operations/${dep.id}`, { amountCents: 120000 });
  s = await state();
  assert.equal(s.transactions.find((t) => t.invOpId === dep.id).amount, 1200);
  assert.equal((await api("DELETE", `accounts/${acc.id}`)).status, 409);
  const p = await api("DELETE", `accounts/${acc.id}?purge=1`);
  assert.equal(p.status, 200);
  s = await state();
  assert.ok(!s.transactions.some((t) => t.invOpId === dep.id));
});

test("trade clôturé et clôture de compte", async () => {
  const acc = (await api("POST", "accounts", { type: "cto", name: "IBKR" })).data;
  await api("POST", "operations", { accountId: acc.id, date: today, type: "deposit", amountCents: 50000, link: false });
  const t = await api("POST", "operations", { accountId: acc.id, date: today, type: "trade", asset: "DAX", side: "short", amountCents: -12000 });
  assert.equal(t.status, 201);
  const c = await api("POST", `accounts/${acc.id}/close`, { date: today, link: false });
  assert.equal(c.data.closedOn, today);
  const ops = (await state()).operations.filter((o) => o.accountId === acc.id);
  assert.equal(ops.find((o) => o.type === "withdrawal").amountCents, 38000);
});

test("réglages validés", async () => {
  assert.equal((await api("PUT", "settings", { showCents: false, density: "compact" })).data.showCents, false);
  assert.equal((await api("PUT", "settings", { nope: 1 })).status, 400);
  assert.equal((await api("PUT", "settings", { density: "énorme" })).status, 400);
});

test("export puis réimport : mêmes données", async () => {
  const a = (await api("GET", "export")).data;
  const exp = typeof a === "string" ? JSON.parse(a) : a;
  const imp = await api("POST", "import", exp);
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  const b = (await api("GET", "export")).data;
  const exp2 = typeof b === "string" ? JSON.parse(b) : b;
  for (const k of ["domains", "categories", "transactions", "recurring", "objectives", "accounts", "operations", "assets", "settings"]) {
    assert.deepEqual(exp2[k], exp[k], k);
  }
});

test("import invalide : rien n'est modifié", async () => {
  const before = (await state()).transactions.length;
  const r = await api("POST", "import", { domains: [], transactions: [{ type: "in", amount: 10, date: "pas une date" }] });
  assert.equal(r.status, 400);
  assert.equal((await state()).transactions.length, before);
});

test("restauration d'une sauvegarde 1.0 conservée", async () => {
  const s = await state();
  const kept = s.info.backups.find((b) => b.kept);
  assert.ok(kept, "sauvegarde avant migration");
  const r = await api("POST", `backups/${kept.name}/restore`);
  assert.equal(r.status, 200);
  const after = await state();
  assert.equal(after.info.schemaVersion, 2);
  assert.ok(after.accounts.length >= 1);
});
