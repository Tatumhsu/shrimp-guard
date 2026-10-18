// 天空預報 — spots + scoring (pure; runs in the browser and in node tests). A = astronomy-engine.
// Scores are heuristics read from forecast cloud layers, not promises; every score carries the reasons behind it.

// kind: s = sunset over open horizon, r = sunrise, star = dark-sky stargazing; alt in metres; bortle 1 (dark) … 9 (city)
export const SPOTS = [
  { id: 'tamsui', name: '淡水漁人碼頭', lat: 25.183, lon: 121.410, kinds: 's', bortle: 8, note: '夕陽落在淡水河口與台灣海峽' },
  { id: 'nanliao', name: '新竹南寮漁港', lat: 24.848, lon: 120.926, kinds: 's', bortle: 7 },
  { id: 'gaomei', name: '高美濕地', lat: 24.312, lon: 120.549, kinds: 's', bortle: 6, note: '退潮時有倒影' },
  { id: 'dongshi', name: '嘉義東石漁人碼頭', lat: 23.452, lon: 120.142, kinds: 's', bortle: 5 },
  { id: 'anping', name: '台南觀夕平台', lat: 22.993, lon: 120.157, kinds: 's', bortle: 7 },
  { id: 'sizihwan', name: '高雄西子灣', lat: 22.624, lon: 120.264, kinds: 's', bortle: 8 },
  { id: 'guanshan', name: '墾丁關山', lat: 21.954, lon: 120.729, kinds: 's', bortle: 4 },
  { id: 'xiyu', name: '澎湖西嶼', lat: 23.567, lon: 119.506, kinds: 's star', bortle: 4 },
  { id: 'kinmen', name: '金門', lat: 24.432, lon: 118.318, kinds: 's', bortle: 6 },
  { id: 'xiangshan', name: '台北象山', lat: 25.027, lon: 121.576, kinds: 's', bortle: 9, note: '看 101 與台北盆地的夕陽' },
  { id: 'sandiao', name: '三貂角', lat: 25.008, lon: 122.000, kinds: 'r', bortle: 4, note: '台灣本島最東' },
  { id: 'waiao', name: '宜蘭外澳', lat: 24.876, lon: 121.842, kinds: 'r', bortle: 5, note: '看龜山島日出' },
  { id: 'qixingtan', name: '花蓮七星潭', lat: 24.026, lon: 121.630, kinds: 'r star', bortle: 5 },
  { id: 'sanxiantai', name: '台東三仙台', lat: 23.123, lon: 121.414, kinds: 'r star', bortle: 3 },
  { id: 'longpan', name: '墾丁龍磐公園', lat: 21.923, lon: 120.846, kinds: 'r star', bortle: 3 },
  { id: 'hehuan', name: '合歡山暗空公園', lat: 24.137, lon: 121.282, alt: 3150, kinds: 'r s star sea', bortle: 2, note: '台灣第一座國際暗空公園' },
  { id: 'alishan', name: '阿里山祝山', lat: 23.509, lon: 120.808, alt: 2451, kinds: 'r star sea', bortle: 3, note: '日出與雲海名所' },
  { id: 'lulin', name: '鹿林山（塔塔加）', lat: 23.469, lon: 120.873, alt: 2860, kinds: 'r s star sea', bortle: 2, note: '鹿林天文台所在' },
  { id: 'taiping', name: '太平山', lat: 24.496, lon: 121.535, alt: 1950, kinds: 'r star sea', bortle: 3 },
  { id: 'qingjing', name: '清境農場', lat: 24.060, lon: 121.162, alt: 1750, kinds: 's star sea', bortle: 4 },
  { id: 'erge', name: '二格山', lat: 24.951, lon: 121.623, alt: 678, kinds: 'sea', bortle: 7, note: '台北近郊雲海' },
  { id: 'qingtiangang', name: '陽明山擎天崗', lat: 25.167, lon: 121.574, alt: 770, kinds: 's star', bortle: 6 },
];
export const MODES = {
  s: { label: '夕陽火燒雲', short: '夕陽' }, r: { label: '日出朝霞', short: '日出' },
  star: { label: '觀星', short: '觀星' }, sea: { label: '雲海', short: '雲海' },
};

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
// point `km` away from (lat, lon) along bearing `az` (deg)
export function dest(lat, lon, az, km) {
  const d = km / 6371, b = az * D2R, p1 = lat * D2R, l1 = lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [+(p2 * R2D).toFixed(3), +(l2 * R2D).toFixed(3)];
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

// hourly series → value at a fractional time (linear between hours)
export function at(series, times, t) {
  const ms = +t, i = times.findIndex(x => x > ms);
  if (i <= 0) return series[i === 0 ? 0 : series.length - 1];
  const f = (ms - times[i - 1]) / (times[i] - times[i - 1]);
  return series[i - 1] + (series[i] - series[i - 1]) * f;
}

/* Sunset / sunrise glow. Needs: something to light up (mid/high cloud overhead = the canvas), a clear path for low sunlight
   (few low clouds toward the sun, ~150 km out), no low overcast overhead, no rain. */
export function glowScore(w) {
  const { high, mid, lowHere, lowSun, rain, vis } = w, canvasC = Math.max(high, mid);
  const canvas = canvasC < 10 ? 0.25 : canvasC <= 70 ? 0.4 + 0.6 * (canvasC - 10) / 60 : canvasC <= 90 ? 1 - (canvasC - 70) / 20 * 0.25 : 0.75;
  const block = lowSun <= 20 ? 1 : lowSun >= 80 ? 0.05 : 1 - (lowSun - 20) / 60 * 0.95;
  const over = lowHere >= 85 ? 0.15 : lowHere > 50 ? 0.6 : 1;
  const rainF = 1 - 0.8 * rain / 100, hazeF = vis != null && vis < 5000 ? 0.6 : 1;
  const score = Math.round(100 * canvas * block * over * rainF * hazeF);
  const why = [];
  why.push(canvasC < 10 ? `上空幾乎沒有中高雲（${r0(canvasC)}%），會是乾淨的夕陽但少了火燒雲` : canvasC <= 90 ? `中高雲 ${r0(canvasC)}% 可當畫布` : `中高雲 ${r0(canvasC)}% 幾乎滿天，若光線透得進來會整片燒紅`);
  why.push(lowSun <= 20 ? `太陽方向低雲 ${r0(lowSun)}%，光線不會被擋` : `太陽方向低雲 ${r0(lowSun)}%，${lowSun >= 60 ? '光線很可能被擋住' : '可能擋掉一部分光'}`);
  if (lowHere > 50) why.push(`頭頂低雲 ${r0(lowHere)}%，${lowHere >= 85 ? '多半陰天' : '雲層偏低偏厚'}`);
  if (rain >= 30) why.push(`降雨機率 ${r0(rain)}%`);
  if (hazeF < 1) why.push(`能見度低（${(vis / 1000).toFixed(1)} 公里）`);
  return { score, level: glowLevel(score, canvasC), why };
}
export const glowLevel = (s, canvasC = 50) => s >= 70 ? '大燒' : s >= 45 ? '中燒' : s >= 25 ? (canvasC < 10 ? '晴朗夕陽' : '小燒') : '機會低';

/* Stargazing over the night (hourly): clear sky × moon × darkness of the site. */
export function starScore(hours, bortle, mountain) {
  // hours: [{ t, cloud, low, rain, hum, moonAlt, moonFrac }]
  const per = hours.map(h => {
    const cloud = mountain ? Math.max(h.mid ?? h.cloud, h.high ?? 0) : h.cloud;   // above-the-clouds sites ignore the low deck
    const clear = clamp(1 - cloud / 100), moon = h.moonAlt > 0 ? 1 - 0.65 * h.moonFrac * clamp(h.moonAlt / 30) : 1;
    const wet = h.rain >= 40 ? 0.3 : 1, hum = h.hum >= 95 ? 0.75 : 1;
    return { t: h.t, v: clear * moon * wet * hum, clear, moon };
  });
  const dark = clamp((9 - bortle) / 7);
  let best = null;   // best 2-hour window
  for (let i = 0; i + 1 < per.length; i++) { const v = (per[i].v + per[i + 1].v) / 2; if (!best || v > best.v) best = { v, from: per[i].t, to: per[i + 1].t + 3600e3 }; }
  const avg = per.reduce((s, x) => s + x.v, 0) / (per.length || 1);
  const score = Math.round(100 * (0.6 * (best?.v ?? 0) + 0.4 * avg) * (0.3 + 0.7 * dark));
  const why = [`整晚平均晴空 ${r0(100 * per.reduce((s, x) => s + x.clear, 0) / (per.length || 1))}%`, `光害等級 ${bortle}（1 最暗、9 市區）`];
  const moonUp = per.filter(x => x.moon < 0.95).length;
  if (moonUp) why.push(`月亮有 ${moonUp} 小時在天上，會照亮天空`);
  return { score, level: score >= 65 ? '極佳' : score >= 45 ? '不錯' : score >= 25 ? '普通' : '不建議', best, why, per };
}

/* Sea of clouds at dawn for mountain sites: a thick low deck below the summit, little mid cloud above, no rain. */
export function seaScore(w, altM) {
  const below = altM >= 2000 ? w.low : w.low * (altM >= 700 ? 0.8 : 0.5);
  const deck = below >= 80 ? 1 : below >= 50 ? 0.5 + (below - 50) / 60 : below / 100;
  const above = 1 - clamp((Math.max(w.mid, w.high * 0.5) - 20) / 70) * 0.85;
  const wet = 1 - 0.7 * w.rain / 100, humid = w.hum >= 85 ? 1 : 0.8;
  const score = Math.round(100 * deck * above * wet * humid);
  const why = [`山下低雲 ${r0(w.low)}%`, `山頂上方中高雲 ${r0(Math.max(w.mid, w.high))}%`];
  if (w.rain >= 30) why.push(`降雨機率 ${r0(w.rain)}%`);
  return { score, level: score >= 65 ? '很有機會' : score >= 40 ? '有機會' : score >= 20 ? '不太會' : '機會低', why };
}
const r0 = x => Math.round(x);
