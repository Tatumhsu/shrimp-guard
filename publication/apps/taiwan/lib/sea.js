// 海況 — beaches, marine-grid sampling, colour ramps, 玩水／衝浪 scoring (pure; browser and node tests)
import { GRID, dirName } from './field.js';

/* face = compass bearing the beach looks out to (sea side); sea = a marine-model cell in front of the beach that the
   Open-Meteo wave model treats as water (checked 2026-10-17; the model grid is 1/12°, so some bays read as land). */
export const BEACHES = [
  { id: 'fulong', name: '福隆海水浴場', lat: 25.022, lon: 121.944, face: 30, sea: [25.208, 121.958], note: '浪況取北方外海（灣內在浪模式裡算陸地）' },
  { id: 'baishawan', name: '白沙灣', lat: 25.284, lon: 121.517, face: 330, sea: [25.375, 121.542] },
  { id: 'waiao', name: '外澳', lat: 24.885, lon: 121.849, face: 70, sea: [24.875, 121.875] },
  { id: 'shuangshi', name: '雙獅（烏石港）', lat: 24.863, lon: 121.835, face: 75, sea: [24.875, 121.875] },
  { id: 'jinzun', name: '金樽', lat: 22.955, lon: 121.293, face: 110, sea: [22.958, 121.375] },
  { id: 'donghe', name: '東河', lat: 22.970, lon: 121.307, face: 105, sea: [22.958, 121.375] },
  { id: 'dulan', name: '都蘭', lat: 22.876, lon: 121.236, face: 115, sea: [22.792, 121.292] },
  { id: 'jialeshui', name: '佳樂水', lat: 21.990, lon: 120.867, face: 95, sea: [21.958, 120.875] },
  { id: 'nanwan', name: '墾丁南灣', lat: 21.957, lon: 120.762, face: 185, sea: [21.958, 120.792] },
  { id: 'baisha', name: '墾丁白沙', lat: 21.937, lon: 120.711, face: 250, sea: [21.958, 120.708] },
  { id: 'cijin', name: '旗津海水浴場', lat: 22.613, lon: 120.266, face: 245, sea: [22.625, 120.208] },
  { id: 'aimen', name: '澎湖隘門', lat: 23.573, lon: 119.665, face: 110, sea: [23.542, 119.708] },
];
export const BEACH_MODE = { label: '海邊玩水衝浪', short: '海邊' };

// null-aware bilinear over GRID (land cells are NaN); null when less than half the weight is over water
export function sampleSea(frame, lat, lon) {
  if (!frame || !frame.wh) return null;
  const y = (lat - GRID.lat0) / GRID.step, x = (lon - GRID.lon0) / GRID.step;
  if (y < 0 || x < 0 || y > GRID.rows - 1 || x > GRID.cols - 1) return null;
  const i = Math.min(Math.floor(y), GRID.rows - 2), j = Math.min(Math.floor(x), GRID.cols - 2), fy = y - i, fx = x - j, C = GRID.cols, k = i * C + j;
  const ks = [k, k + 1, k + C, k + C + 1], ws = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const bl = a => { if (!a) return null; let s = 0, w = 0; for (let n = 0; n < 4; n++) if (!Number.isNaN(a[ks[n]])) { s += a[ks[n]] * ws[n]; w += ws[n]; } return w >= 0.5 ? s / w : null; };
  let sx = 0, sy = 0; for (let n = 0; n < 4; n++) { const d = frame.wd?.[ks[n]]; if (d != null && !Number.isNaN(d)) { sx += Math.sin(d * Math.PI / 180) * ws[n]; sy += Math.cos(d * Math.PI / 180) * ws[n]; } }
  const out = { wh: bl(frame.wh), wp: bl(frame.wp), sh: bl(frame.sh), sp: bl(frame.sp), sst: bl(frame.sst), wd: sx || sy ? (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360 : null };
  return out.wh == null && out.sst == null ? null : out;
}

const ramp = (stops, v) => {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (v - a) / (b - a); return ca.map((c, j) => Math.round(c + (cb[j] - c) * f)); }
  return stops[stops.length - 1][1];
};
export const WAVE_STOPS = [[0, [40, 70, 130]], [0.5, [60, 130, 200]], [1, [70, 195, 190]], [1.5, [225, 220, 90]], [2.5, [240, 130, 50]], [4, [210, 40, 60]], [6, [160, 40, 160]]];
export const SST_STOPS = [[20, [60, 70, 180]], [24, [70, 150, 215]], [26.5, [100, 200, 170]], [28, [235, 215, 90]], [29.5, [240, 130, 55]], [31, [200, 40, 50]]];
export const waveColor = h => ramp(WAVE_STOPS, h), sstColor = t => ramp(SST_STOPS, t);

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), lerp = (a, b, f) => a + (b - a) * clamp(f);
const r1 = x => (Math.round(x * 10) / 10).toFixed(1);
// angle between where the wind comes from and where the beach faces: < 60° blows from the sea (onshore), > 120° from land (offshore)
export function windRel(windFrom, face) {
  const d = Math.abs((((windFrom - face) % 360) + 540) % 360 - 180);
  return d < 60 ? 'on' : d > 120 ? 'off' : 'cross';
}
const REL = { on: '向岸風，浪面會比較亂', off: '離岸風，浪面乾淨', cross: '側風' };

/* One hour at one beach. In: wh/wp (wave height m, mean period s), sh/sp (swell), sst °C, wind (m/s) + windFrom (deg) or null,
   rain (mm/h), face (deg). Surf wants ~0.8–2 m with period ≥ 7 s and no onshore wind; swimming wants < 0.6 m, light wind, warm water. */
export function beachScore(w) {
  const { wh, wp, sh, sp, sst, wind, windFrom, rain = 0, face } = w;
  if (wh == null) return { score: 0, surf: 0, swim: 0, level: '沒有浪況資料', why: ['這裡讀不到浪況預報'] };
  const H = wh < 0.4 ? 0.05 : wh < 0.8 ? lerp(0.3, 0.8, (wh - 0.4) / 0.4) : wh <= 2 ? 1 : wh <= 3 ? lerp(1, 0.3, wh - 2) : 0.1;
  const P = wp == null ? 0.6 : wp >= 10 ? 1 : wp >= 7 ? lerp(0.85, 1, (wp - 7) / 3) : wp >= 5 ? lerp(0.3, 0.7, (wp - 5) / 2) : 0.25;
  const rel = wind == null ? null : windRel(windFrom, face), calm = wind != null && wind < 3;
  const Ws = wind == null || calm ? 1 : rel === 'off' ? (wind > 8 ? 0.8 : 1) : rel === 'cross' ? Math.max(0.6, 1 - (wind - 3) * 0.05) : Math.max(0.3, 1 - (wind - 3) * 0.1);
  const R = rain >= 5 ? 0.6 : rain >= 1 ? 0.8 : 1;
  const surf = Math.round(100 * H * P * Ws * R);
  const Hs = wh < 0.3 ? 1 : wh < 0.6 ? 0.9 : wh < 1 ? lerp(0.9, 0.3, (wh - 0.6) / 0.4) : wh < 1.5 ? lerp(0.3, 0.1, (wh - 1) / 0.5) : 0.05;
  const Ww = wind == null || wind < 5 ? 1 : wind < 8 ? (rel === 'on' ? 0.75 : 0.85) : 0.5;
  const T = sst == null ? 1 : sst < 20 ? 0.6 : sst < 24 ? 0.85 : 1, rip = wp != null && wp >= 9 && wh >= 0.6;
  const swim = Math.round(100 * Hs * Ww * T * R * (rip ? 0.7 : 1));
  const score = Math.max(surf, swim);
  const level = wh > 3 ? '浪太大・勿下水' : surf >= swim ? (surf >= 60 ? '適合衝浪' : surf >= 40 ? '可以衝浪' : swim >= 40 ? '可以玩水' : '不建議下水')
    : swim >= 60 ? '適合玩水' : swim >= 40 ? '可以玩水' : '不建議下水';
  const per = wp == null ? '' : `、週期 ${r1(wp)} 秒`;
  const desc = wh < 0.3 ? '幾乎平靜，適合玩水' : wh < 0.6 ? '浪小，適合玩水' : wh < 0.8 ? '小浪，長板勉強可玩' : wh <= 2 ? (wp != null && wp >= 7 ? '浪高與週期都適合衝浪' : '浪高夠但週期短，浪較碎亂') : wh <= 3 ? '浪大，只適合有經驗的衝浪者' : '浪很大，危險';
  const why = [`浪高 ${r1(wh)} m${per}：${desc}`];
  if (sh != null && sh >= 0.1) why.push(`湧浪 ${r1(sh)} m${sp != null ? `／${r1(sp)} 秒` : ''}`);
  if (wind == null) why.push('這個時段超出風場預報，未計入風');
  else why.push(calm ? `風 ${r1(wind)} m/s，很小` : `${dirName(windFrom)} ${r1(wind)} m/s，對這片海灘是${REL[rel]}`);
  if (rain >= 1) why.push(`降雨 ${r1(rain)} mm/時`);
  if (sst != null) why.push(`海溫 ${r1(sst)}°C${sst < 22 ? '，偏涼' : ''}`);
  if (rip) why.push('長週期湧浪容易有離岸流，玩水要小心');
  return { score, surf, swim, level, why };
}

// best hour of a day: hours = [{ t, ...beachScore inputs }] → that hour's result + t
export function bestHour(hours) {
  let best = null;
  for (const h of hours) { const r = beachScore(h); if (!best || r.score > best.score) best = { ...r, t: h.t }; }
  return best;
}
