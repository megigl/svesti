// Таб „Финанси“: месечна справка, продажби, разходи, склад с материали и импорт на поръчки.
import { num, fmt } from "./calc.js";
import { $, $$, esc, uid, view, toast, go, field, icons, download } from "./ui.js";
import * as sync from "./sync.js";
import { liveCandles } from "./recipes.js";
import { liveArrangements } from "./arrangements.js";
import {
  loadFin, saveFin, deleteFin, matMap, unitCostOf, arrangementCost, previewOrders, applyOrders, monthReport, monthsWithData,
  saleTotal, MAT_CATEGORIES, UNITS, EXP_CATEGORIES, CHANNELS, unitLabel, multiplier,
} from "./finance.js";
import { priceUnit, eur, money } from "./cost-ui.js";

const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const monthName = ym => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1].charAt(0).toUpperCase() + MONTHS[m - 1].slice(1)} ${y}`; };
const shiftMonth = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const dmy = s => s ? s.split("-").reverse().join(".") : "";
const changed = () => sync.scheduleSync();
const seg = active => `<nav class="seg" aria-label="Финанси"><a href="#/fin" class="${active === "m" ? "on" : ""}">Месец</a><a href="#/fin/sales" class="${active === "s" ? "on" : ""}">Продажби</a><a href="#/fin/costs" class="${active === "c" ? "on" : ""}">Разходи</a><a href="#/fin/stock" class="${active === "st" ? "on" : ""}">Склад</a></nav>`;
const head = (active, extra = "") => `<header class="page-head"><div class="title-row"><h1>Финанси</h1>${extra}</div>${seg(active)}</header>`;
const importBtn = (cls = "outline") => `<label class="btn ${cls}">Импорт на поръчка<input type="file" accept="application/json,.json" data-orders hidden></label>`;
const KIND_NAMES = { candle: "Свещ", arrangement: "Аранжировка", other: "Друго" };

function bindOrderImport(root = document) {
  $$("[data-orders]", root).forEach(inp => inp.addEventListener("change", async e => {
    const file = e.target.files[0]; e.target.value = "";
    if (file) await importOrdersFile(file);
  }));
}

// ---------- Месец ----------
export async function renderFinMonth(ym) {
  const fin = await loadFin();
  ym = /^\d{4}-\d{2}$/.test(ym || "") ? ym : thisMonth();
  const r = monthReport(fin, ym);
  const empty = !fin.sales.length && !fin.purchases.length && !fin.expenses.length && !fin.materials.length;
  const list = (rows, fmtRow) => rows.length ? `<ul class="fin-list">${rows.map(fmtRow).join("")}</ul>` : "";
  view().innerHTML = `
    ${head("m")}
    ${empty ? `<div class="empty"><p>Тук ще виждате приходите, разходите и печалбата по месеци. Започнете с импорт на поръчка за материали или въведете първата продажба.</p>${importBtn("primary")}<a class="btn outline" href="#/fin/sale/new">Нова продажба</a></div>` : `
    <section class="month fin-month">
      <div class="month-nav"><a href="#/fin/m/${shiftMonth(ym, -1)}" aria-label="Предишен месец">‹</a><h2>${monthName(ym)}</h2><a href="#/fin/m/${shiftMonth(ym, 1)}" aria-label="Следващ месец">›</a></div>
    </section>
    <section class="result-card fin-card">
      <div class="totals">
        <div><span class="k">Приходи</span><span class="v">${money(r.income)}</span><span class="s">€</span></div>
        <div><span class="k">Разходи</span><span class="v">${money(r.spent)}</span><span class="s">€</span></div>
        <div class="${r.result < 0 ? "neg" : ""}"><span class="k">Резултат</span><span class="v">${money(r.result)}</span><span class="s">€</span></div>
      </div>
      <p class="pc-note">${r.sales.length ? `Материалите в продадените свещи струват ${eur(r.cogs)}, така че продажбите носят ${eur(r.grossOnSales)} над материалите.` : "Няма продажби този месец."}
      ${r.spent ? ` Разходите включват ${eur(r.spentOrders)} за поръчки${r.spentOther ? ` и ${eur(r.spentOther)} други` : ""}.` : ""}</p>
    </section>
    <section class="set">
      <h2>Продажби</h2>
      ${r.sales.length ? `<div class="kind-split">${Object.entries(r.byKind).filter(([, v]) => v > 0).map(([k, v]) => `<div><span class="k">${k === "candle" ? "Свещи" : k === "arrangement" ? "Аранжировки" : "Друго"}</span><strong>${eur(v)}</strong></div>`).join("")}</div>` : `<p class="muted">Още няма продажби за ${monthName(ym).toLowerCase()}.</p>`}
      ${list(r.products.slice(0, 8), p => `<li><span>${esc(p.name)}<small>${fmt(p.qty, 0)} бр., материали ${eur(p.cost)}</small></span><strong>${eur(p.income)}</strong></li>`)}
      ${r.byChannel.length > 1 || (r.byChannel[0] && r.byChannel[0][0] !== "Без канал") ? `<h3 class="mini-h">По канал</h3>${list(r.byChannel, ([k, v]) => `<li><span>${esc(k)}</span><strong>${eur(v)}</strong></li>`)}` : ""}
    </section>
    <section class="set">
      <h2>Разходи</h2>
      ${r.expByCat.length ? list(r.expByCat, ([k, v]) => `<li><span>${esc(k)}</span><strong>${eur(v)}</strong></li>`) : `<p class="muted">Няма разходи този месец.</p>`}
      <a class="text-link" href="#/fin/costs">Всички разходи</a>
    </section>`}
    <div class="row-actions">
      <a class="btn primary" href="#/fin/sale/new">${icons.plus}Продажба</a>
      <a class="btn outline" href="#/fin/exp/new">${icons.plus}Разход</a>
      ${empty ? "" : importBtn()}
      ${r.sales.length || r.spent ? `<button class="btn outline" id="expMonth">Месецът за Excel</button>` : ""}
    </div>
    ${monthsWithData(fin).length > 1 ? `<section class="set"><h2>Всички месеци</h2><ul class="fin-list">${monthsWithData(fin).reverse().map(m => { const x = monthReport(fin, m); return `<li><a href="#/fin/m/${m}"><span>${monthName(m)}<small>приходи ${eur(x.income)}, разходи ${eur(x.spent)}</small></span><strong class="${x.result < 0 ? "neg" : ""}">${eur(x.result)}</strong></a></li>`; }).join("")}</ul></section>` : ""}`;
  bindOrderImport();
  const b = $("#expMonth");
  if (b) b.addEventListener("click", () => exportMonth(r));
}

function exportMonth(r) {
  const cell = v => { const s = String(v ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const n = v => fmt(v, 2).replace(/\s/g, "");
  const lines = [["Дата", "Вид", "Описание", "Количество", "Канал", "Сума (€)"].join(";")];
  for (const s of r.sales) lines.push([dmy(s.date), "Продажба", s.name, fmt(num(s.qty) || 0, 0), s.channel || "", n(saleTotal(s))].map(cell).join(";"));
  for (const p of r.purchases) lines.push([dmy(p.date), "Поръчка", `${p.supplier}${p.orderNo ? ` №${p.orderNo}` : ""}`, "", "", n(-(num(p.total) || 0))].map(cell).join(";"));
  for (const e of r.expenses) lines.push([dmy(e.date), e.category || "Разход", e.text || "", "", "", n(-(num(e.amount) || 0))].map(cell).join(";"));
  lines.push(["", "", "Резултат", "", "", n(r.result)].map(cell).join(";"));
  download(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `finansi-${r.ym}.csv`);
}

// ---------- Продажби ----------
export async function renderSales() {
  const fin = await loadFin();
  let last = "";
  const rows = fin.sales.map(s => {
    const m = s.date.slice(0, 7);
    const h = m !== last ? `<li class="mh">${monthName(m)}</li>` : "";
    last = m;
    return `${h}<li><a href="#/fin/sale/${esc(s.id)}"><span>${esc(s.name)}${num(s.qty) > 1 ? ` × ${fmt(num(s.qty), 0)}` : ""}<small>${dmy(s.date)}${s.channel ? `, ${esc(s.channel)}` : ""}${s.customer ? `, ${esc(s.customer)}` : ""}</small></span><strong>${eur(saleTotal(s))}</strong></a></li>`;
  }).join("");
  view().innerHTML = `${head("s", `<span class="muted">${fin.sales.length || ""}</span>`)}
    ${fin.sales.length ? `<section class="set"><ul class="fin-list">${rows}</ul></section>` : `<div class="empty"><p>Още няма продажби. Изберете свещта или аранжировката, броя и цената, а приложението пресмята печалбата.</p><a class="btn primary" href="#/fin/sale/new">Нова продажба</a></div>`}
    <div class="fab-space"></div><a class="fab" href="#/fin/sale/new">${icons.plus}Продажба</a>`;
}

export async function renderSaleEdit(id) {
  const fin = await loadFin();
  const mats = matMap(fin.materials);
  const candles = await liveCandles(), arrs = await liveArrangements();
  const existing = id ? fin.sales.find(s => s.id === id) : null;
  const d = existing ? { ...existing } : { id: uid(), kind: "sale", date: today(), refKind: "candle", qty: 1 };
  const costOf = (kind, rid) => {
    if (kind === "candle") { const c = candles.find(x => x.id === rid); return c ? unitCostOf(c, mats).value : null; }
    if (kind === "arrangement") { const a = arrs.find(x => x.id === rid); return a ? arrangementCost(a, candles, mats).total : null; }
    return null;
  };
  const priceOf = (kind, rid) => { const x = (kind === "candle" ? candles : arrs).find(y => y.id === rid); return x ? num(x.price) : null; };
  view().innerHTML = `
    <header class="edit-head"><a class="text-link" href="#/fin/sales">Отказ</a><h1>${existing ? "Продажба" : "Нова продажба"}</h1><span class="spacer"></span></header>
    <form id="form" class="stack-form" autocomplete="off" novalidate>
      <div class="seg" role="radiogroup" aria-label="Какво продадохте">${Object.entries(KIND_NAMES).map(([k, n]) => `<label class="${d.refKind === k ? "on" : ""}"><input type="radio" name="refKind" value="${k}" ${d.refKind === k ? "checked" : ""}>${n}</label>`).join("")}</div>
      <div id="prodBox"></div>
      <div class="grid2">
        ${field({ k: "qty", label: "Брой", value: d.qty, type: "number", unit: "бр." })}
        ${field({ k: "unitPrice", label: "Цена на брой", value: d.unitPrice, type: "number", unit: "€" })}
      </div>
      <div id="otherCost"></div>
      <div id="saleOut" class="calc-box"></div>
      <div class="grid2">
        ${field({ k: "date", label: "Дата", value: d.date, type: "date" })}
        ${field({ k: "channel", label: "Канал", value: d.channel, options: CHANNELS })}
      </div>
      ${field({ k: "customer", label: "Клиент (по желание)", value: d.customer, wide: true })}
      ${field({ k: "note", label: "Бележка", value: d.note, type: "textarea", rows: 2 })}
      <button class="btn primary block" type="submit">Запази продажбата</button>
      ${existing ? `<button class="btn danger block" type="button" id="del">Изтрий продажбата</button>` : ""}
    </form>`;
  const form = $("#form"), F = k => form.elements.namedItem(k);
  const kind = () => form.querySelector("input[name=refKind]:checked").value;
  const drawProd = () => {
    const k = kind();
    $$(".seg label", form).forEach(l => l.classList.toggle("on", l.querySelector("input").checked));
    if (k === "other") {
      $("#prodBox").innerHTML = field({ k: "name", label: "Какво продадохте", value: d.refKind === "other" ? d.name : "", wide: true });
      $("#otherCost").innerHTML = `<div class="grid2">${field({ k: "unitCostManual", label: "Себестойност на брой", value: d.refKind === "other" ? d.unitCost : "", type: "number", unit: "€" })}</div>`;
    } else {
      const list = k === "candle" ? candles : arrs;
      $("#prodBox").innerHTML = `<label class="field wide"><span class="lbl">${k === "candle" ? "Свещ" : "Аранжировка"}</span><span class="ctl"><select name="refId"><option value=""></option>${list.map(x => `<option value="${esc(x.id)}" ${x.id === d.refId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></span></label>
        ${list.length ? "" : `<p class="hint">Още няма ${k === "candle" ? "рецепти" : "аранжировки"}. Изберете „Друго“ или ги създайте в Рецепти.</p>`}`;
      $("#otherCost").innerHTML = "";
    }
    out();
  };
  const out = () => {
    const k = kind(), q = num(F("qty").value) || 0, p = num(F("unitPrice").value);
    const c = k === "other" ? num(F("unitCostManual")?.value) : costOf(k, F("refId")?.value);
    $("#saleOut").innerHTML = p !== null ? `Сума: <strong>${eur(q * p)}</strong>${c !== null ? `<br>Материали: ${eur(q * c)}, над материалите: <strong>${eur(q * (p - c))}</strong>` : ""}` : "";
  };
  form.addEventListener("change", e => {
    if (e.target.name === "refKind") drawProd();
    if (e.target.name === "refId") { const pr = priceOf(kind(), e.target.value); if (pr !== null) F("unitPrice").value = String(pr).replace(".", ","); out(); }
  });
  form.addEventListener("input", out);
  drawProd();
  if (!existing && d.refId) { const pr = priceOf(d.refKind, d.refId); if (pr !== null) F("unitPrice").value = pr; }
  out();
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const k = kind();
    const q = num(F("qty").value), p = num(F("unitPrice").value);
    if (!q || q <= 0) return toast("Въведете брой.");
    if (p === null) return toast("Въведете цена.");
    const rec = { ...d, kind: "sale", refKind: k, qty: q, unitPrice: p, date: F("date").value || today(), channel: F("channel").value || "", customer: F("customer").value.trim(), note: F("note").value.trim() };
    if (k === "other") {
      rec.name = F("name").value.trim(); if (!rec.name) return toast("Напишете какво продадохте.");
      rec.refId = ""; rec.unitCost = num(F("unitCostManual").value);
    } else {
      rec.refId = F("refId").value; if (!rec.refId) return toast(`Изберете ${k === "candle" ? "свещта" : "аранжировката"}.`);
      rec.name = ((k === "candle" ? candles : arrs).find(x => x.id === rec.refId) || {}).name || "";
      // Себестойността се записва към датата на продажбата, за да не се променя справката при нови цени.
      rec.unitCost = existing && existing.refId === rec.refId && existing.unitCost !== undefined ? existing.unitCost : costOf(k, rec.refId);
    }
    await saveFin(rec); changed();
    toast("Продажбата е записана"); go("#/fin/sales");
  });
  const del = $("#del");
  if (del) del.addEventListener("click", async () => { if (!confirm("Да изтрия ли продажбата?")) return; await deleteFin(d.id); changed(); toast("Изтрито"); go("#/fin/sales"); });
}

// ---------- Разходи ----------
export async function renderCosts() {
  const fin = await loadFin();
  const items = [
    ...fin.purchases.filter(p => p.mode === "expense").map(p => ({ date: p.date, href: `#/fin/order/${encodeURIComponent(p.id)}`, title: p.supplier || "Поръчка", sub: `поръчка${p.orderNo ? ` №${p.orderNo}` : ""}, ${(p.items || []).length} арт.`, amount: num(p.total) || 0 })),
    ...fin.expenses.map(x => ({ date: x.date, href: `#/fin/exp/${esc(x.id)}`, title: x.text || x.category, sub: x.category, amount: num(x.amount) || 0 })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const stock = fin.purchases.filter(p => p.mode === "stock");
  let last = "";
  const rows = items.map(x => { const m = x.date.slice(0, 7); const h = m !== last ? `<li class="mh">${monthName(m)}</li>` : ""; last = m; return `${h}<li><a href="${x.href}"><span>${esc(x.title)}<small>${dmy(x.date)}, ${esc(x.sub)}</small></span><strong>${eur(x.amount)}</strong></a></li>`; }).join("");
  view().innerHTML = `${head("c")}
    ${items.length ? `<section class="set"><ul class="fin-list">${rows}</ul></section>` : `<div class="empty"><p>Още няма разходи. Импортирайте поръчка за материали или добавете разход ръчно, например куриер или такса за базар.</p></div>`}
    <div class="row-actions">${importBtn("primary")}<a class="btn outline" href="#/fin/exp/new">${icons.plus}Друг разход</a></div>
    ${stock.length ? `<section class="set"><h2>Начална наличност</h2><p class="muted">По-стари поръчки. От тях идват цените в склада, но не се броят за разход.</p><ul class="fin-list">${stock.map(p => `<li><a href="#/fin/order/${encodeURIComponent(p.id)}"><span>${esc(p.supplier || "Поръчка")}<small>${dmy(p.date)}${p.orderNo ? `, №${esc(p.orderNo)}` : ""}</small></span><strong>${eur(num(p.total))}</strong></a></li>`).join("")}</ul></section>` : ""}`;
  bindOrderImport();
}

export async function renderExpEdit(id) {
  const fin = await loadFin();
  const existing = id ? fin.expenses.find(x => x.id === id) : null;
  const d = existing ? { ...existing } : { id: uid(), kind: "expense", date: today(), category: "Куриер до клиент" };
  view().innerHTML = `
    <header class="edit-head"><a class="text-link" href="#/fin/costs">Отказ</a><h1>${existing ? "Разход" : "Нов разход"}</h1><span class="spacer"></span></header>
    <form id="form" class="stack-form" autocomplete="off" novalidate>
      <div class="grid2">${field({ k: "amount", label: "Сума", value: d.amount, type: "number", unit: "€" })}${field({ k: "date", label: "Дата", value: d.date, type: "date" })}</div>
      ${field({ k: "category", label: "Вид", value: d.category, options: EXP_CATEGORIES, wide: true })}
      ${field({ k: "text", label: "Описание", value: d.text, wide: true, ph: "напр. Еконт до клиент в Пловдив" })}
      <p class="hint">Поръчките за материали не ги въвеждайте тук. Импортирайте ги от файл, за да се обновят и цените в склада.</p>
      <button class="btn primary block" type="submit">Запази разхода</button>
      ${existing ? `<button class="btn danger block" type="button" id="del">Изтрий разхода</button>` : ""}
    </form>`;
  const form = $("#form"), F = k => form.elements.namedItem(k);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const a = num(F("amount").value);
    if (a === null) return toast("Въведете сума.");
    await saveFin({ ...d, amount: a, date: F("date").value || today(), category: F("category").value || "Друго", text: F("text").value.trim() }); changed();
    toast("Разходът е записан"); go("#/fin/costs");
  });
  const del = $("#del");
  if (del) del.addEventListener("click", async () => { if (!confirm("Да изтрия ли разхода?")) return; await deleteFin(d.id); changed(); toast("Изтрито"); go("#/fin/costs"); });
}

// ---------- Поръчка ----------
export async function renderOrder(id) {
  id = decodeURIComponent(id || "");
  const fin = await loadFin();
  const p = fin.purchases.find(x => x.id === id);
  if (!p) { view().innerHTML = `<div class="empty"><p>Поръчката не е намерена.</p><a class="btn" href="#/fin/costs">Към разходите</a></div>`; return; }
  view().innerHTML = `
    <header class="page-head"><a class="text-link" href="#/fin/costs">‹ Разходи</a><h1>${esc(p.supplier || "Поръчка")}</h1>
      <p class="muted">${dmy(p.date)}${p.orderNo ? `, поръчка №${esc(p.orderNo)}` : ""}. ${p.mode === "stock" ? "Начална наличност, не се брои за разход." : `Разход за ${monthName(p.date.slice(0, 7)).toLowerCase()}.`}</p></header>
    <section class="set">
      <table class="cost-table"><tbody>${(p.items || []).map(i => `<tr><th scope="row"><span>${i.type === "equipment" ? "Оборудване" : i.type === "other" ? "Друго" : esc(i.category)}</span>${esc(i.name)}${i.estimated ? ` <em class="est">приблизително</em>` : ""}</th>
        <td>${i.qty ? `${fmt(i.qty, 2)} ${esc(unitLabel(i.unit))}` : ""}</td><td>${eur(num(i.lineTotal))}${i.unitPrice ? `<small>${esc(priceUnit({ price: i.unitPrice, unit: i.unit }))} с доставката</small>` : ""}</td></tr>`).join("")}
        ${num(p.shipping) ? `<tr><th scope="row"><span>Доставка</span>разпределена в цените</th><td></td><td>${eur(num(p.shipping))}</td></tr>` : ""}
        <tr class="sum"><th scope="row">Общо</th><td></td><td>${eur(num(p.total))}</td></tr></tbody></table>
      ${p.note ? `<p class="muted">${esc(p.note)}</p>` : ""}
    </section>
    <div class="row-actions">
      <button class="btn outline" id="mode">${p.mode === "stock" ? "Брой я за разход" : "Премести в начална наличност"}</button>
      <button class="btn danger" id="del">Изтрий поръчката</button>
    </div>
    <p class="hint pad">Изтриването маха поръчката от разходите. Цените в склада остават, за да не се развалят рецептите.</p>`;
  $("#mode").addEventListener("click", async () => { await saveFin({ ...p, mode: p.mode === "stock" ? "expense" : "stock" }); changed(); renderOrder(encodeURIComponent(id)); });
  $("#del").addEventListener("click", async () => { if (!confirm("Да изтрия ли поръчката? Ако я импортирате пак, ще се появи отново.")) return; await deleteFin(p.id); changed(); toast("Поръчката е изтрита"); go("#/fin/costs"); });
}

// ---------- Склад ----------
export async function renderStock() {
  const fin = await loadFin();
  const candles = await liveCandles();
  const used = id => candles.filter(c => [c.matWax, c.matAroma, c.matDye, c.matWick, c.matContainer, ...(c.extras || []).map(x => x.m)].includes(id)).length;
  const groups = MAT_CATEGORIES.map(cat => [cat, fin.materials.filter(m => m.category === cat)]).filter(([, l]) => l.length);
  const noPrice = fin.materials.filter(m => num(m.price) === null).length;
  const est = fin.materials.filter(m => m.estimated).length;
  view().innerHTML = `${head("st", `<span class="muted">${fin.materials.length || ""}</span>`)}
    ${fin.materials.length ? `
    ${noPrice || est ? `<p class="hint pad">${noPrice ? `${noPrice} без цена. ` : ""}${est ? `${est} с приблизителна цена: заменя се сама при следваща поръчка на същия материал.` : ""}</p>` : ""}
    ${groups.map(([cat, list]) => `<section class="set"><h2>${esc(cat)}</h2><ul class="fin-list">${list.map(m => { const u = used(m.id); return `<li><a href="#/fin/mat/${esc(m.id)}"><span>${esc(m.name)}${m.estimated ? ` <em class="est">приблизително</em>` : ""}<small>${[m.supplier, m.priceDate && dmy(m.priceDate), u && `в ${u} ${u === 1 ? "рецепта" : "рецепти"}`].filter(Boolean).map(esc).join(", ")}</small></span><strong class="${num(m.price) === null ? "neg" : ""}">${esc(priceUnit(m))}</strong></a></li>`; }).join("")}</ul></section>`).join("")}` :
    `<div class="empty"><p>Складът е празен. Импортирайте файла с поръчки или началната наличност, или добавете материал ръчно.</p>${importBtn("primary")}</div>`}
    <div class="row-actions">${fin.materials.length ? importBtn() : ""}</div>
    <div class="fab-space"></div><a class="fab" href="#/fin/mat/new">${icons.plus}Материал</a>`;
  bindOrderImport();
}

export async function renderMatEdit(id) {
  const fin = await loadFin();
  const existing = id ? fin.materials.find(m => m.id === id) : null;
  const d = existing ? { ...existing } : { id: uid(), kind: "material", category: "Восък", unit: "g" };
  const big = u => u === "g" || u === "ml";
  const packQty = d.packQty ?? (big(d.unit) ? 1000 : 1);
  const packPrice = d.packPrice ?? (num(d.price) !== null ? Math.round(num(d.price) * packQty * 100) / 100 : "");
  view().innerHTML = `
    <header class="edit-head"><a class="text-link" href="#/fin/stock">Отказ</a><h1>${existing ? "Материал" : "Нов материал"}</h1><span class="spacer"></span></header>
    <form id="form" class="stack-form" autocomplete="off" novalidate>
      ${field({ k: "name", label: "Име", value: d.name, wide: true, ph: "напр. Соев восък Golden 464" })}
      <div class="grid2">${field({ k: "category", label: "Категория", value: d.category, options: MAT_CATEGORIES })}${field({ k: "unit", label: "Мярка", value: d.unit, options: UNITS })}</div>
      <fieldset class="group"><legend>Цена</legend>
        <div class="grid2">${field({ k: "packPrice", label: "Платих", value: packPrice, type: "number", unit: "€" })}${field({ k: "packQty", label: "за", value: packQty, type: "number", unit: unitLabel(d.unit) })}</div>
        <p class="calc-box" id="perUnit"></p>
        <label class="check-line"><input type="checkbox" name="_est" ${d.estimated ? "checked" : ""}>Приблизителна цена (не намирам точната)</label>
      </fieldset>
      ${field({ k: "supplier", label: "Доставчик", value: d.supplier, wide: true })}
      ${field({ k: "note", label: "Бележка", value: d.note, type: "textarea", rows: 2 })}
      <button class="btn primary block" type="submit">Запази материала</button>
      ${existing ? `<button class="btn danger block" type="button" id="del">Изтрий материала</button>` : ""}
    </form>`;
  const form = $("#form"), F = k => form.elements.namedItem(k);
  const upd = () => {
    const pp = num(F("packPrice").value), pq = num(F("packQty").value), u = F("unit").value;
    form.querySelector('[name=packQty]').parentElement.querySelector(".unit").textContent = unitLabel(u);
    $("#perUnit").innerHTML = pp !== null && pq ? `Цена: <strong>${esc(priceUnit({ price: pp / pq, unit: u }))}</strong>${big(u) ? ` (${fmt(pp / pq, 4)} € за ${unitLabel(u)})` : ""}` : "";
  };
  form.addEventListener("input", upd); form.addEventListener("change", upd); upd();
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const name = F("name").value.trim();
    if (!name) return toast("Въведете име.");
    const pp = num(F("packPrice").value), pq = num(F("packQty").value);
    const rec = { ...d, name, category: F("category").value || "Друго", unit: F("unit").value || "бр.", supplier: F("supplier").value.trim(), note: F("note").value.trim(), estimated: F("_est").checked };
    if (pp !== null && pq) {
      const price = pp / pq;
      if (price !== num(d.price)) rec.priceDate = today();
      Object.assign(rec, { price, packPrice: pp, packQty: pq });
    } else { rec.price = null; }
    await saveFin(rec); changed();
    toast("Материалът е запазен"); go("#/fin/stock");
  });
  const del = $("#del");
  if (del) del.addEventListener("click", async () => {
    const candles = await liveCandles();
    const n = candles.filter(c => [c.matWax, c.matAroma, c.matDye, c.matWick, c.matContainer, ...(c.extras || []).map(x => x.m)].includes(d.id)).length;
    if (!confirm(n ? `Материалът се ползва в ${n} рецепти. Да го изтрия ли? Там ще се покаже „изтрит материал“.` : "Да изтрия ли материала?")) return;
    await deleteFin(d.id); changed(); toast("Изтрито"); go("#/fin/stock");
  });
}

// ---------- Импорт на поръчки ----------
export async function importOrdersFile(file) {
  let pv;
  try { pv = await previewOrders(await file.text()); }
  catch (err) { toast(err.message, 6000); return; }
  const blocked = pv.errors.length > 0;
  const fresh = pv.orders.filter(o => !o.exists);
  const matOpts = (it, key) => {
    if (!pv.materials.length) return `<small class="ok-map">нов материал в склада</small>`;
    const same = pv.materials.filter(m => m.category === it.category);
    const other = pv.materials.filter(m => m.category !== it.category);
    return `<select name="${key}" class="map-sel" aria-label="Материал за ${esc(it.name)}"><option value="new">Нов материал</option>${same.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}${other.length ? `<optgroup label="Други категории">${other.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</optgroup>` : ""}</select>`;
  };
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.innerHTML = `<form method="dialog">
    <h2>Импорт на поръчки</h2>
    <p class="muted">${esc(file.name)}</p>
    ${blocked ? `<p class="warn">Файлът има грешки и не може да се импортира:</p><ul class="issues">${pv.errors.slice(0, 8).map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : `
    ${pv.orders.map(o => `<div class="imp-order${o.exists ? " done" : ""}">
      <strong>${esc(o.supplier || o.code)}</strong><span class="muted">${dmy(o.date)}, ${eur(o.total)}, ${o.exists ? "вече е импортирана и се пропуска" : o.mode === "stock" ? "начална наличност" : `разход за ${monthName(o.date.slice(0, 7)).toLowerCase()}`}</span>
      ${o.exists ? "" : `<ul class="imp-items">${o.items.map((it, j) => `<li><span><span class="nm">${esc(it.name)}${it.type !== "material" ? ` <em class="est">${it.type === "equipment" ? "оборудване" : "друго"}</em>` : it.estimated ? ` <em class="est">приблизително</em>` : ""}</span><small>${it.qty ? `${fmt(it.qty, 2)} ${esc(unitLabel(it.unit))}, ` : ""}${eur(it.lineTotal)}${it.unitPrice ? `, ${esc(priceUnit({ price: it.unitPrice, unit: it.unit }))} с доставката` : ""}</small></span>
        ${it.type === "material" ? (it.match ? `<small class="ok-map">обновява „${esc(it.match.name)}“</small>` : matOpts(it, `${o.code}|${j}`)) : ""}</li>`).join("")}</ul>`}
    </div>`).join("")}
    ${fresh.length ? `<p class="muted">Нов материал се добавя в склада. Ако е същият като вече въведен, изберете го от списъка и само цената му ще се обнови.</p>` : `<p class="muted">Всички поръчки от файла вече са вътре.</p>`}`}
    <div class="row-actions">${blocked || !fresh.length ? "" : `<button class="btn primary" value="ok">Импортирай</button>`}<button class="btn outline" value="cancel">${blocked || !fresh.length ? "Затвори" : "Отказ"}</button></div>
  </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  await new Promise(r => dlg.addEventListener("close", r, { once: true }));
  const mapping = {};
  dlg.querySelectorAll(".map-sel").forEach(s => { mapping[s.name] = s.value; });
  const ok = dlg.returnValue === "ok"; dlg.remove();
  if (!ok || blocked || !fresh.length) return;
  const r = await applyOrders(pv, mapping);
  changed();
  toast(`Импортирани поръчки: ${r.imported}. Нови материали: ${r.newMats}, обновени цени: ${r.updated}.`, 5000);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
