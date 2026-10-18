// 光影台灣 — peaks + sun light model (pure; browser + node tests). A = astronomy-engine.
export const PEAKS = [
  { name: '玉山主峰', lat: 23.4700, lon: 120.9573, ele: 3952, note: '台灣第一高峰' },
  { name: '雪山主峰', lat: 24.3833, lon: 121.2318, ele: 3886, note: '台灣第二高峰', anchor: 'top' },
  { name: '秀姑巒山', lat: 23.4975, lon: 121.0577, ele: 3825, note: '中央山脈最高峰' },
  { name: '南湖大山', lat: 24.3612, lon: 121.4385, ele: 3742, note: '帝王之山' },
  { name: '關山', lat: 23.2386, lon: 120.9058, ele: 3668 },
  { name: '奇萊北峰', lat: 24.1219, lon: 121.3249, ele: 3607, anchor: 'top-left' },
  { name: '大霸尖山', lat: 24.4596, lon: 121.2575, ele: 3492, note: '世紀奇峰' },
  { name: '合歡山主峰', lat: 24.1425, lon: 121.2709, ele: 3417, note: '開車就能到的高山', anchor: 'bottom-right' },
  { name: '北大武山', lat: 22.6262, lon: 120.7614, ele: 3092, note: '五嶽最南' },
  { name: '阿里山祝山', lat: 23.5095, lon: 120.8070, ele: 2489, note: '觀日樓' },
  { name: '三貂角', lat: 25.0076, lon: 122.0000, ele: 20, note: '本島最東端（海邊）' },
  { name: '蘭嶼紅頭山', lat: 22.0500, lon: 121.5500, ele: 548 },
];
export const VIEWS = [
  { id: 'all', label: '全島', center: [120.95, 23.7], zoom: 7.1, pitch: 50, bearing: -15 },
  { id: 'central', label: '中央山脈', center: [121.12, 23.75], zoom: 8.6, pitch: 66, bearing: 20 },
  { id: 'yushan', label: '玉山', center: [120.957, 23.47], zoom: 11.8, pitch: 70, bearing: 60 },
  { id: 'xueshan', label: '雪山', center: [121.232, 24.383], zoom: 11.8, pitch: 70, bearing: -30 },
  { id: 'taroko', label: '太魯閣', center: [121.52, 24.17], zoom: 10.6, pitch: 68, bearing: 250 },
  { id: 'east', label: '從太平洋看', center: [121.35, 23.6], zoom: 8.4, pitch: 72, bearing: 270 },
];

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const hex = c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${+a.toFixed(2)})`;

export function sunAt(A, date, lat = 23.7, lon = 121) {
  const o = new A.Observer(lat, lon, 0), e = A.Equator('Sun', date, o, true, true), h = A.Horizon(date, o, e.ra, e.dec, 'normal');
  return { alt: h.altitude, az: h.azimuth };
}

// light → MapLibre paint values: shadow direction follows the sun, colours warm at low sun, night goes blue-dark
export function lighting(sun) {
  const day = clamp((sun.alt + 6) / 12), low = sun.alt > -6 && sun.alt < 15 ? 1 - Math.abs(sun.alt - 3) / 12 : 0, golden = clamp(low);
  const highlight = mix([150, 170, 210], mix([255, 255, 245], [255, 196, 120], golden), day);
  const shadow = mix([5, 8, 20], mix([30, 40, 60], [70, 30, 40], golden * 0.6), day);
  return {
    direction: (sun.az + 360) % 360,                       // light comes from the sun's azimuth
    exaggeration: +(0.35 + 0.6 * clamp(1 - sun.alt / 60)).toFixed(2),   // long shadows when the sun is low
    // translucent shading so the satellite colours stay; warm glaze on sunlit slopes when the sun is low
    highlight: rgba(highlight, 0.3 + 0.45 * golden), shadow: rgba(shadow, 0.6 + 0.3 * clamp(1 - sun.alt / 40)), accent: rgba(mix([20, 30, 50], [120, 110, 90], day), 0.15),
    brightness: +(0.1 + 0.9 * clamp((sun.alt + 4) / 22)).toFixed(2),   // satellite image brightness: dim at dawn/dusk, dark at night
    saturation: +(-0.6 + 0.6 * day + 0.25 * golden).toFixed(2),
    sky: hex(mix([6, 10, 26], mix([110, 170, 230], [240, 150, 90], golden * 0.8), day)),
    horizon: hex(mix([20, 26, 50], mix([200, 225, 245], [255, 190, 130], golden), day)),
    phase: sun.alt < -6 ? '夜晚' : sun.alt < 0 ? (sun.az < 180 ? '破曉' : '黃昏') : sun.alt < 10 ? (sun.az < 180 ? '清晨斜陽' : '傍晚斜陽') : sun.alt < 45 ? '白天' : '正午高陽',
  };
}

// first light: sunrise for each peak, counting the earlier sunrise from height (horizon dip)
export function firstLight(A, day0, peaks = PEAKS) {
  return peaks.map(p => {
    const o = new A.Observer(p.lat, p.lon, p.ele), t = A.SearchRiseSet('Sun', o, +1, day0, 1, p.ele), flat = A.SearchRiseSet('Sun', o, +1, day0, 1, 0);
    return { ...p, rise: t?.date, gain: t && flat ? Math.round((flat.date - t.date) / 1000) : 0 };
  }).sort((a, b) => a.rise - b.rise);
}
