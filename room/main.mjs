// main.mjs — 航程風浪 UI（手機優先）。資料一律來自 ./cruise-data.mjs 的 createCruiseDataClient；
// 本檔不含任何假資料或硬編數值。測試可透過 globalThis.__CRUISE_TEST__ 注入 fetch/now/isOnLine/forceNoWebGL/playIntervalMs/
// ageCheckMs/autoRefreshDelayMs/autoRefreshMinGapMs。
import {
  createCruiseDataClient, resolveRange, formatInZone, buildHourlyTable, summarizeTable,
  VOYAGE_META, SAMPLE_POINTS, SAMPLE_POINTS_NOTE, ATTRIBUTION, DEFAULTS,
} from './cruise-data.mjs';
import { createCruiseScene } from './cruise-scene.mjs';

const T = globalThis.__CRUISE_TEST__ ?? {};
const $ = (id) => document.getElementById(id);
const TW = 480, JP = 540;

// 航程時間軸：由 module metadata 計算（基隆離港→返港，整點含兩端）
const range = resolveRange(VOYAGE_META.departure.iso, VOYAGE_META.returnArrival.iso);
const HOURS = range.hours;
const clientOpts = {};
if (T.fetch) clientOpts.fetch = T.fetch;
if (T.now) clientOpts.now = T.now;
if (T.isOnLine) clientOpts.isOnLine = T.isOnLine;
const client = createCruiseDataClient(clientOpts);
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// 年齡檢查：UI 與資料模組共用同一時鐘（測試可注入 now）。定時檢查與自動更新皆有界：
// 單一 interval、單一 pending timer、兩次自動嘗試之間至少間隔 AUTO_REFRESH_MIN_GAP_MS，失敗不無限重試。
const nowMs = () => (typeof T.now === 'function' ? T.now() : Date.now());
const AGE_CHECK_MS = Number.isFinite(T.ageCheckMs) ? T.ageCheckMs : 60_000;
const AUTO_REFRESH_DELAY_MS = Number.isFinite(T.autoRefreshDelayMs) ? T.autoRefreshDelayMs : 1500;
const AUTO_REFRESH_MIN_GAP_MS = Number.isFinite(T.autoRefreshMinGapMs) ? T.autoRefreshMinGapMs : 5 * 60_000;

const state = {
  dir: 'out',          // 'out' 基隆→那霸 ／ 'back' 那霸→基隆（純方向示意）
  pointId: SAMPLE_POINTS[0].id,
  idx: 0,              // HOURS 索引；初次為離港整點
  playing: false,
  loading: false,
  result: null,
  fatal: null,
  timer: 0,
  ageTimer: 0,         // 定時年齡檢查
  autoTimer: 0,        // 待執行的自動更新（單一）
  lastAttemptMs: null, // 最近一次取得／更新嘗試（手動或自動）
  ageKey: '',          // 上次渲染時的年齡等級，變化才重繪
  viewCache: null,     // 過期來源剔除後的檢視結果（依 result 與過期旗標快取）
};

// ---------- 小工具 ----------
const shortTW = (epoch) => { const f = formatInZone(epoch, TW); return `${f.date.slice(5).replace('-', '/')} ${f.time}`; };
const shortJP = (epoch) => { const f = formatInZone(epoch, JP); return `${f.date.slice(5).replace('-', '/')} ${f.time}`; };
const fmtTW = (epoch) => formatInZone(epoch, TW).label;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const COMPASS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
const compass = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
const dirText = (deg) => (isNum(deg) ? `${Math.round(deg)}°（來自${compass(deg)}方）` : null);
const online = () => (T.isOnLine ? T.isOnLine() : (typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const none = '<span class="none">尚無預報</span>';
const hoursOf = (ms) => Math.round(ms / 3_600_000);

// ---------- 年齡：一律以「目前時鐘 − fetchedAt」重算，不用取得時的 freshness 快照 ----------
// level: none（無資料）/ within（TTL 內）/ old（過 TTL、未超 maxAge，可顯示但標舊）/ expired（超 maxAge，一律不顯示）
function ageOf(s) {
  const ttlMs = isNum(s?.ttlMs) ? s.ttlMs : DEFAULTS.ttlMs;
  const maxAgeMs = isNum(s?.maxAgeMs) ? s.maxAgeMs : DEFAULTS.maxAgeMs;
  const ageMs = s?.data && isNum(s.fetchedAt) ? Math.max(0, nowMs() - s.fetchedAt) : null;
  const level = ageMs === null ? 'none' : ageMs > maxAgeMs ? 'expired' : ageMs > ttlMs ? 'old' : 'within';
  return { ageMs, ttlMs, maxAgeMs, level, expired: level === 'expired', old: level === 'old' };
}
function ages() {
  const r = state.result;
  return { marine: ageOf(r?.sources.marine), weather: ageOf(r?.sources.weather) };
}
const ageKey = () => { const a = ages(); return `${a.marine.level}|${a.weather.level}`; };
// 檢視用結果：過期來源的資料整個剔除後，以模組 export 重建 table 與 summary（不複製資料邏輯）
function view() {
  const r = state.result;
  if (!r) return null;
  const a = ages();
  if (!a.marine.expired && !a.weather.expired) return r;
  const key = `${a.marine.expired}|${a.weather.expired}`;
  const c = state.viewCache;
  if (c && c.result === r && c.key === key) return c.view;
  const table = buildHourlyTable(r.range, r.points, a.marine.expired ? null : r.sources.marine.data, a.weather.expired ? null : r.sources.weather.data);
  const v = { ...r, table, summary: summarizeTable(table) };
  state.viewCache = { result: r, key, view: v };
  return v;
}

function currentPoint() { return view()?.table.find((p) => p.id === state.pointId) ?? null; }
function currentRow() { return currentPoint()?.rows[state.idx] ?? null; }
function pointMeta(id) { return SAMPLE_POINTS.find((p) => p.id === id); }

// ---------- 場景 ----------
const sceneEl = $('scene');
const scene = createCruiseScene(sceneEl, { reducedMotion, forceFallback: !!T.forceNoWebGL });
if (scene.mode === 'static') $('sea-fallback').hidden = false;
document.addEventListener('visibilitychange', () => {
  scene.setPaused(document.hidden);
  if (document.hidden) {
    if (state.playing) setPlaying(false);
    stopAgeTimer();
  } else {
    checkAge({ auto: true });
    startAgeTimer();
  }
});

// ---------- 渲染 ----------
function renderRoute() {
  const out = state.dir === 'out';
  $('route-from').textContent = out ? '基隆' : '那霸';
  $('route-to').textContent = out ? '那霸' : '基隆';
  const path = $('route-path');
  if (out) { path.setAttribute('marker-end', 'url(#arrow-head)'); path.removeAttribute('marker-start'); }
  else { path.setAttribute('marker-start', 'url(#arrow-head)'); path.removeAttribute('marker-end'); }
  path.dataset.dir = state.dir;
  for (const b of document.querySelectorAll('.seg-btn')) {
    const on = b.dataset.dir === state.dir;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('is-on', on);
  }
  for (const c of document.querySelectorAll('.route-dots circle')) c.classList.toggle('is-on', c.dataset.point === state.pointId);
  scene.setDirection(state.dir);
}

function renderTime() {
  const epoch = HOURS[state.idx];
  const tw = shortTW(epoch), jp = shortJP(epoch);
  $('hero-time-tw').textContent = tw;
  $('hero-time-tw').dateTime = new Date(epoch * 1000).toISOString();
  $('time-tw').textContent = tw;
  $('time-tw').dateTime = new Date(epoch * 1000).toISOString();
  $('time-jp').textContent = `日本時間 ${jp}（快 1 小時）`;
  const s = $('time-slider');
  s.value = String(state.idx);
  s.setAttribute('aria-valuetext', `${tw} 台灣時間，第 ${state.idx + 1} / ${HOURS.length} 小時`);
  s.style.setProperty('--pct', `${(state.idx / (HOURS.length - 1)) * 100}%`);
  $('prev').disabled = state.idx === 0;
  $('next').disabled = state.idx === HOURS.length - 1;
}

function renderAreas() {
  const host = $('areas');
  if (!host.childElementCount) {
    host.innerHTML = SAMPLE_POINTS.map((p) => `<button type="button" role="radio" class="area" data-point="${p.id}" aria-checked="false"><span class="a-name">${esc(p.label)}</span><span class="a-val" data-val></span></button>`).join('');
    host.addEventListener('click', (e) => { const b = e.target.closest('.area'); if (b) setPoint(b.dataset.point); });
  }
  const r = view();
  for (const b of host.querySelectorAll('.area')) {
    b.setAttribute('aria-checked', String(b.dataset.point === state.pointId));
    const row = r?.table.find((p) => p.id === b.dataset.point)?.rows[state.idx];
    const v = b.querySelector('[data-val]');
    if (!r) { v.textContent = '…'; v.className = 'a-val'; }
    else if (row && isNum(row.wave_height)) { v.innerHTML = `${row.wave_height.toFixed(1)}<small>m</small>`; v.className = 'a-val'; }
    else { v.textContent = '尚無預報'; v.className = 'a-val none'; }
  }
}

function setVal(id, value, digits) {
  const el = $(id);
  if (isNum(value)) { el.textContent = value.toFixed(digits); el.classList.remove('none'); }
  else { el.textContent = state.result ? '尚無預報' : '—'; el.classList.toggle('none', !!state.result); }
}
function renderMetrics() {
  const row = currentRow();
  setVal('m-wave', row?.wave_height ?? null, 1);
  setVal('m-period', row?.wave_period ?? null, 0);
  const ms = row?.wind_speed_10m ?? null;
  setVal('m-wind', isNum(ms) ? ms * 3.6 : null, 0);
  $('m-wind-ms').textContent = isNum(ms) ? `${ms.toFixed(1)} m/s` : '';
  // 海面示意強弱：以浪高做相對示意（0–2.5 m 映射），非物理模型
  scene.setSeaLevel(isNum(row?.wave_height) ? row.wave_height / 2.5 : 0.25);
}

function buildSummary() {
  const r = view();
  if (state.fatal) return { lead: '無法建立查詢，請重新整理頁面。', sub: state.fatal.message ?? '' };
  if (!r) return { lead: state.loading ? '正在取得示例海域預報…' : '尚未取得預報。', sub: '' };
  const a = ages();
  const label = pointMeta(state.pointId)?.label ?? '';
  const w = r.summary.points.find((p) => p.id === state.pointId)?.wave;
  let lead;
  if (a.marine.expired) lead = `${label}：浪高預報已超過 ${hoursOf(a.marine.maxAgeMs)} 小時未更新，舊值不再顯示。`;
  else if (!w || w.available === 0) lead = `${label}：此航程期間尚無浪高預報。`;
  else if (w.available === 1) lead = `${label}：只有一小時有浪高預報，無法判斷變化。`;
  else if (w.flat) lead = `${label}：整段期間浪高約 ${w.min.value.toFixed(1)}–${w.max.value.toFixed(1)} m，變化不大。`;
  else {
    lead = `${label}：${shortTW(w.max.epoch)} 前後浪較大（約 ${w.max.value.toFixed(1)} m）`;
    if (w.smaller && w.smaller.start > w.max.epoch) lead += `，約 ${shortTW(w.smaller.start)} 起轉小。`;
    else if (w.smaller) lead += `，較小時段在 ${shortTW(w.smaller.start)}–${shortTW(w.smaller.end)}。`;
    else lead += '，區間內未見明顯轉小。';
  }
  if (!a.marine.expired && w && w.available > 0 && w.available < w.requested) lead += `（僅 ${w.available}/${w.requested} 小時有預報）`;
  let sub;
  if (a.marine.expired || a.weather.expired) {
    const names = [a.marine.expired ? '海象' : null, a.weather.expired ? '風場' : null].filter(Boolean).join('與');
    sub = `${names}預報已超過可顯示年齡，舊值已隱藏；請按「更新」重新取得。`;
    return { lead, sub };
  }
  const cmp = r.summary.comparison;
  if (cmp?.peaks?.length >= 2) {
    const hi = cmp.peaks.reduce((x, y) => (y.max > x.max ? y : x));
    const lo = cmp.peaks.reduce((x, y) => (y.max < x.max ? y : x));
    sub = hi.max - lo.max < DEFAULTS.smallDiffM
      ? `同期比較：${cmp.peaks.length} 處示例海域最大浪高差異不大。`
      : `同期比較：${hi.label}浪較大，${lo.label}較小。`;
    sub += ' 示例海域比較，非實船航跡。';
  } else sub = cmp?.text ?? '';
  if (r.sources.marine.stale || r.sources.weather.stale) sub = `（以下為舊預報，非最新）${sub}`;
  else if (a.marine.old || a.weather.old) sub = `（以下為舊預報，已超過 ${hoursOf(Math.min(a.marine.ttlMs, a.weather.ttlMs))} 小時未更新）${sub}`;
  return { lead, sub };
}
function renderSummary() {
  const { lead, sub } = buildSummary();
  $('summary-lead').textContent = lead;
  $('summary-sub').textContent = sub;
}

function chipFor() {
  if (state.loading) return ['loading', '取得中…'];
  if (!online()) return ['offline', '離線'];
  const r = state.result;
  if (!r) return ['unavailable', '無法取得'];
  const m = r.sources.marine, w = r.sources.weather;
  const a = ages();
  if (a.marine.expired && a.weather.expired) return ['expired', '預報已過期'];
  if (a.marine.expired || a.weather.expired) return ['expired', '部分預報已過期'];
  if (m.stale || w.stale) return ['stale', '舊預報（非最新）'];
  if (a.marine.old || a.weather.old) return ['stale', '舊預報（已過 TTL）'];
  if (r.overall === 'unavailable') return ['unavailable', '無法取得'];
  if (r.overall === 'no_data') return ['no_data', '尚無預報'];
  if (r.overall === 'partial') return ['partial', '部分資料'];
  if (m.freshness === 'cached' || w.freshness === 'cached') return ['cached', '快取預報'];
  return ['fresh', '最新預報'];
}
function statusMessage() {
  const r = state.result;
  const parts = [];
  if (!online()) parts.push('目前離線：無法取得新預報。');
  if (!r) return { text: parts.join(' ') || (state.loading ? '' : '尚未取得預報。'), tone: parts.length ? 'bad' : '' };
  let tone = '';
  const a = ages();
  for (const [name, s, ag] of [['海象', r.sources.marine, a.marine], ['風場', r.sources.weather, a.weather]]) {
    if (!s.ok) {
      let msg = `${name}：${s.statusText}`;
      if (s.error?.code === 'bad_request') msg += '。此示例航程日期可能已超出可查詢的預報期間，或請求參數不被接受。';
      parts.push(msg);
      tone = s.stale ? 'warn' : 'bad';
    }
    if (ag.expired) { parts.push(`${name}：預報已超過 ${hoursOf(ag.maxAgeMs)} 小時未更新，舊值不再顯示。`); tone = 'bad'; }
    else if (ag.old) { parts.push(`${name}：預報已超過 ${hoursOf(ag.ttlMs)} 小時未更新（已過 TTL），仍顯示舊預報。`); tone = tone || 'warn'; }
  }
  if (r.overall === 'no_data') { parts.push('伺服器有回應，但此航程期間尚無任何預報值。'); tone = tone || 'warn'; }
  else if (r.overall === 'partial' && r.transport.marine && r.transport.weather) { parts.push('部分時段或欄位尚無預報，缺值以「尚無預報」顯示，不以 0 代替。'); tone = tone || 'warn'; }
  return { text: parts.join(' '), tone };
}
function renderStatus() {
  const [st, txt] = chipFor();
  const chip = $('status-chip');
  chip.dataset.state = st; chip.textContent = txt;
  const { text, tone } = statusMessage();
  const line = $('status-text');
  line.textContent = text; line.dataset.tone = tone;
  const r = state.result;
  const a = ages();
  const failed = !!r && (!r.transport.marine || !r.transport.weather || a.marine.expired || a.weather.expired);
  $('retry').hidden = !(failed || (!r && !state.loading && !state.fatal));
  $('retry').disabled = state.loading || !!state.fatal;
  $('refresh').disabled = state.loading || !!state.fatal;
  $('refresh').textContent = state.loading ? '取得中…' : '更新';
}

function fmtTime(ms) { return isNum(ms) ? fmtTW(Math.floor(ms / 1000)) : '—'; }
function sourceBlock(name, s, a, grid, req) {
  // 快取年齡文案一律由「目前時鐘 − fetchedAt」與 ttlMs/maxAgeMs 計算，不看 s.freshness。
  // s.stale 只表示「最近一次更新失敗、仍顯示舊的成功結果」，與是否過 TTL 無關，兩者分開陳述。
  const mins = a.ageMs === null ? null : Math.round(a.ageMs / 60_000);
  const ago = mins === null ? '' : mins < 1 ? '剛取得' : mins < 120 ? `約 ${mins} 分鐘前取得` : `約 ${hoursOf(a.ageMs)} 小時前取得`;
  const base = { none: '無資料', within: '仍在 TTL 內', old: '已過 TTL，仍在可顯示年齡內', expired: '已超過最大年齡，舊值不再顯示' }[a.level];
  let fresh;
  if (a.level === 'none') fresh = base;
  else if (a.expired) fresh = s.ok ? `${base}，${ago}` : `更新失敗；舊預報${base}，${ago}`;
  else if (s.stale) fresh = `更新失敗，顯示舊預報；舊預報${base}，${ago}`;
  else fresh = `${base}，${ago}`;
  const errRow = s.error ? `<dt>最近錯誤</dt><dd>${esc(s.error.code ?? '')}${s.error.message ? `：${esc(s.error.message)}` : ''}</dd>` : '';
  // statusText 是取得時的快照；過 TTL／過期後不得再顯示「已取得最新預報」，改指向快取狀態。失敗時保留原始錯誤文字。
  const lastResp = s.ok && (a.old || a.expired) ? '上次取得成功；目前新鮮度見快取狀態' : s.statusText;
  return `<h3>${name}</h3><dl class="kv">
    <dt>上次請求回應</dt><dd>${esc(lastResp)}</dd>
    <dt>快取狀態</dt><dd>${esc(fresh)}</dd>${errRow}
    <dt>擷取時間</dt><dd>${esc(fmtTime(s.fetchedAt))}</dd>
    <dt>年齡上限</dt><dd>TTL ${hoursOf(a.ttlMs)} 小時／最長顯示 ${hoursOf(a.maxAgeMs)} 小時</dd>
    <dt>模型</dt><dd>unknown（API 未標示具體模型）</dd>
    <dt>請求座標</dt><dd>${req.lat}, ${req.lon}</dd>
    <dt>海格座標</dt><dd>${grid ? `${grid.lat}, ${grid.lon}` : none}</dd>
  </dl>`;
}
function renderDetails() {
  const r = view();
  const body = $('details-body');
  const epoch = HOURS[state.idx];
  const meta = pointMeta(state.pointId);
  let html = `<h3>所選時間</h3><dl class="kv"><dt>台灣時間</dt><dd>${esc(fmtTW(epoch))}</dd><dt>日本時間</dt><dd>${esc(formatInZone(epoch, JP).label)}</dd><dt>海域</dt><dd>${esc(meta.label)}</dd></dl>`;
  if (r) {
    const a = ages();
    const row = currentRow();
    const p = currentPoint();
    const v = (x, d, u) => (isNum(x) ? `${x.toFixed(d)} ${u}` : none);
    html += `<h3>該小時數值</h3><dl class="kv">
      <dt>浪高</dt><dd>${v(row?.wave_height, 2, 'm')}</dd>
      <dt>浪週期</dt><dd>${v(row?.wave_period, 1, 's')}</dd>
      <dt>浪向（來向）</dt><dd>${dirText(row?.wave_direction) ?? none}</dd>
      <dt>風速</dt><dd>${isNum(row?.wind_speed_10m) ? `${row.wind_speed_10m.toFixed(1)} m/s（約 ${(row.wind_speed_10m * 3.6).toFixed(0)} km/h）` : none}</dd>
      <dt>風向（來向）</dt><dd>${dirText(row?.wind_direction_10m) ?? none}</dd>
    </dl>`;
    const cov = p?.coverage;
    html += `<h3>本期間覆蓋</h3><dl class="kv"><dt>海象</dt><dd>${esc(cov.marine.status)}（${cov.marine.complete}/${cov.marine.requested} 小時完整）</dd><dt>風場</dt><dd>${esc(cov.weather.status)}（${cov.weather.complete}/${cov.weather.requested} 小時完整）</dd></dl>`;
    const w = r.summary.points.find((x) => x.id === state.pointId)?.wave;
    html += `<h3>分級規則（相對本期間）</h3><p>浪高最大與最小差距小於 ${DEFAULTS.smallDiffM} m 視為「變化不大」；否則以本期間最小值起算，低段 ≤ 最小值 + 差距/3，高段 ≥ 最小值 + 2×差距/3。此為產品比較規則，非海況分級標準。</p>`;
    if (w?.bands) html += `<dl class="kv"><dt>較小上限</dt><dd>${w.bands.lowMax.toFixed(2)} m</dd><dt>較大下限</dt><dd>${w.bands.highMin.toFixed(2)} m</dd></dl>`;
    html += sourceBlock('海象來源（Open-Meteo Marine）', r.sources.marine, a.marine, p.marineGrid, p.requested);
    html += sourceBlock('風場來源（Open-Meteo Forecast）', r.sources.weather, a.weather, p.weatherGrid, p.requested);
  } else {
    html += `<p>${state.loading ? '預報取得中。' : '尚無預報資料可顯示。'}</p>`;
  }
  html += `<h3>說明</h3>
    <p>${esc(SAMPLE_POINTS_NOTE)}</p>
    <p>${esc(VOYAGE_META.note)} 離港 ${esc(shortTW(VOYAGE_META.departure.epochSec))}、返港 ${esc(shortTW(VOYAGE_META.returnArrival.epochSec))}（台灣時間，${esc(VOYAGE_META.sourceNote)}）。</p>
    <p>${esc(ATTRIBUTION.dataNature)} 資料來源 <a href="${ATTRIBUTION.providerUrl}" target="_blank" rel="noopener">${ATTRIBUTION.provider}</a>（<a href="${ATTRIBUTION.licenseUrl}" target="_blank" rel="noopener">${ATTRIBUTION.license}</a>）。<a href="${VOYAGE_META.source}" target="_blank" rel="noopener">官方船期</a></p>`;
  body.innerHTML = html;
}

function renderAll() {
  state.ageKey = ageKey();
  renderRoute(); renderTime(); renderAreas(); renderMetrics(); renderSummary(); renderStatus();
  if ($('details').open) renderDetails();
}

// ---------- 年齡檢查與有界自動更新 ----------
// auto=false：只用目前時鐘重算年齡並在等級變化時重繪（控制項路徑，不觸發任何請求）。
// auto=true：另在資料過 TTL／過期時排程一次自動更新（online、回到可見、定時檢查）。
function checkAge({ auto = false } = {}) {
  if (!state.result || state.loading) return;
  if (ageKey() !== state.ageKey) renderAll();
  if (!auto) return;
  const a = ages();
  if (a.marine.old || a.marine.expired || a.weather.old || a.weather.expired) scheduleAutoRefresh();
}
function scheduleAutoRefresh() {
  if (state.autoTimer || state.loading || state.fatal || !online() || document.hidden) return;
  state.autoTimer = setTimeout(() => {
    state.autoTimer = 0;
    if (state.loading || state.fatal || !online() || document.hidden) return;
    if (isNum(state.lastAttemptMs) && nowMs() - state.lastAttemptMs < AUTO_REFRESH_MIN_GAP_MS) return;
    load(false); // 非強制：模組依自身 TTL 決定是否真的發請求
  }, AUTO_REFRESH_DELAY_MS);
}
function startAgeTimer() {
  clearInterval(state.ageTimer); state.ageTimer = 0;
  if (AGE_CHECK_MS > 0) state.ageTimer = setInterval(() => checkAge({ auto: true }), AGE_CHECK_MS);
}
function stopAgeTimer() {
  clearInterval(state.ageTimer); state.ageTimer = 0;
  clearTimeout(state.autoTimer); state.autoTimer = 0;
}

// ---------- 狀態變更 ----------
function setIdx(i) {
  const n = Math.max(0, Math.min(HOURS.length - 1, Math.round(Number(i))));
  if (!Number.isFinite(n) || n === state.idx) return;
  state.idx = n;
  checkAge();
  renderTime(); renderAreas(); renderMetrics();
  if ($('details').open) renderDetails();
}
function setPoint(id) {
  if (!pointMeta(id) || id === state.pointId) return;
  state.pointId = id;
  checkAge();
  renderRoute(); renderAreas(); renderMetrics(); renderSummary();
  if ($('details').open) renderDetails();
}
function setDir(dir) {
  if (dir === state.dir) return;
  state.dir = dir;
  checkAge();
  renderRoute();
}
function setPlaying(on) {
  state.playing = !!on;
  const b = $('play');
  b.setAttribute('aria-pressed', String(state.playing));
  b.setAttribute('aria-label', state.playing ? '暫停時間軸' : '播放時間軸');
  clearInterval(state.timer); state.timer = 0;
  if (state.playing) {
    if (state.idx >= HOURS.length - 1) setIdx(0);
    const ms = Number.isFinite(T.playIntervalMs) ? T.playIntervalMs : (reducedMotion ? 1500 : 900);
    state.timer = setInterval(() => {
      if (state.idx >= HOURS.length - 1) { setPlaying(false); return; }
      setIdx(state.idx + 1);
    }, ms);
  }
}

async function load(force) {
  if (state.loading || state.fatal) return;
  state.loading = true;
  state.lastAttemptMs = nowMs();
  clearTimeout(state.autoTimer); state.autoTimer = 0;
  renderStatus(); renderSummary();
  try {
    const args = { start: VOYAGE_META.departure.iso, end: VOYAGE_META.returnArrival.iso };
    state.result = await (force ? client.refresh(args) : client.getForecast(args));
    state.viewCache = null;
  } catch (err) {
    state.fatal = err;
  } finally {
    state.loading = false;
    renderAll();
  }
}

// ---------- 事件 ----------
document.querySelector('.seg').addEventListener('click', (e) => { const b = e.target.closest('.seg-btn'); if (b) setDir(b.dataset.dir); });
$('time-slider').addEventListener('input', (e) => { if (state.playing) setPlaying(false); setIdx(e.target.value); });
$('prev').addEventListener('click', () => { if (state.playing) setPlaying(false); setIdx(state.idx - 1); });
$('next').addEventListener('click', () => { if (state.playing) setPlaying(false); setIdx(state.idx + 1); });
$('play').addEventListener('click', () => setPlaying(!state.playing));
$('retry').addEventListener('click', () => load(true));
$('refresh').addEventListener('click', () => load(true));
$('details').addEventListener('toggle', () => { if ($('details').open) { checkAge(); renderDetails(); } });
window.addEventListener('online', () => { renderStatus(); checkAge({ auto: true }); });
window.addEventListener('offline', () => renderStatus());

// ---------- 初始化 ----------
{
  const s = $('time-slider');
  s.max = String(HOURS.length - 1);
  $('range-start').textContent = shortTW(HOURS[0]);
  $('range-end').textContent = shortTW(HOURS[HOURS.length - 1]);
  const tickCount = Math.min(9, HOURS.length);
  $('ticks').innerHTML = Array.from({ length: tickCount }, () => '<i></i>').join('');
  $('official-link').href = VOYAGE_META.source;
}
renderAll();
load(false);
if (!document.hidden) startAgeTimer();

// 測試／除錯用唯讀入口（不含任何資料來源邏輯）
Object.defineProperty(globalThis, '__cruise', {
  value: {
    get state() { return { dir: state.dir, pointId: state.pointId, idx: state.idx, playing: state.playing, loading: state.loading, overall: state.result?.overall ?? null, hours: HOURS.length }; },
    get result() { return state.result; },
    ages,
    stats: () => client.stats(),
    sceneMode: scene.mode,
    isAnimating: () => scene.isAnimating(),
    reducedMotion,
  },
});
