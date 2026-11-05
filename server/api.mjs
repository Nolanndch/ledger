// API de Ledger : routes et validations communes au serveur du Mac (server.mjs) et à l'app Android.
import { run, tx, insert, update, existsIn, need, get, HttpError, uid, today } from "./db.mjs";
import { backup, listBackups, restoreBackup } from "./backup.mjs";
import * as L from "./ledger.mjs";
import * as I from "./invest.mjs";
import * as Sync from "./sync.mjs";
import { getState, exportState, importState, info, csvTransactions, csvOperations } from "./io.mjs";

// Collections simples (création, modification, suppression génériques)
const SIMPLE = { domains: "domains", categories: "categories", objectives: "objectives" };

// Requête → réponse, sans dépendre de node:http : le même code sert le serveur du Mac et l'app Android.
// ctx : { version, reopen, reopenReplaced, reveal }
export async function handle({ method, parts, query, body = {} }, ctx) {
  const [resource, id, action] = parts;
  const ok = (data, status = 200) => ({ status, body: data });
  const file = (content, headers) => ({ status: 200, body: content, headers });

  switch (resource) {
    case "state": L.materializeRecurring(); return ok(getState(ctx.version));
    case "info": return ok(info(ctx.version));
    case "ping": return ok({ ok: true, rev: Sync.revision() });
    case "sync": return ok(await Sync.handle(method, id, body));
    case "settings":
      if (method === "GET") return ok(L.getSettings());
      if (method === "PUT") return ok(L.putSettings(body));
      break;
    case "export": {
      const date = today();
      if (id === "csv") return file(csvTransactions(), { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ledger-${date}.csv"` });
      if (id === "csv-invest") return file(csvOperations(), { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ledger-placements-${date}.csv"` });
      return file(JSON.stringify(exportState(), null, 2), { "Content-Disposition": `attachment; filename="ledger-${date}.json"` });
    }
    case "import":
      if (method === "POST") { importState(body, ctx.reopenReplaced); return ok({ ok: true }); }
      break;
    case "backups":
      if (method === "GET") return ok(listBackups());
      if (method === "POST" && !id) return ok({ name: backup("manuelle") }, 201);
      if (method === "POST" && parts.at(-1) === "restore") { restoreBackup(decodeURIComponent(parts.slice(1, -1).join("/")), ctx.reopenReplaced); return ok({ ok: true }); }
      break;
    case "reveal":
      ctx.reveal?.();
      return ok({ ok: true });

    case "transactions":
      if (id === "bulk" && method === "POST") return ok(L.restoreTransactions(body.rows), 201);
      if (method === "POST" && !id) return ok(L.createTransaction(body), 201);
      if (id && action === "refund" && method === "POST") return ok(L.refund(id, body), 201);
      if (id && method === "PUT") return ok(L.updateTransaction(id, body));
      if (id && method === "DELETE") return ok({ ok: true, deleted: L.deleteTransaction(id) });
      break;
    case "installments":
      if (method === "POST") return ok(L.createInstallments(body), 201);
      if (id && method === "DELETE") return ok({ deleted: L.deleteInstallments(id, Number(query.get("from")) || 1) });
      break;
    case "recurring":
      if (method === "POST" && !id) return ok(L.createRecurring(body), 201);
      if (id && action === "cancel" && method === "POST") return ok(L.cancelRecurring(id, body));
      if (id && action === "reactivate" && method === "POST") return ok(L.reactivateRecurring(id));
      if (id && method === "PUT") return ok(L.updateRecurring(id, body));
      if (id && method === "DELETE") return ok(L.deleteRecurring(id, { force: query.has("force"), withPayments: query.has("withPayments") }));
      break;

    case "accounts":
      if (method === "POST" && !id) return ok(I.createAccount(body), 201);
      if (id && action === "close" && method === "POST") return ok(I.closeAccount(id, body));
      if (id && action === "reopen" && method === "POST") return ok(I.reopenAccount(id));
      if (id && method === "PUT") return ok(I.updateAccount(id, body));
      if (id && method === "DELETE") return ok(I.deleteAccount(id, { purge: query.has("purge") }));
      break;
    case "operations":
      if (method === "POST" && !id) return ok(I.createOperation(body), 201);
      if (id && method === "PUT") return ok(I.updateOperation(id, body));
      if (id && method === "DELETE") return ok(I.deleteOperation(id));
      break;
    case "assets":
      if (id && method === "PUT") return ok(I.putAsset(id, body));
      break;

    case "domains":
      if (id === "reorder" && method === "POST") {
        need(Array.isArray(body.ids), "Liste invalide.");
        tx(() => body.ids.forEach((d, i) => run("UPDATE domains SET position = ? WHERE id = ?", i, d)));
        return ok({ ok: true });
      }
    // fallthrough vers les collections simples
    default:
      if (SIMPLE[resource]) {
        const table = SIMPLE[resource];
        if (method === "POST" && !id) {
          const newId = body.id && !existsIn(table, body.id) ? String(body.id) : uid();
          insert(table, L.schema[table](body), newId);
          return ok(L.fetchOne(table, newId), 201);
        }
        const prev = id && L.fetchOne(table, id);
        if (!prev) throw new HttpError(404, "Élément introuvable.");
        if (method === "PUT") { update(table, id, L.schema[table](body, prev)); return ok(L.fetchOne(table, id)); }
        if (method === "DELETE") {
          if (table === "domains") {
            const n = get("SELECT COUNT(*) n FROM transactions WHERE domain_id = ?", id).n;
            if (n) throw new HttpError(409, `Ce business a ${n} mouvement${n > 1 ? "s" : ""}. Archive-le plutôt pour garder l'historique.`);
            run("UPDATE objectives SET domain_id = NULL WHERE domain_id = ?", id);
          }
          run(`DELETE FROM ${table} WHERE id = ?`, id);
          return ok({ ok: true, deleted: prev });
        }
      }
  }
  throw new HttpError(404, "Route inconnue.");
}
