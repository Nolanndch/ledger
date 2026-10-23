// Vue Investissements
import { $, esc, fmt, fmtSigned, S, ui, mutate, registerView, render, onChange } from "../core.js";

export function positions() {
  const by = {};
  for (const t of S.transactions.filter((t) => t.kind === "invest" && t.asset && (ui.scope === "all" || t.domainId === ui.scope)))
    (by[t.asset] ||= []).push(t);
  return Object.keys(by).sort().map((asset) => {
    let qty = 0, cost = 0, realized = 0;
    for (const t of by[asset].sort((a, b) => a.date.localeCompare(b.date))) {
      if (t.type === "out") { qty += t.qty; cost += t.amount; }
      else { const avg = qty ? cost / qty : 0, q = Math.min(t.qty, qty); realized += t.amount - avg * q; qty -= q; cost -= avg * q; }
    }
    const avg = qty ? cost / qty : 0;
    const price = S.assetPrices[asset] ?? avg;
    const value = qty * price;
    return { asset, qty, avg, cost, price, value, latent: value - cost, realized };
  });
}
export function renderInvestments() {
  const ps = positions();
  const t = ps.reduce((a, p) => ({ cost: a.cost + p.cost, value: a.value + p.value, latent: a.latent + p.latent, realized: a.realized + p.realized }), { cost: 0, value: 0, latent: 0, realized: 0 });
  $("#invFacts").innerHTML = [
    ["Investi", fmt(t.cost), ""], ["Valeur actuelle", fmt(t.value), ""],
    ["Plus-value latente", fmtSigned(t.latent), t.latent >= 0 ? "up" : "down"], ["Plus-value réalisée", fmtSigned(t.realized), t.realized >= 0 ? "up" : "down"],
  ].map(([l, v, c]) => `<div><div class="kpi-label">${l}</div><div class="kpi-value ${c}">${v}</div>${l === "Plus-value latente" && t.cost ? `<div class="kpi-sub">${((t.latent / t.cost) * 100).toFixed(1).replace(".", ",")} %</div>` : ""}</div>`).join("");
  $("#invEmpty").hidden = ps.length > 0;
  $("#invBody").innerHTML = ps.map((p) => `<tr>
    <td><b>${esc(p.asset)}</b></td>
    <td class="r num">${p.qty.toLocaleString("fr-FR", { maximumFractionDigits: 8 })}</td>
    <td class="amt r">${fmt(p.avg)}</td><td class="amt r">${fmt(p.cost)}</td>
    <td class="r"><input class="input num" style="width:110px;text-align:right;padding:5px 8px" type="number" step="any" min="0" value="${+p.price.toFixed(4)}" data-price="${esc(p.asset)}" aria-label="Prix actuel ${esc(p.asset)}"></td>
    <td class="amt r">${fmt(p.value)}</td>
    <td class="amt r ${p.latent >= 0 ? "up" : "down"}">${fmtSigned(p.latent)}</td>
    <td class="amt r ${p.realized >= 0 ? "up" : "down"}">${fmtSigned(p.realized)}</td></tr>`).join("");
}


onChange("price", (asset, el) => mutate("PUT", `prices/${encodeURIComponent(asset)}`, { price: parseFloat(el.value) || 0 }, `Prix de ${asset} mis à jour`));

registerView("investments", { title: "Investissements", render: renderInvestments, usesPeriod: false, usesScope: true });
