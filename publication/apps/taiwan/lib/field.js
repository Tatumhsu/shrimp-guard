// 台灣風場 — grid + interpolation + wording (pure; browser and node tests)
export const GRID = { lat0: 20.5, lon0: 117.5, step: 0.3, rows: 21, cols: 22 };  // 20.5–26.5°N, 117.5–123.8°E
export const gridPoints = () => { const out = []; for (let i = 0; i < GRID.rows; i++) for (let j = 0; j < GRID.cols; j++) out.push([+(GRID.lat0 + i * GRID.step).toFixed(2), +(GRID.lon0 + j * GRID.step).toFixed(2)]); return out; };

// meteorological direction (where the wind comes FROM) + speed → u (east), v (north)
export const toUV = (speed, dirFrom) => { const r = dirFrom * Math.PI / 180; return [-speed * Math.sin(r), -speed * Math.cos(r)]; };
export const fromUV = (u, v) => [Math.hypot(u, v), (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360];

// frame: { u: Float32Array, v, t (temperature), p (precip), g (gust) } over GRID; bilinear sample at lat/lon (null outside)
export function sample(frame, lat, lon) {
  const y = (lat - GRID.lat0) / GRID.step, x = (lon - GRID.lon0) / GRID.step;
  if (y < 0 || x < 0 || y > GRID.rows - 1 || x > GRID.cols - 1) return null;
  const i = Math.min(Math.floor(y), GRID.rows - 2), j = Math.min(Math.floor(x), GRID.cols - 2), fy = y - i, fx = x - j;
  const k = i * GRID.cols + j, C = GRID.cols;
  const bl = a => a[k] * (1 - fx) * (1 - fy) + a[k + 1] * fx * (1 - fy) + a[k + C] * (1 - fx) * fy + a[k + C + 1] * fx * fy;
  return { u: bl(frame.u), v: bl(frame.v), t: bl(frame.t), p: bl(frame.p), g: bl(frame.g), a: frame.a ? bl(frame.a) : null };
}

const BEAUFORT = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
const BNAME = ['無風', '軟風', '輕風', '微風', '和風', '清風', '強風', '疾風', '大風', '烈風', '狂風', '暴風', '颶風'];
export const beaufort = ms => { let b = BEAUFORT.findIndex(x => ms < x); if (b < 0) b = 12; return { level: b, name: BNAME[b] }; };
const DIR16 = ['北', '北北東', '東北', '東北東', '東', '東南東', '東南', '南南東', '南', '南南西', '西南', '西南西', '西', '西北西', '西北', '北北西'];
export const dirName = deg => DIR16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] + '風';

// whole-grid summary: mean vector wind, strongest point
export function summarize(frame, points) {
  let su = 0, sv = 0, max = null;
  for (let k = 0; k < points.length; k++) {
    su += frame.u[k]; sv += frame.v[k];
    const s = Math.hypot(frame.u[k], frame.v[k]); if (!max || s > max.s) max = { s, k };
  }
  const [ms, dir] = fromUV(su / points.length, sv / points.length);
  return { mean: ms, dir, max: { speed: max.s, lat: points[max.k][0], lon: points[max.k][1] } };
}

// speed (m/s) → colour ramp for particles: calm white → yellow → orange → red → magenta
export function speedColor(s) {
  const stops = [[0, [235, 240, 245]], [5, [250, 230, 140]], [10, [250, 165, 70]], [15, [235, 80, 60]], [22, [200, 40, 140]]];
  for (let i = 1; i < stops.length; i++) if (s <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (s - a) / (b - a); return ca.map((c, j) => Math.round(c + (cb[j] - c) * f)); }
  return stops[stops.length - 1][1];
}
export function tempColor(t) {   // °C → rgb
  const stops = [[0, [70, 90, 200]], [12, [80, 170, 220]], [20, [120, 200, 150]], [26, [240, 210, 90]], [31, [240, 130, 60]], [36, [200, 40, 50]]];
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (t - a) / (b - a); return ca.map((c, j) => Math.round(c + (cb[j] - c) * f)); }
  return stops[stops.length - 1][1];
}

// PM2.5 (µg/m³) → Taiwan AQI band (環境部 PM2.5 breakpoints) and colour
const PM_BANDS = [[15.4, '良好', [70, 190, 110]], [35.4, '普通', [235, 210, 70]], [54.4, '對敏感族群不健康', [240, 140, 50]], [150.4, '對所有族群不健康', [220, 50, 50]], [250.4, '非常不健康', [150, 60, 160]], [Infinity, '危害', [120, 30, 50]]];
export const pmBand = v => { const b = PM_BANDS.find(([max]) => v <= max); return { name: b[1], color: b[2] }; };
