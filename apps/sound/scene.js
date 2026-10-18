// 此刻台灣的聲音 — places, and live weather → what should be audible (pure; browser + node tests)
export const PLACES = [
  { id: 'taipei', name: '臺北', lat: 25.04, lon: 121.56 }, { id: 'keelung', name: '基隆港', lat: 25.13, lon: 121.74, coast: 1 },
  { id: 'tamsui', name: '淡水', lat: 25.17, lon: 121.44, coast: 1 }, { id: 'yilan', name: '宜蘭頭城', lat: 24.86, lon: 121.83, coast: 1 },
  { id: 'hsinchu', name: '新竹', lat: 24.80, lon: 120.97 }, { id: 'taichung', name: '臺中', lat: 24.15, lon: 120.67 },
  { id: 'sunmoon', name: '日月潭', lat: 23.86, lon: 120.91, lake: 1 }, { id: 'alishan', name: '阿里山', lat: 23.51, lon: 120.80, mountain: 1 },
  { id: 'hehuan', name: '合歡山', lat: 24.14, lon: 121.28, mountain: 1 }, { id: 'taroko', name: '太魯閣', lat: 24.16, lon: 121.62, mountain: 1 },
  { id: 'hualien', name: '花蓮七星潭', lat: 24.03, lon: 121.63, coast: 1 }, { id: 'chiayi', name: '嘉義', lat: 23.48, lon: 120.45 },
  { id: 'tainan', name: '臺南', lat: 22.99, lon: 120.21 }, { id: 'kaohsiung', name: '高雄旗津', lat: 22.61, lon: 120.27, coast: 1 },
  { id: 'kenting', name: '墾丁', lat: 21.95, lon: 120.80, coast: 1 }, { id: 'taitung', name: '臺東', lat: 22.76, lon: 121.15, coast: 1 },
  { id: 'lanyu', name: '蘭嶼', lat: 22.05, lon: 121.55, coast: 1 }, { id: 'penghu', name: '澎湖', lat: 23.57, lon: 119.58, coast: 1 },
  { id: 'kinmen', name: '金門', lat: 24.44, lon: 118.32, coast: 1 }, { id: 'matsu', name: '馬祖', lat: 26.16, lon: 119.95, coast: 1 },
];
// 環島 order (clockwise from Taipei)
export const ROUND = ['taipei', 'keelung', 'yilan', 'hualien', 'taroko', 'taitung', 'lanyu', 'kenting', 'kaohsiung', 'tainan', 'chiayi', 'alishan', 'sunmoon', 'hehuan', 'taichung', 'hsinchu', 'tamsui', 'penghu', 'kinmen', 'matsu'];

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const WMO = c => c >= 95 ? '雷雨' : c >= 80 ? '陣雨' : c >= 71 ? '雪' : c >= 61 ? '下雨' : c >= 51 ? '毛毛雨' : c >= 45 ? '霧' : c === 3 ? '陰' : c === 2 ? '多雲' : c === 1 ? '晴時多雲' : '晴';

// w: { temp, hum, rain (mm/h), cloud, wind, gust (m/s), code, sunAlt (deg), month (1–12) }, place flags
export function scene(w, place) {
  const night = w.sunAlt < -4, dawn = w.sunAlt >= -6 && w.sunAlt <= 18 && w.morning, day = w.sunAlt > 0;
  let rain = Math.pow(clamp(w.rain / 6), 0.6);
  if (w.code >= 51 && w.code <= 57) rain = Math.max(rain, 0.15);
  if (w.code >= 61 && w.code <= 67 || w.code >= 80 && w.code <= 82) rain = Math.max(rain, 0.35);
  const wind = clamp((w.wind - 0.8) / 12), gusty = clamp((w.gust - w.wind) / 8);
  const sea = place.coast ? clamp(0.25 + 0.6 * clamp(w.wind / 12)) : place.lake ? 0.12 : 0;
  const warm = clamp((w.temp - 16) / 10), dry = 1 - 0.85 * rain;
  const insects = night ? warm * dry * (place.mountain ? 0.5 : 1) : 0;
  const cicadas = day && w.month >= 4 && w.month <= 10 && w.temp >= 26 && !place.mountain ? clamp((w.temp - 25) / 6) * dry * (w.month >= 6 && w.month <= 8 ? 1 : 0.55) : 0;
  const frogs = night && w.hum >= 80 && w.temp >= 18 ? clamp(0.3 + rain * 0.9 + (w.hum - 80) / 40) * (place.coast && !place.lake ? 0.5 : 1) : 0;
  const birds = night ? 0 : (dawn ? 1 : day ? 0.35 : 0.15) * (1 - 0.9 * rain) * (place.mountain ? 1.2 : 1);
  const thunder = w.code >= 95;
  const mood = thunder ? 'storm' : rain > 0.1 ? 'rain' : w.code === 45 || w.code === 48 ? 'fog' : w.cloud > 70 ? 'cloudy' : night ? 'night' : 'clear';
  const root = Math.round(45 + clamp((w.temp - 5) / 30) * 12);   // A2 … A3 by temperature
  const hear = [];
  if (rain > 0.05) hear.push(rain > 0.85 ? '大雨' : '雨聲');  // 大雨 ≈ 5 mm/h and up
  if (thunder) hear.push('雷');
  if (wind > 0.12) hear.push(wind > 0.55 ? '強風' : '風');
  if (sea > 0.05) hear.push(place.lake ? '湖水' : '海浪');
  if (cicadas > 0.05) hear.push('蟬鳴');
  if (insects > 0.05) hear.push('蟲鳴');
  if (frogs > 0.05) hear.push('蛙鳴');
  if (birds > 0.08) hear.push(dawn ? '清晨鳥鳴' : '鳥叫');
  return { rain: +rain.toFixed(3), wind: +wind.toFixed(3), gusty: +gusty.toFixed(3), sea: +sea.toFixed(3), insects: +insects.toFixed(3), cicadas: +cicadas.toFixed(3),
    frogs: +frogs.toFixed(3), birds: +clamp(birds).toFixed(3), thunder, mood, root, night, hear };
}

// chord tones (semitones over root) per mood
export const CHORDS = { clear: [0, 4, 7, 11, 14], night: [0, 7, 11, 14, 16], cloudy: [0, 2, 7, 9, 14], fog: [0, 5, 7, 10, 14], rain: [0, 3, 7, 10, 14], storm: [0, 3, 6, 10, 13] };
export const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
// earthquake bell pitch: bigger quake → lower, longer
export const bell = mag => ({ midi: Math.round(62 - (mag - 2.5) * 4), decay: 3 + mag });
