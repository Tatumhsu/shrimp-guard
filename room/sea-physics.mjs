// sea-physics.mjs — 海象的幾個標準關係式（純函式）。只用來決定畫面「怎麼動」，不預測船體運動。
// 來源：深水線性波（Airy）色散關係；船舶遭遇頻率；視風向量；白浪覆蓋率經驗式 Monahan & O'Muircheartaigh (1980)。
export const G = 9.80665;
const D2R = Math.PI / 180;

/** 深水波：波長 L = gT²/2π（公尺）、相速 c = gT/2π（m/s）。T 為週期（秒）。 */
export function deepWater(periodSec) {
  const T = Math.max(0.5, periodSec || 0);
  return { wavelengthM: G * T * T / (2 * Math.PI), phaseSpeedMs: G * T / (2 * Math.PI), omega: 2 * Math.PI / T };
}

/**
 * 遭遇週期（秒）：船以 shipSpeedMs 行駛，航向 headingDeg（自北順時針），波自 waveFromDeg 來。
 * ωe = ω − (ω²/g)·V·cos(μ)，μ = 波傳播方向與船首的夾角（0 = 順浪）。回傳 { encounterPeriodSec, relAngleDeg }。
 */
export function encounter(periodSec, waveFromDeg, headingDeg, shipSpeedMs) {
  const { omega } = deepWater(periodSec);
  const travelDeg = (waveFromDeg + 180) % 360;              // 波往哪裡去
  const rel = ((travelDeg - headingDeg + 540) % 360) - 180; // −180..180，0 = 順浪、±180 = 頂浪
  let we = omega - (omega * omega / G) * shipSpeedMs * Math.cos(rel * D2R);
  if (Math.abs(we) < 0.05) we = 0.05 * Math.sign(we || 1); // 追浪且速度相近時遭遇頻率趨近 0，避免除以 0
  return { encounterPeriodSec: 2 * Math.PI / Math.abs(we), relAngleDeg: rel };
}

/** 視風：真風（來向、m/s）減去船速向量。回傳 { speedMs, fromDeg }。 */
export function apparentWind(trueSpeedMs, trueFromDeg, headingDeg, shipSpeedMs) {
  // 風「去向」向量（東=x、北=y）
  const toDeg = trueFromDeg + 180;
  const wx = trueSpeedMs * Math.sin(toDeg * D2R), wy = trueSpeedMs * Math.cos(toDeg * D2R);
  const sx = shipSpeedMs * Math.sin(headingDeg * D2R), sy = shipSpeedMs * Math.cos(headingDeg * D2R);
  const ax = wx - sx, ay = wy - sy;
  const speed = Math.hypot(ax, ay);
  const toA = Math.atan2(ax, ay) / D2R;
  return { speedMs: speed, fromDeg: ((toA + 180) % 360 + 360) % 360 };
}

/** 白浪覆蓋率（0..1）：W = 3.84e-6 · U^3.41，U = 10 m 風速（m/s）。約 5 m/s 開始出現，15 m/s 約 4%。 */
export function whitecapFraction(windMs) {
  const u = Math.max(0, windMs || 0);
  return Math.min(0.25, 3.84e-6 * u ** 3.41);
}

/** 蒲福風級（0..12） */
export function beaufort(windMs) {
  const u = Math.max(0, windMs || 0);
  const limits = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  let b = 0; while (b < 12 && u >= limits[b]) b++;
  return b;
}

/** 道格拉斯海況（0..9，依有義波高 m） */
export function douglasSeaState(waveHeightM) {
  const h = Math.max(0, waveHeightM || 0);
  const limits = [0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14];
  let s = 0; while (s < 8 && h >= limits[s]) s++;
  return s;
}

/** 基隆→那霸大圓初始方位（度）。 */
export function initialBearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * D2R, φ2 = lat2 * D2R, Δλ = (lon2 - lon1) * D2R;
  const y = Math.sin(Δλ) * Math.cos(φ2), x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / D2R) + 360) % 360;
}
