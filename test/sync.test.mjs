// Synchro entre deux serveurs (un hôte, un client) sur des bases temporaires.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const base = 5100 + Math.floor(Math.random() * 300);
const SYNC_PORT = base + 500;
const nodes = { host: { port: base }, phone: { port: base + 1 } };
const today = new Date().toLocaleDateString("sv-SE");
const monthsAgo = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return d.toLocaleDateString("sv-SE"); };

const call = (node) => async (method, url, body) => {
  const res = await fetch(`http://127.0.0.1:${node.port}/api/${url}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
};
const H = call(nodes.host), P = call(nodes.phone);
const state = async (api) => (await api("GET", "state")).data;
const syncPhone = async () => { const r = await P("POST", "sync/now"); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.result; };
const txIds = (s) => s.transactions.map((t) => `${t.id}|${t.amount}|${t.desc}|${t.status}|${t.domainId}`).sort();

before(async () => {
  for (const node of Object.values(nodes)) {
    node.dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-sync-"));
    node.proc = spawn(process.execPath, [path.join(ROOT, "server.mjs"), "--port", String(node.port)],
      { env: { ...process.env, LEDGER_DATA_DIR: node.dir, LEDGER_SYNC_PORT: String(SYNC_PORT) }, stdio: "pipe" });
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${node.port}/api/ping`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  }
});
after(() => { for (const n of Object.values(nodes)) { n.proc?.kill(); fs.rmSync(n.dir, { recursive: true, force: true }); } });

let code, domainId;
test("jumelage : le téléphone reprend les données du Mac", async () => {
  const dom = (await H("POST", "domains", { name: "Studio" })).data;
  domainId = dom.id;
  await H("POST", "transactions", { type: "in", amount: 1200, desc: "Site vitrine", domainId: dom.id, date: today, status: "paid" });
  await H("POST", "recurring", { name: "Figma", type: "out", amount: 15, freq: "monthly", domainId: dom.id, startDate: monthsAgo(3), kind: "subscription" });
  await P("POST", "transactions", { type: "out", amount: 5, desc: "Brouillon téléphone", date: today, status: "paid" });

  const host = await H("POST", "sync/host");
  assert.equal(host.status, 200);
  code = host.data.code;
  assert.match(code, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);

  const bad = await P("POST", "sync/join", { url: `127.0.0.1:${SYNC_PORT}`, code: "AAAA-AAAA-AAAA-AAAA-AAAA", replace: true });
  assert.equal(bad.status, 401);
  assert.equal((await P("GET", "sync")).data.role, null);

  const join = await P("POST", "sync/join", { url: `127.0.0.1:${SYNC_PORT}`, code: code.toLowerCase(), replace: true });
  assert.equal(join.status, 200, JSON.stringify(join.data));
  assert.equal(join.data.role, "client");
  const [h, p] = [await state(H), await state(P)];
  assert.deepEqual(txIds(p), txIds(h));
  assert.ok(!p.transactions.some((t) => t.desc === "Brouillon téléphone"));
  assert.equal(p.recurring.length, 1);
  assert.ok(h.transactions.filter((t) => t.recurringId).length >= 3, "paiements d'abonnement créés");
  assert.equal((await H("GET", "sync")).data.clients.length, 1);
});

test("changements des deux côtés, sans doublon de paiements automatiques", async () => {
  const s = await state(P);
  const site = s.transactions.find((t) => t.desc === "Site vitrine");
  await P("PUT", `transactions/${site.id}`, { ...site, amount: 1500 });
  await P("POST", "transactions", { type: "out", amount: 42, desc: "Café client", date: today, status: "paid", domainId });
  await H("POST", "categories", { name: "Logiciels", color: "#8ea3b9" });
  await H("PUT", "settings", { showCents: false });
  const r = await syncPhone();
  assert.equal(r.sent, 2);
  const [h, p] = [await state(H), await state(P)];
  assert.deepEqual(txIds(p), txIds(h));
  assert.equal(h.transactions.find((t) => t.id === site.id).amount, 1500);
  assert.equal(p.categories.length, 1);
  assert.equal(p.settings.showCents, false);
  const recIds = (x) => x.transactions.filter((t) => t.recurringId).map((t) => t.id).sort();
  assert.deepEqual(recIds(p), recIds(h));
  assert.equal(new Set(h.transactions.filter((t) => t.recurringId).map((t) => t.date)).size, recIds(h).length);
});

test("même ligne modifiée des deux côtés : la plus récente gagne ; suppression propagée", async () => {
  const { transactions } = await state(H);
  const cafe = transactions.find((t) => t.desc === "Café client");
  await H("PUT", `transactions/${cafe.id}`, { ...cafe, desc: "Café (Mac)" });
  await new Promise((r) => setTimeout(r, 5));
  await P("PUT", `transactions/${cafe.id}`, { ...cafe, desc: "Café (téléphone)" });
  const site = transactions.find((t) => t.desc === "Site vitrine");
  await H("DELETE", `transactions/${site.id}`);
  await syncPhone();
  const [h, p] = [await state(H), await state(P)];
  assert.deepEqual(txIds(p), txIds(h));
  assert.equal(h.transactions.find((t) => t.id === cafe.id).desc, "Café (téléphone)");
  assert.ok(!p.transactions.some((t) => t.id === site.id));
});

test("paiement automatique modifié à la main : la modification n'est pas écrasée", async () => {
  const pay = (await state(P)).transactions.find((t) => t.recurringId);
  await P("PUT", `transactions/${pay.id}`, { ...pay, amount: 17.5 });
  await syncPhone();
  await syncPhone();
  assert.equal((await state(H)).transactions.find((t) => t.id === pay.id).amount, 17.5);
  assert.equal((await state(P)).transactions.find((t) => t.id === pay.id).amount, 17.5);
});

test("restauration sur l'hôte : la version restaurée l'emporte, la synchro continue", async () => {
  const before = await state(H);
  await H("POST", "backups");
  const name = (await H("GET", "backups")).data[0].name;
  await H("POST", "transactions", { type: "in", amount: 9, desc: "Après sauvegarde", date: today, status: "paid" });
  await syncPhone();
  assert.ok((await state(P)).transactions.some((t) => t.desc === "Après sauvegarde"));
  const restored = await H("POST", `backups/${encodeURIComponent(name)}/restore`);
  assert.equal(restored.status, 200);
  await syncPhone();
  const [h, p] = [await state(H), await state(P)];
  assert.deepEqual(txIds(p), txIds(h));
  assert.equal(h.transactions.length, before.transactions.length + 1, "la ligne absente de la sauvegarde revient depuis le téléphone");
});

test("arrêt du jumelage", async () => {
  assert.equal((await P("POST", "sync/stop")).data.role, null);
  assert.equal((await P("POST", "sync/now")).status, 400);
  assert.equal((await H("POST", "sync/stop")).data.role, null);
});
