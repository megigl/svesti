// Екраните за рецептите: списък, рецепта, редакция.
import { CONFIG } from "./config.js";
import { db, getSettings } from "./db.js";
import { WAX_TYPES, DYE_TYPES, COLLECTIONS, num, fmt, perCandle } from "./calc.js";
import { compressPhoto } from "./image.js";
import { $, $$, esc, uid, view, objURL, toast, go, openPhoto, field, icons } from "./ui.js";
import * as sync from "./sync.js";
import { loadCalendar, dm } from "./calendar.js";
import { loadFin, matMap, candleCost, unitCostOf, multiplier } from "./finance.js";
import { matSelect, extraRow, extrasRows, readExtras, breakdown, priceCard, addRowBtn, eur } from "./cost-ui.js";

// Свещите (без аранжировките, които са в същото хранилище с kind: "arrangement").
export async function liveCandles() {
  return (await db.getAll("candles")).filter(c => !c.deleted && c.kind !== "arrangement").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export const kindSeg = active => `<nav class="seg" aria-label="Вид"><a href="#/" class="${active === "c" ? "on" : ""}">Свещи</a><a href="#/arr" class="${active === "a" ? "on" : ""}">Аранжировки</a></nav>`;
async function saveCandle(c) { c.updatedAt = Date.now(); await db.put("candles", c); sync.scheduleSync(); }

// ---------- Списък ----------
const listState = { q: "", col: "" };
export async function renderList() {
  const items = await liveCandles();
  const q = listState.q.toLowerCase();
  const onlyArr = listState.col === "__arr";
  const filtered = items.filter(c => (onlyArr ? c.arrangementOnly : !c.arrangementOnly && (!listState.col || c.collection === listState.col)) &&
    (!q || [c.name, c.fragrance, c.batch, c.waxType, c.dyeName, c.supplier, c.collection].join(" ").toLowerCase().includes(q)));
  const chips = ["", ...COLLECTIONS, ...(items.some(c => c.arrangementOnly) ? ["__arr"] : [])].map(c => `<button type="button" class="chip${listState.col === c ? " on" : ""}" data-col="${esc(c)}">${c === "__arr" ? "За аранжировки" : c || "Всички"}</button>`).join("");
  view().innerHTML = `
    <header class="page-head">
      <div class="title-row"><h1>Рецепти</h1><span class="muted">${items.length ? `${items.length} ${items.length === 1 ? "свещ" : "свещи"}` : ""}</span></div>
      ${kindSeg("c")}
      ${items.length ? `<label class="search">${icons.search}<input id="search" type="search" aria-label="Търсене" placeholder="Търсене по име или аромат" value="${esc(listState.q)}"></label>
      <div class="chips" role="group" aria-label="Колекции">${chips}</div>` : ""}
    </header>
    <ul class="recipe-grid" id="grid"></ul>
    ${items.length ? "" : `<div class="empty"><p>Още няма рецепти. Започнете с първата свещ – снимка, восък, фитил, аромат и цвят на едно място.</p><a class="btn primary" href="#/new">Нова рецепта</a></div>`}
    <a class="fab" href="#/new">${icons.plus}Нова рецепта</a>`;
  const ul = $("#grid");
  for (const c of filtered) {
    const li = document.createElement("li");
    const sub = [c.waxType && `${c.waxType}${c.totalG ? `, ${fmt(c.totalG, 0)} g` : c.waxG ? `, ${fmt(c.waxG, 0)} g` : ""}`, c.fragranceLoad != null && `аромат ${fmt(c.fragranceLoad, 1)}%`].filter(Boolean).join("<br>");
    li.innerHTML = `<a href="#/card/${esc(c.id)}"><span class="ph-box">${icons.candle}</span><strong>${esc(c.name || "Без име")}</strong><span class="sub">${sub}</span></a>`;
    ul.appendChild(li);
    if (c.photos?.length) db.get("photos", c.photos[0]).then(p => { if (p) { const b = li.querySelector(".ph-box"); b.innerHTML = ""; b.style.backgroundImage = `url(${objURL(p.thumb || p.blob)})`; b.classList.add("has"); } });
  }
  if (items.length && !filtered.length) ul.innerHTML = `<li class="none">Няма рецепти по този филтър.</li>`;
  const s = $("#search");
  if (s) s.addEventListener("input", () => { listState.q = s.value; const pos = s.selectionStart; renderList().then(() => { const n = $("#search"); n.focus(); n.setSelectionRange(pos, pos); }); });
  $$(".chip").forEach(b => b.addEventListener("click", () => { listState.col = b.dataset.col; renderList(); }));
}

// ---------- Рецепта ----------
export async function renderDetail(id) {
  const c = await db.get("candles", id);
  if (!c || c.deleted) { view().innerHTML = `<div class="empty"><p>Рецептата не е намерена.</p><a class="btn" href="#/">Към рецептите</a></div>`; return; }
  const photos = (await Promise.all((c.photos || []).map(pid => db.get("photos", pid)))).filter(Boolean);
  const cal = await loadCalendar();
  const linked = cal.posts.filter(p => (p.local.recipeIds || []).includes(c.id)).sort((a, b) => a.src.date.localeCompare(b.src.date));
  const v = x => x !== undefined && x !== null && x !== "";
  const row = (label, val, unit = "") => v(val) ? `<div class="row"><dt>${label}</dt><dd>${typeof val === "number" ? fmt(val, 2) : esc(val)}${unit ? ` ${unit}` : ""}</dd></div>` : "";
  const section = (title, preview, rows) => rows.trim() ? `<details class="fold"><summary><span><strong>${title}</strong><small>${esc(preview)}</small></span>${icons.chevron}</summary><dl>${rows}</dl></details>` : "";
  const fin = await loadFin();
  const mats = matMap(fin.materials);
  const mult = await multiplier();
  const uc = unitCostOf(c, mats);
  const margin = num(c.price) !== null && uc.value !== null ? num(c.price) - uc.value : null;
  const keys = [
    ["Восък", v(c.waxG) ? `${fmt(c.waxG, 0)} g` : "–", c.waxType || ""],
    ["Аромат", v(c.fragranceLoad) ? `${fmt(c.fragranceLoad, 1)}%` : "–", [v(c.fragranceG) && `${fmt(c.fragranceG, 1)} g`, c.fragrance].filter(Boolean).join(" ")],
    ["Фитил", [c.wickSeries, c.wickSize].filter(Boolean).join(" ") || "–", v(c.wickCount) ? `${fmt(c.wickCount, 0)} бр.` : ""],
    ["Горене", v(c.burnHours) ? `${fmt(c.burnHours, 0)} ч` : "–", c.burnNotes ? "с бележки от теста" : ""],
  ];
  view().innerHTML = `
    <div class="hero">
      ${photos.length ? `<button class="hero-img" data-i="0" aria-label="Отвори снимката"><img alt="" src="${objURL(photos[0].blob)}"></button>` : `<div class="hero-img empty-ph">${icons.candle}</div>`}
      <a class="round-back" href="#/" aria-label="Назад към рецептите">${icons.back}</a>
      ${c.collection ? `<span class="hero-tag"><i></i>${esc(c.collection)}</span>` : ""}
    </div>
    ${photos.length > 1 ? `<div class="thumbs">${photos.slice(1).map((p, i) => `<button data-i="${i + 1}" aria-label="Отвори снимка ${i + 2}"><img alt="" src="${objURL(p.thumb || p.blob)}"></button>`).join("")}</div>` : ""}
    <section class="detail">
      <h1>${esc(c.name || "Без име")}</h1>
      <p class="muted">${[c.batch && `Партида ${esc(c.batch)}`, c.date && new Date(c.date).toLocaleDateString("bg-BG")].filter(Boolean).join(", ")}</p>
      <div class="keys">${keys.map(([k, val, s]) => `<div><span class="k">${k}</span><span class="v">${esc(val)}</span><span class="s">${esc(s)}</span></div>`).join("")}</div>
      ${priceCard({ cost: uc.value, source: uc.source, estimated: uc.detail?.estimated, missing: uc.detail?.missing, mult, price: c.price })}
      <div class="folds">
        ${section("Свещ и съд", [v(c.totalG) && `${fmt(c.totalG, 0)} g само восък`, c.container].filter(Boolean).join(", "),
          row("Свещ само восък", c.totalG, "g") + row("Вид съд", c.container) + row("Обем", c.volumeMl, "мл") + row("Диаметър", c.diameterCm, "см"))}
        ${section("Цвят", [c.dyeName, v(c.dyePercent) && `${fmt(c.dyePercent, 2)}%`].filter(Boolean).join(", "),
          row("Вид боя", c.dyeType) + row("Нюанс", c.dyeName) + row("Доза", v(c.dyePercent) ? `${fmt(c.dyePercent, 2)}% от восъка` : "") + row("Количество", c.dyeG, "g") + (v(c.dyeAmount) && !v(c.dyeG) ? row("Количество", c.dyeAmount, c.dyeUnit || "") : ""))}
        ${section("Температури и зреене", [v(c.tempPour) && `изливане ${fmt(c.tempPour, 0)}°C`, v(c.cureDays) && `${fmt(c.cureDays, 0)} дни`].filter(Boolean).join(", "),
          row("Добавяне на аромата", c.tempAdd, "°C") + row("Изливане", c.tempPour, "°C") + row("Зреене", c.cureDays, "дни"))}
        ${section("Тест за горене", c.burnNotes ? c.burnNotes.slice(0, 40) + (c.burnNotes.length > 40 ? "…" : "") : "",
          row("Време на горене", c.burnHours, "ч") + (c.burnNotes ? `<div class="row wide"><dt>Бележки</dt><dd>${esc(c.burnNotes)}</dd></div>` : ""))}
        ${uc.detail ? `<details class="fold"><summary><span><strong>Себестойност по материали</strong><small>${esc(eur(uc.detail.total))}${uc.detail.missing ? ", непълна" : ""}</small></span>${icons.chevron}</summary>${breakdown(uc.detail)}</details>` : ""}
        ${section("Цена и доставчик", [margin !== null && `печалба ${fmt(margin, 2)} € на брой`].filter(Boolean).join(""),
          (uc.source === "manual" ? row("Себестойност (ръчно)", c.cost, "€") : "") + row("Продажна цена", c.price, "€") + (margin !== null ? row("Печалба на брой", margin, "€") : "") + row("Доставчик", c.supplier))}
        ${section("Бележки", c.notes ? c.notes.slice(0, 40) + (c.notes.length > 40 ? "…" : "") : "", c.notes ? `<div class="row wide"><dt>Бележки</dt><dd>${esc(c.notes)}</dd></div>` : "")}
      </div>
      ${linked.length ? `<h2 class="sub-h">В календара</h2><ul class="link-list">${linked.map(p => `<li><a href="#/cal/post/${esc(p.id)}"><span>${dm(p.src.date)}</span>${esc(p.src.title)}</a></li>`).join("")}</ul>` : ""}
    </section>
    <footer class="action-bar">
      <a class="btn primary grow" href="#/edit/${esc(c.id)}">Редактирай</a>
      <button class="btn" id="dup">Дублирай</button>
      <button class="btn icon danger" id="del" aria-label="Изтрий рецептата"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3"/></svg></button>
    </footer>`;
  $$("[data-i]").forEach(b => b.addEventListener("click", () => openPhoto(photos[+b.dataset.i].blob)));
  $("#del").addEventListener("click", async () => {
    if (!confirm(`Да изтрия ли „${c.name}“? Снимките ѝ също ще бъдат изтрити.`)) return;
    for (const pid of c.photos || []) await db.del("photos", pid);
    await saveCandle({ id: c.id, deleted: true, name: c.name });
    toast("Рецептата е изтрита"); go("#/");
  });
  $("#dup").addEventListener("click", async () => {
    const copy = { ...c, id: uid(), name: `${c.name} (копие)`, photos: [], createdAt: Date.now(), date: new Date().toISOString().slice(0, 10) };
    await saveCandle(copy); toast("Създадено е копие без снимки"); go(`#/edit/${copy.id}`);
  });
}

// ---------- Редакция ----------
export const prefill = { value: null };
const CHAPTERS = [["osnovni", "Основни"], ["recepta", "Рецепта"], ["gorene", "Горене"], ["cena", "Цена"]];

export async function renderEdit(id) {
  const settings = await getSettings();
  const existing = id ? await db.get("candles", id) : null;
  const draft = existing ? { ...existing } : { id: uid(), createdAt: Date.now(), photos: [], date: new Date().toISOString().slice(0, 10), wickCount: 1, dyePercent: settings.maxDye, ...(prefill.value || {}) };
  const fin = await loadFin();
  const mats = matMap(fin.materials);
  const mult = await multiplier();
  prefill.value = null;
  let photoIds = [...(draft.photos || [])];
  const newPhotos = new Map();
  const removed = new Set();
  const f = (k, label, extra = {}) => field({ k, label, value: draft[k], ...extra });
  const group = (title, inner) => `<fieldset class="group"><legend>${title}</legend>${inner}</fieldset>`;
  const grid = (...xs) => `<div class="grid2">${xs.join("")}</div>`;
  const grid3 = (...xs) => `<div class="grid3">${xs.join("")}</div>`;
  const methodNote = settings.aromaMethod === "wax" ? "% от восъка" : "% от свещта";

  view().innerHTML = `
    <header class="edit-head">
      <a class="text-link" href="${existing ? `#/card/${esc(draft.id)}` : "#/"}">Отказ</a>
      <h1>${existing ? "Редакция" : "Нова рецепта"}</h1>
      <span class="spacer"></span>
    </header>
    <nav class="seg sticky-tabs" aria-label="Части на рецептата">${CHAPTERS.map(([cid, n], i) => `<a href="#" data-target="ch-${cid}" class="${i === 0 ? "on" : ""}">${n}</a>`).join("")}</nav>
    <form id="form" class="stack-form" autocomplete="off" novalidate>
      <section id="ch-osnovni" class="chapter"><div class="chapter-head"><span class="num">1</span><h2>Основни</h2><i></i></div>
        ${group("Снимки", `<div class="thumb-row" id="gallery"></div><label class="btn photo-btn">${icons.plus}Добави снимка<input id="photoInput" type="file" accept="image/*" multiple hidden></label>`)}
        ${group("Основни", f("name", "Име на свещта", { wide: true }) + grid(f("batch", "Партида"), f("date", "Дата", { type: "date" })) + f("collection", "Колекция", { options: COLLECTIONS, wide: true }) +
          `<label class="check-line"><input type="checkbox" name="_arrOnly" ${draft.arrangementOnly ? "checked" : ""}>Само за аранжировки (скрита от основния списък)</label>`)}
        ${group("Съд", f("container", "Вид съд", { wide: true, ph: "напр. стъклен буркан" }) + grid(f("volumeMl", "Обем", { type: "number", unit: "мл" }), f("diameterCm", "Диаметър", { type: "number", unit: "см" })))}
      </section>
      <section id="ch-recepta" class="chapter"><div class="chapter-head"><span class="num">2</span><h2>Рецепта</h2><i></i></div>
        ${group("Восък", grid(f("waxType", "Вид восък", { options: WAX_TYPES.map(w => w.name) }), f("totalG", "Свещ само восък", { type: "number", unit: "g" })) +
          `<details class="helper"><summary>Нов съд и още не знаете теглото?</summary>
            <p>Напълнете празния съд с вода до мястото, докъдето ще стига восъкът, и претеглете водата. Восъкът е по-лек, затова теглото само с восък е грамовете вода × коефициента на восъка (соев 0,86).</p>
            <div class="helper-row">${field({ k: "_water", label: "Грамове вода", type: "number", unit: "g" })}<button type="button" class="btn small" id="waterCalc">Изчисли</button></div>
            <p class="result-line" id="waterOut"></p></details>` +
          f("waxG", "Восък за свещта (изчислен)", { type: "number", unit: "g", readonly: true, wide: true }))}
        ${group("Фитил", grid3(f("wickSeries", "Серия", { ph: "ECO, CD…" }), f("wickSize", "Размер"), f("wickCount", "Брой", { type: "number" })))}
        ${group("Аромат", f("fragrance", "Ароматно масло", { wide: true }) + grid(f("fragranceLoad", "Аромат", { type: "number", unit: methodNote }), f("fragranceG", "Аромат (изчислен)", { type: "number", unit: "g", readonly: true })) + `<div class="calc-box" id="aromaOut"></div>`)}
        ${group("Цвят", grid(f("dyeType", "Вид боя", { options: DYE_TYPES }), f("dyeName", "Нюанс")) +
          grid(f("dyePercent", "Доза", { type: "number", unit: "% от восъка" }), f("dyeG", "Боя (изчислена)", { type: "number", unit: "g", readonly: true })) +
          `<div class="chips dose" role="group" aria-label="Бърза доза">${[["Наситен", settings.maxDye], ["Среден", settings.maxDye / 2], ["Светъл", settings.maxDye / 4]].map(([n, v]) => `<button type="button" class="chip" data-dose="${v}">${n} ${fmt(v, 2)}%</button>`).join("")}</div><div class="calc-box" id="dyeOut"></div>`)}
      </section>
      <section id="ch-gorene" class="chapter"><div class="chapter-head"><span class="num">3</span><h2>Горене</h2><i></i></div>
        ${group("Температури и зреене", grid3(f("tempAdd", "Аромат при", { type: "number", unit: "°C" }), f("tempPour", "Изливане", { type: "number", unit: "°C" }), f("cureDays", "Зреене", { type: "number", unit: "дни" })))}
        ${group("Горене", grid(f("burnHours", "Време на горене", { type: "number", unit: "ч" })) + f("burnNotes", "Бележки от теста", { type: "textarea", ph: "разтопен басейн, пламък, тунелиране…" }))}
      </section>
      <section id="ch-cena" class="chapter"><div class="chapter-head"><span class="num">4</span><h2>Цена и бележки</h2><i></i></div>
        ${group("Материали", `<p class="hint">Изберете материалите от склада (таб Финанси). Грамовете восък, аромат и боя идват от рецептата.${mats.size ? "" : " Складът още е празен: импортирайте поръчка или добавете материал."}</p>` +
          matSelect({ k: "matWax", label: "Восък", value: draft.matWax, mats, cats: ["Восък"], wide: true }) +
          matSelect({ k: "matAroma", label: "Ароматно масло", value: draft.matAroma, mats, cats: ["Аромат"], wide: true }) +
          matSelect({ k: "matDye", label: "Боя", value: draft.matDye, mats, cats: ["Боя"], wide: true }) +
          grid(matSelect({ k: "matWick", label: "Фитил", value: draft.matWick, mats, cats: ["Фитил"] }), f("wickLenCm", "Дължина на фитил", { type: "number", unit: "см", ph: "ако е на метър" })) +
          matSelect({ k: "matContainer", label: "Съд", value: draft.matContainer, mats, cats: ["Съд"], wide: true }) +
          `<span class="lbl">Етикет, опаковка, декорация</span><div id="extras" class="extras">${extrasRows("_ex", draft.extras, mats)}</div>` + addRowBtn("addExtra", "Добави материал") +
          `<div id="costOut"></div>`)}
        ${group("Цена", grid(f("price", "Вашата цена", { type: "number", unit: "€" }), f("cost", "Себестойност ръчно", { type: "number", unit: "€", ph: "ако няма материали" })) + f("supplier", "Доставчик", { wide: true }))}
        ${group("Бележки", f("notes", "Свободни бележки", { type: "textarea", ph: "Идеи за следващата партида…" }))}
      </section>
      <button class="btn primary block" type="submit">Запази рецептата</button>
    </form>`;

  const form = $("#form");
  const F = k => form.elements.namedItem(k);

  // Табове: скрол до частта и отбелязване на текущата
  const tabs = $$(".sticky-tabs a");
  tabs.forEach(a => a.addEventListener("click", e => { e.preventDefault(); const t = document.getElementById(a.dataset.target); window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - 118, behavior: "smooth" }); }));
  const onScroll = () => {
    let cur = CHAPTERS[0][0];
    for (const [cid] of CHAPTERS) { const el = document.getElementById("ch-" + cid); if (el && el.getBoundingClientRect().top < 140) cur = cid; }
    tabs.forEach(a => a.classList.toggle("on", a.dataset.target === "ch-" + cur));
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  const stopScroll = () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("hashchange", stopScroll); };
  window.addEventListener("hashchange", stopScroll);

  // Снимки
  const gallery = $("#gallery");
  async function drawGallery() {
    gallery.innerHTML = "";
    for (const pid of photoIds) {
      const p = newPhotos.get(pid) || await db.get("photos", pid);
      if (!p) continue;
      const el = document.createElement("div");
      el.className = "thumb";
      el.innerHTML = `<img alt="" src="${objURL(p.thumb || p.blob)}"><button type="button" aria-label="Премахни снимката">×</button>`;
      el.querySelector("button").addEventListener("click", () => { photoIds = photoIds.filter(x => x !== pid); if (!newPhotos.delete(pid)) removed.add(pid); drawGallery(); });
      gallery.appendChild(el);
    }
  }
  drawGallery();
  $("#photoInput").addEventListener("change", async e => {
    const files = [...e.target.files]; e.target.value = "";
    for (const file of files) {
      try {
        toast("Обработка на снимката…", 10000);
        const { blob, thumb } = await compressPhoto(file, CONFIG);
        const pid = uid(); newPhotos.set(pid, { blob, thumb }); photoIds.push(pid);
        toast(`Снимката е компресирана до ${Math.round(blob.size / 1024)} KB`);
      } catch (err) { toast(err.message || "Снимката не може да се прочете."); }
    }
    drawGallery();
  });

  // Изчисления
  // Себестойност на живо
  const costOut = $("#costOut");
  const updateCost = () => {
    const tmp = { waxG: F("waxG").value, fragranceG: F("fragranceG").value, dyeG: F("dyeG").value, wickCount: F("wickCount").value, wickLenCm: F("wickLenCm").value,
      matWax: F("matWax").value, matAroma: F("matAroma").value, matDye: F("matDye").value, matWick: F("matWick").value, matContainer: F("matContainer").value, extras: readExtras(form, "_ex") };
    const cc = candleCost(tmp, mats);
    const manual = num(F("cost").value);
    const cost = cc && cc.total > 0 ? cc.total : manual;
    costOut.innerHTML = breakdown(cc) + priceCard({ cost, source: cc && cc.total > 0 ? "materials" : manual !== null ? "manual" : "none", estimated: cc?.estimated, missing: cc?.missing, mult, price: F("price").value });
  };
  let extraIdx = (draft.extras || []).length;
  $("#addExtra").addEventListener("click", () => { $("#extras").insertAdjacentHTML("beforeend", extraRow("_ex", extraIdx++, {}, mats)); updateCost(); });
  $("#extras").addEventListener("click", e => { const b = e.target.closest("[data-rm-row]"); if (b) { b.closest(".extra-row").remove(); updateCost(); } });
  $("#extras").addEventListener("change", e => { const row = e.target.closest(".extra-row"); if (row && e.target.tagName === "SELECT") { const m = mats.get(e.target.value); row.querySelector("[data-unit]").textContent = m ? ({ g: "g", ml: "мл", "бр.": "бр.", "м": "м" }[m.unit] || "") : ""; } });
  form.addEventListener("input", e => { if (/^(_ex_|price$|cost$|wickLenCm$|wickCount$)/.test(e.target.name || "")) updateCost(); });
  form.addEventListener("change", e => { if (/^(mat|_ex_)/.test(e.target.name || "")) updateCost(); });

  const recalc = (force) => {
    const X = num(F("totalG").value), p = num(F("fragranceLoad").value);
    if (X !== null) {
      const one = perCandle(X, p || 0, settings.aromaMethod);
      F("waxG").value = Math.round(one.wax * 10) / 10;
      F("fragranceG").value = p !== null ? Math.round(one.aroma * 10) / 10 : "";
      $("#aromaOut").innerHTML = p !== null ? (settings.aromaMethod === "wax"
        ? `Восък: ${fmt(X, 1)} g ÷ ${fmt(1 + p / 100, 3)} = <strong>${fmt(one.wax, 1)} g</strong><br>Аромат: ${fmt(one.wax, 1)} g × ${fmt(p, 2)}% = <strong>${fmt(one.aroma, 1)} g</strong>`
        : `Аромат: ${fmt(X, 1)} g × ${fmt(p, 2)}% = <strong>${fmt(one.aroma, 1)} g</strong><br>Восък: ${fmt(X, 1)} g − ${fmt(one.aroma, 1)} g = <strong>${fmt(one.wax, 1)} g</strong>`) : "";
      const ofWax = one.wax ? one.aroma / one.wax * 100 : 0;
      if (p !== null && ofWax > settings.maxAroma + 1e-9) $("#aromaOut").innerHTML += `<br><span class="warn">Това е ${fmt(ofWax, 1)}% от восъка – над максимума от ${fmt(settings.maxAroma, 1)}%.</span>`;
    } else if (force) { $("#aromaOut").innerHTML = ""; }
    const W = num(F("waxG").value), d = num(F("dyePercent").value);
    F("dyeG").value = W !== null && d !== null ? Math.round(W * d / 100 * 100) / 100 : "";
    $("#dyeOut").innerHTML = W !== null && d !== null ? `${fmt(W, 1)} g восък × ${fmt(d, 2)}% = <strong>${fmt(W * d / 100, 2)} g боя</strong>${d > settings.maxDye + 1e-9 ? `<br><span class="warn">Над максимума от ${fmt(settings.maxDye, 2)}% от восъка.</span>` : Math.abs(d - settings.maxDye) < 1e-9 ? ". Това е максимумът: най-наситен цвят." : ""}` : "";
    $$(".dose .chip").forEach(b => b.classList.toggle("on", d !== null && Math.abs(+b.dataset.dose - d) < 1e-9));
    updateCost();
  };
  ["totalG", "fragranceLoad", "dyePercent"].forEach(k => F(k).addEventListener("input", () => recalc(true)));
  $$(".dose .chip").forEach(b => b.addEventListener("click", () => { F("dyePercent").value = fmt(+b.dataset.dose, 3); recalc(true); }));
  $("#waterCalc").addEventListener("click", () => {
    const water = num(F("_water").value);
    const wax = WAX_TYPES.find(w => w.name === F("waxType").value);
    if (water === null) return toast("Въведете грамовете вода.");
    if (!wax || !wax.factor) return toast("Изберете вид восък: соев, парафин или пчелен.");
    const X = Math.round(water * wax.factor);
    F("totalG").value = X;
    if (!F("volumeMl").value) F("volumeMl").value = Math.round(water);
    $("#waterOut").innerHTML = `${fmt(water, 0)} g вода × ${fmt(wax.factor, 2)} = <strong>${fmt(X, 0)} g само восък</strong>`;
    recalc(true);
  });
  recalc(false);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!F("name").value.trim()) { F("name").focus(); return toast("Въведете име на свещта."); }
    const data = { ...draft };
    for (const el of form.elements) {
      if (!el.name || el.name.startsWith("_")) continue;
      const numeric = ["volumeMl", "diameterCm", "totalG", "waxG", "wickCount", "wickLenCm", "fragranceLoad", "fragranceG", "dyePercent", "dyeG", "tempAdd", "tempPour", "cureDays", "burnHours", "cost", "price"].includes(el.name);
      const raw = el.value.trim();
      const val = numeric ? num(raw) : raw;
      if (val === "" || val === null) delete data[el.name]; else data[el.name] = val;
    }
    const extras = readExtras(form, "_ex");
    if (extras.length) data.extras = extras; else delete data.extras;
    if (F("_arrOnly").checked) data.arrangementOnly = true; else delete data.arrangementOnly;
    for (const [pid, p] of newPhotos) await db.put("photos", { id: pid, blob: p.blob, thumb: p.thumb, uploaded: false, createdAt: Date.now() });
    for (const pid of removed) await db.del("photos", pid);
    data.photos = photoIds;
    await saveCandle(data);
    toast("Рецептата е запазена");
    go(`#/card/${data.id}`);
  });
}

// ---------- Експорт за Excel ----------
export const CSV_COLUMNS = [["name", "Име"], ["batch", "Партида"], ["date", "Дата"], ["collection", "Колекция"], ["container", "Съд"], ["volumeMl", "Обем (мл)"], ["diameterCm", "Диаметър (см)"], ["waxType", "Восък"], ["totalG", "Свещ само восък (g)"], ["waxG", "Восък (g)"], ["wickSeries", "Фитил серия"], ["wickSize", "Фитил размер"], ["wickCount", "Брой фитили"], ["fragrance", "Аромат"], ["fragranceLoad", "Аромат (%)"], ["fragranceG", "Аромат (g)"], ["dyeType", "Боя"], ["dyeName", "Нюанс"], ["dyePercent", "Боя (%)"], ["dyeG", "Боя (g)"], ["tempAdd", "Аромат при (°C)"], ["tempPour", "Изливане (°C)"], ["cureDays", "Зреене (дни)"], ["burnHours", "Горене (ч)"], ["burnNotes", "Бележки от теста"], ["cost", "Себестойност (€)"], ["price", "Цена (€)"], ["supplier", "Доставчик"], ["notes", "Бележки"]];
