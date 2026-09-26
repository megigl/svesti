// Калкулатор по метода „свещ само восък“.
import { getSettings } from "./db.js";
import { WAX_TYPES, DYE_TYPES, calculate, fmt, num } from "./calc.js";
import { $, $$, esc, view, go, field, toast } from "./ui.js";
import { prefill } from "./recipes.js";

let state = null;
export async function renderCalc() {
  const settings = await getSettings();
  if (!state) state = { X: "", count: 1, load: 7, reserve: 0, method: settings.aromaMethod, dyeType: DYE_TYPES[0], dyePct: String(settings.maxDye).replace(".", ","), waxType: "Соев" };
  const s = state;
  view().innerHTML = `
    <header class="page-head"><div class="title-row"><h1>Калкулатор</h1></div></header>
    <section class="result-card" id="result" aria-live="polite"></section>
    <form id="calc" class="calc-form" autocomplete="off">
      <div class="grid2">
        ${field({ k: "X", label: "Свещ само восък", value: s.X, type: "number", unit: "g", ph: "0" })}
        <div class="field"><span class="lbl">Брой свещи</span><div class="ctl stepper"><button type="button" data-step="-1" aria-label="По-малко">−</button><input name="count" inputmode="numeric" value="${esc(s.count)}" aria-label="Брой свещи"><button type="button" data-step="1" aria-label="Повече">+</button></div></div>
      </div>
      <div class="grid2">
        ${field({ k: "load", label: "Аромат", value: s.load, type: "number", unit: "%" })}
        ${field({ k: "reserve", label: "Резерв за каната", value: s.reserve, type: "number", unit: "%" })}
      </div>
      <div class="field wide"><span class="lbl">Процентът аромат е от</span>
        <div class="seg" role="radiogroup">
          <label class="${s.method === "total" ? "on" : ""}"><input type="radio" name="method" value="total" ${s.method === "total" ? "checked" : ""}>теглото на свещта</label>
          <label class="${s.method === "wax" ? "on" : ""}"><input type="radio" name="method" value="wax" ${s.method === "wax" ? "checked" : ""}>теглото на восъка</label>
        </div></div>
      <div class="grid2">
        ${field({ k: "dyeType", label: "Боя", value: s.dyeType, options: DYE_TYPES })}
        ${field({ k: "dyePct", label: "Доза боя (от восъка)", value: s.dyePct, type: "number", unit: "%" })}
      </div>
      <div class="chips dose">${[["Наситен", settings.maxDye], ["Среден", settings.maxDye / 2], ["Светъл", settings.maxDye / 4]].map(([n, v]) => `<button type="button" class="chip" data-dose="${v}">${n} ${fmt(v, 2)}%</button>`).join("")}</div>
      <p class="hint">Максимум за восъка: ${fmt(settings.maxDye, 2)}% боя и ${fmt(settings.maxAroma, 1)}% аромат. Можете да ги смените в Настройки.</p>
      <details class="helper"><summary>Нов съд? Изчисли теглото от вода</summary>
        <p>Напълнете празния съд с вода до мястото, докъдето ще стига восъкът, и претеглете водата.</p>
        <div class="grid2">${field({ k: "waxType", label: "Вид восък", value: s.waxType, options: WAX_TYPES.filter(w => w.factor).map(w => w.name) })}${field({ k: "water", label: "Грамове вода", type: "number", unit: "g" })}</div>
        <button type="button" class="btn small" id="waterCalc">Изчисли теглото</button>
      </details>
      <button type="button" class="btn outline block" id="toRecipe">Нова рецепта с тези стойности</button>
    </form>`;
  const form = $("#calc");
  const E = k => form.elements.namedItem(k);
  const update = () => {
    for (const k of ["X", "count", "load", "reserve", "dyeType", "dyePct", "waxType"]) if (E(k)) s[k] = E(k).value;
    s.method = form.querySelector("input[name=method]:checked").value;
    $$(".seg label", form).forEach(l => l.classList.toggle("on", l.querySelector("input").checked));
    const r = calculate(s, settings);
    const has = r.X > 0;
    const d = num(s.dyePct);
    $$(".dose .chip").forEach(b => b.classList.toggle("on", d !== null && Math.abs(+b.dataset.dose - d) < 1e-9));
    const share = has ? Math.min(100, (r.aroma / (r.wax + r.aroma)) * 100) : 0;
    $("#result").innerHTML = has ? `
      <div class="totals">
        <div><span class="k">Восък</span><span class="v">${fmt(r.wax, 0)}</span><span class="s">g</span></div>
        <div><span class="k">Аромат</span><span class="v">${fmt(r.aroma, 1)}</span><span class="s">g</span></div>
        <div><span class="k">Боя</span><span class="v">${fmt(r.dye, 2)}</span><span class="s">g</span></div>
      </div>
      <div class="bar"><span style="width:${100 - share}%"></span><i style="width:${share}%"></i></div>
      <div class="steps"><strong>Как се смята</strong>${r.steps.map((t, i) => `<span>${i + 1}. ${esc(t)}</span>`).join("")}
      <span class="muted">За една свещ: ${fmt(r.one.wax, 1)} g восък, ${fmt(r.one.aroma, 1)} g аромат${r.dyePct ? `, ${fmt(r.dyePerCandle, 2)} g боя` : ""}.</span></div>
      ${r.warnings.map(w => `<p class="warn">${esc(w)}</p>`).join("")}`
      : `<p class="muted">Въведете колко тежи една свещ само с восък. Резултатът ще се появи тук.</p>`;
  };
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  $$("[data-step]").forEach(b => b.addEventListener("click", () => { E("count").value = Math.max(1, (num(E("count").value) || 1) + +b.dataset.step); update(); }));
  $$(".dose .chip").forEach(b => b.addEventListener("click", () => { E("dyePct").value = fmt(+b.dataset.dose, 3); update(); }));
  $("#waterCalc").addEventListener("click", () => {
    const water = num(E("water").value), wax = WAX_TYPES.find(w => w.name === E("waxType").value);
    if (water === null) return toast("Въведете грамовете вода.");
    E("X").value = Math.round(water * wax.factor);
    toast(`${fmt(water, 0)} g вода × ${fmt(wax.factor, 2)} = ${E("X").value} g само восък`);
    update();
  });
  $("#toRecipe").addEventListener("click", () => {
    const r = calculate(s, settings);
    if (!r.X) return toast("Първо въведете теглото на свещта.");
    const load = settings.aromaMethod === "wax" ? r.loadOfWax : (r.one.aroma / r.X) * 100;
    prefill.value = { totalG: r.X, fragranceLoad: Math.round(load * 100) / 100, dyeType: s.dyeType, dyePercent: num(s.dyePct), waxType: s.waxType };
    go("#/new");
  });
  update();
}
