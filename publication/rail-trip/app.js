// 鐵道出走沙盤 — app controller (vanilla JS, mobile-first).
import * as P from './planner.js?v=20261007125517';
import { createScene } from './scene.js?v=20261007125517';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY_DRAFT = 'railtrip.v1.draft', KEY_SAVED = 'railtrip.v1.saved';
const ICONS = { food: '🍜', street: '🏮', cat: '🐈', mine: '⛏️', waterfall: '💦', lantern: '🎐' };
const SPEEDS = [2, 4, 8]; // simulated minutes per real second

const state = { data: null, input: null, result: null, selected: null, tab: 'plan', sheet: 'peek', scene: null, preview: null, lastSavedId: null };

function taipeiToday() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());
}
function defaults() { return { date: taipeiToday(), origin: '7360', departAfter: '09:00', returnBy: '14:00', stops: [] }; }
function storage() { try { return window.localStorage; } catch { return null; } }
function loadJSON(k, fb) { try { const s = storage(); const v = s && s.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function saveJSON(k, v) { try { const s = storage(); if (s) s.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
function sanitizeInput(x) {
  const d = defaults(); if (!x || typeof x !== 'object') return d;
  const inp = { date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : d.date, origin: typeof x.origin === 'string' ? x.origin : d.origin,
    departAfter: P.hm(x.departAfter) != null ? x.departAfter : d.departAfter, returnBy: P.hm(x.returnBy) != null ? x.returnBy : d.returnBy, stops: [] };
  for (const s of Array.isArray(x.stops) ? x.stops.slice(0, 12) : []) {
    if (!s || typeof s.station !== 'string') continue;
    inp.stops.push({ station: s.station, pois: (Array.isArray(s.pois) ? s.pois : []).filter(p => p && typeof p.id === 'string').map(p => ({ id: p.id, stay: Math.max(0, Math.min(600, Math.round(+p.stay || 0))) })) });
  }
  return inp;
}

// ---------- data ----------
async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}
async function loadData() {
  const v = document.querySelector('script[type=module]').src.split('v=')[1] || '';
  const [timetable, stations, pois] = await Promise.all([fetchJSON(`data/timetable.json?v=${v}`), fetchJSON(`data/stations.json?v=${v}`), fetchJSON(`data/pois.json?v=${v}`)]);
  if (!timetable.dates || !stations.stations || !pois.pois) throw new Error('資料格式不符');
  return { timetable, stations, pois };
}

// ---------- helpers ----------
const st = code => state.data.stations.stations.find(s => s.code === code);
const poi = id => state.data.pois.pois.find(p => p.id === id);
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms); }
function setSheet(mode) { state.sheet = mode; const el = $('#sheet'); el.classList.remove('peek', 'half', 'full'); el.classList.add(mode); }
function setTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name)); document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name)); }
function statusInfo(r) {
  if (!r) return { cls: 'st-idle', label: '—', text: '' };
  const m = { OK: ['st-ok', '可行'], OVERTIME: ['st-bad', '超時'], NO_TRAIN: ['st-bad', '無班次'], CLOSED: ['st-warn', '休館／未開'], NO_DATA: ['st-info', '無資料'], INVALID: ['st-warn', '設定有誤'] }[r.status] || ['st-idle', r.status];
  let text = '';
  if (r.status === 'OK') text = r.input.stops.length ? `${P.fmt(r.summary.departAt)} 出發 · ${P.fmt(r.summary.returnAt)} 回到${r.summary.originName} · 餘 ${P.fmtDur(r.summary.slack)}` : `點地圖上的車站開始安排（${P.fmt(r.summary.departAt)} 從${r.summary.originName}出發）`;
  else text = r.problems[0] ? r.problems[0].message : '';
  return { cls: m[0], label: m[1], text };
}

// ---------- compute + render ----------
function recompute({ persist = true } = {}) {
  state.result = P.plan(state.input, state.data);
  if (persist) saveJSON(KEY_DRAFT, state.input);
  state.scene && state.scene.setPlan(state.result);
  renderPeek(); renderPlan(); renderStation(); renderPill();
}
function renderPill() { $('#pill-date').textContent = state.input.date.slice(5).replace('-', '/'); $('#pill-time').textContent = `${state.input.departAfter}–${state.input.returnBy}`; }
function renderPeek() {
  const s = statusInfo(state.result); const el = $('#peek-status'); el.className = 'status ' + s.cls; el.textContent = s.label; $('#peek-text').textContent = s.text;
}
function bannerFor(r) {
  const s = statusInfo(r); const cls = { 'st-ok': 'ok', 'st-bad': 'bad', 'st-warn': 'warn', 'st-info': 'info' }[s.cls] || 'info';
  let html = `<div class="banner ${cls}"><b>${esc(s.label)}</b> `;
  if (r.status === 'OK') html += r.input.stops.length ? `${esc(s.text)}。全程 ${esc(P.fmtDur(r.summary.totalMin))}：搭車 ${r.summary.trainMin} 分、步行約 ${r.summary.walkMin} 分（估算）、停留 ${r.summary.visitMin} 分。` : `尚未安排停靠點。點 3D 地圖上的車站，或到「車站」頁挑景點。`;
  else html += `<ul>${r.problems.map(p => `<li>${esc(p.message)}</li>`).join('')}</ul>`;
  if (r.warnings && r.warnings.length) html += `<ul>${r.warnings.map(w => `<li>ℹ ${esc(w.message)}</li>`).join('')}</ul>`;
  return html + '</div>';
}
function renderPlan() {
  const r = state.result; const inp = state.input; const el = $('#tab-plan'); if (!r) return;
  let h = bannerFor(r);
  h += `<div class="row between"><h2 style="margin:0">停靠點 <span class="muted small">${inp.stops.length ? inp.stops.length + ' 站' : ''}</span></h2><div class="row"><button class="btn sm accent" data-act="preview" ${r.segments.length ? '' : 'disabled'}>▶ 預覽</button><button class="btn sm ghost" data-act="menu">保存／匯出</button></div></div>`;
  if (!inp.stops.length) h += `<p class="muted">從 ${esc(st(inp.origin).name)} 出發，${esc(inp.departAfter)} 以後搭車，${esc(inp.returnBy)} 前回來。點地圖上的車站加入停靠點。</p><div class="stations-strip">${state.data.stations.stations.map(s => `<button data-act="pick" data-code="${s.code}">${esc(s.name)}</button>`).join('')}</div>`;
  inp.stops.forEach((stop, i) => {
    const sdef = st(stop.station);
    h += `<div class="stop" data-i="${i}"><div class="head"><span class="name">${i + 1}. ${esc(sdef.name)}</span>
      <button class="ordbtn" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button><button class="ordbtn" data-act="down" data-i="${i}" ${i === inp.stops.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
      <button class="rm" data-act="rmstop" data-i="${i}" aria-label="移除停靠點">✕</button></div>`;
    if (!stop.pois.length) h += `<div class="poi-row"><div class="pn"><span>沒有選景點：只在此站下車再搭下一班。</span></div><button class="btn sm ghost" data-act="pick" data-code="${stop.station}">挑景點</button></div>`;
    stop.pois.forEach((p, j) => {
      const d = poi(p.id); if (!d) return;
      h += `<div class="poi-row"><div class="pn"><b>${ICONS[d.icon] || '📍'} ${esc(d.name)}</b><span>步行約 ${d.walk_min} 分 <i class="tag est">估算</i></span></div>
        <div class="stepper" aria-label="停留時間"><button data-act="stay" data-i="${i}" data-j="${j}" data-d="-10" aria-label="減 10 分">−</button><output>${p.stay} 分</output><button data-act="stay" data-i="${i}" data-j="${j}" data-d="10" aria-label="加 10 分">＋</button></div>
        <button class="rm" data-act="rmpoi" data-i="${i}" data-j="${j}" aria-label="移除景點">✕</button></div>`;
    });
    h += `<div class="row" style="margin-top:6px"><button class="btn sm ghost" data-act="pick" data-code="${stop.station}">＋ 加景點</button></div></div>`;
  });
  if (r.segments.length) {
    h += `<h3>時間軸 <span class="tag est">步行為估算</span></h3><ol class="timeline">`;
    for (const s of r.segments) {
      if (s.kind === 'train') h += `<li class="seg train"><span class="t">${P.fmt(s.dep)}</span><span class="ic">🚆</span><div class="body"><div class="title">${esc(s.fromName)} → ${esc(s.toName)}</div><div class="sub">${esc(s.type)} ${esc(s.train)} 次 · ${P.fmt(s.arr)} 抵達 · ${s.minutes} 分${s.note && s.note !== '每日行駛。' ? ' · ' + esc(s.note) : ''}</div></div></li>`;
      else if (s.kind === 'walk') h += `<li class="seg walk"><span class="t">${P.fmt(s.start)}</span><span class="ic">🚶</span><div class="body"><div class="title">${esc(s.from)} → ${esc(s.to)}</div><div class="sub">約 ${s.minutes} 分 <i class="tag est">估算</i></div></div></li>`;
      else if (s.kind === 'visit') h += `<li class="seg visit ${s.problem ? 'problem' : ''}"><span class="t">${P.fmt(s.start)}</span><span class="ic">📍</span><div class="body"><div class="title">${esc(s.name)}${s.problem ? ` <i class="tag bad">${esc(s.problem)}</i>` : ''}</div><div class="sub">停留到 ${P.fmt(s.end)}（${s.minutes} 分）${s.hoursText ? ' · ' + esc(s.hoursText) : ''}${s.warning ? ' · ⚠ ' + esc(s.warning) : ''}</div></div></li>`;
      else if (s.kind === 'wait') h += `<li class="seg wait"><span class="t">${P.fmt(s.start)}</span><span class="ic">⏳</span><div class="body"><div class="title">${esc(st(s.station).name)} 候車</div><div class="sub">${s.minutes} 分</div></div></li>`;
    }
    if (r.summary.returnAt != null) h += `<li class="seg"><span class="t">${P.fmt(r.summary.returnAt)}</span><span class="ic">🏁</span><div class="body"><div class="title">回到 ${esc(r.summary.originName)}</div><div class="sub">最晚 ${P.fmt(r.summary.returnBy)}${r.summary.slack >= 0 ? ` · 還有 ${P.fmtDur(r.summary.slack)} 緩衝` : ` · 超過 ${P.fmtDur(-r.summary.slack)}`}</div></div></li>`;
    h += `</ol>`;
  }
  h += `<div class="row" style="margin-top:12px"><button class="btn sm danger" data-act="reset">重新開始</button></div>`;
  const day = state.data.timetable.dates[P.dateKey(inp.date)];
  h += `<p class="muted small" style="margin-top:10px">班次：臺鐵開放資料 ${esc(inp.date)} 當日時刻表${day ? `（檔案更新 ${esc(day.update_time)}）` : ''}；轉乘保留 ${P.CONNECT_BUFFER_MIN} 分緩衝；步行時間與動畫位置為估算，非即時 GPS。</p>`;
  el.innerHTML = h;
}
function renderStation() {
  const el = $('#tab-station'); const code = state.selected;
  if (!code) { el.innerHTML = `<h2>車站</h2><p class="muted">點 3D 地圖上的車站標籤，或從下面選一站。</p><div class="stations-strip">${state.data.stations.stations.map(s => `<button data-act="pick" data-code="${s.code}">${esc(s.name)}</button>`).join('')}</div>`; return; }
  const s = st(code); const inp = state.input; const r = state.result;
  const trains = P.dayTrains(state.data.timetable, inp.date) || [];
  // reference time: planned arrival at this station if in plan, else departAfter
  let ref = P.hm(inp.departAfter); let refNote = `${inp.departAfter} 起`;
  if (r && r.segments) { const arr = r.segments.find(x => x.kind === 'train' && x.to === code); if (arr) { ref = arr.arr; refNote = `行程抵達 ${P.fmt(arr.arr)} 起`; } }
  const dep = P.departuresFrom(trains, code, ref, state.data.stations.stations, 3);
  const endName = state.data.stations.stations[state.data.stations.stations.length - 1].name, startName = state.data.stations.stations[0].name;
  const stopIdx = inp.stops.findIndex(x => x.station === code);
  let h = `<div class="stations-strip">${state.data.stations.stations.map(x => `<button data-act="pick" data-code="${x.code}" class="${x.code === code ? 'on' : ''}">${esc(x.name)}</button>`).join('')}</div>`;
  h += `<h2>${esc(s.name)} <span class="muted small">${esc(s.name_en)} · 站碼 ${esc(s.code)}</span></h2><p class="small">${esc(s.blurb)}</p>`;
  h += `<div class="card"><div class="row between"><b>下一班（${esc(refNote)}）</b><span class="muted small">${esc(inp.date)}</span></div><div class="dep-list">`;
  const col = (title, list) => `<div class="col"><b>${esc(title)}</b>${list.length ? list.map(l => `<div>${P.fmt(l.dep)} <span class="muted">${esc(l.type)} ${esc(l.train)}</span></div>`).join('') : `<div class="muted">無</div>`}</div>`;
  if (code !== state.data.stations.stations[state.data.stations.stations.length - 1].code) h += col(`往 ${endName}`, dep.toEnd);
  if (code !== state.data.stations.stations[0].code) h += col(`往 ${startName}`, dep.toStart);
  h += `</div>${trains.length ? '' : '<p class="muted small">此日期沒有時刻表資料。</p>'}</div>`;
  h += `<div class="row between"><h3 style="margin:8px 0">步行可達景點</h3>${stopIdx < 0 && code !== inp.origin ? `<button class="btn sm ghost" data-act="addstop" data-code="${code}">只加入停靠</button>` : ''}</div>`;
  for (const p of state.data.pois.pois.filter(p => p.station === code)) {
    const inPlan = stopIdx >= 0 && inp.stops[stopIdx].pois.some(x => x.id === p.id);
    const win = P.openWindow(p, inp.date);
    h += `<div class="poi-card"><div class="ico">${ICONS[p.icon] || '📍'}</div><div class="meta"><b>${esc(p.name)}</b><p>${esc(p.blurb)}</p>
      <div class="hrs">🕒 ${esc(p.hours.text)}${win && win.closed ? ' <i class="tag bad">當日休</i>' : ''}<br>🚶 距車站約 ${p.walk_m} 公尺、步行約 ${p.walk_min} 分 <i class="tag est">估算</i><br>📍 ${esc(p.addr)} · <a href="${esc(p.source_url)}" target="_blank" rel="noopener">官方頁</a></div></div>
      <div class="act">${inPlan ? `<button class="btn sm ghost" data-act="rmpoi-id" data-id="${p.id}">已加入 ✓</button>` : `<button class="btn sm accent" data-act="addpoi" data-id="${p.id}">＋ 加入</button>`}<span class="muted small">建議 ${p.stay_default} 分</span></div></div>`;
  }
  el.innerHTML = h;
}
function renderSettings() {
  const el = $('#tab-settings'); const inp = state.input; const range = P.supportedRange(state.data.timetable);
  el.innerHTML = `<h2>設定</h2>
    <label class="f"><span>出發日期（支援 ${range ? esc(range.from) + ' ～ ' + esc(range.to) : '—'}）</span><input id="f-date" type="date" value="${esc(inp.date)}" ${range ? `min="${range.from}" max="${range.to}"` : ''}></label>
    <div class="f"><span class="muted small">出發站</span><div class="chips" id="f-origin">${state.data.stations.stations.map(s => `<button type="button" data-code="${s.code}" class="${s.code === inp.origin ? 'on' : ''}">${esc(s.name)}</button>`).join('')}</div></div>
    <div class="grid2"><label class="f"><span>最早出發時間</span><input id="f-dep" type="time" value="${esc(inp.departAfter)}" step="300"></label><label class="f"><span>最晚返回時間</span><input id="f-ret" type="time" value="${esc(inp.returnBy)}" step="300"></label></div>
    <p class="muted small">日期沒有官方時刻表時會顯示「無資料」，不會用其他日期的班次代替。</p>`;
  $('#f-date').addEventListener('change', e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { inp.date = e.target.value; recompute(); } });
  $('#f-dep').addEventListener('change', e => { if (P.hm(e.target.value) != null) { inp.departAfter = e.target.value; recompute(); } });
  $('#f-ret').addEventListener('change', e => { if (P.hm(e.target.value) != null) { inp.returnBy = e.target.value; recompute(); } });
  $('#f-origin').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; inp.origin = b.dataset.code; renderSettings(); recompute(); });
}
function renderSources() {
  const d = state.data; const range = P.supportedRange(d.timetable);
  $('#tab-sources').innerHTML = `<h2>資料來源與限制</h2>
    <div class="card"><b>班次</b><ul class="src"><li>${esc(d.timetable.source.name)}（<a href="${esc(d.timetable.source.url)}" target="_blank" rel="noopener">開放資料列表</a>）</li><li>支援乘車日期：${range ? `${esc(range.from)} ～ ${esc(range.to)}（${range.days} 天，每日一檔）` : '—'}</li><li>本站擷取時間：${esc(d.timetable.generated_at)}（UTC）</li><li>授權：${esc(d.timetable.source.license)}</li></ul></div>
    <div class="card"><b>車站</b><ul class="src"><li>${esc(d.stations.source.name)}（<a href="${esc(d.stations.source.dataset)}" target="_blank" rel="noopener">data.gov.tw</a>，擷取 ${esc(d.stations.source.fetched)}）</li></ul></div>
    <div class="card"><b>景點</b><ul class="src"><li>${esc(d.pois.source.name)}，擷取 ${esc(d.pois.source.fetched)}；各景點頁連結見「車站」頁。</li><li>${esc(d.pois.source.note)}</li></ul></div>
    <div class="card"><b>已知限制</b><ul class="src"><li>只收錄平溪線 5 站、10 個景點，班次限直達車（瑞芳—猴硐段含宜蘭線區間車）。</li><li>轉乘緩衝固定 ${P.CONNECT_BUFFER_MIN} 分；不含票價、座位、誤點與臨時停駛資訊。</li><li>3D 場景為示意，不按比例；預覽中的火車與人物位置依時刻表分鐘數估算。</li><li>行程只存在你的瀏覽器（localStorage），清除網站資料會一併清除。</li></ul></div>
    <p class="muted small">鐵道出走沙盤 v1 · 原創場景與介面 · Three.js (MIT)</p>`;
}

// ---------- itinerary edits ----------
function findStop(code) { return state.input.stops.findIndex(s => s.station === code); }
function addPoi(id) {
  const p = poi(id); if (!p) return;
  let i = findStop(p.station); if (i < 0) { state.input.stops.push({ station: p.station, pois: [] }); i = state.input.stops.length - 1; }
  if (state.input.stops[i].pois.some(x => x.id === id)) { toast('已在行程中'); return; }
  state.input.stops[i].pois.push({ id, stay: p.stay_default }); recompute(); toast(`已加入 ${p.name}`);
}
function removePoi(i, j) { const s = state.input.stops[i]; if (!s) return; s.pois.splice(j, 1); if (!s.pois.length) state.input.stops.splice(i, 1); recompute(); }
function removePoiById(id) { const p = poi(id); const i = findStop(p.station); if (i < 0) return; const j = state.input.stops[i].pois.findIndex(x => x.id === id); if (j >= 0) removePoi(i, j); }
function addStop(code) { if (findStop(code) >= 0) return; state.input.stops.push({ station: code, pois: [] }); recompute(); toast(`已加入停靠 ${st(code).name}`); }
function moveStop(i, d) { const s = state.input.stops; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; recompute(); }
function pickStation(code) {
  state.selected = code; renderStation(); setTab('station'); if (state.sheet === 'peek') setSheet('half');
  const portrait = !matchMedia('(min-width:900px)').matches && window.innerHeight > window.innerWidth;
  if (state.scene) { state.scene.setSelected(code); state.scene.focusStation(code, portrait ? 22 : 0); }
  updateLabels();
}
function resetAll() {
  stopPreview(); state.input = defaults(); state.selected = null; state.scene && state.scene.setSelected(null); state.lastSavedId = null;
  try { storage() && storage().removeItem(KEY_DRAFT); } catch { }
  renderSettings(); recompute({ persist: false }); setTab('plan'); state.scene && state.scene.fitCamera(); toast('已重新開始'); updateLabels();
}

// ---------- save / open / export ----------
function savedList() { const l = loadJSON(KEY_SAVED, []); return Array.isArray(l) ? l : []; }
function dialog(html) { const d = $('#dlg'); d.innerHTML = `<div class="dlg-in">${html}</div>`; if (!d.open) d.showModal(); return d; }
function closeDialog() { const d = $('#dlg'); if (d.open) d.close(); }
function openMenu() {
  const r = state.result; const can = r && r.segments && r.segments.length;
  dialog(`<h2>行程</h2>
    <div class="row" style="flex-direction:column;align-items:stretch">
      <button class="btn" data-act="save" ${state.input.stops.length ? '' : 'disabled'}>💾 保存到這個瀏覽器</button>
      <button class="btn ghost" data-act="open">📂 開啟已保存的行程（${savedList().length}）</button>
      <button class="btn ghost" data-act="export" ${can ? '' : 'disabled'}>⬇ 匯出 JSON</button>
      <button class="btn ghost" data-act="copy" ${can ? '' : 'disabled'}>📋 複製文字摘要</button>
      ${navigator.share ? `<button class="btn ghost" data-act="share" ${can ? '' : 'disabled'}>↗ 分享</button>` : ''}
      <button class="btn danger" data-act="reset">↺ 重新開始</button>
      <button class="btn ghost" data-act="close">關閉</button>
    </div>`);
}
function saveTrip() {
  const name = `${state.input.date} ${st(state.input.origin).name}出發 ${state.input.stops.map(s => st(s.station).name).join('→') || '未排'}`;
  dialog(`<h2>保存行程</h2><label class="f"><span>名稱</span><input id="save-name" value="${esc(name)}" maxlength="60"></label><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close">取消</button><button class="btn accent" data-act="save-confirm">保存</button></div>`);
  setTimeout(() => { const i = $('#save-name'); i && i.focus(); }, 50);
}
function saveConfirm() {
  const nm = ($('#save-name')?.value || '').trim() || '未命名行程';
  const list = savedList(); const id = state.lastSavedId && list.some(x => x.id === state.lastSavedId) ? state.lastSavedId : ('t' + Date.now().toString(36));
  const rec = { id, name: nm, savedAt: new Date().toISOString(), status: state.result?.status, input: JSON.parse(JSON.stringify(state.input)) };
  const idx = list.findIndex(x => x.id === id); if (idx >= 0) list[idx] = rec; else list.unshift(rec);
  if (saveJSON(KEY_SAVED, list.slice(0, 30))) { state.lastSavedId = id; closeDialog(); toast(`已保存「${nm}」`); } else toast('無法保存：瀏覽器不允許儲存');
}
function openList() {
  const list = savedList();
  dialog(`<h2>已保存的行程</h2>${list.length ? list.map(x => `<div class="saved-item"><div class="m"><b>${esc(x.name)}</b><span>${esc(x.input.date)} · ${x.input.stops.length} 站 · ${esc(new Date(x.savedAt).toLocaleString('zh-TW', { hour12: false }))}</span></div><button class="btn sm" data-act="load" data-id="${x.id}">開啟</button><button class="rm" data-act="del" data-id="${x.id}" aria-label="刪除">🗑</button></div>`).join('') : '<p class="muted">還沒有保存的行程。</p>'}<div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn ghost" data-act="close">關閉</button></div>`);
}
function loadTrip(id) { const x = savedList().find(t => t.id === id); if (!x) return; stopPreview(); state.input = sanitizeInput(x.input); state.lastSavedId = id; renderSettings(); recompute(); closeDialog(); setTab('plan'); toast(`已開啟「${x.name}」`); }
function deleteTrip(id) { const list = savedList().filter(t => t.id !== id); saveJSON(KEY_SAVED, list); if (state.lastSavedId === id) state.lastSavedId = null; openList(); }
function exportJSON() {
  const doc = P.exportTrip(state.result, state.data);
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `rail-trip_${state.input.date}_${st(state.input.origin).name_en}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  closeDialog(); toast('已匯出 JSON');
}
async function copyText() {
  const txt = P.tripText(state.result, state.data);
  try { await navigator.clipboard.writeText(txt); closeDialog(); toast('已複製文字摘要'); }
  catch { dialog(`<h2>文字摘要</h2><textarea style="width:100%;height:220px;font:12px/1.4 monospace" readonly>${esc(txt)}</textarea><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn ghost" data-act="close">關閉</button></div>`); }
}
async function shareText() { try { await navigator.share({ title: '鐵道出走沙盤 行程', text: P.tripText(state.result, state.data) }); closeDialog(); } catch { } }
function confirmReset() { dialog(`<h2>重新開始？</h2><p>會清除目前的停靠點與設定（已保存的行程不受影響）。</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close">取消</button><button class="btn danger" data-act="reset-confirm">清除並重新開始</button></div>`); }
function about() {
  dialog(`<div class="about"><h2>鐵道出走沙盤</h2><p>半日鐵道旅行的沙盤：在低多邊形的平溪線裡點車站、排景點、看火車跑，用臺鐵官方時刻表算出可行的來回班次。</p><p>班次來自臺鐵開放資料每日時刻表；景點資訊來自新北市觀光旅遊網；步行時間與火車動畫為估算。詳見「資料」頁。</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close">關閉</button></div></div>`);
}

// ---------- preview ----------
function startPreview() {
  const r = state.result; if (!r || !r.segments.length) { toast('先加入停靠點再預覽'); return; }
  stopPreview();
  const end = r.summary.returnAt != null ? r.summary.returnAt : Math.max(...r.segments.map(s => s.end ?? s.arr));
  state.preview = { t: r.summary.departAt, end, speedIdx: 0, paused: false, last: performance.now(), raf: 0 };
  state.scene.startPreview(r); $('#preview-hud').hidden = false; $('#hud-speed').textContent = '×1'; $('#hud-pause').textContent = '⏸';
  if (state.sheet !== 'peek') setSheet('peek');
  const step = now => {
    const p = state.preview; if (!p) return; p.raf = requestAnimationFrame(step);
    const dt = Math.min(0.25, (now - p.last) / 1000); p.last = now;
    if (!p.paused) p.t = Math.min(p.end, p.t + dt * SPEEDS[p.speedIdx]);
    const hud = state.scene.setTime(p.t); $('#hud-time').textContent = P.fmt(p.t); $('#hud-text').textContent = hud.text || '';
    if (p.t >= p.end && !p.paused) { p.paused = true; $('#hud-pause').textContent = '↺'; $('#hud-text').textContent = (hud.text || '') + ' · 預覽結束'; }
  };
  state.preview.raf = requestAnimationFrame(step);
}
function stopPreview() { if (!state.preview) return; cancelAnimationFrame(state.preview.raf); state.preview = null; state.scene.stopPreview(); $('#preview-hud').hidden = true; }

// ---------- labels ----------
const labelEls = {}; const poiLabelEls = {};
function buildLabels() {
  const root = $('#labels'); root.innerHTML = '';
  for (const s of state.data.stations.stations) { const b = document.createElement('button'); b.className = 'st-label'; b.type = 'button'; b.dataset.code = s.code; b.innerHTML = `${esc(s.name)}<span class="n">${esc(s.name_en)}</span>`; b.addEventListener('click', () => pickStation(s.code)); root.appendChild(b); labelEls[s.code] = b; }
  for (const p of state.data.pois.pois) { const d = document.createElement('div'); d.className = 'poi-label hide'; d.textContent = `${ICONS[p.icon] || ''} ${p.name}`; root.appendChild(d); poiLabelEls[p.id] = d; }
}
let lastFrame = null;
function onFrame(f) { lastFrame = f; updateLabels(); }
function updateLabels() {
  const f = lastFrame; if (!f) return;
  const inPlan = new Set((state.input.stops || []).map(s => s.station)); inPlan.add(state.input.origin);
  for (const c in labelEls) { const p = f.stations[c]; const el = labelEls[c]; el.style.transform = `translate(${p.x.toFixed(0)}px,${(p.y).toFixed(0)}px) translate(-50%,-100%)`; el.classList.toggle('hide', !p.visible); el.classList.toggle('active', c === state.selected); el.classList.toggle('in-plan', inPlan.has(c)); }
  const planned = new Set(); for (const s of state.input.stops) for (const p of s.pois) planned.add(p.id);
  const close = f.cameraDist < 70;
  for (const id in poiLabelEls) { const p = f.pois[id]; const el = poiLabelEls[id]; const d = poi(id); const show = p.visible && (planned.has(id) || (close && d.station === state.selected)); el.classList.toggle('hide', !show); el.classList.toggle('in-plan', planned.has(id)); if (show) el.style.transform = `translate(${p.x.toFixed(0)}px,${p.y.toFixed(0)}px) translate(-50%,-100%)`; }
}

// ---------- sheet drag ----------
function setupSheet() {
  const sheet = $('#sheet'), handle = $('#sheet-handle');
  let drag = null;
  const snap = h => { const vh = window.innerHeight; const peek = 112, half = Math.min(vh * 0.56, 560), full = vh - 64; const opts = [['peek', peek], ['half', half], ['full', full]]; opts.sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h)); setSheet(opts[0][0]); };
  handle.addEventListener('pointerdown', e => { if (matchMedia('(min-width:900px)').matches) return; drag = { y: e.clientY, h: sheet.getBoundingClientRect().height, moved: false }; handle.setPointerCapture(e.pointerId); sheet.classList.add('dragging'); });
  handle.addEventListener('pointermove', e => { if (!drag) return; const dy = drag.y - e.clientY; if (Math.abs(dy) > 4) drag.moved = true; sheet.style.height = Math.max(90, Math.min(window.innerHeight - 64, drag.h + dy)) + 'px'; });
  const end = e => { if (!drag) return; sheet.classList.remove('dragging'); const h = sheet.getBoundingClientRect().height; sheet.style.height = ''; if (drag.moved) snap(h); else setSheet(state.sheet === 'peek' ? 'half' : 'peek'); drag = null; };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(state.sheet === 'peek' ? 'half' : 'peek'); } });
  $('#peekbar').addEventListener('click', () => { if (!matchMedia('(min-width:900px)').matches) setSheet(state.sheet === 'peek' ? 'half' : 'peek'); });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { setTab(b.dataset.tab); if (state.sheet === 'peek') setSheet('half'); }));
}

// ---------- events ----------
function setupEvents() {
  document.body.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; const a = b.dataset.act; const i = +b.dataset.i, j = +b.dataset.j;
    const acts = {
      pick: () => pickStation(b.dataset.code), addpoi: () => addPoi(b.dataset.id), 'rmpoi-id': () => removePoiById(b.dataset.id), addstop: () => addStop(b.dataset.code),
      rmpoi: () => removePoi(i, j), rmstop: () => { state.input.stops.splice(i, 1); recompute(); }, up: () => moveStop(i, -1), down: () => moveStop(i, 1),
      stay: () => { const p = state.input.stops[i]?.pois[j]; if (p) { p.stay = Math.max(0, Math.min(600, p.stay + (+b.dataset.d))); recompute(); } },
      preview: startPreview, menu: openMenu, save: saveTrip, 'save-confirm': saveConfirm, open: openList, load: () => loadTrip(b.dataset.id), del: () => deleteTrip(b.dataset.id),
      export: exportJSON, copy: copyText, share: shareText, reset: confirmReset, 'reset-confirm': () => { closeDialog(); resetAll(); }, close: closeDialog,
    };
    acts[a] && acts[a]();
  });
  $('#btn-menu').addEventListener('click', openMenu);
  $('#btn-preview').addEventListener('click', () => state.preview ? stopPreview() : startPreview());
  $('#brand').addEventListener('click', about);
  $('#datepill').addEventListener('click', () => { setTab('settings'); if (state.sheet === 'peek') setSheet('half'); });
  $('#hud-stop').addEventListener('click', stopPreview);
  $('#hud-pause').addEventListener('click', () => { const p = state.preview; if (!p) return; if (p.t >= p.end) { p.t = state.result.summary.departAt; p.paused = false; } else p.paused = !p.paused; $('#hud-pause').textContent = p.paused ? '▶' : '⏸'; p.last = performance.now(); });
  $('#hud-speed').addEventListener('click', () => { const p = state.preview; if (!p) return; p.speedIdx = (p.speedIdx + 1) % SPEEDS.length; $('#hud-speed').textContent = '×' + [1, 2, 4][p.speedIdx]; });
  $('#dlg').addEventListener('click', e => { if (e.target === e.currentTarget) closeDialog(); });
  window.addEventListener('resize', () => { state.scene && state.scene.resize(); });
}

// ---------- boot ----------
async function boot() {
  setupSheet(); setupEvents();
  const overlay = $('#loading'), txt = $('#loading-text');
  try {
    state.data = await loadData();
  } catch (err) {
    overlay.querySelector('.card').innerHTML = `<h2 style="margin:0 0 6px">資料載入失敗</h2><p class="small">無法取得官方時刻表或景點資料，暫時不能規劃行程。<br><span class="muted">${esc(err.message)}</span></p><button class="btn accent" id="retry">重試</button>`;
    $('#retry').addEventListener('click', () => location.reload());
    $('#peek-status').className = 'status st-bad'; $('#peek-status').textContent = '載入失敗'; $('#peek-text').textContent = '資料載入失敗，請重試。';
    return;
  }
  state.input = sanitizeInput(loadJSON(KEY_DRAFT, null));
  try {
    state.scene = createScene($('#world'), { stations: state.data.stations.stations, pois: state.data.pois.pois, onStationTap: pickStation, onFrame });
  } catch (err) {
    $('#scene-note').textContent = '此裝置無法啟用 3D 場景（WebGL 不可用）；行程規劃仍可使用。';
  }
  buildLabels(); renderSettings(); renderSources(); recompute({ persist: false });
  overlay.hidden = true;
  if (!state.input.stops.length && state.sheet === 'peek' && !matchMedia('(min-width:900px)').matches) { /* keep the 3D world as the first screen */ }
  window.__railtrip = { state, P, recompute, pickStation, addPoi, resetAll, startPreview, stopPreview };
}
boot();
