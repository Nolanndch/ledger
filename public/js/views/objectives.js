// Vue Objectifs et son dialogue
import { $, esc, fmt, fmtCents, todayISO, parseISO, addMonths, S, api, refresh, mutate, toast, domainById, pnl, portfolio, registerView, fillSelects, onClick, segVal, setSeg } from "../core.js";
import { mrr } from "../lib/subscriptions.js";

const METRICS = {
  net: { label: "Résultat encaissé", hint: "entrées moins sorties depuis le début, hors virements vers les placements" },
  revenue: { label: "Chiffre d'affaires", hint: "total encaissé depuis le début, remboursements déduits" },
  mrr: { label: "Revenu mensuel récurrent", hint: "MRR actuel des abonnements clients" },
  portfolio: { label: "Valeur des placements", hint: "valeur actuelle d'un compte ou de tous les comptes" },
};

const root = $("#view-objectives");
root.innerHTML = `
  <div class="view-tabs"><p class="muted" style="margin:0;font-size:13px">Un objectif suit un résultat, un chiffre d'affaires, un revenu récurrent ou la valeur de tes placements. La partie hachurée inclut ce qui est en attente.</p><span class="spacer"></span><button class="btn primary small" id="addGoalBtn">Nouvel objectif</button></div>
  <div class="cards" id="goalList"></div>`;

function measure(o) {
  const today = todayISO();
  const scope = (t) => o.domainId === "all" ? (!domainById(t.domainId) || domainById(t.domainId).active) : t.domainId === o.domainId;
  if (o.metric === "mrr") return { cur: mrr(S.recurring.filter((r) => o.domainId === "all" || r.domainId === o.domainId), today).mrr, pend: 0 };
  if (o.metric === "portfolio") {
    const accounts = o.accountId ? S.accounts.filter((a) => a.id === o.accountId) : S.accounts.filter((a) => !a.closedOn);
    return { cur: portfolio(accounts).value / 100, pend: 0 };
  }
  const list = S.transactions.filter(scope);
  const p = pnl(list);
  const value = (q) => o.metric === "revenue" ? q.revenue : q.result;
  const pend = o.metric === "revenue" ? p.pRevenue : p.pRevenue - p.pExpenses;
  // Rythme récent : moyenne des 3 derniers mois complets ou en cours
  const k = today.slice(0, 7);
  const recent = value(pnl(list.filter((t) => t.date >= addMonths(k, -2) + "-01" && t.date <= today))) / 3;
  return { cur: value(p), pend, recent };
}

function renderObjectives() {
  const today = todayISO();
  $("#goalList").innerHTML = S.objectives.length ? S.objectives.map((o) => {
    const { cur, pend, recent } = measure(o);
    const pct = Math.max(0, Math.min(100, (cur / o.target) * 100));
    const pctP = Math.max(0, Math.min(100, ((cur + Math.max(0, pend)) / o.target) * 100));
    const done = cur >= o.target;
    const d = o.domainId !== "all" ? domainById(o.domainId) : null;
    const acc = o.accountId ? S.accounts.find((a) => a.id === o.accountId) : null;
    let status = "", pace = "";
    if (done) status = `<span class="chip paid">Atteint</span>`;
    else if (o.deadline) {
      const days = Math.ceil((parseISO(o.deadline) - parseISO(today)) / 864e5);
      if (days < 0) status = `<span class="chip down">Échéance dépassée</span>`;
      else if (recent != null) {
        const perMonth = (o.target - cur) / Math.max(days / 30.44, 0.5);
        status = recent >= perMonth ? `<span class="chip paid">En bonne voie</span>` : `<span class="chip pending">À accélérer</span>`;
        pace = `${fmt(perMonth)} / mois nécessaires · ${days} j restants`;
      } else { status = `<span class="chip neutral">Échéance le ${today < o.deadline ? o.deadline.split("-").reverse().join("/") : ""}</span>`; pace = `${days} j restants`; }
    } else status = `<span class="chip neutral">Sans échéance</span>`;
    const scopeLabel = o.metric === "portfolio" ? (acc ? esc(acc.name) : "Tous les comptes") : d ? `<span class="dot" style="background:${esc(d.color)}"></span> ${esc(d.name)}` : "Tous les business";
    return `<div class="panel goal ${done ? "done" : ""}">
      <div class="goal-top"><h3>${esc(o.name)}</h3>${status}</div>
      <div class="faint" style="font-size:12px">${METRICS[o.metric]?.label || METRICS.net.label}${o.metric === "mrr" ? " · par mois" : ""}</div>
      <div class="figures"><span class="num">${fmt(cur)}</span><span class="muted num">/ ${fmt(o.target)}</span></div>
      <div class="progress" title="${Math.round(pct)} %${pend > 0 ? `, ${Math.round(pctP)} % avec l'attente` : ""}"><div class="p-pend" style="width:${pctP}%"></div><div class="p-paid" style="width:${pct}%"></div></div>
      <div class="foot"><span>${Math.round(pct)} %${pend > 0 && !done ? ` · ${Math.round(pctP)} % avec l'attente` : ""}</span><span>${scopeLabel}</span></div>
      ${pace ? `<div class="faint" style="font-size:12px">${pace}</div>` : done ? "" : `<div class="faint" style="font-size:12px">Reste ${fmt(o.target - cur)}</div>`}
      <div class="actions"><button class="btn small" data-goal-edit="${o.id}">Modifier</button><button class="btn small danger" data-goal-del="${o.id}">Supprimer</button></div>
    </div>`;
  }).join("") : `<div class="panel empty"><b>Aucun objectif</b>Fixe un cap : ton premier 10 000 € encaissé, 500 € de revenu récurrent par mois, ou 20 000 € sur ton PEA.</div>`;
}

// ---------- dialogue ----------
const dialog = document.createElement("dialog");
dialog.innerHTML = `<form id="goalForm" novalidate>
  <h3 id="goalTitle">Nouvel objectif</h3>
  <div class="field"><label for="goalName">Nom</label><input class="input" id="goalName" placeholder="Ex. Premier 10 k€" autocomplete="off"></div>
  <div class="field"><span class="label">Ce que tu suis</span><div class="seg wrap pick" id="goalMetric">${Object.entries(METRICS).map(([k, m]) => `<button type="button" data-v="${k}">${m.label}</button>`).join("")}</div><span class="hint" id="goalHint"></span></div>
  <div class="field"><label for="goalTarget" id="goalTargetLabel">Montant cible (€)</label><input class="input num" id="goalTarget" type="number" step="0.01" min="0"></div>
  <div class="fields-2">
    <div class="field" id="goalDomainField"><label for="goalDomain">Business</label><select class="select" id="goalDomain" data-fill="goal-domains"></select></div>
    <div class="field" id="goalAccountField"><label for="goalAccount">Compte</label><select class="select" id="goalAccount"></select></div>
    <div class="field"><label for="goalDeadline">Échéance (optionnel)</label><input class="input" id="goalDeadline" type="date"></div>
  </div>
  <div class="form-error" id="goalError" hidden></div>
  <div class="dialog-actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div>
</form>`;
document.body.appendChild(dialog);
let editingGoal = null;
function syncMetric() {
  const m = segVal("goalMetric") || "net";
  $("#goalHint").textContent = METRICS[m].hint;
  $("#goalDomainField").hidden = m === "portfolio";
  $("#goalAccountField").hidden = m !== "portfolio";
  $("#goalTargetLabel").textContent = m === "mrr" ? "Revenu mensuel visé (€)" : "Montant cible (€)";
}
dialog.addEventListener("click", (e) => { if (e.target.closest("#goalMetric button")) setTimeout(syncMetric); });

export function openGoal(o) {
  editingGoal = o || null;
  fillSelects(dialog);
  $("#goalAccount").innerHTML = `<option value="">Tous les comptes</option>` + S.accounts.filter((a) => !a.closedOn || a.id === o?.accountId).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  $("#goalTitle").textContent = o ? "Modifier l'objectif" : "Nouvel objectif";
  $("#goalName").value = o?.name || "";
  $("#goalTarget").value = o?.target || "";
  $("#goalDomain").value = o?.domainId || "all";
  $("#goalAccount").value = o?.accountId || "";
  $("#goalDeadline").value = o?.deadline || "";
  setSeg("goalMetric", o?.metric || "net");
  $("#goalError").hidden = true;
  syncMetric();
  dialog.showModal();
}
$("#goalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { name: $("#goalName").value, target: parseFloat($("#goalTarget").value), metric: segVal("goalMetric") || "net", domainId: $("#goalDomain").value, accountId: $("#goalAccount").value || null, deadline: $("#goalDeadline").value || null };
  try {
    await api(editingGoal ? "PUT" : "POST", editingGoal ? `objectives/${editingGoal.id}` : "objectives", body);
    dialog.close();
    await refresh();
    toast("Objectif enregistré");
  } catch (err) { $("#goalError").textContent = err.message; $("#goalError").hidden = false; }
});

$("#addGoalBtn").addEventListener("click", () => openGoal());
onClick("goalEdit", (id) => openGoal(S.objectives.find((o) => o.id === id)));
onClick("goalDel", (id) => {
  const o = S.objectives.find((x) => x.id === id);
  return mutate("DELETE", `objectives/${o.id}`, null, `Objectif « ${o.name} » supprimé`, () => mutate("POST", "objectives", o, "Objectif restauré"));
});

registerView("objectives", { title: "Objectifs", render: renderObjectives, usesPeriod: false, usesScope: false });
