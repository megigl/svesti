// Финанси: материали (склад с цени), поръчки, разходи, продажби и себестойност.
// Всичко е в хранилището "fin" и се синхронизира с OneDrive във finance.json.
import { db, getSettings } from "./db.js";
import { num } from "./calc.js";
import { uid } from "./ui.js";

export const MAT_CATEGORIES = ["Восък", "Аромат", "Боя", "Фитил", "Съд", "Етикет и опаковка", "Декорация", "Друго"];
export const UNITS = ["g", "ml", "бр.", "м"];
export const EXP_CATEGORIES = ["Материали", "Оборудване", "Куриер до клиент", "Такса за базар", "Реклама", "Абонаменти", "Консумативи", "Друго"];
export const CHANNELS = ["Instagram", "Facebook", "TikTok", "Базар", "Лично", "Друго"];
export const unitLabel = u => ({ g: "g", ml: "мл", "бр.": "бр.", "м": "м" }[u] || u || "");

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
export const normName = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const month = d => String(d || "").slice(0, 7);

// ---------- Четене ----------
export async function loadFin() {
  const all = (await db.getAll("fin")).filter(r => !r.deleted);
  const by = k => all.filter(r => r.kind === k);
  const byDate = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.updatedAt || 0) - (a.updatedAt || 0);
  return {
    materials: by("material").sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "bg")),
    purchases: by("purchase").sort(byDate),
    expenses: by("expense").sort(byDate),
    sales: by("sale").sort(byDate),
  };
}
export async function saveFin(rec) { rec.updatedAt = Date.now(); await db.put("fin", rec); }
export async function deleteFin(id) { await db.put("fin", { id, deleted: true, updatedAt: Date.now() }); }
export const matMap = materials => new Map(materials.map(m => [m.id, m]));

// ---------- Себестойност ----------
// Една свещ: восък, аромат и боя по изчислените грамове, фитил, съд и допълнителни материали.
export function candleCost(c, mats) {
  const lines = [];
  const add = (label, matId, qty) => {
    if (!matId) return;
    const m = mats.get(matId);
    const q = num(qty);
    const line = { label, name: m ? m.name : "изтрит материал", unit: m ? m.unit : "", qty: q, price: m ? num(m.price) : null, estimated: !!(m && m.estimated) };
    line.missing = !m || line.price === null || q === null;
    line.cost = line.missing ? 0 : q * line.price;
    lines.push(line);
  };
  add("Восък", c.matWax, c.waxG);
  add("Аромат", c.matAroma, c.fragranceG);
  add("Боя", c.matDye, c.dyeG);
  if (c.matWick) {
    const m = mats.get(c.matWick);
    const count = num(c.wickCount) ?? 1;
    const perMeter = m && m.unit === "м";
    add("Фитил", c.matWick, perMeter ? (num(c.wickLenCm) !== null ? count * num(c.wickLenCm) / 100 : null) : count);
  }
  add("Съд", c.matContainer, 1);
  for (const x of c.extras || []) add("Допълнително", x.m, x.q);
  if (!lines.length) return null;
  return summarize(lines);
}
function summarize(lines) {
  const total = lines.reduce((s, l) => s + l.cost, 0);
  return { lines, total, missing: lines.some(l => l.missing), estimated: lines.some(l => l.estimated) };
}
// Себестойност за показване: изчислена от материалите или въведена ръчно.
export function unitCostOf(c, mats) {
  const cc = candleCost(c, mats);
  if (cc && cc.total > 0) return { value: cc.total, source: "materials", detail: cc };
  const manual = num(c.cost);
  return manual !== null ? { value: manual, source: "manual", detail: cc } : { value: null, source: "none", detail: cc };
}
export function arrangementCost(a, candles, mats) {
  const lines = [];
  const cmap = new Map(candles.map(c => [c.id, c]));
  for (const it of a.items || []) {
    const c = cmap.get(it.c);
    const q = num(it.q) ?? 1;
    const u = c ? unitCostOf(c, mats) : { value: null, detail: null };
    const missing = !c || u.value === null;
    lines.push({ label: "Свещ", name: c ? c.name : "изтрита рецепта", unit: "бр.", qty: q, price: u.value, cost: missing ? 0 : u.value * q, missing, estimated: !!(u.detail && u.detail.estimated) });
  }
  for (const x of a.extras || []) {
    const m = mats.get(x.m);
    const q = num(x.q), price = m ? num(m.price) : null;
    const missing = !m || price === null || q === null;
    lines.push({ label: "Допълнително", name: m ? m.name : "изтрит материал", unit: m ? m.unit : "", qty: q, price, cost: missing ? 0 : q * price, missing, estimated: !!(m && m.estimated) });
  }
  return summarize(lines);
}
export const suggested = (cost, mult) => (cost === null || cost === undefined ? null : cost * mult);

// ---------- Импорт на поръчки ----------
// Формат: { app: "made-for-home-orders", version: 1, orders: [ { code, date, supplier, orderNo, mode: "expense"|"stock", total, shipping, items: [...] } ] }
// items: { name, type: "material"|"equipment"|"other", category, qty, unit, lineTotal, estimated }
export async function previewOrders(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Файлът не е валиден JSON."); }
  if (!data || data.app !== "made-for-home-orders") throw new Error("Файлът не е файл с поръчки за това приложение.");
  if (!Array.isArray(data.orders)) throw new Error("Във файла няма списък с поръчки.");
  const fin = await loadFin();
  const known = new Map(fin.purchases.map(p => [p.id, p]));
  const byName = new Map(fin.materials.map(m => [normName(m.name), m]));
  const errors = [], orders = [];
  data.orders.forEach((o, i) => {
    const where = o && o.code ? o.code : `поръчка №${i + 1}`;
    if (!o || !o.code) { errors.push(`${where}: липсва код.`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || "")) errors.push(`${where}: невалидна дата.`);
    if (!Array.isArray(o.items) || !o.items.length) { errors.push(`${where}: няма артикули.`); return; }
    const mode = o.mode === "stock" ? "stock" : "expense";
    const itemsSum = o.items.reduce((s, it) => s + (num(it.lineTotal) || 0), 0);
    const shipping = num(o.shipping) || 0;
    const total = num(o.total) ?? itemsSum + shipping;
    const items = o.items.map((it, j) => {
      const qty = num(it.qty), line = num(it.lineTotal);
      if (!it.name) errors.push(`${where}: артикул №${j + 1} няма име.`);
      const type = ["material", "equipment", "other"].includes(it.type) ? it.type : "material";
      if (type === "material" && (qty === null || qty <= 0)) errors.push(`${where}: „${it.name}“ няма количество.`);
      if (type === "material" && !UNITS.includes(it.unit)) errors.push(`${where}: „${it.name}“ има непозната мярка „${it.unit}“ (позволени: ${UNITS.join(", ")}).`);
      const share = itemsSum > 0 && line !== null ? shipping * line / itemsSum : 0;
      const landed = line !== null ? line + share : null;
      const unitPrice = type === "material" && landed !== null && qty ? round(landed / qty, 6) : null;
      const match = type === "material" ? byName.get(normName(it.name)) || null : null;
      return { name: String(it.name || ""), type, category: MAT_CATEGORIES.includes(it.category) ? it.category : "Друго", qty, unit: it.unit, lineTotal: line, landed, unitPrice, estimated: !!it.estimated, match };
    });
    orders.push({ code: String(o.code), date: o.date, supplier: o.supplier || "", orderNo: o.orderNo || "", mode, total, shipping, note: o.note || "", items, exists: known.has(String(o.code)) });
  });
  return { data, orders, errors, materials: fin.materials };
}

// mapping: ключ "код|индекс" -> id на съществуващ материал или "new"
export async function applyOrders(preview, mapping = {}) {
  const fin = await loadFin();
  const mats = matMap(fin.materials);
  const byName = new Map(fin.materials.map(m => [normName(m.name), m]));
  let newMats = 0, updated = 0, imported = 0;
  for (const o of preview.orders) {
    if (o.exists) continue;
    const items = [];
    for (const [j, it] of o.items.entries()) {
      let materialId = null;
      if (it.type === "material") {
        const choice = mapping[`${o.code}|${j}`];
        let m = choice && choice !== "new" ? mats.get(choice) : (choice === "new" ? null : byName.get(normName(it.name)));
        if (!m) {
          m = { id: uid(), kind: "material", name: it.name, category: it.category, unit: it.unit, price: it.unitPrice, estimated: it.estimated, priceDate: o.date, supplier: o.supplier };
          newMats++;
        } else if (!m.priceDate || o.date >= m.priceDate || m.price === null || m.price === undefined) {
          m = { ...m, price: it.unitPrice, estimated: it.estimated, priceDate: o.date, supplier: o.supplier || m.supplier };
          if (m.unit !== it.unit) m.unit = it.unit;
          updated++;
        }
        await saveFin(m);
        mats.set(m.id, m); byName.set(normName(m.name), m);
        materialId = m.id;
      }
      items.push({ name: it.name, type: it.type, category: it.category, qty: it.qty, unit: it.unit, lineTotal: it.lineTotal, unitPrice: it.unitPrice, estimated: it.estimated, materialId });
    }
    await saveFin({ id: o.code, kind: "purchase", date: o.date, supplier: o.supplier, orderNo: o.orderNo, mode: o.mode, total: o.total, shipping: o.shipping, note: o.note, items });
    imported++;
  }
  return { imported, newMats, updated };
}

// ---------- Справки ----------
export const saleTotal = s => (num(s.qty) || 0) * (num(s.unitPrice) || 0);
export const saleCost = s => (num(s.qty) || 0) * (num(s.unitCost) || 0);

export function monthReport(fin, ym) {
  const sales = fin.sales.filter(s => month(s.date) === ym);
  const purchases = fin.purchases.filter(p => p.mode === "expense" && month(p.date) === ym);
  const expenses = fin.expenses.filter(e => month(e.date) === ym);
  const income = sales.reduce((s, x) => s + saleTotal(x), 0);
  const cogs = sales.reduce((s, x) => s + saleCost(x), 0);
  const spentOrders = purchases.reduce((s, p) => s + (num(p.total) || 0), 0);
  const spentOther = expenses.reduce((s, e) => s + (num(e.amount) || 0), 0);
  const spent = spentOrders + spentOther;
  const byProduct = new Map();
  for (const s of sales) {
    const k = s.refId || s.name;
    const r = byProduct.get(k) || { name: s.name, refKind: s.refKind, qty: 0, income: 0, cost: 0 };
    r.qty += num(s.qty) || 0; r.income += saleTotal(s); r.cost += saleCost(s);
    byProduct.set(k, r);
  }
  const byKind = { candle: 0, arrangement: 0, other: 0 };
  for (const s of sales) byKind[s.refKind in byKind ? s.refKind : "other"] += saleTotal(s);
  const byChannel = new Map();
  for (const s of sales) { const k = s.channel || "Без канал"; byChannel.set(k, (byChannel.get(k) || 0) + saleTotal(s)); }
  const expByCat = new Map();
  for (const p of purchases) {
    const eq = (p.items || []).filter(i => i.type === "equipment").reduce((s, i) => s + (num(i.lineTotal) || 0), 0);
    const share = eq && (num(p.total) || 0) ? Math.min(eq / (p.items.reduce((s, i) => s + (num(i.lineTotal) || 0), 0) || 1), 1) : 0;
    expByCat.set("Материали", (expByCat.get("Материали") || 0) + (num(p.total) || 0) * (1 - share));
    if (share) expByCat.set("Оборудване", (expByCat.get("Оборудване") || 0) + (num(p.total) || 0) * share);
  }
  for (const e of expenses) expByCat.set(e.category || "Друго", (expByCat.get(e.category || "Друго") || 0) + (num(e.amount) || 0));
  return {
    ym, sales, purchases, expenses, income, cogs, spent, spentOrders, spentOther, result: income - spent, grossOnSales: income - cogs,
    products: [...byProduct.values()].sort((a, b) => b.income - a.income),
    byKind, byChannel: [...byChannel.entries()].sort((a, b) => b[1] - a[1]), expByCat: [...expByCat.entries()].filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]),
  };
}
export function monthsWithData(fin) {
  const set = new Set();
  for (const s of fin.sales) set.add(month(s.date));
  for (const p of fin.purchases) if (p.mode === "expense") set.add(month(p.date));
  for (const e of fin.expenses) set.add(month(e.date));
  set.delete("");
  return [...set].sort();
}

export async function multiplier() { return num((await getSettings()).priceMultiplier) || 2; }
