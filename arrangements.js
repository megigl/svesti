// Аранжировки и букети: сглобяват се от рецептите за свещи и материали от склада.
// Пазят се в хранилището "candles" с kind: "arrangement", за да се синхронизират заедно със снимките.
import { CONFIG } from "./config.js";
import { db } from "./db.js";
import { COLLECTIONS, num, fmt } from "./calc.js";
import { compressPhoto } from "./image.js";
import { $, $$, esc, uid, view, objURL, toast, go, openPhoto, field, icons } from "./ui.js";
import * as sync from "./sync.js";
import { liveCandles, kindSeg } from "./recipes.js";
import { loadFin, matMap, arrangementCost, multiplier } from "./finance.js";
import { extraRow, extrasRows, readExtras, breakdown, priceCard, addRowBtn, eur } from "./cost-ui.js";

export async function liveArrangements() {
  return (await db.getAll("candles")).filter(c => !c.deleted && c.kind === "arrangement").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
async function saveArr(a) { a.updatedAt = Date.now(); await db.put("candles", a); sync.scheduleSync(); }

// ---------- Списък ----------
export async function renderArrList() {
  const items = await liveArrangements();
  const candles = await liveCandles();
  const mats = matMap((await loadFin()).materials);
  view().innerHTML = `
    <header class="page-head">
      <div class="title-row"><h1>Рецепти</h1><span class="muted">${items.length ? `${items.length} ${items.length === 1 ? "аранжировка" : "аранжировки"}` : ""}</span></div>
      ${kindSeg("a")}
    </header>
    <ul class="recipe-grid" id="grid"></ul>
    ${items.length ? "" : `<div class="empty"><p>Още няма аранжировки. Сглобете първата от свещите в рецептите и материали от склада, като кутия, панделка или сухи цветя.</p><a class="btn primary" href="#/arr-new">Нова аранжировка</a></div>`}
    <a class="fab" href="#/arr-new">${icons.plus}Нова аранжировка</a>`;
  const ul = $("#grid");
  for (const a of items) {
    const cost = arrangementCost(a, candles, mats);
    const count = (a.items || []).reduce((s, it) => s + (num(it.q) || 0), 0);
    const li = document.createElement("li");
    li.innerHTML = `<a href="#/arr-card/${esc(a.id)}"><span class="ph-box">${icons.candle}</span><strong>${esc(a.name || "Без име")}</strong><span class="sub">${count ? `${fmt(count, 0)} ${count === 1 ? "свещ" : "свещи"}` : "без свещи"}${num(a.price) !== null ? `<br>${eur(num(a.price))}` : cost.total ? `<br>материали ${eur(cost.total)}` : ""}</span></a>`;
    ul.appendChild(li);
    if (a.photos?.length) db.get("photos", a.photos[0]).then(p => { if (p) { const b = li.querySelector(".ph-box"); b.innerHTML = ""; b.style.backgroundImage = `url(${objURL(p.thumb || p.blob)})`; b.classList.add("has"); } });
  }
}

// ---------- Аранжировка ----------
export async function renderArrDetail(id) {
  const a = await db.get("candles", id);
  if (!a || a.deleted || a.kind !== "arrangement") { view().innerHTML = `<div class="empty"><p>Аранжировката не е намерена.</p><a class="btn" href="#/arr">Към аранжировките</a></div>`; return; }
  const candles = await liveCandles();
  const mats = matMap((await loadFin()).materials);
  const mult = await multiplier();
  const cost = arrangementCost(a, candles, mats);
  const photos = (await Promise.all((a.photos || []).map(pid => db.get("photos", pid)))).filter(Boolean);
  const cmap = new Map(candles.map(c => [c.id, c]));
  view().innerHTML = `
    <div class="hero">
      ${photos.length ? `<button class="hero-img" data-i="0" aria-label="Отвори снимката"><img alt="" src="${objURL(photos[0].blob)}"></button>` : `<div class="hero-img empty-ph">${icons.candle}</div>`}
      <a class="round-back" href="#/arr" aria-label="Назад към аранжировките">${icons.back}</a>
      ${a.collection ? `<span class="hero-tag"><i></i>${esc(a.collection)}</span>` : ""}
    </div>
    ${photos.length > 1 ? `<div class="thumbs">${photos.slice(1).map((p, i) => `<button data-i="${i + 1}" aria-label="Отвори снимка ${i + 2}"><img alt="" src="${objURL(p.thumb || p.blob)}"></button>`).join("")}</div>` : ""}
    <section class="detail">
      <h1>${esc(a.name || "Без име")}</h1>
      <p class="muted">Аранжировка</p>
      ${priceCard({ cost: cost.lines.length ? cost.total : null, source: "materials", estimated: cost.estimated, missing: cost.missing, mult, price: a.price })}
      <h2 class="sub-h">Състав</h2>
      ${breakdown(cost) || `<p class="muted">Още няма добавени свещи и материали.</p>`}
      ${(a.items || []).length ? `<ul class="link-list">${a.items.map(it => cmap.get(it.c) ? `<li><a href="#/card/${esc(it.c)}"><span>${fmt(num(it.q) || 1, 0)} ×</span>${esc(cmap.get(it.c).name)}</a></li>` : "").join("")}</ul>` : ""}
      ${a.notes ? `<h2 class="sub-h">Бележки</h2><p class="notes">${esc(a.notes)}</p>` : ""}
    </section>
    <footer class="action-bar">
      <a class="btn primary grow" href="#/arr-edit/${esc(a.id)}">Редактирай</a>
      <button class="btn" id="dup">Копирай</button>
      <button class="btn icon danger" id="del" aria-label="Изтрий аранжировката"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3"/></svg></button>
    </footer>`;
  $$("[data-i]").forEach(b => b.addEventListener("click", () => openPhoto(photos[+b.dataset.i].blob)));
  $("#del").addEventListener("click", async () => {
    if (!confirm(`Да изтрия ли „${a.name}“? Снимките ѝ също ще бъдат изтрити.`)) return;
    for (const pid of a.photos || []) await db.del("photos", pid);
    await saveArr({ id: a.id, kind: "arrangement", deleted: true, name: a.name });
    toast("Аранжировката е изтрита"); go("#/arr");
  });
  $("#dup").addEventListener("click", async () => {
    const copy = { ...a, id: uid(), name: `${a.name} (копие)`, photos: [], createdAt: Date.now() };
    await saveArr(copy); toast("Копието е създадено. Сменете каквото е различно."); go(`#/arr-edit/${copy.id}`);
  });
}

// ---------- Редакция ----------
export async function renderArrEdit(id) {
  const existing = id ? await db.get("candles", id) : null;
  const draft = existing && !existing.deleted ? { ...existing } : { id: uid(), kind: "arrangement", createdAt: Date.now(), photos: [], items: [], extras: [] };
  const candles = await liveCandles();
  const mats = matMap((await loadFin()).materials);
  const mult = await multiplier();
  let photoIds = [...(draft.photos || [])];
  const newPhotos = new Map();
  const removed = new Set();
  const candleOpts = sel => `<option value=""></option>${candles.map(c => `<option value="${esc(c.id)}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}${c.arrangementOnly ? " (за аранжировки)" : ""}</option>`).join("")}`;
  const itemRow = (i, it) => `<div class="extra-row" data-row="${i}">
    <label class="field"><span class="lbl">Свещ</span><span class="ctl"><select name="_it_c_${i}">${candleOpts(it.c)}</select></span></label>
    <label class="field"><span class="lbl">Брой</span><span class="ctl"><input name="_it_q_${i}" inputmode="decimal" value="${esc(it.q ?? 1)}"><span class="unit">бр.</span></span></label>
    <button type="button" class="btn icon small-x" data-rm-row="${i}" aria-label="Премахни реда">×</button></div>`;
  const group = (title, inner) => `<fieldset class="group"><legend>${title}</legend>${inner}</fieldset>`;
  view().innerHTML = `
    <header class="edit-head">
      <a class="text-link" href="${existing ? `#/arr-card/${esc(draft.id)}` : "#/arr"}">Отказ</a>
      <h1>${existing ? "Редакция" : "Нова аранжировка"}</h1>
      <span class="spacer"></span>
    </header>
    <form id="form" class="stack-form" autocomplete="off" novalidate>
      ${group("Снимки", `<div class="thumb-row" id="gallery"></div><label class="btn photo-btn">${icons.plus}Добави снимка<input id="photoInput" type="file" accept="image/*" multiple hidden></label>`)}
      ${group("Основни", field({ k: "name", label: "Име", value: draft.name, wide: true }) + field({ k: "collection", label: "Колекция", value: draft.collection, options: COLLECTIONS, wide: true }))}
      ${group("Свещи", `${candles.length ? "" : `<p class="hint">Още няма рецепти за свещи. Първо създайте рецептите, после ги добавете тук.</p>`}<div id="items" class="extras">${(draft.items || []).map((it, i) => itemRow(i, it)).join("")}</div>${addRowBtn("addItem", "Добави свещ")}`)}
      ${group("Материали", `<p class="hint">Кутия, поднос, панделка, сухи цветя, декорации. Количеството е в мярката на материала.</p><div id="extras" class="extras">${extrasRows("_ex", draft.extras, mats)}</div>${addRowBtn("addExtra", "Добави материал")}`)}
      ${group("Цена", `<div id="costOut"></div>` + `<div class="grid2">${field({ k: "price", label: "Вашата цена", value: draft.price, type: "number", unit: "€" })}</div>`)}
      ${group("Бележки", field({ k: "notes", label: "Свободни бележки", value: draft.notes, type: "textarea" }))}
      <button class="btn primary block" type="submit">Запази аранжировката</button>
    </form>`;
  const form = $("#form");
  const F = k => form.elements.namedItem(k);
  const readItems = () => {
    const out = [];
    form.querySelectorAll('[name^="_it_c_"]').forEach(sel => { const i = sel.name.split("_").pop(); if (sel.value) out.push({ c: sel.value, q: num(F(`_it_q_${i}`)?.value) ?? 1 }); });
    return out;
  };
  const updateCost = () => {
    const cost = arrangementCost({ items: readItems(), extras: readExtras(form, "_ex") }, candles, mats);
    $("#costOut").innerHTML = breakdown(cost) + priceCard({ cost: cost.lines.length ? cost.total : null, source: "materials", estimated: cost.estimated, missing: cost.missing, mult, price: F("price").value });
  };
  let itemIdx = (draft.items || []).length, extraIdx = (draft.extras || []).length;
  $("#addItem").addEventListener("click", () => { $("#items").insertAdjacentHTML("beforeend", itemRow(itemIdx++, { q: 1 })); updateCost(); });
  $("#addExtra").addEventListener("click", () => { $("#extras").insertAdjacentHTML("beforeend", extraRow("_ex", extraIdx++, {}, mats)); updateCost(); });
  form.addEventListener("click", e => { const b = e.target.closest("[data-rm-row]"); if (b) { b.closest(".extra-row").remove(); updateCost(); } });
  form.addEventListener("change", e => {
    const row = e.target.closest("#extras .extra-row");
    if (row && e.target.tagName === "SELECT") { const m = mats.get(e.target.value); row.querySelector("[data-unit]").textContent = m ? ({ g: "g", ml: "мл", "бр.": "бр.", "м": "м" }[m.unit] || "") : ""; }
    updateCost();
  });
  form.addEventListener("input", e => { if (/^(_it_q_|_ex_q_|price$)/.test(e.target.name || "")) updateCost(); });
  updateCost();

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

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!F("name").value.trim()) { F("name").focus(); return toast("Въведете име на аранжировката."); }
    const data = { ...draft, kind: "arrangement", name: F("name").value.trim(), collection: F("collection").value || undefined, notes: F("notes").value.trim() || undefined, items: readItems(), extras: readExtras(form, "_ex") };
    const price = num(F("price").value);
    if (price !== null) data.price = price; else delete data.price;
    for (const k of ["collection", "notes"]) if (data[k] === undefined) delete data[k];
    for (const [pid, p] of newPhotos) await db.put("photos", { id: pid, blob: p.blob, thumb: p.thumb, uploaded: false, createdAt: Date.now() });
    for (const pid of removed) await db.del("photos", pid);
    data.photos = photoIds;
    await saveArr(data);
    toast("Аранжировката е запазена");
    go(`#/arr-card/${data.id}`);
  });
}
