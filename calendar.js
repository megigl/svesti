// Календар за съдържание: импорт, заявки по дати, сторита, почистване на снимки.
import { db, getSettings } from "./db.js";

export const KINDS = ["post", "task", "deadline", "phase", "story"];
const FILE_KEYS = { posts: "post", tasks: "task", deadlines: "deadline", phases: "phase", stories: "story" };
export const FORMATS = ["Reel", "Карусел", "Статична", "Статична (карта)", "Статична + стори"];
export const TASK_TYPES = ["изработка", "снимки", "текстове", "друго"];
export const WEEKDAYS = ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"];
export const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];

const FIELDS = {
  post: ["code", "date", "time", "format", "title", "cta", "keyword", "guidelines", "batch", "batchNote", "platforms", "collection", "isNew", "profileExample", "inspiration"],
  task: ["code", "date", "type", "title", "details", "batch", "forPosts", "note"],
  deadline: ["code", "date", "occasion", "orderDeadline", "orderDeadlineTime", "deadlineNote"],
  phase: ["code", "name", "from", "to", "goal", "content", "keywords"],
  story: ["code", "weekdays", "dates", "from", "to", "story", "sticker", "example"],
};
const LIST_FIELDS = new Set(["platforms", "forPosts", "keywords", "weekdays", "dates"]);

export const defaultLocal = kind =>
  kind === "post" ? { photos: [], caption: "", recipeIds: [], published: false, publishedAt: null, photosPurged: false }
  : kind === "task" ? { done: false } : {};

// ---------- Дати ----------
export const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export const mondayOf = s => { const d = parseISO(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return iso(d); };
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export const dm = s => { const d = parseISO(s); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const weekdayName = s => WEEKDAYS[parseISO(s).getDay()];
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseISO(s));

// ---------- Нормализиране на запис от файла ----------
function normalize(kind, raw) {
  const r = {};
  for (const f of FIELDS[kind]) {
    let v = raw[f];
    if (v === undefined || v === "") v = null;
    if (LIST_FIELDS.has(f)) v = Array.isArray(v) ? v.filter(x => x !== null && x !== "") : (v === null ? (f === "platforms" || f === "keywords" || f === "forPosts" ? [] : null) : [v]);
    r[f] = v;
  }
  if (kind === "phase" && (!r.keywords || !r.keywords.length) && raw.keyword) r.keywords = [raw.keyword];
  if (kind === "post") {
    r.isNew = !!raw.isNew;
    if (!r.platforms.length) r.platforms = r.format === "Reel" ? ["Instagram", "Facebook", "TikTok"] : ["Instagram", "Facebook"];
    if (!r.time) r.time = "19:00";
  }
  return r;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Проверка и преглед преди импорт ----------
export async function previewImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Файлът не е валиден JSON. Помолете другия проект да го провери."); }
  if (!data || data.app !== "made-for-home-calendar") throw new Error("Файлът не е календар за това приложение (липсва \"app\": \"made-for-home-calendar\").");
  const incoming = [];
  const errors = [], warnings = [];
  const seen = new Set();
  for (const [key, kind] of Object.entries(FILE_KEYS)) {
    const arr = data[key];
    if (arr === undefined) { warnings.push(`Във файла няма раздел „${key}“.`); continue; }
    if (!Array.isArray(arr)) { errors.push(`Разделът „${key}“ не е списък.`); continue; }
    arr.forEach((raw, i) => {
      if (!raw || !raw.code) { errors.push(`${key}: запис №${i + 1} няма код.`); return; }
      if (seen.has(raw.code)) { errors.push(`Кодът ${raw.code} се повтаря.`); return; }
      seen.add(raw.code);
      const src = normalize(kind, raw);
      const dateFields = kind === "phase" ? ["from", "to"] : kind === "story" ? [] : ["date"];
      for (const f of dateFields) if (!isDate(src[f])) errors.push(`${raw.code}: невалидна дата в „${f}“.`);
      if (kind === "deadline" && src.orderDeadline && !isDate(src.orderDeadline)) errors.push(`${raw.code}: невалиден краен срок.`);
      if (kind === "story" && !(src.weekdays && src.weekdays.length) && !(src.dates && src.dates.length)) warnings.push(`${raw.code}: сторито няма дни или дати.`);
      incoming.push({ id: raw.code, kind, src });
    });
  }
  const postCodes = new Set(incoming.filter(r => r.kind === "post").map(r => r.id));
  for (const t of incoming.filter(r => r.kind === "task"))
    for (const c of t.src.forPosts || []) if (!postCodes.has(c)) warnings.push(`${t.id}: сочи към пост ${c}, който го няма във файла.`);
  const posts = incoming.filter(r => r.kind === "post");
  if (posts.length && posts.every(p => !("profileExample" in (data.posts.find(x => x.code === p.id) || {}))))
    warnings.push("Постовете нямат поле „profileExample“ (пример от профила).");

  const existing = (await db.getAll("cal")).filter(r => !r.deleted && KINDS.includes(r.kind) && !String(r.id).startsWith("M-"));
  const exMap = new Map(existing.map(r => [r.id, r]));
  const added = [], changed = [], unchanged = [];
  for (const r of incoming) {
    const ex = exMap.get(r.id);
    if (!ex) added.push(r);
    else if (!same(ex.src, r.src)) changed.push({ ...r, before: ex });
    else unchanged.push(r);
  }
  const inSet = new Set(incoming.map(r => r.id));
  const removed = existing.filter(r => !inSet.has(r.id));
  return { data, incoming, added, changed, unchanged, removed, errors, warnings: [...new Set(warnings)] };
}

export async function applyImport(preview, fileName) {
  const now = Date.now();
  const puts = [];
  for (const r of preview.added) {
    const prev = await db.get("cal", r.id); // може да е изтрит преди – запазваме локалните данни, ако има
    puts.push({ id: r.id, kind: r.kind, src: r.src, local: prev && !prev.deleted ? prev.local : defaultLocal(r.kind), updatedAt: now });
  }
  for (const r of preview.changed) puts.push({ ...r.before, src: r.src, updatedAt: now });
  for (const r of preview.removed) {
    for (const pid of (r.local && r.local.photos) || []) await db.del("photos", pid);
    puts.push({ id: r.id, kind: r.kind, deleted: true, updatedAt: now });
  }
  await db.putMany("cal", puts);
  await db.setMeta("calendarImport", { fileName, importedAt: now, period: preview.data.period || null, counts: countKinds(preview.incoming) });
}
export const countKinds = list => KINDS.reduce((o, k) => ({ ...o, [k]: list.filter(r => r.kind === k).length }), {});

// ---------- Заявки ----------
export async function loadCalendar() {
  const all = (await db.getAll("cal")).filter(r => !r.deleted);
  const by = k => all.filter(r => r.kind === k);
  const marks = new Set(all.filter(r => r.kind === "mark" && r.local && r.local.done).map(r => r.id));
  return { all, posts: by("post"), tasks: by("task"), deadlines: by("deadline"), phases: by("phase"), stories: by("story"), marks };
}

export function storiesOn(cal, date) {
  const wd = weekdayName(date);
  return cal.stories.filter(s => {
    const src = s.src;
    if (src.from && date < src.from) return false;
    if (src.to && date > src.to) return false;
    if (src.dates && src.dates.includes(date)) return true;
    return !!(src.weekdays && src.weekdays.includes(wd));
  }).map(s => ({ rule: s, markId: `mark|${s.id}|${date}`, done: cal.marks.has(`mark|${s.id}|${date}`) }));
}

export function dayItems(cal, date) {
  const byTime = (a, b) => (a.src.time || "").localeCompare(b.src.time || "");
  return {
    occasions: cal.deadlines.filter(d => d.src.date === date),
    orderDeadlines: cal.deadlines.filter(d => d.src.orderDeadline === date),
    posts: cal.posts.filter(p => p.src.date === date).sort(byTime),
    tasks: cal.tasks.filter(t => t.src.date === date),
    stories: storiesOn(cal, date),
  };
}

export const phaseOn = (cal, date) => cal.phases.find(p => p.src.from <= date && date <= p.src.to) || null;

export function nextDeadline(cal, from = today()) {
  return cal.deadlines.filter(d => d.src.orderDeadline && d.src.orderDeadline >= from)
    .sort((a, b) => a.src.orderDeadline.localeCompare(b.src.orderDeadline))[0] || null;
}

export function upcomingTasks(cal, from = today(), limit = 5) {
  const open = cal.tasks.filter(t => !(t.local && t.local.done)).sort((a, b) => a.src.date.localeCompare(b.src.date));
  const overdue = open.filter(t => t.src.date < from);
  const next = open.filter(t => t.src.date >= from).slice(0, limit);
  return { overdue, next };
}

// ---------- Отметки и промени ----------
export async function toggleMark(markId, done) {
  await db.put("cal", { id: markId, kind: "mark", local: { done }, updatedAt: Date.now(), ...(done ? {} : { deleted: true }) });
}
export async function saveCal(rec) { rec.updatedAt = Date.now(); await db.put("cal", rec); }

// Снимките на публикувани постове се трият N дни след датата; текстът остава.
export async function purgePublishedPhotos() {
  const { graceDays } = await getSettings();
  const limit = addDays(today(), -Math.max(0, Number(graceDays) || 0));
  const posts = (await db.getAll("cal")).filter(r => r.kind === "post" && !r.deleted && r.local && r.local.published && (r.local.photos || []).length && r.src.date < limit);
  for (const p of posts) {
    for (const pid of p.local.photos) await db.del("photos", pid);
    p.local = { ...p.local, photos: [], photosPurged: true };
    await saveCal(p);
  }
  return posts.length;
}
