// Екраните на календара: месец, седмица, пост, редакция, импорт.
import { CONFIG } from "./config.js";
import { db, getSettings } from "./db.js";
import { COLLECTIONS } from "./calc.js";
import { compressPhoto } from "./image.js";
import { $, $$, esc, uid, view, objURL, toast, go, openPhoto, field, icons } from "./ui.js";
import * as sync from "./sync.js";
import { liveCandles } from "./recipes.js";
import {
  loadCalendar, dayItems, phaseOn, nextDeadline, upcomingTasks, toggleMark, saveCal, previewImport, applyImport, purgePublishedPhotos,
  iso, parseISO, today, addDays, mondayOf, daysBetween, dm, weekdayName, MONTHS, FORMATS, TASK_TYPES, defaultLocal, countKinds,
} from "./calendar.js";

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const seg = active => `<nav class="seg" aria-label="Изглед"><a href="#/cal" class="${active === "m" ? "on" : ""}">Месец</a><a href="#/cal/week/${mondayOf(today())}" class="${active === "w" ? "on" : ""}">Седмица</a></nav>`;
const taskIcon = t => icons[{ "изработка": "make", "снимки": "photo", "текстове": "text" }[t] || "other"];
const changed = () => sync.scheduleSync();

function deadlineBanner(cal) {
  const d = nextDeadline(cal);
  if (!d) return "";
  const left = daysBetween(today(), d.src.orderDeadline);
  const when = left === 0 ? "днес" : left === 1 ? "остава 1 ден" : `остават ${left} дни`;
  return `<div class="banner"><i></i><div><span class="muted">Следващ срок, ${when}</span><strong>${esc(d.src.occasion)}${d.src.deadlineNote ? `: ${esc(d.src.deadlineNote)}` : ""} до ${dm(d.src.orderDeadline)}${d.src.orderDeadlineTime ? `, ${esc(d.src.orderDeadlineTime)}` : ""}</strong></div></div>`;
}

function taskRow(t, posts) {
  const forDates = (t.src.forPosts || []).map(c => posts.find(p => p.id === c)).filter(Boolean).map(p => dm(p.src.date));
  const late = t.src.date < today() && !t.local.done;
  return `<div class="task${t.local.done ? " done" : ""}">
    <input type="checkbox" data-task="${esc(t.id)}" ${t.local.done ? "checked" : ""} aria-label="Готово: ${esc(t.src.title)}">
    <a href="#/cal/task/${esc(t.id)}" class="task-body"><span class="muted">${dm(t.src.date)}, ${esc(t.src.type || "задача")}${late ? ` <em class="late">закъсняла</em>` : ""}</span>
      <strong>${esc(t.src.title)}</strong>
      ${t.src.details ? `<span class="muted">${esc(t.src.details)}</span>` : ""}
      ${forDates.length ? `<span class="muted">За постовете: ${forDates.join(", ")}</span>` : ""}
      ${t.src.note ? `<span class="note">${esc(t.src.note)}</span>` : ""}</a>
    <span class="task-ic">${taskIcon(t.src.type)}</span></div>`;
}
function bindTasks(root, cal) {
  $$("[data-task]", root).forEach(cb => cb.addEventListener("change", async () => {
    const t = cal.tasks.find(x => x.id === cb.dataset.task);
    t.local = { ...t.local, done: cb.checked };
    await saveCal(t); changed();
    cb.closest(".task").classList.toggle("done", cb.checked);
  }));
}
async function firstPhoto(p) {
  const pid = (p.local.photos || [])[0];
  return pid ? db.get("photos", pid) : null;
}

// ---------- Празен календар ----------
function emptyCal() {
  return `<div class="empty"><p>Календарът е празен. Импортирайте файла от другия проект (made-for-home-kalendar-….json) или добавете пост ръчно.</p>
    <label class="btn primary">Импорт на календар<input type="file" accept="application/json,.json" data-import hidden></label>
    <a class="btn outline" href="#/cal/new-post">Нов пост</a></div>`;
}
export function bindImport(root = document) {
  $$("[data-import]", root).forEach(inp => inp.addEventListener("change", async e => {
    const file = e.target.files[0]; e.target.value = "";
    if (file) await importCalendarFile(file);
  }));
}

// ---------- Месец ----------
export async function renderMonth(ym) {
  const cal = await loadCalendar();
  const t = today();
  const [y, m] = (ym || t.slice(0, 7)).split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const start = mondayOf(iso(first));
  const lastDay = new Date(y, m, 0);
  const end = addDays(mondayOf(iso(lastDay)), 6);
  const prev = iso(new Date(y, m - 2, 1)).slice(0, 7), next = iso(new Date(y, m, 1)).slice(0, 7);
  const upcomingPosts = cal.posts.filter(p => p.src.date >= t).length;
  if (!cal.all.some(r => ["post", "task", "deadline"].includes(r.kind))) {
    view().innerHTML = `<header class="page-head"><div class="title-row"><h1>Календар</h1></div></header>${emptyCal()}`;
    bindImport(); return;
  }
  const cells = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const it = dayItems(cal, d);
    const other = d.slice(0, 7) !== `${y}-${String(m).padStart(2, "0")}`;
    const marks = (it.posts.length ? `<i class="mk mk-post"></i>` : "") + (it.tasks.length ? `<i class="mk mk-task"></i>` : "") + (it.occasions.length || it.orderDeadlines.length ? `<i class="mk mk-dead"></i>` : "");
    cells.push(`<a href="#/cal/week/${mondayOf(d)}" class="day${other ? " other" : ""}${d === t ? " today" : ""}" data-day="${d}" aria-label="${parseISO(d).getDate()} ${MONTHS[parseISO(d).getMonth()]}"><span class="n">${parseISO(d).getDate()}</span><span class="th"></span><span class="mks">${marks}</span></a>`);
  }
  const up = upcomingTasks(cal);
  view().innerHTML = `
    <header class="page-head">
      <div class="title-row"><h1>Календар</h1><span class="muted">${upcomingPosts} ${upcomingPosts === 1 ? "предстоящ пост" : "предстоящи поста"}</span></div>
      ${seg("m")}
      ${deadlineBanner(cal)}
    </header>
    <section class="month">
      <div class="month-nav"><a href="#/cal/m/${prev}" aria-label="Предишен месец">‹</a><h2>${cap(MONTHS[m - 1])} ${y}</h2><a href="#/cal/m/${next}" aria-label="Следващ месец">›</a></div>
      <div class="cal-grid">${["пн", "вт", "ср", "чт", "пт", "сб", "нд"].map(w => `<span class="wd">${w}</span>`).join("")}${cells.join("")}</div>
      <div class="legend"><span><i class="mk mk-post"></i>пост</span><span><i class="mk mk-task"></i>задача</span><span><i class="mk mk-dead"></i>срок или повод</span></div>
    </section>
    <section class="upcoming">
      <h2 class="sub-h">Предстои</h2>
      ${up.overdue.map(x => taskRow(x, cal.posts)).join("")}
      ${up.next.map(x => taskRow(x, cal.posts)).join("") || (up.overdue.length ? "" : `<p class="muted">Няма предстоящи задачи.</p>`)}
    </section>
    <div class="row-actions"><a class="btn outline" href="#/cal/new-post">${icons.plus}Нов пост</a><a class="btn outline" href="#/cal/new-task">${icons.plus}Нова задача</a></div>`;
  bindTasks(view(), cal);
  // малки снимки в дните с пост
  for (const p of cal.posts) {
    if (p.src.date < start || p.src.date > end) continue;
    firstPhoto(p).then(ph => { if (!ph) return; const el = view().querySelector(`[data-day="${p.src.date}"] .th`); if (el) { el.style.backgroundImage = `url(${objURL(ph.thumb || ph.blob)})`; el.classList.add("has"); } });
  }
}

// ---------- Седмица ----------
export async function renderWeek(monday) {
  const cal = await loadCalendar();
  const mon = mondayOf(monday || today());
  const sun = addDays(mon, 6);
  const days = [...Array(7)].map((_, i) => addDays(mon, i));
  const phase = days.map(d => phaseOn(cal, d)).find(Boolean);
  const fmtRange = `${parseISO(mon).getDate()} ${MONTHS[parseISO(mon).getMonth()]} – ${parseISO(sun).getDate()} ${MONTHS[parseISO(sun).getMonth()]}`;
  const phaseIdx = phase ? [...cal.phases].sort((a, b) => a.src.from.localeCompare(b.src.from)).findIndex(p => p.id === phase.id) + 1 : 0;
  const sections = [];
  for (const d of days) {
    const it = dayItems(cal, d);
    const parts = [];
    it.occasions.forEach(o => parts.push(`<div class="dl"><i></i>${esc(o.src.occasion)}</div>`));
    it.orderDeadlines.forEach(o => parts.push(`<div class="dl"><i></i>Краен срок: ${esc(o.src.occasion)}${o.src.deadlineNote ? `, ${esc(o.src.deadlineNote)}` : ""}${o.src.orderDeadlineTime ? ` до ${esc(o.src.orderDeadlineTime)}` : ""}</div>`));
    for (const p of it.posts) parts.push(`<a class="post-card" href="#/cal/post/${esc(p.id)}"><span class="pc-th" data-post="${esc(p.id)}">${icons.candle}</span><span class="pc-body">
      <span class="muted"><i class="mk mk-post"></i>Пост, ${esc(p.src.format || "")}${p.src.time ? `, ${esc(p.src.time)}` : ""}${p.local.published ? ` <em class="ok">публикуван</em>` : ""}</span>
      <strong>${p.src.isNew ? `<b class="new">НОВО</b> ` : ""}${esc(p.src.title)}</strong>
      ${p.src.cta ? `<span class="muted">${esc(p.src.cta)}</span>` : ""}
      <span class="tags">${p.src.keyword ? `<b class="kw">${esc(p.src.keyword)}</b>` : ""}${p.src.batch ? `<b class="tag">${esc(p.src.batch)}</b>` : ""}</span></span></a>`);
    it.tasks.forEach(t => parts.push(taskRow(t, cal.posts)));
    it.stories.forEach(s => parts.push(`<label class="story"><input type="checkbox" data-mark="${esc(s.markId)}" ${s.done ? "checked" : ""}><span><span class="muted">Стори: </span>${esc(s.rule.src.story)}${s.rule.src.sticker ? `<span class="muted">, ${esc(s.rule.src.sticker)}</span>` : ""}</span></label>`));
    sections.push(`<section class="day-sec${d === today() ? " is-today" : ""}" id="d-${d}"><h3>${cap(weekdayName(d))}<span class="muted">${dm(d)}</span></h3>${parts.join("") || `<p class="muted">Свободен ден</p>`}</section>`);
  }
  view().innerHTML = `
    <header class="page-head">
      <div class="title-row"><h1>Календар</h1></div>
      ${seg("w")}
      <div class="week-nav"><a href="#/cal/week/${addDays(mon, -7)}" aria-label="Предишна седмица">‹</a><strong>${fmtRange}</strong><a href="#/cal/week/${addDays(mon, 7)}" aria-label="Следваща седмица">›</a></div>
      ${phase ? `<div class="phase"><span>Фаза ${phaseIdx} от ${cal.phases.length}</span><strong>${esc(phase.src.name)}: ${dm(phase.src.from)} – ${dm(phase.src.to)}</strong>${phase.src.goal ? `<span>Цел: ${esc(phase.src.goal)}${(phase.src.keywords || []).length ? `. Ключови думи: ${phase.src.keywords.map(esc).join(", ")}` : ""}</span>` : ""}</div>` : ""}
    </header>
    <main class="week">${sections.join("")}</main>`;
  bindTasks(view(), cal);
  $$("[data-mark]").forEach(cb => cb.addEventListener("change", async () => { await toggleMark(cb.dataset.mark, cb.checked); changed(); }));
  $$("[data-post]").forEach(async el => { const p = cal.posts.find(x => x.id === el.dataset.post); const ph = await firstPhoto(p); if (ph) { el.innerHTML = ""; el.style.backgroundImage = `url(${objURL(ph.thumb || ph.blob)})`; el.classList.add("has"); } });
  const td = document.getElementById("d-" + today());
  if (td) setTimeout(() => window.scrollTo({ top: td.getBoundingClientRect().top + scrollY - 70 }), 0);
}

// ---------- Пост ----------
export async function renderPost(id) {
  const p = await db.get("cal", id);
  if (!p || p.deleted) { view().innerHTML = `<div class="empty"><p>Постът не е намерен.</p><a class="btn" href="#/cal">Към календара</a></div>`; return; }
  const settings = await getSettings();
  const cal = await loadCalendar();
  const recipes = await liveCandles();
  const s = p.src, L = p.local = { ...defaultLocal("post"), ...p.local };
  const photos = (await Promise.all(L.photos.map(pid => db.get("photos", pid)))).filter(Boolean);
  const batchTasks = s.batch ? cal.tasks.filter(t => t.src.batch === s.batch) : [];
  const linked = recipes.filter(r => L.recipeIds.includes(r.id));
  const d = parseISO(s.date);
  const kv = (k, v) => v ? `<div class="kv"><span class="muted">${k}</span><span>${v}</span></div>` : "";
  view().innerHTML = `
    <header class="page-head post-head">
      <a class="text-link" href="#/cal/week/${mondayOf(s.date)}">‹ Седмица</a>
      <p class="muted">${cap(weekdayName(s.date))}, ${dm(s.date)}.${d.getFullYear()}${s.time ? `, ${esc(s.time)}` : ""} ${s.isNew ? `<b class="new">НОВО</b>` : ""}</p>
      <h1>${esc(s.title || "Пост")}</h1>
      <div class="plats">${["Instagram", "Facebook", "TikTok"].map(n => `<span class="${(s.platforms || []).includes(n) ? "on" : ""}">${n}</span>`).join("")}</div>
    </header>
    <section class="post-photos">
      <span class="muted">Снимки за вдъхновение</span>
      <div class="thumb-row">${photos.map(ph => `<div class="thumb big"><button type="button" class="open" data-open="${esc(ph.id)}" aria-label="Отвори снимката"><img alt="" src="${objURL(ph.thumb || ph.blob)}"></button><button type="button" class="x" data-rm="${esc(ph.id)}" aria-label="Премахни снимката">×</button></div>`).join("")}
        <label class="thumb big add">${icons.plus}<span>Снимка</span><input type="file" accept="image/*" multiple hidden id="addPhoto"></label></div>
      ${L.photosPurged ? `<p class="muted">Снимките са изтрити след публикуването. Текстът остава.</p>` : ""}
      ${s.isNew ? `<p class="flag"><i></i>Снимките за вдъхновение са от други майстори, само за ориентир. Не се публикуват.</p>` : ""}
      ${s.profileExample ? `<p class="muted">Пример от профила: ${esc(s.profileExample)}</p>` : ""}
      ${s.inspiration ? `<p class="muted">Вдъхновение: ${esc(s.inspiration)}</p>` : ""}
    </section>
    <section class="kvs">
      ${kv("Формат", esc(s.format))}
      ${kv("Призив към действие", `${esc(s.cta)}${s.keyword ? `<br>Ключова дума: <strong>${esc(s.keyword)}</strong>` : ""}`)}
      ${kv("Насоки", esc(s.guidelines))}
      ${s.batch ? `<div class="kv"><span class="muted">Изработка</span><span>${esc(s.batch)}${s.batchNote ? ` (${esc(s.batchNote)})` : ""}</span>${batchTasks.map(t => `<a class="mini-link" href="#/cal/week/${mondayOf(t.src.date)}">${dm(t.src.date)}: ${esc(t.src.title)}${t.local.done ? ", готово" : ""}</a>`).join("")}</div>` : ""}
      ${kv("Колекция", esc(s.collection))}
      <div class="kv"><span class="muted">Свързани рецепти</span>
        <div class="linked">${linked.map(r => `<a class="chip" href="#/card/${esc(r.id)}">${esc(r.name)}</a>`).join("") || `<span class="muted">Няма избрани</span>`}
        <button type="button" class="btn small outline" id="pickRecipes">${linked.length ? "Промени" : "Добави"}</button></div></div>
    </section>
    <label class="caption"><span class="muted">Текст за публикуване</span><textarea id="caption" rows="6" placeholder="Текстът от неделната сесия…">${esc(L.caption)}</textarea></label>
    <button type="button" class="btn outline block" id="copy">Копирай текста</button>
    <div class="publish">
      <label><input type="checkbox" id="published" ${L.published ? "checked" : ""}>Публикуван</label>
      <span class="muted">${settings.graceDays} ${settings.graceDays == 1 ? "ден" : "дни"} след датата снимките се изтриват, а текстът остава за догодина.</span>
    </div>
    <div class="row-actions"><a class="btn outline" href="#/cal/post/${esc(p.id)}/edit">Редактирай</a><button class="btn outline danger" id="delPost">Изтрий поста</button></div>
    <dialog id="picker" class="sheet"><form method="dialog"><h2>Свързани рецепти</h2>
      <div class="pick-list">${recipes.map(r => `<label><input type="checkbox" value="${esc(r.id)}" ${L.recipeIds.includes(r.id) ? "checked" : ""}>${esc(r.name)}</label>`).join("") || `<p class="muted">Още няма рецепти.</p>`}</div>
      <button class="btn primary block" value="ok">Готово</button></form></dialog>`;

  const save = async () => { await saveCal(p); changed(); };
  let tmr;
  $("#caption").addEventListener("input", e => { L.caption = e.target.value; clearTimeout(tmr); tmr = setTimeout(save, 700); });
  $("#caption").addEventListener("blur", () => { clearTimeout(tmr); save(); });
  $("#copy").addEventListener("click", async () => {
    const text = $("#caption").value;
    if (!text.trim()) return toast("Още няма текст за копиране.");
    try { await navigator.clipboard.writeText(text); toast("Текстът е копиран"); }
    catch { $("#caption").select(); document.execCommand("copy"); toast("Текстът е копиран"); }
  });
  $("#published").addEventListener("change", async e => { L.published = e.target.checked; L.publishedAt = e.target.checked ? Date.now() : null; await save(); toast(e.target.checked ? "Отбелязан като публикуван" : "Отметката е махната"); });
  $$("[data-open]").forEach(b => b.addEventListener("click", () => openPhoto(photos.find(x => x.id === b.dataset.open).blob)));
  $$("[data-rm]").forEach(b => b.addEventListener("click", async () => {
    L.photos = L.photos.filter(x => x !== b.dataset.rm); await db.del("photos", b.dataset.rm); await save(); renderPost(id);
  }));
  $("#addPhoto").addEventListener("change", async e => {
    const files = [...e.target.files]; e.target.value = "";
    for (const f of files) {
      try {
        toast("Обработка на снимката…", 10000);
        const { blob, thumb } = await compressPhoto(f, CONFIG);
        const pid = uid();
        await db.put("photos", { id: pid, blob, thumb, uploaded: false, createdAt: Date.now() });
        L.photos = [...L.photos, pid]; L.photosPurged = false;
      } catch (err) { toast(err.message || "Снимката не може да се прочете."); }
    }
    await save(); toast("Снимката е добавена"); renderPost(id);
  });
  const dlg = $("#picker");
  $("#pickRecipes").addEventListener("click", () => dlg.showModal());
  dlg.addEventListener("close", async () => {
    L.recipeIds = $$(".pick-list input:checked", dlg).map(i => i.value);
    await save(); renderPost(id);
  });
  $("#delPost").addEventListener("click", async () => {
    if (!confirm("Да изтрия ли поста? Снимките му също ще бъдат изтрити." + (String(p.id).startsWith("M-") ? "" : " Ако после импортирате календар, в който го има, той ще се върне."))) return;
    for (const pid of L.photos) await db.del("photos", pid);
    await saveCal({ id: p.id, kind: "post", deleted: true }); changed();
    toast("Постът е изтрит"); go(`#/cal/week/${mondayOf(s.date)}`);
  });
}

// ---------- Редакция на пост ----------
export async function renderPostEdit(id) {
  const existing = id ? await db.get("cal", id) : null;
  const rec = existing && !existing.deleted ? existing : { id: "M-" + uid().slice(0, 8), kind: "post", src: { date: today(), time: "19:00", format: "Карусел", platforms: ["Instagram", "Facebook"], isNew: false, forPosts: [] }, local: defaultLocal("post") };
  const s = rec.src;
  const imported = existing && !String(existing.id).startsWith("M-");
  view().innerHTML = `
    <header class="edit-head"><a class="text-link" href="${existing ? `#/cal/post/${esc(rec.id)}` : "#/cal"}">Отказ</a><h1>${existing ? "Редакция на пост" : "Нов пост"}</h1><span class="spacer"></span></header>
    ${imported ? `<p class="hint pad">Промените важат, докато не импортирате нова версия на календара. Тогава стойностите от файла заменят тези тук, а снимките, текстът за публикуване и отметките остават.</p>` : ""}
    <form id="pform" class="stack-form" autocomplete="off" novalidate>
      <fieldset class="group"><legend>Кога и къде</legend>
        <div class="grid2">${field({ k: "date", label: "Дата", type: "date", value: s.date })}${field({ k: "time", label: "Час", type: "time", value: s.time })}</div>
        <div class="grid2">${field({ k: "format", label: "Формат", value: s.format, options: FORMATS })}${field({ k: "collection", label: "Колекция", value: s.collection, options: COLLECTIONS })}</div>
        <div class="field wide"><span class="lbl">Платформи</span><div class="checks">${["Instagram", "Facebook", "TikTok"].map(n => `<label><input type="checkbox" name="plat" value="${n}" ${(s.platforms || []).includes(n) ? "checked" : ""}>${n}</label>`).join("")}</div></div>
        <label class="check-line"><input type="checkbox" name="isNew" ${s.isNew ? "checked" : ""}>НОВО (нов продукт)</label>
      </fieldset>
      <fieldset class="group"><legend>Съдържание</legend>
        ${field({ k: "title", label: "Пост", type: "textarea", value: s.title, rows: 3 })}
        ${field({ k: "cta", label: "Призив към действие", type: "textarea", value: s.cta, rows: 2 })}
        ${field({ k: "keyword", label: "Ключова дума", value: s.keyword, wide: true })}
        ${field({ k: "guidelines", label: "Насоки", type: "textarea", value: s.guidelines, rows: 3 })}
      </fieldset>
      <fieldset class="group"><legend>Изработка и снимки</legend>
        <div class="grid2">${field({ k: "batch", label: "Партида", value: s.batch, ph: "П1, налични…" })}${field({ k: "batchNote", label: "Уточнение", value: s.batchNote })}</div>
        ${field({ k: "profileExample", label: "Пример от профила", value: s.profileExample, wide: true })}
        ${field({ k: "inspiration", label: "Вдъхновение", value: s.inspiration, wide: true })}
      </fieldset>
      <button class="btn primary block" type="submit">Запази поста</button>
    </form>`;
  const form = $("#pform"); const F = k => form.elements.namedItem(k);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!F("date").value) return toast("Изберете дата.");
    const v = k => F(k).value.trim() || null;
    rec.src = { ...s, code: rec.id, date: F("date").value, time: v("time"), format: v("format"), collection: v("collection"), title: v("title"), cta: v("cta"), keyword: v("keyword"), guidelines: v("guidelines"), batch: v("batch"), batchNote: v("batchNote"), profileExample: v("profileExample"), inspiration: v("inspiration"), isNew: F("isNew").checked, platforms: $$("input[name=plat]:checked", form).map(i => i.value) };
    await saveCal(rec); changed();
    toast("Постът е запазен"); go(`#/cal/post/${rec.id}`);
  });
}

// ---------- Задача ----------
export async function renderTaskEdit(id) {
  const existing = id ? await db.get("cal", id) : null;
  const rec = existing && !existing.deleted ? existing : { id: "M-" + uid().slice(0, 8), kind: "task", src: { date: today(), type: "изработка", forPosts: [] }, local: defaultLocal("task") };
  const s = rec.src;
  const cal = await loadCalendar();
  const forPosts = (s.forPosts || []).map(c => cal.posts.find(p => p.id === c)).filter(Boolean);
  view().innerHTML = `
    <header class="edit-head"><a class="text-link" href="${existing ? `#/cal/week/${mondayOf(s.date)}` : "#/cal"}">Отказ</a><h1>${existing ? "Задача" : "Нова задача"}</h1><span class="spacer"></span></header>
    <form id="tform" class="stack-form" autocomplete="off" novalidate>
      <fieldset class="group"><legend>Задача</legend>
        <div class="grid2">${field({ k: "date", label: "Дата", type: "date", value: s.date })}${field({ k: "type", label: "Вид", value: s.type, options: TASK_TYPES })}</div>
        ${field({ k: "title", label: "Заглавие", value: s.title, wide: true, ph: "напр. П6 — изработка" })}
        ${field({ k: "details", label: "Какво включва", type: "textarea", value: s.details })}
        <div class="grid2">${field({ k: "batch", label: "Партида", value: s.batch })}</div>
        ${field({ k: "note", label: "Бележка", type: "textarea", value: s.note, rows: 2 })}
        <label class="check-line"><input type="checkbox" name="done" ${rec.local.done ? "checked" : ""}>Готово</label>
      </fieldset>
      ${forPosts.length ? `<fieldset class="group"><legend>За постовете</legend><ul class="link-list">${forPosts.map(p => `<li><a href="#/cal/post/${esc(p.id)}"><span>${dm(p.src.date)}</span>${esc(p.src.title)}</a></li>`).join("")}</ul></fieldset>` : ""}
      <button class="btn primary block" type="submit">Запази задачата</button>
      ${existing ? `<button class="btn outline danger block" type="button" id="delTask">Изтрий задачата</button>` : ""}
    </form>`;
  const form = $("#tform"); const F = k => form.elements.namedItem(k);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!F("title").value.trim()) return toast("Въведете заглавие.");
    const v = k => F(k).value.trim() || null;
    rec.src = { ...s, code: rec.id, date: F("date").value, type: v("type"), title: v("title"), details: v("details"), batch: v("batch"), note: v("note") };
    rec.local = { ...rec.local, done: F("done").checked };
    await saveCal(rec); changed(); toast("Задачата е запазена"); go(`#/cal/week/${mondayOf(rec.src.date)}`);
  });
  const del = $("#delTask");
  if (del) del.addEventListener("click", async () => {
    if (!confirm("Да изтрия ли задачата?")) return;
    await saveCal({ id: rec.id, kind: "task", deleted: true }); changed(); toast("Задачата е изтрита"); go("#/cal");
  });
}

// ---------- Импорт ----------
const KIND_NAMES = { post: ["пост", "поста"], task: ["задача", "задачи"], deadline: ["срок", "срока"], phase: ["фаза", "фази"], story: ["правило за стори", "правила за сторита"] };
const plural = (k, n) => `${n} ${n === 1 ? KIND_NAMES[k][0] : KIND_NAMES[k][1]}`;
const describe = list => Object.entries(countKinds(list)).filter(([, n]) => n).map(([k, n]) => plural(k, n)).join(", ");
const label = r => r.kind === "post" ? `${dm(r.src.date)} ${r.src.title || ""}` : r.kind === "task" ? `${dm(r.src.date)} ${r.src.title || ""}` : r.kind === "deadline" ? `${dm(r.src.date)} ${r.src.occasion || ""}` : r.kind === "phase" ? r.src.name || r.id : r.src.story || r.id;

export async function importCalendarFile(file) {
  let pv;
  try { pv = await previewImport(await file.text()); }
  catch (err) { toast(err.message, 6000); return; }
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  const blocked = pv.errors.length > 0;
  const lostPhotos = pv.removed.filter(r => (r.local && r.local.photos || []).length);
  dlg.innerHTML = `<form method="dialog">
    <h2>Импорт на календар</h2>
    <p class="muted">${esc(file.name)}${pv.data.period ? `, ${dm(pv.data.period.from)} – ${dm(pv.data.period.to)}` : ""}</p>
    ${blocked ? `<p class="warn">Файлът има грешки и не може да се импортира:</p><ul class="issues">${pv.errors.slice(0, 8).map(e => `<li>${esc(e)}</li>`).join("")}</ul><p class="muted">Покажете ги на другия проект, за да поправи файла.</p>` : `
    <ul class="summary">
      <li><strong>Нови:</strong> ${describe(pv.added) || "няма"}</li>
      <li><strong>Променени:</strong> ${describe(pv.changed) || "няма"}${pv.changed.length ? `<small>${pv.changed.slice(0, 5).map(r => esc(label(r))).join("; ")}${pv.changed.length > 5 ? "…" : ""}</small>` : ""}</li>
      <li><strong>Премахнати:</strong> ${describe(pv.removed) || "няма"}${pv.removed.length ? `<small>${pv.removed.slice(0, 5).map(r => esc(label(r))).join("; ")}${pv.removed.length > 5 ? "…" : ""}</small>` : ""}</li>
      <li><strong>Без промяна:</strong> ${describe(pv.unchanged) || "няма"}</li>
    </ul>
    ${lostPhotos.length ? `<p class="warn">Премахнатите постове имат снимки. Те също ще бъдат изтрити.</p>` : ""}
    ${pv.warnings.length ? `<details class="helper"><summary>Забележки (${pv.warnings.length})</summary><ul class="issues">${pv.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul></details>` : ""}
    <p class="muted">Снимките, текстовете за публикуване и отметките ви се запазват.</p>`}
    <div class="row-actions">${blocked ? "" : `<button class="btn primary" value="ok">Импортирай</button>`}<button class="btn outline" value="cancel">${blocked ? "Затвори" : "Отказ"}</button></div>
  </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  await new Promise(r => dlg.addEventListener("close", r, { once: true }));
  const ok = dlg.returnValue === "ok"; dlg.remove();
  if (!ok || blocked) return;
  await applyImport(pv, file.name);
  await purgePublishedPhotos();
  changed();
  toast(`Календарът е импортиран: ${describe(pv.incoming)}`, 4000);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
