// sky-astro.mjs — 太陽／月亮位置、月相、恆星時（純函式，無 DOM、無依賴；瀏覽器與 Node 皆可）
// 太陽：NOAA Solar Calculator 公式（Meeus《Astronomical Algorithms》簡化版，含大氣折射），誤差約 < 0.1°。
// 月亮：Meeus 第 47 章主要項（黃經 14 項、黃緯 8 項），位置誤差約 0.3°，相位誤差約 1%。足供場景照明與月相顯示，
// 不是天文曆精度；不處理月球地平視差（最多約 1°）。
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const sin = (d) => Math.sin(d * D2R), cos = (d) => Math.cos(d * D2R), tan = (d) => Math.tan(d * D2R);
const norm360 = (x) => ((x % 360) + 360) % 360;

export function julianDay(epochSec) { return epochSec / 86400 + 2440587.5; }
const centuries = (jd) => (jd - 2451545) / 36525;

/** 平均恆星時（度）。Meeus 12.4。 */
export function siderealDeg(epochSec, lonDeg = 0) {
  const jd = julianDay(epochSec), T = centuries(jd);
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000;
  return norm360(gmst + lonDeg);
}

function obliquity(T) {
  const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  const e0 = 23 + (26 + seconds / 60) / 60;
  const omega = 125.04 - 1934.136 * T;
  return e0 + 0.00256 * cos(omega);
}

/** NOAA 大氣折射修正（度），輸入幾何高度角。 */
export function refractionDeg(elevDeg) {
  if (elevDeg > 85) return 0;
  const te = tan(elevDeg);
  if (elevDeg > 5) return (58.1 / te - 0.07 / (te ** 3) + 0.000086 / (te ** 5)) / 3600;
  if (elevDeg > -0.575) return (1735 + elevDeg * (-518.2 + elevDeg * (103.4 + elevDeg * (-12.79 + elevDeg * 0.711)))) / 3600;
  return -20.772 / te / 3600;
}

function altAz(latDeg, decDeg, hourAngleDeg) {
  const cosZ = sin(latDeg) * sin(decDeg) + cos(latDeg) * cos(decDeg) * cos(hourAngleDeg);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ))) * R2D;
  const elev = 90 - zen;
  let az;
  const denom = cos(latDeg) * sin(zen);
  if (Math.abs(denom) < 1e-9) az = 180;
  else {
    const c = Math.max(-1, Math.min(1, (sin(latDeg) * cosZ - sin(decDeg)) / denom));
    const a = Math.acos(c) * R2D;
    az = hourAngleDeg > 0 ? norm360(a + 180) : norm360(540 - a);
  }
  return { elev, az };
}

/**
 * 太陽位置。回傳 { elevationDeg（含折射）, geometricElevationDeg, azimuthDeg（自北順時針）, declinationDeg, equationOfTimeMin }
 */
export function sunPosition(epochSec, latDeg, lonDeg) {
  const jd = julianDay(epochSec), T = centuries(jd);
  const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = norm360(357.52911 + T * (35999.05029 - 0.0001537 * T));
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sin(2 * M) * (0.019993 - 0.000101 * T) + sin(3 * M) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * sin(omega);
  const eps = obliquity(T);
  const decl = Math.asin(sin(eps) * sin(lambda)) * R2D;
  const y = tan(eps / 2) ** 2;
  const eqTime = 4 * R2D * (y * sin(2 * L0) - 2 * e * sin(M) + 4 * e * y * sin(M) * cos(2 * L0) - 0.5 * y * y * sin(4 * L0) - 1.25 * e * e * sin(2 * M));
  const utcMinutes = ((epochSec % 86400) + 86400) % 86400 / 60;
  let tst = (utcMinutes + eqTime + 4 * lonDeg) % 1440; if (tst < 0) tst += 1440;
  let ha = tst / 4 - 180; if (ha < -180) ha += 360;
  const { elev, az } = altAz(latDeg, decl, ha);
  return { elevationDeg: elev + refractionDeg(elev), geometricElevationDeg: elev, azimuthDeg: az, declinationDeg: decl, equationOfTimeMin: eqTime };
}

/**
 * 當天日出／日沒（太陽中心折射後高度 = −0.833°，即視地平面接觸上緣），在 [dayStartEpoch, dayStartEpoch+86400) 內以 2 分鐘掃描＋二分法求解。
 * 回傳 { sunrise, sunset }（epoch 秒；極晝／極夜為 null）。
 */
export function solarEvents(dayStartEpoch, latDeg, lonDeg) {
  const h = (t) => sunPosition(t, latDeg, lonDeg).geometricElevationDeg + 0.833;
  const step = 120;
  let sunrise = null, sunset = null, prev = h(dayStartEpoch);
  for (let t = dayStartEpoch + step; t <= dayStartEpoch + 86400; t += step) {
    const cur = h(t);
    if (prev < 0 && cur >= 0 && sunrise === null) sunrise = bisect(h, t - step, t);
    if (prev >= 0 && cur < 0 && sunset === null) sunset = bisect(h, t - step, t);
    prev = cur;
  }
  return { sunrise, sunset };
}
function bisect(f, a, b) { for (let i = 0; i < 20; i++) { const m = (a + b) / 2; if (f(a) * f(m) <= 0) b = m; else a = m; } return Math.round((a + b) / 2); }

/** 月亮位置與月相。回傳 { elevationDeg, azimuthDeg, illumination(0..1), phase(0..1，0=朔 0.5=望), waxing, ageDays } */
export function moonPosition(epochSec, latDeg, lonDeg) {
  const jd = julianDay(epochSec), T = centuries(jd);
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T);
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T);
  const F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T);
  const lon = Lp + 6.288774 * sin(Mp) + 1.274027 * sin(2 * D - Mp) + 0.658314 * sin(2 * D) + 0.213618 * sin(2 * Mp) - 0.185116 * sin(M)
    - 0.114332 * sin(2 * F) + 0.058793 * sin(2 * D - 2 * Mp) + 0.057066 * sin(2 * D - M - Mp) + 0.053322 * sin(2 * D + Mp) + 0.045758 * sin(2 * D - M)
    - 0.040923 * sin(M - Mp) - 0.034720 * sin(D) - 0.030383 * sin(M + Mp) + 0.015327 * sin(2 * D - 2 * F);
  const lat = 5.128122 * sin(F) + 0.280602 * sin(Mp + F) + 0.277693 * sin(Mp - F) + 0.173237 * sin(2 * D - F) + 0.055413 * sin(2 * D - Mp + F)
    + 0.046271 * sin(2 * D - Mp - F) + 0.032573 * sin(2 * D + F) + 0.017198 * sin(2 * Mp + F);
  const eps = obliquity(T);
  const ra = norm360(Math.atan2(sin(lon) * cos(eps) - tan(lat) * sin(eps), cos(lon)) * R2D);
  const dec = Math.asin(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon)) * R2D;
  let ha = siderealDeg(epochSec, lonDeg) - ra; ha = ((ha + 180) % 360 + 360) % 360 - 180;
  const { elev, az } = altAz(latDeg, dec, ha);
  // 相位角（Meeus 48.4）→ 被照亮比例
  const i = 180 - D - 6.289 * sin(Mp) + 2.1 * sin(M) - 1.274 * sin(2 * D - Mp) - 0.658 * sin(2 * D) - 0.214 * sin(2 * Mp) - 0.11 * sin(D);
  const illumination = (1 + cos(i)) / 2;
  const phase = norm360(D) / 360;      // 平均距角：0 朔、0.5 望
  return { elevationDeg: elev + refractionDeg(elev), azimuthDeg: az, illumination, phase, waxing: phase < 0.5, ageDays: phase * 29.530588853 };
}

/** 晨昏階段：day / civil / nautical / astronomical / night（依太陽折射後高度角） */
export function twilightStage(elevationDeg) {
  if (elevationDeg >= 0) return 'day';
  if (elevationDeg >= -6) return 'civil';
  if (elevationDeg >= -12) return 'nautical';
  if (elevationDeg >= -18) return 'astronomical';
  return 'night';
}

/** 方位角 → 相對鏡頭朝向的水平偏角（度，右正左負，範圍 −180..180） */
export function relativeAzimuth(azimuthDeg, cameraHeadingDeg) {
  return ((azimuthDeg - cameraHeadingDeg + 540) % 360) - 180;
}
