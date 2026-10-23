// Vue Objectifs et son dialogue
import { $, esc, fmt, todayISO, parseISO, addMonths, S, api, refresh, mutate, toast, domainById, sums, registerView, render, fillSelects, onClick } from "../core.js";

export function renderObjectives() {
  const today = todayISO();
  $("#goalList").innerHTML = S.objectives.length ? S.objectives.map((o) => {
    const list = o.domainId === "all" ? S.transactions.filter((t) => { const d = domainById(t.domainId); return !d || d.active; }) : S.transactions.filter((t) => t.domainId === o.domainId);
    const s = sums(list);
    const cur = s.net, withPend = s.net + s.pNet;
    const pct = Math.max(0, Math.min(100, (cur / o.target) * 100));
    const pctP = Math.max(0, Math.min(100, (withPend / o.target) * 100));
    const done = cur >= o.target;
    const d = o.domainId !== "all" ? domainById(o.domainId) : null;
    let status = "", pace = "";
    if (done) status = `<span class="chip paid">Atteint</span>`;
    else if (o.deadline) {
      const days = Math.ceil((parseISO(o.deadline) - parseISO(today)) / 864e5);
      if (days < 0) status = `<span class="chip down">Échéance dépassée</span>`;
      else {
        const months = Math.max(days / 30.44, 0.5);
        const perMonth = (o.target - cur) / months;
        // rythme récent : moyenne nette des 3 derniers mois
        const k = today.slice(0, 7);
        const recent = sums(list.filter((t) => t.date >= addMonths(k, -2) + "-01")).net / 3;
        status = recent >= perMonth ? `<span class="chip paid">En bonne voie</span>` : `<span class="chip pending">À accélérer</span>`;
        pace = `${fmt(perMonth)} / mois nécessaires · ${days} j restants`;
      }
    } else status = `<span class="chip neutral">Sans échéance</span>`;
    return `<div class="panel goal ${done ? "done" : ""}">
      <div class="goal-top"><h3>${esc(o.name)}</h3>${status}</div>
      <div class="figures"><span class="num">${fmt(cur)}</span><span class="muted num">/ ${fmt(o.target)}</span></div>
      <div class="progress" title="${Math.round(pct)} % encaissé, ${Math.round(pctP)} % avec l'attente"><div class="p-pend" style="width:${pctP}%"></div><div class="p-paid" style="width:${pct}%"></div></div>
      <div class="foot"><span>${Math.round(pct)} %${s.pNet > 0 && !done ? ` · ${Math.round(pctP)} % avec l'attente` : ""}</span><span>${d ? `<span class="dot" style="background:${esc(d.color)}"></span> ${esc(d.name)}` : "Tous les business"}</span></div>
      ${pace ? `<div class="faint" style="font-size:12px">${pace}</div>` : done ? "" : `<div class="faint" style="font-size:12px">Reste ${fmt(o.target - cur)}</div>`}
      <div class="actions"><button class="btn small" data-goal-edit="${o.id}">Modifier</button><button class="btn small danger" data-goal-del="${o.id}">Supprimer</button></div>
    </div>`;
  }).join("") : `<div class="panel empty"><b>Aucun objectif</b>Fixe un cap, par exemple ton premier 1 000 € encaissé.</div>`;
}


export let editingGoal = null;
export function openGoal(o) {
  editingGoal = o || null;
  $("#goalTitle").textContent = o ? "Modifier l'objectif" : "Nouvel objectif";
  fillSelects();
  $("#goalName").value = o?.name || ""; $("#goalTarget").value = o?.target || "";
  $("#goalDomain").value = o?.domainId || "all"; $("#goalDeadline").value = o?.deadline || "";
  $("#goalError").hidden = true;
  $("#goalDialog").showModal();
}
$("#goalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { name: $("#goalName").value, target: parseFloat($("#goalTarget").value), domainId: $("#goalDomain").value, deadline: $("#goalDeadline").value || null };
  try {
    await api(editingGoal ? "PUT" : "POST", editingGoal ? `objectives/${editingGoal.id}` : "objectives", body);
    $("#goalDialog").close();
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
