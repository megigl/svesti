// Общи помощни функции за екраните.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const view = () => document.getElementById("view");

let urls = [];
export const objURL = blob => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
export const releaseURLs = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };

export function toast(msg, ms = 2600) {
  const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

// Навигация: табовете и листането не трупат история; „назад“ връща само от вътрешни екрани.
let renderFn = () => {};
let pendingTab = null;
const depth = () => (history.state && history.state.depth) || 0;
export function setRenderer(fn) { renderFn = fn; }
export function navigate(href, mode = "push") {
  if (mode === "tab" && depth() > 0) { pendingTab = href; history.go(-depth()); return; }
  if (mode === "push") history.pushState({ depth: depth() + 1 }, "", href);
  else history.replaceState(history.state, "", href);
  renderFn();
}
// Извиква се при „назад“/„напред“; довършва смяна на таб след връщане до основния екран.
export function onHistoryChange() {
  if (pendingTab) { const h = pendingTab; pendingTab = null; history.replaceState(history.state, "", h); }
  renderFn();
}
export function goBack(fallback) {
  if (depth() > 0) history.back();
  else navigate(fallback, "replace");
}
// След запис/изтриване: заменяме текущия екран, за да не се връщаме към формата.
export function go(hash) { navigate(hash, "replace"); }

export function openPhoto(blob) {
  const d = document.getElementById("lightbox");
  d.querySelector("img").src = objURL(blob);
  d.showModal();
}

// Поле за форма: label над кутия с единица вдясно.
export function field({ k, label, value = "", unit = "", type = "text", ph = "", options = null, readonly = false, wide = false, rows = 3, inputmode = "" }) {
  let input;
  const v = value ?? "";
  if (options) input = `<select name="${k}"><option value=""></option>${options.map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  else if (type === "textarea") input = `<textarea name="${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(v)}</textarea>`;
  else {
    const t = type === "number" ? "text" : type;
    const im = inputmode || (type === "number" ? "decimal" : "");
    input = `<input name="${k}" type="${t}" ${im ? `inputmode="${im}"` : ""} value="${esc(v)}" placeholder="${esc(ph)}" ${readonly ? "readonly tabindex='-1'" : ""}>`;
  }
  return `<label class="field${wide || type === "textarea" ? " wide" : ""}${readonly ? " computed" : ""}"><span class="lbl">${esc(label)}</span><span class="ctl">${input}${unit ? `<span class="unit">${esc(unit)}</span>` : ""}</span></label>`;
}

export function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Сезонен цвят (малките акценти в интерфейса).
export const SEASONS = {
  autumn: { name: "Есен", color: "#D9782D" },
  christmas: { name: "Коледа и зима", color: "#A8323A" },
  valentine: { name: "Св. Валентин и 8 март", color: "#C2325A" },
  spring: { name: "Пролет и Великден", color: "#B9A6D6" },
  occasions: { name: "Поводи", color: "#D9A441" },
};
export function seasonFor(date = new Date()) {
  const m = date.getMonth() + 1, d = date.getDate();
  if (m === 9 || m === 10) return "autumn";
  if (m === 11 || m === 12 || m === 1) return "christmas";
  if (m === 2 || (m === 3 && d <= 8)) return "valentine";
  if (m >= 3 && m <= 5) return "spring";
  return "occasions";
}
export function applySeason(setting) {
  const key = setting === "auto" || !SEASONS[setting] ? seasonFor() : setting;
  document.documentElement.style.setProperty("--accent", SEASONS[key].color);
}

export const icons = {
  candle: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M24 6c-2 3-3 5-3 7a3 3 0 0 0 6 0c0-2-1-4-3-7z"/><path d="M24 16v5"/><rect x="13" y="21" width="22" height="21" rx="4"/><path d="M13 26h22"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>`,
  make: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4c-1.5 2.2-2.2 3.6-2.2 5a2.2 2.2 0 0 0 4.4 0c0-1.4-.7-2.8-2.2-5z"/><rect x="7" y="12" width="10" height="8" rx="2"/></svg>`,
  photo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M9 7l1.5-2h3L15 7"/></svg>`,
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19l1-4L15.5 5.5a2 2 0 0 1 3 3L9 18z"/></svg>`,
  other: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>`,
};
