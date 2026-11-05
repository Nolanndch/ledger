// Synchronisation directe entre deux appareils sur le même Wi-Fi (le Mac et le téléphone), sans serveur intermédiaire.
//
// Principe :
// - Chaque table synchronisée a des triggers qui notent dans `sync_log` la dernière version de chaque ligne :
//   un horodatage (ms + identifiant de l'appareil auteur), un drapeau « supprimée » et un numéro d'ordre local `seq`.
// - Un appareil « hôte » (le Mac) écoute sur le réseau local ; un appareil « client » (le téléphone) le contacte
//   régulièrement. En un seul aller-retour, le client envoie ses changements et reçoit ceux de l'hôte.
// - En cas de modification des deux côtés, la version la plus récente de la ligne l'emporte.
// - Les échanges sont chiffrés et authentifiés (AES-256-GCM) avec une clé tirée du code de jumelage.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import dgram from "node:dgram";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { all, get, run, tx, need, meta, HttpError, connectHooks, DATA_DIR, LATEST_SCHEMA } from "./db.mjs";
import { backup } from "./backup.mjs";

export const SYNC_PORT = Number(process.env.LEDGER_SYNC_PORT || 4748);
const CONF_PATH = path.join(DATA_DIR, "sync.json");
const CLIENT_EVERY = 30_000;          // synchro automatique du client
const RETRY_AFTER_ERROR = 120_000;    // pause après un échec (hors du Wi-Fi de la maison, par exemple)
const MAX_CLOCK_SKEW = 15 * 60_000;

// Tables synchronisées et leur clé, parents avant enfants.
const TABLES = [["domains", "id"], ["categories", "id"], ["recurring", "id"], ["inv_accounts", "id"], ["inv_operations", "id"],
  ["transactions", "id"], ["objectives", "id"], ["asset_prices", "asset"], ["settings", "key"]];
const PK = Object.fromEntries(TABLES);
const ORDER = Object.fromEntries(TABLES.map(([t], i) => [t, i]));
export const AUTO_STAMP = "000000000000000-auto"; // lignes créées automatiquement à l'identique sur chaque appareil

// ---------- configuration (hors de la base : survit aux imports et restaurations) ----------
let conf = (() => { try { return JSON.parse(fs.readFileSync(CONF_PATH, "utf8")); } catch { return {}; } })();
function save() {
  fs.writeFileSync(CONF_PATH + ".tmp", JSON.stringify(conf, null, 2), { mode: 0o600 });
  fs.renameSync(CONF_PATH + ".tmp", CONF_PATH);
}
if (!conf.deviceId) { conf.deviceId = crypto.randomBytes(6).toString("hex"); save(); }
const computerName = (() => {
  if (process.platform === "android") return "Téléphone";
  if (process.platform === "darwin") { try { return execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim(); } catch {} }
  return os.hostname().split(".")[0];
})();
const deviceName = () => conf.name || computerName;

// ---------- horloge et triggers ----------
let clock = 0;
const observe = (stamp) => { const ms = parseInt(stamp, 10); if (ms > clock) clock = ms; };
function stamp() {
  clock = Math.max(Date.now(), clock + 1);
  return String(clock).padStart(15, "0") + "-" + conf.deviceId;
}
let muted = 0;
// Écritures qui ne doivent pas être notées comme des changements locaux (application d'une synchro, calculs refaits à l'identique partout).
export function quiet(fn) { muted++; try { return fn(); } finally { muted--; } }

connectHooks.push((conn) => {
  conn.function("sync_stamp", { deterministic: false }, () => stamp());
  conn.function("sync_muted", { deterministic: false }, () => (muted ? 1 : 0));
});

const maxSeq = () => get("SELECT COALESCE(MAX(seq), 0) s FROM sync_log").s;
const upsertLog = (t, pk, s, deleted, seq) => run(`INSERT INTO sync_log (tbl, pk, stamp, deleted, seq) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (tbl, pk) DO UPDATE SET stamp = excluded.stamp, deleted = excluded.deleted, seq = excluded.seq`, t, pk, s, deleted, seq);

// Ligne créée automatiquement (paiement d'abonnement) : n'importe quelle modification faite à la main l'emporte sur elle.
export const markAuto = (t, pk) => upsertLog(t, pk, AUTO_STAMP, 0, maxSeq() + 1);
export const wasDeleted = (t, pk) => !!get("SELECT 1 FROM sync_log WHERE tbl = ? AND pk = ? AND deleted = 1", t, pk);

function backfill() {
  let seq = maxSeq();
  for (const [t, pk] of TABLES) {
    for (const r of all(`SELECT ${pk} k FROM ${t} WHERE ${pk} NOT IN (SELECT pk FROM sync_log WHERE tbl = ?)`, t)) upsertLog(t, String(r.k), stamp(), 0, ++seq);
  }
}

// À appeler après chaque ouverture de la base.
export function ensure({ replaced = false } = {}) {
  run(`CREATE TABLE IF NOT EXISTS sync_log (tbl TEXT NOT NULL, pk TEXT NOT NULL, stamp TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, PRIMARY KEY (tbl, pk))`);
  run("CREATE INDEX IF NOT EXISTS sync_log_seq ON sync_log(seq)");
  for (const [t, pk] of TABLES) {
    const log = (ref, del) => `INSERT INTO sync_log (tbl, pk, stamp, deleted, seq) VALUES ('${t}', ${ref}.${pk}, sync_stamp(), ${del}, (SELECT COALESCE(MAX(seq), 0) + 1 FROM sync_log))
      ON CONFLICT (tbl, pk) DO UPDATE SET stamp = excluded.stamp, deleted = excluded.deleted, seq = excluded.seq;`;
    run(`CREATE TRIGGER IF NOT EXISTS sync_${t}_ins AFTER INSERT ON ${t} WHEN sync_muted() = 0 BEGIN ${log("NEW", 0)} END`);
    run(`CREATE TRIGGER IF NOT EXISTS sync_${t}_upd AFTER UPDATE ON ${t} WHEN sync_muted() = 0 BEGIN ${log("NEW", 0)} END`);
    run(`CREATE TRIGGER IF NOT EXISTS sync_${t}_del AFTER DELETE ON ${t} WHEN sync_muted() = 0 BEGIN ${log("OLD", 1)} END`);
  }
  observe(get("SELECT MAX(stamp) s FROM sync_log").s || "0");
  const token = meta.get("sync_token");
  if (replaced || !token || token !== conf.dbToken) {
    // Base nouvelle, importée ou restaurée : son contenu devient la version la plus récente de chaque ligne,
    // et l'historique de synchro repart de zéro (les deux appareils se renvoient tout une fois).
    tx(() => { run("DELETE FROM sync_log"); backfill(); });
    conf.dbToken = crypto.randomBytes(8).toString("hex");
    meta.set("sync_token", conf.dbToken);
    if (conf.client) Object.assign(conf.client, { sentSeq: 0, recvSeq: 0, recvToken: null });
    save();
  } else tx(backfill); // lignes écrites sans trace (ne devrait pas arriver)
}

// ---------- changements ----------
function changesSince(since, exclude) {
  const out = [];
  for (const c of all("SELECT tbl, pk, stamp, deleted FROM sync_log WHERE seq > ? ORDER BY seq", since)) {
    if (!PK[c.tbl] || (exclude && c.stamp.endsWith("-" + exclude))) continue;
    if (c.deleted) { out.push({ t: c.tbl, k: c.pk, s: c.stamp, d: 1 }); continue; }
    const row = get(`SELECT * FROM ${c.tbl} WHERE ${PK[c.tbl]} = ?`, c.pk);
    if (row) out.push({ t: c.tbl, k: c.pk, s: c.stamp, r: { ...row } });
  }
  return out;
}

const columns = new Map();
const knownColumns = (t) => {
  if (!columns.has(t)) columns.set(t, new Set(all(`PRAGMA table_info(${t})`).map((c) => c.name)));
  return columns.get(t);
};

// Lien cassé après une synchro (ex. mouvement reçu dont le business a été supprimé ici) : on applique la règle
// de la clé étrangère comme si le parent venait d'être supprimé (mise à vide, ou suppression en cascade).
function repairLinks() {
  for (let pass = 0; pass < 5; pass++) {
    const broken = all("PRAGMA foreign_key_check");
    if (!broken.length) return;
    for (const b of broken) {
      const fk = all(`PRAGMA foreign_key_list(${b.table})`).filter((f) => f.id === b.fkid);
      if (!fk.length) continue;
      if (fk[0].on_delete === "CASCADE") run(`DELETE FROM ${b.table} WHERE rowid = ?`, b.rowid);
      else for (const f of fk) run(`UPDATE ${b.table} SET ${f.from} = NULL WHERE rowid = ?`, b.rowid);
    }
  }
}

function apply(changes, { wipe = false } = {}) {
  let applied = 0;
  const errors = [];
  const list = (Array.isArray(changes) ? changes : []).filter((c) => c && PK[c.t] && typeof c.k === "string" && typeof c.s === "string");
  // Créations et modifications d'abord (parents avant enfants), puis suppressions (enfants avant parents).
  list.sort((a, b) => (!!a.d - !!b.d) || (a.d ? ORDER[b.t] - ORDER[a.t] : ORDER[a.t] - ORDER[b.t]));
  quiet(() => tx(() => {
    run("PRAGMA defer_foreign_keys = ON");
    if (wipe) { for (const [t] of [...TABLES].reverse()) run(`DELETE FROM ${t}`); run("DELETE FROM sync_log"); }
    let seq = maxSeq();
    for (const c of list) {
      observe(c.s);
      const local = get("SELECT stamp FROM sync_log WHERE tbl = ? AND pk = ?", c.t, c.k);
      if (local && local.stamp >= c.s) continue;
      const pk = PK[c.t];
      run("SAVEPOINT sync_row");
      try {
        if (c.d) run(`DELETE FROM ${c.t} WHERE ${pk} = ?`, c.k);
        else {
          need(c.r && typeof c.r === "object" && String(c.r[pk]) === c.k, "ligne invalide");
          const known = knownColumns(c.t);
          const keys = Object.keys(c.r).filter((k) => known.has(k));
          const rest = keys.filter((k) => k !== pk);
          run(`INSERT INTO ${c.t} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})
            ON CONFLICT (${pk}) DO ${rest.length ? `UPDATE SET ${rest.map((k) => `${k} = excluded.${k}`).join(",")}` : "NOTHING"}`, ...keys.map((k) => c.r[k]));
        }
        upsertLog(c.t, c.k, c.s, c.d ? 1 : 0, ++seq);
        run("RELEASE sync_row");
        applied++;
      } catch (e) {
        run("ROLLBACK TO sync_row");
        run("RELEASE sync_row");
        errors.push(`${c.t} ${c.k} : ${e.message}`);
      }
    }
    repairLinks();
  }));
  if (errors.length) console.error(`Synchro : ${errors.length} ligne(s) ignorée(s)`, errors.slice(0, 5));
  if (applied) rev++;
  return { applied, errors: errors.length };
}

// Compteur des changements reçus : l'interface se recharge quand il bouge.
let rev = 0;
export const revision = () => rev;

// ---------- chiffrement ----------
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const normCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const newCode = () => Array.from(crypto.randomBytes(20), (b) => ALPHABET[b % ALPHABET.length]).join("");
const formatCode = (c) => c.match(/.{1,4}/g).join("-");
const keys = new Map();
const keyOf = (code) => { if (!keys.has(code)) keys.set(code, crypto.scryptSync(code, "ledger-sync-v1", 32)); return keys.get(code); };

function seal(obj, code) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyOf(code), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") });
}
function unseal(text, code) {
  const e = JSON.parse(text);
  const d = crypto.createDecipheriv("aes-256-gcm", keyOf(code), Buffer.from(e.iv, "base64"));
  d.setAuthTag(Buffer.from(e.tag, "base64"));
  const msg = JSON.parse(Buffer.concat([d.update(Buffer.from(e.data, "base64")), d.final()]).toString("utf8"));
  if (!(Math.abs(Date.now() - msg.ts) < MAX_CLOCK_SKEW)) throw new HttpError(400, "L'heure des deux appareils est trop différente : vérifie la date et l'heure.");
  return msg;
}

// ---------- hôte : écoute sur le réseau local ----------
let lanServer = null, udp = null, listenError = null;

function respond(msg) {
  need(/^[0-9a-f]{12}$/.test(msg.from || ""), "Message invalide.");
  need(msg.schema === LATEST_SCHEMA, "Les deux appareils n'ont pas la même version de Ledger : mets-les à jour tous les deux.");
  const token = meta.get("sync_token");
  const result = msg.full ? { applied: 0, errors: 0 } : apply(msg.changes);
  const since = msg.full || msg.token !== token ? 0 : Number(msg.since) || 0;
  const seq = maxSeq();
  const changes = changesSince(since, msg.full ? null : msg.from);
  conf.clients = { ...conf.clients, [msg.from]: { name: String(msg.name || "Appareil").slice(0, 60), lastSync: new Date().toISOString() } };
  save();
  return { ts: Date.now(), from: conf.deviceId, name: deviceName(), token, seq, changes, applied: result.applied, errors: result.errors };
}

function startHost() {
  if (lanServer || conf.role !== "host" || !conf.code) return;
  listenError = null;
  lanServer = http.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (req.method !== "POST" || req.url !== "/sync") return reply(404, { error: "Introuvable." });
    try {
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > 100e6) throw new HttpError(413, "Trop volumineux."); }
      let msg;
      try { msg = unseal(raw, conf.code); } catch (e) { return reply(e instanceof HttpError ? e.status : 401, { error: e instanceof HttpError ? e.message : "Code de jumelage incorrect." }); }
      reply(200, seal(respond(msg), conf.code));
    } catch (e) {
      if (!e.status) console.error(e);
      reply(e.status || 500, { error: e.message });
    }
  });
  lanServer.on("error", (e) => { listenError = e.code === "EADDRINUSE" ? `Le port ${SYNC_PORT} est déjà utilisé.` : e.message; lanServer = null; });
  lanServer.listen(SYNC_PORT, "0.0.0.0");
  // Découverte : un client qui ne trouve plus l'hôte (adresse IP changée) le cherche sur le réseau.
  udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
  udp.on("message", (m, rinfo) => {
    if (m.toString() === "LEDGER?") udp.send(`LEDGER!${conf.deviceId}:${SYNC_PORT}:${deviceName()}`, rinfo.port, rinfo.address);
  });
  udp.on("error", () => { try { udp.close(); } catch {} udp = null; });
  udp.bind(SYNC_PORT);
}
function stopHost() {
  lanServer?.close(); lanServer = null;
  try { udp?.close(); } catch {}
  udp = null;
}

function addresses() {
  try {
    return Object.values(os.networkInterfaces()).flat()
      .filter((a) => a && a.family === "IPv4" && !a.internal && !a.address.startsWith("100.")) // 100.x : Tailscale
      .map((a) => `${a.address}:${SYNC_PORT}`);
  } catch { return []; } // Android refuse parfois de lister les interfaces
}

// ---------- client ----------
export function discover(timeout = 1500) {
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    try { sock = dgram.createSocket("udp4"); } catch { return resolve([]); }
    const done = () => { try { sock.close(); } catch {} resolve([...found.values()]); };
    sock.on("error", done);
    sock.on("message", (m, rinfo) => {
      const r = /^LEDGER!([0-9a-f]+):(\d+):(.*)$/.exec(m.toString());
      if (r && r[1] !== conf.deviceId) found.set(r[1], { deviceId: r[1], name: r[3], url: `http://${rinfo.address}:${r[2]}` });
    });
    sock.bind(() => {
      try { sock.setBroadcast(true); sock.send("LEDGER?", SYNC_PORT, "255.255.255.255"); } catch { /* réseau sans broadcast */ }
      setTimeout(done, timeout);
    });
  });
}

const normUrl = (u) => {
  let s = String(u || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(s)) s = "http://" + s;
  const url = new URL(s);
  if (!url.port) url.port = String(SYNC_PORT);
  return url.origin;
};

async function post(url, body) {
  let res;
  try { res = await fetch(url + "/sync", { method: "POST", body, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new HttpError(502, "Appareil injoignable : vérifie que les deux sont sur le même Wi-Fi et que Ledger est ouvert sur l'autre."); }
  const text = await res.text();
  if (!res.ok) { let m; try { m = JSON.parse(text).error; } catch {} throw new HttpError(res.status === 401 ? 401 : 502, m || `Erreur ${res.status} de l'autre appareil.`); }
  return text;
}

async function exchange({ full = false } = {}) {
  const c = conf.client;
  if (!c) throw new HttpError(400, "Cet appareil n'est relié à aucun autre.");
  const sentUpTo = maxSeq();
  const msg = { ts: Date.now(), from: conf.deviceId, name: deviceName(), schema: LATEST_SCHEMA, full, token: c.recvToken, since: c.recvSeq || 0,
    changes: full ? [] : changesSince(c.sentSeq || 0, c.resendAll ? null : c.hostId) };
  const body = seal(msg, conf.code);
  let text;
  try { text = await post(c.url, body); }
  catch (e) {
    if (e.status !== 502) throw e;
    // L'hôte a peut-être changé d'adresse IP : on le cherche sur le réseau.
    const host = (await discover()).find((h) => !c.hostId || h.deviceId === c.hostId);
    if (!host || host.url === c.url) throw e;
    c.url = host.url;
    text = await post(c.url, body);
  }
  const reply = unseal(text, conf.code);
  need(!c.hostId || reply.from === c.hostId, "L'appareil contacté n'est pas celui avec lequel celui-ci est jumelé.");
  if (full) backup("avant-synchro");
  const result = apply(reply.changes, { wipe: full });
  // L'hôte a changé de base (restauration, import) : on lui renvoie tout ce qu'on a, y compris ce qui venait de lui.
  const hostReset = !full && !c.resendAll && c.recvToken && reply.token !== c.recvToken;
  Object.assign(c, { resendAll: hostReset, sentSeq: full ? maxSeq() : sentUpTo, recvSeq: reply.seq, recvToken: reply.token, hostId: reply.from, hostName: reply.name,
    lastSync: new Date().toISOString(), lastError: null, lastErrorAt: null });
  if (hostReset) { c.sentSeq = 0; save(); return exchange(); }
  save();
  return { sent: msg.changes.length, received: result.applied, errors: result.errors + (reply.errors || 0), sentApplied: reply.applied || 0 };
}

let running = null;
export function syncNow(opts) {
  running ||= exchange(opts).catch((e) => {
    if (conf.client) { conf.client.lastError = e.message; conf.client.lastErrorAt = Date.now(); save(); }
    throw e;
  }).finally(() => { running = null; });
  return running;
}

let timer = null;
function startClient() {
  if (timer || conf.role !== "client") return;
  const tick = () => {
    const c = conf.client;
    if (!c || (c.lastErrorAt && Date.now() - c.lastErrorAt < RETRY_AFTER_ERROR)) return;
    syncNow().catch(() => {});
  };
  timer = setInterval(tick, CLIENT_EVERY);
  timer.unref();
  tick();
}
function stopClient() { clearInterval(timer); timer = null; }

export function start() { startHost(); startClient(); }

// ---------- API locale (/api/sync/…) ----------
export function status() {
  const base = { role: conf.role || null, deviceId: conf.deviceId, name: deviceName(), port: SYNC_PORT };
  if (conf.role === "host") {
    return { ...base, code: formatCode(conf.code), listening: !!lanServer, listenError, addresses: addresses(), hostname: os.hostname(),
      clients: Object.entries(conf.clients || {}).map(([id, v]) => ({ id, ...v })) };
  }
  if (conf.role === "client") {
    const c = conf.client;
    return { ...base, url: c.url, hostName: c.hostName, lastSync: c.lastSync, lastError: c.lastError, syncing: !!running };
  }
  return base;
}

export async function handle(method, action, body) {
  if (method === "GET" && !action) return status();
  if (method === "GET" && action === "discover") return discover();
  if (method !== "POST") throw new HttpError(404, "Route inconnue.");
  switch (action) {
    case "host": // cet appareil devient l'hôte
      stopClient();
      if (conf.role !== "host") Object.assign(conf, { role: "host", code: newCode(), client: null, clients: {} });
      save(); startHost();
      return status();
    case "new-code":
      need(conf.role === "host", "Cet appareil n'est pas l'hôte.");
      conf.code = newCode(); conf.clients = {}; save();
      return status();
    case "join": { // cet appareil se relie à un hôte
      const code = normCode(body.code);
      need(code.length === 20, "Le code de jumelage fait 20 caractères (ex. ABCD-EFGH-…).");
      let url = body.url ? normUrl(body.url) : null;
      if (!url) {
        const hosts = await discover(2500);
        need(hosts.length, "Aucun appareil trouvé sur le Wi-Fi : saisis son adresse (affichée dans ses réglages).");
        url = hosts[0].url;
      }
      stopHost(); stopClient();
      const previous = { ...conf };
      Object.assign(conf, { role: "client", code, client: { url, sentSeq: 0, recvSeq: 0, recvToken: null } });
      try { const r = await syncNow({ full: !!body.replace }); startClient(); return { ...status(), result: r }; }
      catch (e) { conf = previous; save(); start(); throw e; }
    }
    case "now":
      need(conf.role === "client", "Cet appareil n'est relié à aucun autre.");
      return { ...status(), result: await syncNow() };
    case "replace": // reprendre toutes les données de l'hôte
      need(conf.role === "client", "Cet appareil n'est relié à aucun autre.");
      return { ...status(), result: await syncNow({ full: true }) };
    case "stop":
      stopHost(); stopClient();
      Object.assign(conf, { role: null, code: null, client: null, clients: {} });
      save();
      return status();
  }
  throw new HttpError(404, "Route inconnue.");
}
