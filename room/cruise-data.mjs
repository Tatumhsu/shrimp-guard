// cruise-data.mjs — 郵輪風浪產品獨立資料模組（ES module，瀏覽器 / Node 22 皆可）
// 無外部依賴、無 DOM、無副作用；fetch 與時鐘皆可注入以利測試。
// 資料來源：Open-Meteo Marine / Forecast API（CC BY 4.0），為模型預報，非實況觀測。

// ---------------------------------------------------------------------------
// 1. 固定 metadata
// ---------------------------------------------------------------------------
export const SAMPLE_POINTS = Object.freeze([
  Object.freeze({ id: 'keelung', label: '基隆外海', lat: 25.3, lon: 121.9 }),
  Object.freeze({ id: 'midsea', label: '途中示例海域', lat: 25.7, lon: 124.7 }),
  Object.freeze({ id: 'naha', label: '那霸外海', lat: 26.15, lon: 127.5 }),
]);
export const SAMPLE_POINTS_NOTE =
  '三個座標為假設抽樣點，非 AIS 資料，不代表真實船位或航跡；各點資料只能在同一有效時間比較，不可串成實船航程。';

export const VOYAGE_META = Object.freeze({
  ship: 'STAR NAVIGATOR',
  source: 'https://cruise.twport.com.tw/Articles.aspx?a=2630&l=1',
  sourceNote: '官方公開船期附件第 9 頁',
  departure: Object.freeze({ port: '基隆', berth: '西3', iso: '2026-10-11T17:00:00+08:00', epochSec: 1791709200 }),
  returnArrival: Object.freeze({ port: '基隆', berth: '西3', iso: '2026-10-13T09:00:00+08:00', epochSec: 1791853200 }),
  nahaCall: 'unknown',
  nahaTime: 'unknown',
  midRoute: 'unknown',
  note: '那霸停靠、時間與中段路線未知；本模組不製造去／回程分界，也不推算船位。',
});

export const ATTRIBUTION = Object.freeze({
  provider: 'Open-Meteo',
  providerUrl: 'https://open-meteo.com/',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  marineDocs: 'https://open-meteo.com/en/docs/marine-weather-api',
  weatherDocs: 'https://open-meteo.com/en/docs',
  dataNature: '模型預報，非實況觀測；海面狀態示意，不代表船體運動。',
  model: 'unknown',
  modelNote: 'API 回應未識別具體模型／機構，不得列特定機構為確定來源。',
  termsSnapshot: Object.freeze({
    snapshotDate: '2026-10-06',
    scope: '個人非商業使用額度（條款快照，非保證）',
    perMinute: 600, perHour: 5000, perDay: 10000, perMonth: 300000,
    callAccounting: '一次多地點 HTTP 請求依條款可能以地點數與期間加權計算，不可斷言只算 1 次呼叫。',
  }),
});

export const DEFAULTS = Object.freeze({
  ttlMs: 3 * 60 * 60 * 1000,      // 快取視為新鮮的時間
  maxAgeMs: 24 * 60 * 60 * 1000,  // 超過此年齡即使離線也不展示
  timeoutMs: 10_000,
  maxRangeHours: 24 * 31,          // 產品側輸入保護，非模型預報長度限制
  smallDiffM: 0.3,                 // 產品比較門檻（非海況標準）
});

const TW_OFFSET_MIN = 480;
const JP_OFFSET_MIN = 540;
const HOUR = 3600;
const MAX_EPOCH_SEC = 8.64e12; // ECMAScript Date 可表示範圍（±8.64e15 ms）

// ---------------------------------------------------------------------------
// 2. 錯誤與狀態文字
// ---------------------------------------------------------------------------
export const STATUS_TEXT = Object.freeze({
  ok: '資料取得成功',
  invalid_range: '查詢期間無效',
  invalid_points: '示例點設定無效',
  invalid_config: '模組設定無效',
  offline: '目前離線，無法取得新預報',
  timeout: '連線逾時，未取得預報',
  network: '網路錯誤，未取得預報',
  bad_request: '請求參數被伺服器拒絕（HTTP 400）',
  rate_limited: '請求次數超過限制（HTTP 429），請稍後再試',
  server_error: '預報伺服器錯誤（HTTP 5xx）',
  http_error: '伺服器回應異常',
  invalid_json: '伺服器回應不是有效 JSON',
  invalid_payload: '伺服器回應格式不符預期',
});

export class CruiseDataError extends Error {
  constructor(code, detail = '', httpStatus = null) {
    super(STATUS_TEXT[code] ?? STATUS_TEXT.http_error);
    this.name = 'CruiseDataError';
    this.code = code;
    this.detail = detail;
    this.httpStatus = httpStatus;
  }
  toJSON() {
    return { code: this.code, message: this.message, detail: this.detail, httpStatus: this.httpStatus };
  }
}

function nonNegFinite(v, name, code = 'invalid_config') {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new CruiseDataError(code, `${name} 必須是有限非負數，實得 ${String(v)}`);
  return v;
}

// ---------------------------------------------------------------------------
// 3. 時間工具（全部以 epoch 秒運算，不依賴主機時區、不經 Date.UTC）
// ---------------------------------------------------------------------------
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** 公曆 → 自 1970-01-01 起的日數（Howard Hinnant days_from_civil；年 0000–9999 皆正確，不會把 0..99 當 1900 年代）。 */
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function assertEpochSec(sec, what = '時間') {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || Math.abs(sec) > MAX_EPOCH_SEC) {
    throw new CruiseDataError('invalid_range', `${what}必須是有限且在可表示範圍內的 epoch 秒，實得 ${String(sec)}`);
  }
  return sec;
}

export function parseIsoWithOffset(str) {
  const m = typeof str === 'string' ? ISO_RE.exec(str.trim()) : null;
  if (!m) throw new CruiseDataError('invalid_range', `ISO 字串必須含明確時區偏移: ${String(str)}`);
  const [, ys, mos, ds, hs, mis, ss, off] = m;
  const y = +ys, mo = +mos, d = +ds, h = +hs, mi = +mis, s = ss === undefined ? 0 : +ss;
  if (mo < 1 || mo > 12) throw new CruiseDataError('invalid_range', `月份無效: ${str}`);
  if (d < 1 || d > daysInMonth(y, mo)) throw new CruiseDataError('invalid_range', `日期不存在: ${str}`);
  if (h > 23 || mi > 59 || s > 59) throw new CruiseDataError('invalid_range', `時分秒超出範圍: ${str}`);
  let offsetMin = 0;
  if (off !== 'Z') {
    const sign = off[0] === '-' ? -1 : 1;
    const oh = Number(off.slice(1, 3));
    const om = Number(off.slice(4, 6));
    if (oh > 23 || om > 59) throw new CruiseDataError('invalid_range', `時區偏移無效: ${str}`);
    offsetMin = sign * (oh * 60 + om);
  }
  const epochSec = daysFromCivil(y, mo, d) * 86400 + h * HOUR + mi * 60 + s - offsetMin * 60;
  return assertEpochSec(epochSec);
}

export function toEpochSec(input) {
  if (typeof input === 'number') {
    assertEpochSec(input);
    const sec = Math.floor(input);
    if (!Number.isSafeInteger(sec)) throw new CruiseDataError('invalid_range', 'epoch 秒必須是安全整數');
    return sec;
  }
  if (input instanceof Date) {
    const ms = input.getTime();
    if (!Number.isFinite(ms)) throw new CruiseDataError('invalid_range', 'Date 無效');
    return Math.floor(ms / 1000);
  }
  return parseIsoWithOffset(input);
}

const pad2 = (n) => String(n).padStart(2, '0');

export function formatInZone(epochSec, offsetMin) {
  assertEpochSec(epochSec);
  if (typeof offsetMin !== 'number' || !Number.isFinite(offsetMin)) throw new CruiseDataError('invalid_range', '時區偏移必須是有限數字');
  const shifted = epochSec + offsetMin * 60;
  assertEpochSec(shifted, '時區換算後時間');
  const d = new Date(shifted * 1000);
  if (Number.isNaN(d.getTime())) throw new CruiseDataError('invalid_range', '時間無法格式化');
  const date = `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const tz = abs % 60 === 0 ? `UTC${sign}${abs / 60}` : `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  return { date, time, label: `${date} ${time} (${tz})` };
}
export const formatTW = (epochSec) => formatInZone(epochSec, TW_OFFSET_MIN).label;
export const formatJP = (epochSec) => formatInZone(epochSec, JP_OFFSET_MIN).label;
export const dateTW = (epochSec) => formatInZone(epochSec, TW_OFFSET_MIN).date;

/**
 * 區間規則：start / end 可為 epoch 秒、含偏移的 ISO 字串或 Date。
 * 先以原始秒比較 end < start（同一小時內反向亦拒絕），再把兩端向下取整到整點；
 * requested hours = 所有 startHour <= h <= endHour 的整點（含兩端）。
 * 小時數先以算術計算並與 maxRangeHours 比對，確認有限且在上限內才配置陣列（巨大輸入 fail fast）。
 */
export function resolveRange(start, end, { maxRangeHours = DEFAULTS.maxRangeHours } = {}) {
  if (start == null || end == null) throw new CruiseDataError('invalid_range', 'start 與 end 皆為必填');
  if (!Number.isSafeInteger(maxRangeHours) || maxRangeHours < 1) throw new CruiseDataError('invalid_config', 'maxRangeHours 必須是正整數');
  const s = toEpochSec(start);
  const e = toEpochSec(end);
  if (e < s) throw new CruiseDataError('invalid_range', 'end 早於 start');
  const startHour = Math.floor(s / HOUR) * HOUR;
  const endHour = Math.floor(e / HOUR) * HOUR;
  const count = (endHour - startHour) / HOUR + 1;
  if (!Number.isSafeInteger(count) || count < 1) throw new CruiseDataError('invalid_range', '期間小時數無法計算');
  if (count > maxRangeHours) throw new CruiseDataError('invalid_range', `期間 ${count} 小時超過 ${maxRangeHours} 小時上限`);
  const hours = new Array(count);
  for (let k = 0; k < count; k++) hours[k] = startHour + k * HOUR;
  return {
    startEpoch: startHour, endEpoch: endHour, hours,
    startTW: formatTW(startHour), endTW: formatTW(endHour),
    startJP: formatJP(startHour), endJP: formatJP(endHour),
    apiStartDate: dateTW(startHour), apiEndDate: dateTW(endHour), apiTimezone: 'Asia/Taipei',
    rule: 'inclusive-hour: 先以原始秒拒絕 end<start，再將 start/end 向下取整到整點，含兩端整點',
  };
}

// ---------------------------------------------------------------------------
// 4. 請求計畫與 fetch
// ---------------------------------------------------------------------------
export const MARINE_FIELDS = Object.freeze({
  wave_height: { units: ['m'], min: 0, max: 30 },
  wave_direction: { units: ['°', 'deg'], min: 0, max: 360 },
  wave_period: { units: ['s'], min: 0, max: 40 },
});
export const WEATHER_FIELDS = Object.freeze({
  wind_speed_10m: { units: ['m/s'], min: 0, max: 120 },
  wind_direction_10m: { units: ['°', 'deg'], min: 0, max: 360 },
});

const validLatLon = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

export function validatePoints(points) {
  if (!Array.isArray(points) || points.length === 0) throw new CruiseDataError('invalid_points', '至少一個點');
  const ids = new Set();
  for (const p of points) {
    if (!p || typeof p.id !== 'string' || ids.has(p.id)) throw new CruiseDataError('invalid_points', 'id 缺少或重複');
    if (!validLatLon(p.lat, p.lon)) throw new CruiseDataError('invalid_points', `座標無效: ${p.id}`);
    ids.add(p.id);
  }
  return points;
}

export function buildRequestPlan(range, points = SAMPLE_POINTS) {
  validatePoints(points);
  const lat = points.map((p) => p.lat).join(',');
  const lon = points.map((p) => p.lon).join(',');
  const common = `latitude=${lat}&longitude=${lon}&start_date=${range.apiStartDate}&end_date=${range.apiEndDate}` +
    `&timezone=${encodeURIComponent(range.apiTimezone)}&timeformat=unixtime&cell_selection=sea`;
  return {
    marine: `https://marine-api.open-meteo.com/v1/marine?${common}&hourly=${Object.keys(MARINE_FIELDS).join(',')}`,
    weather: `https://api.open-meteo.com/v1/forecast?${common}&hourly=${Object.keys(WEATHER_FIELDS).join(',')}&wind_speed_unit=ms`,
  };
}

function classifyHttp(status) {
  if (status === 400) return 'bad_request';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'http_error';
}

const isAbort = (err, ac) => err?.name === 'AbortError' || ac.signal.aborted;

/** 單次請求，含 AbortController 逾時（連線與讀取 body 階段皆算 timeout）；不重試。失敗一律 throw CruiseDataError。 */
export async function fetchJson(url, { fetch: fetchImpl = globalThis.fetch, timeoutMs = DEFAULTS.timeoutMs, isOnLine } = {}) {
  nonNegFinite(timeoutMs, 'timeoutMs');
  if (typeof isOnLine === 'function' && isOnLine() === false) throw new CruiseDataError('offline');
  if (typeof fetchImpl !== 'function') throw new CruiseDataError('network', 'fetch 不可用');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res, text;
  try {
    try {
      res = await fetchImpl(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      if (isAbort(err, ac)) throw new CruiseDataError('timeout', `${timeoutMs}ms（連線階段）`);
      throw new CruiseDataError('network', String(err?.message ?? err));
    }
    try {
      text = await res.text();
    } catch (err) {
      if (isAbort(err, ac)) throw new CruiseDataError('timeout', `${timeoutMs}ms（讀取回應階段）`);
      throw new CruiseDataError('network', '讀取回應失敗');
    }
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new CruiseDataError(classifyHttp(res.status), String(text).slice(0, 200), res.status);
  try {
    return JSON.parse(text);
  } catch {
    throw new CruiseDataError('invalid_json', String(text).slice(0, 80));
  }
}

// ---------------------------------------------------------------------------
// 5. Normalize / schema 檢驗（null 一律保留，不補 0、不補前值）
// ---------------------------------------------------------------------------
function bad(detail) { return new CruiseDataError('invalid_payload', detail); }

export function normalizePayload(payload, points, fieldSpec, sourceUrl = '') {
  validatePoints(points);
  const list = Array.isArray(payload) ? payload : (payload && typeof payload === 'object' ? [payload] : null);
  if (!list) throw bad('回應不是物件或陣列');
  if (list.length !== points.length) throw bad(`地點數 ${list.length} ≠ 要求 ${points.length}`);
  const fields = Object.keys(fieldSpec);
  let refTime = null;
  const locations = list.map((loc, i) => {
    if (!loc || typeof loc !== 'object') throw bad(`第 ${i} 筆不是物件`);
    if (loc.location_id != null && loc.location_id !== i) throw bad(`location_id ${loc.location_id} 與順序 ${i} 不符`);
    if (!validLatLon(loc.latitude, loc.longitude)) throw bad(`第 ${i} 筆回傳座標缺失或超出經緯度範圍: ${loc.latitude},${loc.longitude}`);
    const units = loc.hourly_units ?? {};
    if (units.time !== 'unixtime') throw bad(`time 單位應為 unixtime，實得 ${units.time}`);
    const hourly = loc.hourly;
    if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) throw bad(`第 ${i} 筆缺少 hourly.time`);
    const time = hourly.time;
    for (let k = 0; k < time.length; k++) {
      const t = time[k];
      if (!Number.isSafeInteger(t)) throw bad(`time[${k}] 非整數 epoch（需安全整數）`);
      if (Math.abs(t) > MAX_EPOCH_SEC) throw bad(`time[${k}] 超出可表示範圍`);
      if (t % HOUR !== 0) throw bad(`time[${k}]=${t} 非整點（hourly 應為 3600 的倍數）`);
      if (k > 0 && t <= time[k - 1]) throw bad(`time[${k}] 未嚴格遞增／重複`);
    }
    if (refTime === null) refTime = time;
    else if (time.length !== refTime.length || time.some((t, k) => t !== refTime[k])) throw bad(`第 ${i} 筆時間軸與第 0 筆不對齊`);
    const series = {};
    const unitOut = {};
    for (const f of fields) {
      const spec = fieldSpec[f];
      if (!spec.units.includes(units[f])) throw bad(`${f} 單位 ${units[f]} 不在允許範圍`);
      const arr = hourly[f];
      if (!Array.isArray(arr) || arr.length !== time.length) throw bad(`${f} 長度 ${arr?.length} ≠ time 長度 ${time.length}`);
      for (let k = 0; k < arr.length; k++) {
        const v = arr[k];
        if (v === null || v === undefined) continue;
        if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${f}[${k}] 非 finite 數值`);
        if (v < spec.min || v > spec.max) throw bad(`${f}[${k}]=${v} 超出合理範圍 ${spec.min}~${spec.max}`);
      }
      series[f] = arr.map((v) => (v == null ? null : v));
      unitOut[f] = units[f];
    }
    const p = points[i];
    return {
      id: p.id, label: p.label,
      requested: { lat: p.lat, lon: p.lon },
      returned: { lat: loc.latitude, lon: loc.longitude },
      gridOffsetDeg: Math.max(Math.abs(loc.latitude - p.lat), Math.abs(loc.longitude - p.lon)),
      utcOffsetSeconds: loc.utc_offset_seconds ?? null,
      timezone: loc.timezone ?? null,
      time, series, units: unitOut,
    };
  });
  return { sourceUrl, fields, locations, firstEpoch: refTime[0], lastEpoch: refTime[refTime.length - 1] };
}
export const normalizeMarine = (payload, points = SAMPLE_POINTS, url = '') => normalizePayload(payload, points, MARINE_FIELDS, url);
export const normalizeWeather = (payload, points = SAMPLE_POINTS, url = '') => normalizePayload(payload, points, WEATHER_FIELDS, url);

// ---------------------------------------------------------------------------
// 6. 逐小時表與覆蓋率（缺值保留 null，不推斷未來；欄位級 coverage）
// ---------------------------------------------------------------------------
export const MARINE_COLS = Object.freeze(['wave_height', 'wave_period', 'wave_direction']);
export const WEATHER_COLS = Object.freeze(['wind_speed_10m', 'wind_direction_10m']);

export const COVERAGE_STATUS = Object.freeze({
  complete: '完整',
  partial: '資料不足：部分時段缺少預報',
  missing: '資料不足：此期間尚無預報',
});

function indexOf(norm, pointIdx) {
  if (!norm) return null;
  const loc = norm.locations[pointIdx];
  const map = new Map();
  loc.time.forEach((t, k) => map.set(t, k));
  return { loc, map };
}

/**
 * 某來源在 rows 上的覆蓋率。
 * - available / complete：該小時「所有」欄位皆非 null 的小時數。
 * - partial：至少一欄非 null 但非全部的小時數（這些小時仍可顯示有值的欄位）。
 * - missing：非 complete 的小時 epoch（含 partial 與全缺）。absent：全部欄位皆 null 的 epoch。
 * - status：missing 為空 → 完整；complete 與 partial 皆 0 → 此期間尚無預報；否則 部分時段缺少預報。
 * - level：'complete' | 'partial' | 'missing'。fields：每欄各自的 available / missing。
 */
function coverageOf(rows, cols, levelFlag) {
  const missing = [], absent = [];
  let complete = 0, partial = 0;
  const fields = Object.fromEntries(cols.map((c) => [c, { available: 0, missing: [] }]));
  for (const r of rows) {
    let have = 0;
    for (const c of cols) {
      if (r[c] === null) fields[c].missing.push(r.epoch); else { have++; fields[c].available++; }
    }
    if (have === cols.length) complete++;
    else { missing.push(r.epoch); if (have === 0) absent.push(r.epoch); else partial++; }
    r[levelFlag] = have === cols.length ? 'complete' : have === 0 ? 'missing' : 'partial';
  }
  const level = missing.length === 0 ? 'complete' : complete + partial === 0 ? 'missing' : 'partial';
  return { requested: rows.length, available: complete, complete, partial, missing, absent, level, status: COVERAGE_STATUS[level], fields };
}

export function buildHourlyTable(range, points, marineNorm, weatherNorm) {
  return points.map((p, i) => {
    const m = indexOf(marineNorm, i);
    const w = indexOf(weatherNorm, i);
    const rows = range.hours.map((epoch) => {
      const row = { epoch, tw: formatTW(epoch), jp: formatJP(epoch) };
      const mk = m?.map.get(epoch);
      for (const c of MARINE_COLS) row[c] = mk === undefined ? null : m.loc.series[c][mk];
      const wk = w?.map.get(epoch);
      for (const c of WEATHER_COLS) row[c] = wk === undefined ? null : w.loc.series[c][wk];
      // marineAvailable / weatherAvailable = 該小時該來源所有欄位皆非 null（單欄缺即 false）
      row.marineAvailable = MARINE_COLS.every((c) => row[c] !== null);
      row.weatherAvailable = WEATHER_COLS.every((c) => row[c] !== null);
      return row;
    });
    return {
      id: p.id, label: p.label,
      requested: { lat: p.lat, lon: p.lon },
      marineGrid: m ? m.loc.returned : null,
      weatherGrid: w ? w.loc.returned : null,
      units: { wave_height: 'm', wave_period: 's', wave_direction: 'deg (coming from)', wind_speed_10m: 'm/s', wind_direction_10m: 'deg (coming from)' },
      rows,
      coverage: { marine: coverageOf(rows, MARINE_COLS, 'marineLevel'), weather: coverageOf(rows, WEATHER_COLS, 'weatherLevel') },
    };
  });
}

// ---------------------------------------------------------------------------
// 7. 白話摘要（只比同一有效時間；「此期間相對」高低段不重疊；缺口與時間不連續皆中斷）
// ---------------------------------------------------------------------------
/** 連續 run：值非 null、符合 pred，且 epoch 與前一列恰差 1 小時；null 或時間跳躍皆中斷。 */
function runsOf(rows, field, pred) {
  const runs = [];
  let cur = null, prevEpoch = null;
  for (const r of rows) {
    const v = r[field];
    const contiguous = prevEpoch !== null && r.epoch === prevEpoch + HOUR;
    if (v !== null && v !== undefined && pred(v)) {
      if (cur && contiguous) cur.end = r.epoch;
      else { if (cur) runs.push(cur); cur = { start: r.epoch, end: r.epoch }; }
    } else if (cur) { runs.push(cur); cur = null; }
    prevEpoch = r.epoch;
  }
  if (cur) runs.push(cur);
  return runs;
}

/**
 * 產品比較規則（非海況標準）：
 * - spread = max − min < smallDiff → 「變化不大」。
 * - 否則以此期間的 min + spread/3 為「相對較小」上限、min + 2·spread/3 為「相對較大」下限；
 *   兩段門檻相差 spread/3 > 0，保證不重疊。中間帶不歸屬任一段。
 * - 「何時轉小」只在峰值到該低值段之間每小時皆有值（無 null、無時間跳躍）時才斷言。
 */
export function summarizeSeries(rows, field, { smallDiff = DEFAULTS.smallDiffM, unit = 'm', noun = '浪高', decimals = 2 } = {}) {
  const valid = rows.filter((r) => r[field] !== null && r[field] !== undefined);
  const total = rows.length;
  const base = {
    field, unit, available: valid.length, requested: total, max: null, min: null, larger: null, smaller: null, flat: false,
    bands: null, rule: '相對本期間：低段 ≤ min+spread/3，高段 ≥ min+2·spread/3（產品比較規則，非海況標準）', text: '',
  };
  if (valid.length === 0) return { ...base, text: `尚無足夠預報：此期間${noun}資料為空。` };
  const fmt = (v) => `${v.toFixed(decimals)} ${unit}`;
  let max = valid[0], min = valid[0];
  for (const r of valid) { if (r[field] > max[field]) max = r; if (r[field] < min[field]) min = r; }
  base.max = { value: max[field], epoch: max.epoch, tw: max.tw };
  base.min = { value: min[field], epoch: min.epoch, tw: min.tw };
  const partial = valid.length < total ? `（僅 ${valid.length}/${total} 小時有預報）` : '';
  if (valid.length === 1) return { ...base, flat: true, text: `僅 ${max.tw} 一筆${noun}預報 ${fmt(max[field])}，不足以判斷變化${partial}。` };
  const spread = max[field] - min[field];
  if (spread < smallDiff) {
    return { ...base, flat: true, text: `${noun}介於 ${fmt(min[field])} 至 ${fmt(max[field])}，變化不大（差異小於 ${smallDiff} ${unit} 的比較門檻）${partial}。` };
  }
  const lowMax = min[field] + spread / 3;
  const highMin = min[field] + (2 * spread) / 3;
  base.bands = { lowMax, highMin, spread };
  const hiRuns = runsOf(rows, field, (v) => v >= highMin);
  const loRuns = runsOf(rows, field, (v) => v <= lowMax);
  const larger = hiRuns.find((r) => r.start <= max.epoch && max.epoch <= r.end) ?? hiRuns[0];
  base.larger = larger;
  const lastValid = valid[valid.length - 1];
  let smallerText;
  const after = loRuns.find((r) => r.start > max.epoch);
  if (after) {
    // 峰值到該低值段之間必須每小時都有值：null 或時間跳躍皆視為空窗，不斷言「何時轉小」
    const between = rows.filter((r) => r.epoch > max.epoch && r.epoch < after.start);
    const expected = (after.start - max.epoch) / HOUR - 1;
    const gap = between.length !== expected || between.some((r) => r[field] === null || r[field] === undefined);
    if (gap) smallerText = '峰值之後有資料空窗，無法判斷何時轉小';
    else { base.smaller = after; smallerText = `約 ${formatTW(after.start)} 起轉為相對較小（≤ ${fmt(lowMax)}）`; }
  } else if (max.epoch === lastValid.epoch) {
    smallerText = '峰值出現在區間末尾，區間內未見轉小';
  } else {
    const before = loRuns.find((r) => r.end < max.epoch);
    base.smaller = before ?? null;
    smallerText = before ? `相對較小時段在峰值之前（${formatTW(before.start)} 至 ${formatTW(before.end)}）` : '區間內未見明顯較小時段';
  }
  const text = `${noun}最大 ${fmt(max[field])}（${max.tw}），最小 ${fmt(min[field])}（${min.tw}）；此期間相對較大時段（≥ ${fmt(highMin)}）約 ${formatTW(larger.start)} 至 ${formatTW(larger.end)}；${smallerText}${partial}。`;
  return { ...base, text };
}

export function summarizeTable(table, { smallDiffM = DEFAULTS.smallDiffM } = {}) {
  const points = table.map((p) => ({
    id: p.id, label: p.label,
    wave: summarizeSeries(p.rows, 'wave_height', { smallDiff: smallDiffM, unit: 'm', noun: '浪高' }),
    wind: summarizeSeries(p.rows, 'wind_speed_10m', { smallDiff: 1, unit: 'm/s', noun: '風速', decimals: 1 }),
  }));
  // 跨點比較：只用所有點都有浪高的共同小時
  const common = table.length ? table[0].rows.map((_, k) => k).filter((k) => table.every((p) => p.rows[k] && p.rows[k].wave_height !== null)) : [];
  const n = table.length;
  let comparison;
  if (n < 2) comparison = { commonHours: common.length, text: '僅單一示例點，無跨點比較。' };
  else if (common.length === 0) comparison = { commonHours: 0, text: '尚無足夠預報：各示例海域沒有共同有效時段可比較。' };
  else {
    const peak = table.map((p) => ({ id: p.id, label: p.label, max: Math.max(...common.map((k) => p.rows[k].wave_height)) }));
    const hi = peak.reduce((a, b) => (b.max > a.max ? b : a));
    const lo = peak.reduce((a, b) => (b.max < a.max ? b : a));
    const text = hi.max - lo.max < smallDiffM
      ? `在 ${common.length} 個共同有效小時內，${n} 處示例海域最大浪高差異不大（${lo.max.toFixed(2)}–${hi.max.toFixed(2)} m）。`
      : `在 ${common.length} 個共同有效小時內，${hi.label}最大浪高較高（${hi.max.toFixed(2)} m），${lo.label}較低（${lo.max.toFixed(2)} m）。`;
    comparison = { commonHours: common.length, peaks: peak, text: `${text}此為同期各海域比較，非實船航程。` };
  }
  return { points, comparison, note: '浪高（wave_height）與風速為不同欄位，不可互相代表；本摘要為模型預報示意，不提供安全或舒適保證。' };
}

// ---------------------------------------------------------------------------
// 8. Client：fetch + 記憶體快取 + freshness（成功才寫快取；失敗不延長 TTL）
// ---------------------------------------------------------------------------
function sourceState(kind, cached, nowMs, ttlMs, maxAgeMs, error) {
  const age = cached ? nowMs - cached.fetchedAt : null;
  let freshness, statusText, data = null;
  if (!error) {
    data = cached.data;
    freshness = cached.justFetched ? 'fresh' : 'cached';
    statusText = cached.justFetched ? '已取得最新預報' : `使用 ${Math.round(age / 60000)} 分鐘前的快取`;
  } else if (cached && age <= maxAgeMs) {
    data = cached.data; freshness = 'stale';
    statusText = `${error.message}；顯示 ${Math.round(age / 60000)} 分鐘前的舊預報（非最新）`;
  } else {
    freshness = 'unavailable';
    statusText = cached ? `${error.message}；舊快取已超過最大年齡，不予顯示` : error.message;
  }
  return {
    kind, ok: !error, freshness, statusText, data,
    fetchedAt: cached ? cached.fetchedAt : null,
    checkedAt: nowMs, ageMs: age, ttlMs, maxAgeMs,
    stale: freshness === 'stale',
    modelRun: 'unknown',
    error: error ? error.toJSON() : null,
  };
}

/**
 * overall（與 transport 成功與否分開）：
 * - 'ok'：兩來源皆 transport 成功且每點每來源 coverage 皆 complete。
 * - 'partial'：有部分小時／欄位可顯示，但 transport 失敗或 coverage 不完整。
 * - 'no_data'：有拿到回應（可能 HTTP 200）但 requested 期間所有小時皆無值。
 * - 'unavailable'：無任何資料（transport 失敗且無可用快取）。
 */
function assessOverall(marine, weather, table) {
  const transportOk = marine.ok && weather.ok;
  const covs = table.flatMap((p) => [p.coverage.marine, p.coverage.weather]);
  const complete = covs.every((c) => c.level === 'complete');
  const anyHours = covs.some((c) => c.complete + c.partial > 0);
  const dataCoverage = complete ? 'complete' : anyHours ? 'partial' : 'none';
  let overall;
  if (!marine.data && !weather.data) overall = transportOk ? 'no_data' : 'unavailable';
  else if (!anyHours) overall = 'no_data';
  else if (transportOk && complete) overall = 'ok';
  else overall = 'partial';
  return { overall, dataCoverage, transport: { marine: marine.ok, weather: weather.ok } };
}

export function createCruiseDataClient(opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? (() => Date.now());
  const ttlMs = nonNegFinite(opts.ttlMs ?? DEFAULTS.ttlMs, 'ttlMs');
  const maxAgeMs = nonNegFinite(opts.maxAgeMs ?? DEFAULTS.maxAgeMs, 'maxAgeMs');
  const timeoutMs = nonNegFinite(opts.timeoutMs ?? DEFAULTS.timeoutMs, 'timeoutMs');
  if (ttlMs > maxAgeMs) throw new CruiseDataError('invalid_config', `ttlMs ${ttlMs} 不得大於 maxAgeMs ${maxAgeMs}（否則過期資料會被當成新鮮）`);
  const maxRangeHours = opts.maxRangeHours ?? DEFAULTS.maxRangeHours;
  if (!Number.isSafeInteger(maxRangeHours) || maxRangeHours < 1) throw new CruiseDataError('invalid_config', 'maxRangeHours 必須是正整數');
  const points = validatePoints(opts.points ?? SAMPLE_POINTS);
  const isOnLine = opts.isOnLine ?? (() => (typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true));
  const cache = new Map();    // key -> { marine?: {data, fetchedAt}, weather?: {...} }
  const inflight = new Map(); // key -> Promise
  let fetchCount = 0;

  async function loadSource(kind, url, normalize, entry, nowMs, force) {
    const cached = entry[kind];
    if (!force && cached && nowMs - cached.fetchedAt <= ttlMs) return sourceState(kind, { ...cached, justFetched: false }, nowMs, ttlMs, maxAgeMs, null);
    try {
      fetchCount++;
      const payload = await fetchJson(url, { fetch: fetchImpl, timeoutMs, isOnLine });
      const data = normalize(payload, points, url);
      entry[kind] = { data, fetchedAt: now() };
      return sourceState(kind, { ...entry[kind], justFetched: true }, now(), ttlMs, maxAgeMs, null);
    } catch (err) {
      const e = err instanceof CruiseDataError ? err : new CruiseDataError('invalid_payload', String(err?.message ?? err));
      return sourceState(kind, cached ? { ...cached, justFetched: false } : null, now(), ttlMs, maxAgeMs, e);
    }
  }

  function assemble(range, plan, marine, weather) {
    const table = buildHourlyTable(range, points, marine.data, weather.data);
    const summary = summarizeTable(table);
    const { overall, dataCoverage, transport } = assessOverall(marine, weather, table);
    return {
      overall, dataCoverage, transport, range, points: points.map((p) => ({ ...p })), pointsNote: SAMPLE_POINTS_NOTE,
      requests: plan, sources: { marine, weather }, table, summary,
      voyage: VOYAGE_META, attribution: ATTRIBUTION,
    };
  }

  async function getForecast({ start, end, force = false } = {}) {
    const range = resolveRange(start, end, { maxRangeHours });
    const key = `${range.startEpoch}-${range.endEpoch}|${points.map((p) => `${p.id}@${p.lat},${p.lon}`).join(';')}`;
    if (inflight.has(key)) return inflight.get(key);
    const plan = buildRequestPlan(range, points);
    const entry = cache.get(key) ?? {};
    cache.set(key, entry);
    const nowMs = now();
    const job = (async () => {
      const [marine, weather] = await Promise.all([
        loadSource('marine', plan.marine, normalizeMarine, entry, nowMs, force),
        loadSource('weather', plan.weather, normalizeWeather, entry, nowMs, force),
      ]);
      return assemble(range, plan, marine, weather);
    })();
    inflight.set(key, job);
    try { return await job; } finally { inflight.delete(key); }
  }

  return {
    getForecast,
    refresh: (args) => getForecast({ ...args, force: true }),
    clearCache: () => cache.clear(),
    stats: () => ({ fetchCount, cacheKeys: [...cache.keys()], inflight: inflight.size }),
    config: { ttlMs, maxAgeMs, timeoutMs, maxRangeHours, points },
  };
}
