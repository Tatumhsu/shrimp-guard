// 台灣天象曆 — sky events for the next months as seen from Taiwan (pure; browser + node). A = astronomy-engine.
export const TPE = { lat: 25.03, lon: 121.56, h: 10 };
export const CATS = { eclipse: '日月食', moon: '月相', planet: '行星', meet: '星星相會', meteor: '流星雨', season: '節氣' };
const PLANET_ZH = { Mercury: '水星', Venus: '金星', Mars: '火星', Jupiter: '木星', Saturn: '土星', Uranus: '天王星', Neptune: '海王星' };
const TERMS = ['春分', '清明', '穀雨', '立夏', '小滿', '芒種', '夏至', '小暑', '大暑', '立秋', '處暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至', '小寒', '大寒', '立春', '雨水', '驚蟄'];
const SHOWERS = [['象限儀座流星雨', 1, 4, 110], ['天琴座流星雨', 4, 22, 18], ['寶瓶座η流星雨', 5, 6, 50], ['英仙座流星雨', 8, 12, 100], ['獵戶座流星雨', 10, 21, 20], ['獅子座流星雨', 11, 17, 15], ['雙子座流星雨', 12, 14, 150], ['小熊座流星雨', 12, 22, 10]];
const AU_KM = 149597870.7;
const fmtHM = d => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const addMin = (d, m) => new Date(+d + m * 60000);

export function events(A, start = new Date(), months = 13, where = TPE) {
  const end = new Date(+start + months * 30.44 * 86400000), obs = new A.Observer(where.lat, where.lon, where.h || 0), out = [];
  const alt = (body, d) => { const e = A.Equator(body, d, obs, true, true); return A.Horizon(d, obs, e.ra, e.dec, 'normal').altitude; };
  const push = (t, cat, title, detail, visible = true, extra = {}) => { if (t >= start && t <= end) out.push({ t, cat, title, detail, visible, ...extra }); };

  // moon phases + super/micro moons
  let q = A.SearchMoonQuarter(start);
  while (q.time.date <= end) {
    const t = q.time.date, name = ['新月', '上弦月', '滿月', '下弦月'][q.quarter];
    if (q.quarter === 0 || q.quarter === 2) {
      const km = A.GeoMoon(q.time).Length() * AU_KM;
      if (q.quarter === 2 && km < 360500) push(t, 'moon', '超級月亮', `滿月時月球距離地球約 ${Math.round(km).toLocaleString()} 公里，看起來比平常大一點、亮一點。`, true, { big: true });
      else if (q.quarter === 2 && km > 404000) push(t, 'moon', '微型滿月', `今年最遠的滿月之一（約 ${Math.round(km).toLocaleString()} 公里）。`);
      else push(t, 'moon', name, q.quarter === 0 ? '月亮看不見，前後幾天是觀星好時機。' : `${fmtHM(t)} 正圓。`);
    }
    q = A.NextMoonQuarter(q);
  }
  // lunar eclipses: visible if the moon is above Taiwan's horizon during the partial (or penumbral) phase
  let le = A.SearchLunarEclipse(start);
  while (le.peak.date <= end) {
    const peak = le.peak.date, half = le.sd_partial || le.sd_penum, b = addMin(peak, -half), e = addMin(peak, half);
    const vis = [b, peak, e].some(d => alt('Moon', d) > 0);
    const kind = { total: '月全食', partial: '月偏食', penumbral: '半影月食' }[le.kind];
    const detail = le.kind === 'total' ? `全食 ${fmtHM(addMin(peak, -le.sd_total))}–${fmtHM(addMin(peak, le.sd_total))}，食甚 ${fmtHM(peak)}；偏食從 ${fmtHM(addMin(peak, -le.sd_partial))} 開始。`
      : le.kind === 'partial' ? `偏食 ${fmtHM(addMin(peak, -le.sd_partial))}–${fmtHM(addMin(peak, le.sd_partial))}，食甚 ${fmtHM(peak)}。` : `食甚 ${fmtHM(peak)}，月面只會微微變暗，肉眼不容易察覺。`;
    push(peak, 'eclipse', kind, detail + (vis ? '' : ' 發生時月亮在台灣地平線下，看不到。'), vis, { big: vis && le.kind !== 'penumbral' });
    le = A.NextLunarEclipse(le.peak);
  }
  // solar eclipses seen from Taiwan
  let se = A.SearchLocalSolarEclipse(start, obs);
  while (se.peak.time.date <= end) {
    if (se.peak.altitude > 0) {
      const kind = { total: '日全食', annular: '日環食', partial: '日偏食' }[se.kind];
      push(se.peak.time.date, 'eclipse', kind, `台灣可見：${fmtHM(se.partial_begin.time.date)} 開始，${fmtHM(se.peak.time.date)} 食甚（太陽被遮 ${Math.round(se.obscuration * 100)}%），${fmtHM(se.partial_end.time.date)} 結束。務必用合格的日食眼鏡。`, true, { big: true });
    }
    se = A.NextLocalSolarEclipse(se.peak.time, obs);
  }
  // outer planets at opposition (closest, brightest, up all night)
  for (const body of ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
    let t = A.SearchRelativeLongitude(body, 0, start);
    while (t.date <= end) {
      const mag = A.Illumination(body, t).mag;
      push(t.date, 'planet', `${PLANET_ZH[body]}衝`, `${PLANET_ZH[body]}和太陽分別在地球兩側，整晚都看得到，也是一年中最亮的時候（星等 ${mag.toFixed(1)}）。${mag > 5.5 ? '需要望遠鏡。' : ''}`, mag < 5.5, { big: mag < 0 });
      t = A.SearchRelativeLongitude(body, 0, new Date(+t.date + 30 * 86400000));
    }
  }
  // Mercury & Venus greatest elongations
  for (const body of ['Mercury', 'Venus']) {
    let ev = A.SearchMaxElongation(body, start);
    while (ev.time.date <= end) {
      const when = ev.visibility === 'evening' ? '黃昏後在西方天空' : '日出前在東方天空';
      push(ev.time.date, 'planet', `${PLANET_ZH[body]}${ev.visibility === 'evening' ? '東' : '西'}大距`, `${PLANET_ZH[body]}離太陽最遠（${ev.elongation.toFixed(0)}°），${when}最好找。`, true, { big: body === 'Venus' });
      ev = A.SearchMaxElongation(body, new Date(+ev.time.date + 10 * 86400000));
    }
  }
  // close meetings: moon–bright planet (< 3°), planet–planet (< 1.5°), found by hourly separation minima
  const bright = ['Venus', 'Jupiter', 'Mars', 'Saturn', 'Mercury'];
  // nearest moment within ±14 h when the sky is dark (sun < -8°) and every body is ≥ 10° up (moon ≥ 5°) — when people can look
  const bestView = (bodies, d) => {
    for (let k = 0; k <= 28 * 4; k++) for (const sgn of k ? [-1, 1] : [1]) {
      const t = new Date(+d + sgn * k * 15 * 60000);
      if (alt('Sun', t) < -8 && bodies.every(b => alt(b, t) >= (b === 'Moon' ? 5 : 10))) return t;
    }
    return null;
  };
  const partOfNight = t => { const h = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: 'numeric', hourCycle: 'h23' }).format(t); return h >= 17 && h < 20 ? '傍晚' : h >= 20 ? '晚上' : h < 3 ? '半夜' : '清晨'; };
  const sep = (b1, b2, d) => A.AngleBetween(A.GeoVector(b1, d, true), A.GeoVector(b2, d, true));
  const minima = (b1, b2, limit, stepH) => {
    const found = []; let prev = null, prev2 = null;
    for (let t = +start; t <= +end; t += stepH * 3600000) {
      const s = sep(b1, b2, new Date(t));
      if (prev && prev2 && prev.s < prev2.s && prev.s <= s && prev.s < limit) found.push(prev);
      prev2 = prev; prev = { t, s };
    }
    return found;
  };
  for (const p of bright) for (const m of minima('Moon', p, 3, 2)) {
    const d = new Date(m.t), el = A.Elongation(p, d);
    if (el.elongation < 12) continue;   // planet lost in the sun's glare
    const best = bestView(['Moon', p], d);
    if (!best) continue;   // never up together in a dark Taiwan sky that night
    const sNow = sep('Moon', p, best);
    push(best, 'meet', `月亮與${PLANET_ZH[p]}相伴`, `${partOfNight(best)} ${fmtHM(best)}，${PLANET_ZH[p]}就在月亮旁約 ${sNow.toFixed(1)}°（最接近時 ${m.s.toFixed(1)}°）。找月亮旁最亮的那顆星。`, p !== 'Mercury', { big: sNow < 3 && (p === 'Venus' || p === 'Jupiter') });
  }
  for (let i = 0; i < bright.length; i++) for (let j = i + 1; j < bright.length; j++) for (const m of minima(bright[i], bright[j], 1.5, 12)) {
    const d = new Date(m.t), el = A.Elongation(bright[i], d);
    if (el.elongation < 12) continue;   // too close to the sun to see
    const best = bestView([bright[i], bright[j]], d);
    if (!best) continue;
    push(best, 'meet', `${PLANET_ZH[bright[i]]}合${PLANET_ZH[bright[j]]}`, `兩顆行星只差 ${m.s.toFixed(1)}°，${partOfNight(best)} ${fmtHM(best)} 在${el.visibility === 'evening' ? '西方' : '東方'}天空可見。`, true, { big: m.s < 0.7 });
  }
  // meteor showers
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) for (const [name, mo, da, zhr] of SHOWERS) {
    const t = new Date(Date.UTC(y, mo - 1, da, 12)), moon = A.Illumination('Moon', t).phase_fraction;
    push(t, 'meteor', name, `極大期前後的後半夜最好，理想暗空每小時約 ${zhr} 顆。${moon > 0.6 ? `月光很亮（${Math.round(moon * 100)}%），只看得到亮流星。` : moon > 0.3 ? `有些月光（${Math.round(moon * 100)}%）。` : '月光不干擾，條件好。'}`, true, { big: zhr >= 100 && moon < 0.4 });
  }
  // 24 solar terms
  let lon = Math.ceil(A.SunPosition(start).elon / 15) * 15, from = start;
  for (let k = 0; k < 30; k++) {
    const t = A.SearchSunLongitude(lon % 360, from, 40);
    if (!t || t.date > end) break;
    from = new Date(+t.date + 86400000);
    const name = TERMS[Math.round((lon % 360) / 15) % 24], major = ['春分', '夏至', '秋分', '冬至'].includes(name);
    push(t.date, 'season', name, major ? { 春分: '晝夜幾乎等長，之後白天越來越長。', 夏至: '一年白天最長的一天。', 秋分: '晝夜幾乎等長，之後夜越來越長。', 冬至: '一年夜晚最長的一天，吃湯圓。' }[name] : '二十四節氣之一。', true, { big: major });
    lon += 15;
  }
  return out.sort((a, b) => a.t - b.t);
}

// iCalendar export
export function ics(list, now = new Date()) {
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = s => String(s).replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//shrimp-guard//台灣天象曆//ZH', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:台灣天象曆'];
  for (const e of list) {
    lines.push('BEGIN:VEVENT', `UID:${stamp(e.t)}-${e.cat}-${encodeURIComponent(e.title).slice(0, 40)}@shrimp-guard`, `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.t)}`, `DTEND:${stamp(new Date(+e.t + 3600000))}`, `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.detail)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
