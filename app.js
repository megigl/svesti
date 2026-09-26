import { db, requestPersistence, storageInfo, mergeRecords, getSettings, saveSettings, photosOf } from "./db.js";
import { makeThumb, blobToDataURL, dataURLToBlob } from "./image.js";
import { CONFIG } from "./config.js";
import { fmt, num } from "./calc.js";
import { $, $$, esc, view, toast, go, releaseURLs, download, applySeason, SEASONS, seasonFor } from "./ui.js";
import * as sync from "./sync.js";
import { renderList, renderDetail, renderEdit, liveCandles, CSV_COLUMNS } from "./recipes.js";
import { renderCalc } from "./calc-ui.js";
import { renderMonth, renderWeek, renderPost, renderPostEdit, renderTaskEdit, bindImport } from "./cal-ui.js";
import { purgePublishedPhotos } from "./calendar.js";

// ---------- Навигация ----------
window.addEventListener("hashchange", render);
async function render() {
  releaseURLs();
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const [a, b, c] = parts;
  const tab = a === "cal" ? "cal" : a === "calc" ? "calc" : a === "settings" ? "settings" : "list";
  $$(".tabs a").forEach(x => x.classList.toggle("active", x.dataset.tab === tab));
  document.body.dataset.view = a || "list";
  window.scrollTo(0, 0);
  if (a === "card") return renderDetail(b);
  if (a === "edit") return renderEdit(b);
  if (a === "new") return renderEdit(null);
  if (a === "calc") return renderCalc();
  if (a === "settings") return renderSettings();
  if (a === "cal") {
    if (b === "m") return renderMonth(c);
    if (b === "week") return renderWeek(c);
    if (b === "post" && parts[3] === "edit") return renderPostEdit(c);
    if (b === "post") return renderPost(c);
    if (b === "new-post") return renderPostEdit(null);
    if (b === "task") return renderTaskEdit(c);
    if (b === "new-task") return renderTaskEdit(null);
    return renderMonth();
  }
  return renderList();
}

// ---------- Настройки ----------
async function renderSettings() {
  const st = sync.syncState;
  const settings = await getSettings();
  const info = await storageInfo();
  const count = (await liveCandles()).length;
  const cal = (await db.getAll("cal")).filter(r => !r.deleted && r.kind === "post").length;
  const photos = await db.getAll("photos");
  const pending = photos.filter(p => !p.uploaded).length;
  const imp = await db.meta("calendarImport");
  const last = st.lastSync ? new Date(st.lastSync).toLocaleString("bg-BG") : "никога";
  const name = sync.accountName();
  const autoName = SEASONS[seasonFor()].name;
  view().innerHTML = `
    <header class="page-head"><div class="title-row"><h1>Настройки</h1></div></header>
    <section class="set">
      <h2>OneDrive</h2>
      ${!sync.isConfigured() ? `<p class="warn">Входът с Microsoft още не е настроен. Попълнете Application (client) ID във файла <code>config.js</code> (README.md, Част 4).</p>` : `
        <p>${name ? `Влезли сте като <strong>${esc(name)}</strong> (${esc(sync.accountEmail())}).` : "Не сте влезли. Данните се пазят само на този телефон."}</p>
        <p class="muted">Последна синхронизация: ${last}${pending ? `. Чакат качване: ${pending} снимки` : ""}.</p>
        ${st.message ? `<p class="status ${st.status === "need-login" || /Грешка/.test(st.message) ? "warn" : ""}">${esc(st.message)}</p>` : ""}
        <div class="row-actions">
          ${name ? `<button class="btn primary" id="syncBtn" ${st.busy ? "disabled" : ""}>Синхронизирай сега</button>
                    ${st.status === "need-login" ? `<button class="btn outline" id="reLogin">Влез отново</button>` : ""}
                    <button class="btn outline" id="logout">Изход</button>`
                 : `<button class="btn primary" id="login">Вход с Microsoft</button>`}
        </div>
        <p class="hint">Приложението вижда само своята папка в OneDrive. Там са <code>data.json</code> (рецептите), <code>calendar.json</code> (календарът) и папка <code>photos</code>.</p>`}
    </section>
    <section class="set">
      <h2>Календар</h2>
      <p class="muted">${imp ? `Последен импорт: ${esc(imp.fileName)}, ${new Date(imp.importedAt).toLocaleString("bg-BG")}.` : "Още няма импортиран календар."} Постове в календара: ${cal}.</p>
      <div class="row-actions"><label class="btn primary">Импорт на календар<input type="file" accept="application/json,.json" data-import hidden></label></div>
      <div class="grid2">${fieldNum("graceDays", "Снимките се трият след", settings.graceDays, "дни")}</div>
      <p class="hint">Броят се от датата на поста, след като е отметнат като публикуван. Текстът на поста остава.</p>
    </section>
    <section class="set">
      <h2>Изчисления</h2>
      <div class="grid2">${fieldNum("maxAroma", "Максимум аромат", settings.maxAroma, "% от восъка")}${fieldNum("maxDye", "Максимум боя", settings.maxDye, "% от восъка")}</div>
      <div class="field wide"><span class="lbl">Процентът аромат в рецептите е от</span>
        <div class="seg" role="radiogroup">
          <label class="${settings.aromaMethod === "total" ? "on" : ""}"><input type="radio" name="aromaMethod" value="total" ${settings.aromaMethod === "total" ? "checked" : ""}>теглото на свещта</label>
          <label class="${settings.aromaMethod === "wax" ? "on" : ""}"><input type="radio" name="aromaMethod" value="wax" ${settings.aromaMethod === "wax" ? "checked" : ""}>теглото на восъка</label>
        </div></div>
    </section>
    <section class="set">
      <h2>Сезонен цвят</h2>
      <div class="season-list">
        <label><input type="radio" name="season" value="auto" ${settings.season === "auto" ? "checked" : ""}><i style="background:${SEASONS[seasonFor()].color}"></i>Автоматично (сега: ${autoName})</label>
        ${Object.entries(SEASONS).map(([k, s]) => `<label><input type="radio" name="season" value="${k}" ${settings.season === k ? "checked" : ""}><i style="background:${s.color}"></i>${s.name}</label>`).join("")}
      </div>
    </section>
    <section class="set">
      <h2>Архив на файл</h2>
      <p class="muted">Резервно копие без OneDrive: рецептите, календарът и снимките в един файл.</p>
      <div class="row-actions">
        <button class="btn outline" id="expJson">Експорт на архив</button>
        <button class="btn outline" id="expCsv">Рецептите за Excel</button>
        <label class="btn outline">Импорт на архив<input id="impJson" type="file" accept="application/json,.json" hidden></label>
      </div>
    </section>
    <section class="set">
      <h2>Памет на телефона</h2>
      <p>${count} рецепти, ${photos.length} снимки. Заето: ${fmt(info.usage / 1048576, 1)} MB.</p>
      <p class="muted">${info.persisted ? "Данните са защитени от автоматично изтриване." : "Браузърът може да изтрие данните при недостиг на памет."}</p>
      ${info.persisted ? "" : `<button class="btn outline" id="persist">Защити данните</button>`}
    </section>`;
  const on = (id, fn) => { const el = $("#" + id); if (el) el.addEventListener("click", fn); };
  on("login", () => sync.signIn().catch(e => toast(e.message)));
  on("reLogin", () => sync.syncNow({ interactive: true }));
  on("logout", () => { if (confirm("Изход от Microsoft акаунта? Данните остават на телефона.")) sync.signOut(); });
  on("syncBtn", () => sync.syncNow());
  on("persist", async () => { toast((await requestPersistence()) ? "Данните са защитени" : "Браузърът отказа. Инсталирайте приложението на началния екран и опитайте пак."); renderSettings(); });
  on("expJson", exportJson);
  on("expCsv", exportCsv);
  $("#impJson").addEventListener("change", importArchive);
  bindImport(view());
  for (const k of ["graceDays", "maxAroma", "maxDye"]) {
    view().querySelector(`[name=${k}]`).addEventListener("change", async e => {
      const v = num(e.target.value);
      if (v === null || v < 0) { toast("Въведете число."); return; }
      await saveSettings({ [k]: v }); toast("Запазено");
    });
  }
  $$("input[name=aromaMethod]").forEach(r => r.addEventListener("change", async () => { await saveSettings({ aromaMethod: r.value }); toast("Запазено"); renderSettings(); }));
  $$("input[name=season]").forEach(r => r.addEventListener("change", async () => { const s = await saveSettings({ season: r.value }); applySeason(s.season); }));
}
function fieldNum(k, label, value, unit) {
  return `<label class="field"><span class="lbl">${esc(label)}</span><span class="ctl"><input name="${k}" inputmode="decimal" value="${esc(String(value).replace(".", ","))}"><span class="unit">${esc(unit)}</span></span></label>`;
}

const stamp = () => new Date().toISOString().slice(0, 10);
async function exportJson() {
  toast("Подготовка на архива…", 10000);
  const candles = await db.getAll("candles");
  const cal = await db.getAll("cal");
  const photos = [];
  for (const p of await db.getAll("photos")) photos.push({ id: p.id, data: await blobToDataURL(p.blob) });
  download(new Blob([JSON.stringify({ app: "svesti", version: 2, exportedAt: new Date().toISOString(), candles, cal, photos })], { type: "application/json" }), `svesti-arhiv-${stamp()}.json`);
  toast("Архивът е свален в „Изтегляния“");
}
async function exportCsv() {
  const items = await liveCandles();
  const cell = v => { const s = String(v ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [CSV_COLUMNS.map(([, l]) => cell(l)).join(";")];
  for (const c of items) lines.push(CSV_COLUMNS.map(([k]) => cell(typeof c[k] === "number" ? String(c[k]).replace(".", ",") : c[k])).join(";"));
  download(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `svesti-recepti-${stamp()}.csv`);
}
async function importArchive(e) {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app === "made-for-home-calendar") throw new Error("Това е файл на календар. Използвайте „Импорт на календар“.");
    if (!Array.isArray(data.candles)) throw new Error("Файлът не е архив от това приложение.");
    const photoMap = new Map((data.photos || []).map(p => [p.id, p.data]));
    let n = 0;
    for (const [store, list] of [["candles", data.candles], ["cal", data.cal || []]]) {
      const { changedLocal } = mergeRecords(await db.getAll(store), list);
      for (const { incoming } of changedLocal) {
        await db.put(store, incoming); n++;
        for (const pid of photosOf(incoming)) {
          if (await db.get("photos", pid) || !photoMap.has(pid)) continue;
          const blob = await dataURLToBlob(photoMap.get(pid));
          await db.put("photos", { id: pid, blob, thumb: await makeThumb(blob, CONFIG), uploaded: false, createdAt: Date.now() });
        }
      }
    }
    toast(`Възстановени/обновени записи: ${n}`);
    sync.scheduleSync(1000);
    renderSettings();
  } catch (err) { toast("Импортът не успя: " + err.message, 5000); }
}

// ---------- Индикатор за синхронизация ----------
function paintSync(st) {
  const el = $("#syncDot");
  const cls = st.busy ? "busy" : st.status === "signed-in" ? (/Грешка/.test(st.message) ? "err" : "ok") : st.status === "need-login" ? "err" : "off";
  el.className = "sync-dot " + cls;
  el.title = st.message || "";
  $("#syncLabel").textContent = st.busy ? "Синхронизиране…" : cls === "ok" ? "Синхронизирано" : cls === "err" ? "Нужен е вход" : "Само на телефона";
  if (location.hash.startsWith("#/settings") && !st.busy) renderSettings();
  if (st.changed && !st.busy) { st.changed = false; if (!/^#\/(edit|new|cal\/(post\/.+\/edit|new-|task))/.test(location.hash) && !location.hash.startsWith("#/settings")) render(); }
}
sync.onSyncChange(paintSync);

// ---------- Старт ----------
async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  applySeason((await getSettings()).season);
  const authReturn = /[#&?](code|error)=/.test(location.hash + location.search);
  if (authReturn) { view().innerHTML = `<p class="muted center">Вход с Microsoft…</p>`; await sync.initAuth(); if (/[#&](code|error)=/.test(location.hash)) history.replaceState(null, "", location.pathname + "#/settings"); }
  if (await purgePublishedPhotos()) sync.scheduleSync(2000);
  render();
  requestPersistence().catch(() => {});
  await sync.initAuth();
  paintSync(sync.syncState);
  if (sync.accountName()) sync.syncNow();
  window.addEventListener("online", () => sync.scheduleSync(1500));
}
start();
