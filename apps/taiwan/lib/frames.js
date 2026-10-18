// 衛星雲圖 — NASA GIBS Himawari layers and frame-time arithmetic (pure; browser + node tests)
export const LAYERS = {
  ir: { id: 'Himawari_AHI_Band13_Clean_Infrared', matrix: 'GoogleMapsCompatible_Level6', native: 6, label: '紅外線', note: '日夜都看得到；越冷（越高）的雲越亮，藍綠色是很高很冷的對流雲頂。' },
  vis: { id: 'Himawari_AHI_Band3_Red_Visible_1km', matrix: 'GoogleMapsCompatible_Level7', native: 7, label: '可見光', note: '像從太空拍的黑白照片，最細緻，但只有白天有。' },
  air: { id: 'Himawari_AHI_Air_Mass', matrix: 'GoogleMapsCompatible_Level6', native: 6, label: '氣團', note: '紅色是乾冷的高空空氣，綠色是溫暖潮濕的熱帶氣團；鋒面就在顏色交界。' },
};
export const tileUrl = (layer, iso) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${LAYERS[layer].id}/default/${iso}/${LAYERS[layer].matrix}/{z}/{y}/{x}.png`;
// frames every 10 min, newest first: start from (now − lagMin) rounded down to 10 min, going back `hours`
export function candidateTimes(now = Date.now(), hours = 3, lagMin = 30) {
  const step = 600000, newest = Math.floor((now - lagMin * 60000) / step) * step, out = [];
  for (let t = newest; t > newest - hours * 3600000; t -= step) out.push(new Date(t).toISOString().replace('.000Z', 'Z'));
  return out;
}
// a probe tile over Taiwan at zoom 5 (x 26, y 13 covers 117–129°E, 21–31°N)
export const probeUrl = (layer, iso) => tileUrl(layer, iso).replace('{z}/{y}/{x}', '5/13/26');
