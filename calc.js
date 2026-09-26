// Формули: восък, аромат и боя по метода „свещ само восък“ (X).
export const WAX_TYPES = [
  { name: "Соев", factor: 0.86 },
  { name: "Парафин", factor: 0.90 },
  { name: "Пчелен", factor: 0.96 },
  { name: "Друг", factor: null },
];
export const DYE_TYPES = ["Прах / чипс", "Блокче", "Течна"];
export const COLLECTIONS = ["Есен", "Коледа", "Валентин", "Пролет", "Поводи"];

export const num = v => { const x = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : null; };
export const fmt = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? "–" : Number(v).toLocaleString("bg-BG", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const pct = v => fmt(v, 2) + "%";

// Една свещ: X = тегло само с восък. method: "total" (% от X) или "wax" (% от восъка).
export function perCandle(X, loadPct, method) {
  const p = (loadPct || 0) / 100;
  if (!X) return { wax: null, aroma: null };
  if (method === "wax") { const wax = X / (1 + p); return { wax, aroma: wax * p }; }
  const aroma = X * p; return { wax: X - aroma, aroma };
}

export function calculate(i, settings) {
  const X = num(i.X) || 0, count = Math.max(1, Math.round(num(i.count) || 1));
  const load = num(i.load) || 0, reserve = num(i.reserve) || 0, dyePct = num(i.dyePct) || 0;
  const one = perCandle(X, load, i.method);
  const k = count * (1 + reserve / 100);
  const wax = (one.wax || 0) * k, aroma = (one.aroma || 0) * k, dye = wax * dyePct / 100;
  const steps = [];
  if (X) {
    if (i.method === "wax") {
      steps.push(`Восък на свещ: ${fmt(X, 1)} g ÷ ${fmt(1 + load / 100, 3)} = ${fmt(one.wax, 1)} g`);
      steps.push(`Аромат на свещ: ${fmt(one.wax, 1)} g × ${pct(load)} = ${fmt(one.aroma, 1)} g`);
    } else {
      steps.push(`Аромат на свещ: ${fmt(X, 1)} g × ${pct(load)} = ${fmt(one.aroma, 1)} g`);
      steps.push(`Восък на свещ: ${fmt(X, 1)} g − ${fmt(one.aroma, 1)} g = ${fmt(one.wax, 1)} g`);
    }
    steps.push(`За ${count} ${count === 1 ? "свещ" : "свещи"}${reserve ? ` + ${pct(reserve)} резерв` : ""}: ${fmt(wax, 0)} g восък и ${fmt(aroma, 1)} g аромат`);
    if (dyePct) steps.push(`Боя: ${fmt(wax, 0)} g × ${pct(dyePct)} = ${fmt(dye, 2)} g (${fmt((one.wax || 0) * dyePct / 100, 2)} g на свещ)`);
  }
  const warnings = [];
  const loadOfWax = one.wax ? (one.aroma / one.wax) * 100 : 0;
  if (settings && loadOfWax > settings.maxAroma + 1e-9)
    warnings.push(`Ароматът е ${fmt(loadOfWax, 1)}% от восъка – над максимума от ${fmt(settings.maxAroma, 1)}%.`);
  if (settings && dyePct > settings.maxDye + 1e-9)
    warnings.push(`Боята е над максимума от ${fmt(settings.maxDye, 2)}% от восъка.`);
  return { X, count, load, reserve, dyePct, one, wax, aroma, dye, loadOfWax, steps, warnings, dyePerCandle: (one.wax || 0) * dyePct / 100 };
}
