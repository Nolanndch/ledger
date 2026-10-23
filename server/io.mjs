// État envoyé à l'interface, export et import JSON, exports CSV.
// Un import passe par une base temporaire construite au bon schéma, puis remplace la base d'un bloc :
// un fichier 1.0 suit exactement la même migration que la base de l'application.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { all, get, need, HttpError, euros, isDate, schemaVersion, DATA_DIR, DB_PATH, BACKUP_DIR, LATEST_SCHEMA } from "./db.mjs";
import { MIGRATIONS } from "./schema.mjs";
import { out as L, getSettings, SETTINGS } from "./ledger.mjs";
import { out as I } from "./invest.mjs";
import { listBackups, replaceDatabase } from "./backup.mjs";
import { ACCOUNT_TYPES, OP_TYPES } from "../public/js/lib/portfolio.js";

const COUNTED = ["transactions", "domains", "categories", "recurring", "objectives", "inv_accounts", "inv_operations"];

export function info(version) {
  const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  const counts = Object.fromEntries(COUNTED.map((t) => [t, get(`SELECT COUNT(*) n FROM ${t}`).n]));
  return {
    app: "ledger", version, schemaVersion: schemaVersion(), dbPath: DB_PATH, dataDir: DATA_DIR, backupDir: BACKUP_DIR,
    size: size(DB_PATH) + size(DB_PATH + "-wal"), lastBackup: get("SELECT value FROM meta WHERE key = 'last_backup'")?.value || null,
    counts: { ...counts, accounts: counts.inv_accounts, operations: counts.inv_operations }, backups: listBackups(),
  };
}

function collections() {
  return {
    domains: all("SELECT * FROM domains ORDER BY position").map(L.domains),
    categories: all("SELECT * FROM categories ORDER BY name, id").map(L.categories),
    transactions: all("SELECT * FROM transactions ORDER BY date DESC, created_at DESC, id DESC").map(L.transactions),
    recurring: all("SELECT * FROM recurring ORDER BY next_date, id").map(L.recurring),
    objectives: all("SELECT * FROM objectives ORDER BY id").map(L.objectives),
    accounts: all("SELECT * FROM inv_accounts ORDER BY position, created_at, id").map(I.accounts),
    operations: all("SELECT * FROM inv_operations ORDER BY date, created_at, id").map(I.operations),
    assets: all("SELECT * FROM asset_prices ORDER BY asset").map(I.assets),
  };
}

export const getState = (version) => ({ ...collections(), settings: getSettings(), info: info(version) });
export const exportState = () => ({ app: "ledger", version: 4, schemaVersion: LATEST_SCHEMA, exportedAt: new Date().toISOString(), ...collections(), settings: getSettings() });

// ---------- import ----------
const ID = (v) => typeof v === "string" && v.length > 0 && v.length <= 64;
const cents = (v) => Math.round(Math.abs(Number(v)) * 100);

function buildTempDb() {
  const file = path.join(DATA_DIR, `import-${process.pid}-${Date.now()}.db`);
  const conn = new DatabaseSync(file);
  conn.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  return { file, conn };
}
const insertRow = (conn, table, row) => {
  const keys = Object.keys(row);
  conn.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k] ?? null));
};

// Fichier 1.0 (avec ou sans numéro de version) : écrit au schéma 1 ; la migration fera le reste.
function importV3(data, conn, errors) {
  MIGRATIONS[0]({ db: conn });
  const domains = new Set(), cats = new Set(), recs = new Set();
  data.domains.forEach((d, i) => {
    const id = ID(d.id) ? d.id : `d${i}`;
    domains.add(id);
    insertRow(conn, "domains", { id, name: String(d.name || "Sans nom").slice(0, 80), color: d.color || "#8ea3b9", active: d.active === false ? 0 : 1, position: Number.isFinite(d.position) ? d.position : Number.isFinite(d.order) ? d.order : i });
  });
  (data.categories || []).forEach((c, i) => { const id = ID(c.id) ? c.id : `c${i}`; cats.add(id); insertRow(conn, "categories", { id, name: String(c.name || "Sans nom").slice(0, 80), color: c.color || "#8ea3b9" }); });
  (data.recurring || []).forEach((r, i) => {
    if (!r.name || !(Number(r.amount) > 0) || !["daily", "weekly", "monthly", "yearly"].includes(r.freq)) { errors.push(`Récurrence n°${i + 1} : incomplète.`); return; }
    const id = ID(r.id) ? r.id : `r${i}`; recs.add(id);
    const next = isDate(r.nextDate) ? r.nextDate : new Date().toLocaleDateString("sv-SE");
    insertRow(conn, "recurring", { id, name: r.name, type: r.type === "in" ? "in" : "out", amount_cents: cents(r.amount), freq: r.freq, domain_id: domains.has(r.domainId) ? r.domainId : null, category_id: cats.has(r.categoryId) ? r.categoryId : null, next_date: next, status: r.status === "pending" ? "pending" : "paid", active: r.active === false ? 0 : 1, anchor_day: r.anchorDay || Number(next.slice(8)) });
  });
  data.transactions.forEach((t, i) => {
    if (!isDate(t.date)) { errors.push(`Mouvement n°${i + 1} : date invalide.`); return; }
    if (!(Number(t.amount) > 0)) { errors.push(`Mouvement n°${i + 1} : montant invalide.`); return; }
    const invest = t.kind === "invest";
    insertRow(conn, "transactions", {
      id: ID(t.id) ? t.id : `t${i}`, type: t.type === "out" ? "out" : "in", amount_cents: cents(t.amount),
      domain_id: domains.has(t.domainId) ? t.domainId : null, category_id: cats.has(t.categoryId) ? t.categoryId : null,
      description: String(t.desc ?? t.description ?? "").slice(0, 500), date: t.date, status: t.status === "pending" ? "pending" : "paid",
      kind: invest ? "invest" : "cash", asset: invest ? String(t.asset || "").toUpperCase() : "", qty: invest ? Number(t.qty) || 0 : 0,
      unit_price: invest ? Number(t.pricePerUnit) || 0 : 0, recurring_id: recs.has(t.recurringId) ? t.recurringId : null,
      created_at: t.createdAt || `${t.date} 00:00:${String(i % 60).padStart(2, "0")}`,
    });
  });
  (data.objectives || []).forEach((o, i) => { if (Number(o.target) > 0) insertRow(conn, "objectives", { id: ID(o.id) ? o.id : `o${i}`, name: String(o.name || "Objectif"), target_cents: cents(o.target), domain_id: domains.has(o.domainId) ? o.domainId : null, deadline: isDate(o.deadline) ? o.deadline : null }); });
  for (const [asset, price] of Object.entries(data.assetPrices || {})) insertRow(conn, "asset_prices", { asset: asset.toUpperCase(), price: Number(price) || 0 });
  conn.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '1')").run();
}

// Fichier 1.1 : écrit directement au dernier schéma.
function importV4(data, conn, errors) {
  for (const m of MIGRATIONS) m({ db: conn, all: (s, ...p) => conn.prepare(s).all(...p), get: (s, ...p) => conn.prepare(s).get(...p), run: (s, ...p) => conn.prepare(s).run(...p), uid: () => Math.random().toString(36).slice(2), fresh: true });
  conn.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(LATEST_SCHEMA));
  const c = (v) => Math.round(Number(v) * 100);
  const ids = (list) => new Set((list || []).map((x) => x.id));
  const dom = ids(data.domains), cat = ids(data.categories), rec = ids(data.recurring), acc = ids(data.accounts), ops = ids(data.operations);
  (data.domains || []).forEach((d) => insertRow(conn, "domains", { id: d.id, name: d.name, color: d.color, active: d.active === false ? 0 : 1, position: d.position || 0, opening_cents: c(d.openingBalance || 0), opening_date: d.openingDate || null }));
  (data.categories || []).forEach((x) => insertRow(conn, "categories", { id: x.id, name: x.name, color: x.color }));
  (data.recurring || []).forEach((r, i) => {
    if (!isDate(r.startDate) || !isDate(r.nextDate)) { errors.push(`Abonnement n°${i + 1} : dates invalides.`); return; }
    insertRow(conn, "recurring", { id: r.id, name: r.name, type: r.type, kind: r.kind || "subscription", amount_cents: c(r.amount), freq: r.freq, interval: r.interval || 1, domain_id: dom.has(r.domainId) ? r.domainId : null, category_id: cat.has(r.categoryId) ? r.categoryId : null, counterparty: r.counterparty || "", plan: r.plan || "", notes: r.notes || "", start_date: r.startDate, trial_end: r.trialEnd || null, end_date: r.endDate || null, next_date: r.nextDate, anchor_day: r.anchorDay || 1, status: r.status || "paid", active: 1, amount_variable: r.amountVariable ? 1 : 0, created_at: r.createdAt || r.startDate });
  });
  (data.accounts || []).forEach((a, i) => {
    if (!ACCOUNT_TYPES[a.type]) { errors.push(`Compte n°${i + 1} : type inconnu.`); return; }
    insertRow(conn, "inv_accounts", { id: a.id, name: a.name, type: a.type, broker: a.broker || "", fiscal_date: a.fiscalDate || null, ceiling_cents: a.ceilingCents ?? null, initial_contributions_cents: a.initialContributionsCents || 0, domain_id: dom.has(a.domainId) ? a.domainId : null, closed_on: a.closedOn || null, position: a.position || 0, created_at: a.createdAt || "2000-01-01" });
  });
  (data.operations || []).forEach((o, i) => {
    if (!acc.has(o.accountId) || !OP_TYPES[o.type] || !isDate(o.date)) { errors.push(`Opération n°${i + 1} : invalide.`); return; }
    insertRow(conn, "inv_operations", { id: o.id, account_id: o.accountId, date: o.date, type: o.type, asset: o.asset || "", qty: o.qty || 0, price: o.price || 0, fees_cents: o.feesCents || 0, amount_cents: Math.round(o.amountCents || 0), side: o.side || null, ratio: o.ratio ?? null, notes: o.notes || "", created_at: o.createdAt || o.date });
  });
  (data.transactions || []).forEach((t, i) => {
    if (!isDate(t.date) || !(Number(t.amount) >= 0)) { errors.push(`Mouvement n°${i + 1} : invalide.`); return; }
    insertRow(conn, "transactions", { id: t.id, type: t.type, amount_cents: c(t.amount), domain_id: dom.has(t.domainId) ? t.domainId : null, category_id: cat.has(t.categoryId) ? t.categoryId : null, description: t.desc || "", counterparty: t.counterparty || "", notes: t.notes || "", date: t.date, status: t.status === "pending" ? "pending" : "paid", kind: ["cash", "transfer", "refund"].includes(t.kind) ? t.kind : "cash", nature: t.nature || "one_time", recurring_id: rec.has(t.recurringId) ? t.recurringId : null, installment_group: t.installmentGroup || null, installment_index: t.installmentIndex || null, installment_count: t.installmentCount || null, refund_of: t.refundOf || null, inv_op_id: ops.has(t.invOpId) ? t.invOpId : null, created_at: t.createdAt || t.date, updated_at: t.createdAt || t.date });
  });
  (data.objectives || []).forEach((o) => insertRow(conn, "objectives", { id: o.id, name: o.name, target_cents: c(o.target), domain_id: dom.has(o.domainId) ? o.domainId : null, deadline: o.deadline || null, metric: o.metric || "net", account_id: acc.has(o.accountId) ? o.accountId : null }));
  (data.assets || []).forEach((a) => insertRow(conn, "asset_prices", { asset: a.symbol, price: a.price || 0, name: a.name || "", class: a.class || "", updated_at: a.updatedAt || "2000-01-01 00:00:00" }));
  for (const [k, v] of Object.entries(data.settings || {})) if (SETTINGS[k]?.ok(v)) insertRow(conn, "settings", { key: k, value: JSON.stringify(v) });
}

export function importState(data, reopen) {
  need(data && Array.isArray(data.domains) && Array.isArray(data.transactions), "Fichier non reconnu : il faut les listes domains et transactions.");
  const version = Number(data.version) || 3;
  need(version <= 4, "Ce fichier vient d'une version plus récente de Ledger.");
  const { file, conn } = buildTempDb();
  const errors = [];
  try {
    conn.exec("PRAGMA foreign_keys = OFF; BEGIN");
    (version >= 4 ? importV4 : importV3)(data, conn, errors);
    conn.exec("COMMIT");
    const broken = conn.prepare("PRAGMA foreign_key_check").all();
    if (broken.length) errors.push(`${broken.length} lien(s) cassé(s) dans le fichier (${broken[0].table}).`);
  } catch (e) {
    try { conn.exec("ROLLBACK"); } catch { /* pas de transaction */ }
    errors.push(e.message);
  } finally { conn.close(); }
  try {
    if (errors.length) throw new HttpError(400, `Import annulé, rien n'a été modifié : ${errors.slice(0, 5).join(" ")}${errors.length > 5 ? ` (+${errors.length - 5})` : ""}`);
    replaceDatabase(file, "avant-import", reopen);
  } finally { fs.rmSync(file, { force: true }); }
}

// ---------- CSV ----------
const csvLine = (r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";");
const num = (c) => euros(c).toFixed(2).replace(".", ",");
const NATURE = { one_time: "Unique", subscription: "Abonnement", recurring: "Récurrent", installment: "Échéance" };

export function csvTransactions() {
  const domains = Object.fromEntries(all("SELECT id, name FROM domains").map((r) => [r.id, r.name]));
  const cats = Object.fromEntries(all("SELECT id, name FROM categories").map((r) => [r.id, r.name]));
  const rows = [["Date", "Libellé", "Client / fournisseur", "Business", "Catégorie", "Statut", "Type", "Nature", "Montant (EUR)"]];
  for (const t of all("SELECT * FROM transactions ORDER BY date, created_at")) {
    const nature = t.kind === "transfer" ? "Virement placement" : t.kind === "refund" ? "Remboursement"
      : t.nature === "installment" ? `Échéance ${t.installment_index}/${t.installment_count}` : NATURE[t.nature];
    rows.push([t.date, t.description, t.counterparty, domains[t.domain_id] || "", cats[t.category_id] || "", t.status === "pending" ? "En attente" : "Payé",
      t.type === "in" ? "Entrée" : "Sortie", nature, (t.type === "in" ? "" : "-") + num(t.amount_cents)]);
  }
  return "﻿" + rows.map(csvLine).join("\n");
}

export function csvOperations() {
  const accounts = Object.fromEntries(all("SELECT id, name FROM inv_accounts").map((r) => [r.id, r.name]));
  const rows = [["Date", "Compte", "Opération", "Actif", "Quantité", "Prix unitaire", "Frais (EUR)", "Montant (EUR)", "Notes"]];
  for (const o of all("SELECT * FROM inv_operations ORDER BY date, created_at")) {
    rows.push([o.date, accounts[o.account_id] || "", OP_TYPES[o.type], o.asset, o.qty ? String(o.qty).replace(".", ",") : "", o.price ? String(o.price).replace(".", ",") : "", num(o.fees_cents), num(o.amount_cents), o.notes]);
  }
  return "﻿" + rows.map(csvLine).join("\n");
}
