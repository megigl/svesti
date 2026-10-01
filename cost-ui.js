// Общи части за себестойност: избор на материал, разбивка, карта с цената.
import { fmt, num } from "./calc.js";
import { esc, icons } from "./ui.js";
import { unitLabel } from "./finance.js";

export const money = v => (v === null || v === undefined || !isFinite(v) ? "–" : Number(v).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const eur = v => (v === null || v === undefined || !isFinite(v) ? "–" : `${money(v)} €`);

// Падащо меню с материали от склада (стойност = id). cats ограничава категориите; останалите са под „Други“.
export function matSelect({ k, label, value = "", mats, cats = null, wide = false, placeholder = "не е избран" }) {
  const list = [...mats.values()];
  const main = cats ? list.filter(m => cats.includes(m.category)) : list;
  const rest = cats ? list.filter(m => !cats.includes(m.category)) : [];
  const opt = m => `<option value="${esc(m.id)}" ${m.id === value ? "selected" : ""}>${esc(m.name)}${m.price !== null && m.price !== undefined ? ` (${priceUnit(m)})` : " (без цена)"}</option>`;
  const missing = value && !list.some(m => m.id === value) ? `<option value="${esc(value)}" selected>изтрит материал</option>` : "";
  return `<label class="field${wide ? " wide" : ""}"><span class="lbl">${esc(label)}</span><span class="ctl"><select name="${k}"><option value="">${esc(placeholder)}</option>${missing}${main.map(opt).join("")}${rest.length ? `<optgroup label="Други">${rest.map(opt).join("")}</optgroup>` : ""}</select></span></label>`;
}
// Цена на единица, четимо: восък и аромат на кг/л, останалото на брой или метър.
export function priceUnit(m) {
  const p = num(m.price);
  if (p === null) return "без цена";
  const nice = v => (v >= 0.1 ? money(v) : fmt(v, 4));
  if (m.unit === "g") return `${nice(p * 1000)} €/кг`;
  if (m.unit === "ml") return `${nice(p * 1000)} €/л`;
  return `${nice(p)} €/${unitLabel(m.unit)}`;
}

// Редове „материал + количество“ за допълнителни материали (етикет, кутия, панделка…).
export function extrasRows(prefix, extras, mats, { qtyLabel = "Количество" } = {}) {
  return (extras || []).map((x, i) => extraRow(prefix, i, x, mats, qtyLabel)).join("");
}
export function extraRow(prefix, i, x, mats, qtyLabel = "Количество") {
  const m = mats.get(x.m);
  return `<div class="extra-row" data-row="${i}">
    ${matSelect({ k: `${prefix}_m_${i}`, label: "Материал", value: x.m || "", mats })}
    <label class="field"><span class="lbl">${esc(qtyLabel)}</span><span class="ctl"><input name="${prefix}_q_${i}" inputmode="decimal" value="${esc(x.q ?? "")}"><span class="unit" data-unit>${esc(m ? unitLabel(m.unit) : "")}</span></span></label>
    <button type="button" class="btn icon small-x" data-rm-row="${i}" aria-label="Премахни реда">×</button></div>`;
}
export function readExtras(form, prefix) {
  const out = [];
  form.querySelectorAll(`[name^="${prefix}_m_"]`).forEach(sel => {
    const i = sel.name.split("_").pop();
    const q = num(form.elements.namedItem(`${prefix}_q_${i}`)?.value);
    if (sel.value) out.push({ m: sel.value, q: q ?? 1 });
  });
  return out;
}

// Разбивка на себестойността (за екраните с детайли и за живия преглед във формите).
export function breakdown(detail) {
  if (!detail || !detail.lines.length) return "";
  return `<table class="cost-table"><tbody>${detail.lines.map(l => `<tr class="${l.missing ? "miss" : ""}">
    <th scope="row"><span>${esc(l.label)}</span>${esc(l.name)}${l.estimated ? ` <em class="est">приблизително</em>` : ""}</th>
    <td>${l.qty !== null && l.qty !== undefined ? `${fmt(l.qty, l.unit === "g" || l.unit === "ml" ? 1 : 2)} ${esc(unitLabel(l.unit))}` : "–"}</td>
    <td>${l.missing ? (l.qty === null ? "няма количество" : "няма цена") : eur(l.cost)}</td></tr>`).join("")}</tbody></table>`;
}

// Картата с цената: материали, ×коефициент, вашата цена и реалният коефициент след закръгляне.
export function priceCard({ cost, source, estimated, missing, mult, price }) {
  const p = num(price);
  const sug = cost !== null && cost !== undefined ? cost * mult : null;
  const real = p !== null && cost ? p / cost : null;
  const note = [
    source === "manual" ? "Себестойността е въведена ръчно. Свържете материалите в рецептата, за да се смята сама." : "",
    missing ? "Някои материали нямат цена или количество, затова сумата е непълна." : "",
    estimated ? "Има материали с приблизителна цена." : "",
  ].filter(Boolean);
  return `<div class="price-card">
    <div class="pc-cells">
      <div><span class="k">Материали</span><span class="v">${eur(cost)}</span></div>
      <div><span class="k">× ${fmt(mult, 2)}</span><span class="v">${eur(sug)}</span></div>
      <div class="mine"><span class="k">Вашата цена</span><span class="v">${p !== null ? eur(p) : "–"}</span>${real !== null ? `<span class="s ${real < mult - 0.05 ? "low" : ""}">реално × ${fmt(real, 2)}</span>` : ""}</div>
    </div>
    ${note.length ? `<p class="pc-note">${note.map(esc).join(" ")}</p>` : ""}
  </div>`;
}
export const addRowBtn = (id, text) => `<button type="button" class="btn small outline" id="${id}">${icons.plus}${esc(text)}</button>`;
