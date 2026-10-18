// 今晚星空 — pure calculations (no DOM). A = astronomy-engine, S = satellite.js subset. Runs in the browser and in node tests.
export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm360 = x => ((x % 360) + 360) % 360;
const addDays = (d, n) => new Date(+(d instanceof Date ? d : d.date) + n * 86400000);

export const TERMS = ['春分', '清明', '穀雨', '立夏', '小滿', '芒種', '夏至', '小暑', '大暑', '立秋', '處暑', '白露',
  '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至', '小寒', '大寒', '立春', '雨水', '驚蟄'];
export const DIR8 = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
export const dir8 = az => DIR8[Math.round(norm360(az) / 45) % 8];
export const PLANETS = [['Mercury', '水星'], ['Venus', '金星'], ['Mars', '火星'], ['Jupiter', '木星'], ['Saturn', '土星'], ['Uranus', '天王星'], ['Neptune', '海王星']];
// Major annual showers: peak (month, day), ZHR, radiant (ra°, dec°)
export const SHOWERS = [
  ['象限儀座流星雨', 1, 4, 110, 230, 49], ['天琴座流星雨', 4, 22, 18, 271, 34], ['寶瓶座η流星雨', 5, 6, 50, 338, -1],
  ['英仙座流星雨', 8, 12, 100, 48, 58], ['獵戶座流星雨', 10, 21, 20, 95, 16], ['獅子座流星雨', 11, 17, 15, 152, 22],
  ['雙子座流星雨', 12, 14, 150, 112, 33], ['小熊座流星雨', 12, 22, 10, 217, 76],
];

export function makeAstro(A, S) {
  const observer = o => new A.Observer(o.lat, o.lon, o.h || 0);

  // J2000 RA/Dec (deg) → horizontal alt/az (deg). Fast path for thousands of stars: one sidereal time per frame.
  function frame(date, o) {
    const lst = norm360(A.SiderealTime(date) * 15 + o.lon), sl = Math.sin(o.lat * D2R), cl = Math.cos(o.lat * D2R);
    return (ra, dec) => {
      const ha = (lst - ra) * D2R, sd = Math.sin(dec * D2R), cd = Math.cos(dec * D2R);
      const alt = Math.asin(sl * sd + cl * cd * Math.cos(ha));
      const az = Math.atan2(-cd * Math.sin(ha), cl * sd - sl * cd * Math.cos(ha));
      return [alt * R2D, norm360(az * R2D)];
    };
  }

  function bodyHor(name, date, o) {
    const eq = A.Equator(name, date, observer(o), true, true), hor = A.Horizon(date, observer(o), eq.ra, eq.dec, 'normal');
    const j2000 = A.Equator(name, date, observer(o), false, true);
    return { alt: hor.altitude, az: hor.azimuth, ra: j2000.ra * 15, dec: j2000.dec };
  }

  // 二十八宿: a body is "in" the mansion whose determinative star is the nearest one to the west (smaller RA, cyclic)
  function mansionOf(ra, mansions) {
    let best = null, bestD = 999;
    for (const [m, mra] of mansions) { const d = norm360(ra - mra); if (d < bestD) { bestD = d; best = m; } }
    return best + '宿';
  }

  function solarTerm(date) {
    const lon = A.SunPosition(date).elon, i = Math.floor(norm360(lon) / 15);
    const nextLon = ((i + 1) % 24) * 15, next = A.SearchSunLongitude(nextLon, date, 20);
    return { now: TERMS[i], next: TERMS[(i + 1) % 24], nextAt: next ? next.date : null };
  }

  function moonInfo(date, o, mansions) {
    const ill = A.Illumination('Moon', date), phase = A.MoonPhase(date);   // 0 new, 90 first quarter, 180 full, 270 last quarter
    const name = phase < 10 || phase >= 350 ? '新月' : phase < 80 ? '眉月' : phase < 100 ? '上弦月' : phase < 170 ? '盈凸月'
      : phase < 190 ? '滿月' : phase < 260 ? '虧凸月' : phase < 280 ? '下弦月' : '殘月';
    const prevNew = A.SearchMoonPhase(0, addDays(date, -30), 30);
    const age = prevNew ? (date - prevNew.date) / 86400000 : null;
    const h = bodyHor('Moon', date, o);
    return { name, phase, frac: ill.phase_fraction, age, mag: ill.mag, ...h, mansion: mansionOf(h.ra, mansions) };
  }

  function riseSet(name, date, o, dir, alt = null) {
    const t = alt == null ? A.SearchRiseSet(name, observer(o), dir, date, 1.2) : A.SearchAltitude(name, observer(o), dir, date, 1.2, alt);
    return t ? t.date : null;
  }

  // The night that "tonight" refers to: from this evening's sunset (or the last one, if it is already night) to the next sunrise.
  function night(date, o) {
    const sunAlt = bodyHor('Sun', date, o).alt;
    const start = sunAlt < -0.8 ? riseSet('Sun', addDays(date, -1), o, -1) : riseSet('Sun', date, o, -1);
    const dark = riseSet('Sun', start, o, -1, -18), end = riseSet('Sun', start, o, +1), dawn = riseSet('Sun', start, o, +1, -18);
    return { sunset: start, dark, dawn, sunrise: end };
  }

  // Planet visibility tonight: sample every 10 min while the sun is below -6°.
  function planetsTonight(date, o, mansions, nightInfo) {
    const out = [];
    const t0 = riseSet('Sun', nightInfo.sunset, o, -1, -6) || nightInfo.sunset, t1 = riseSet('Sun', nightInfo.sunset, o, +1, -6) || nightInfo.sunrise;
    for (const [body, zh] of PLANETS) {
      let best = null, first = null, last = null;
      for (let t = +t0; t <= +t1; t += 600000) {
        const h = bodyHor(body, new Date(t), o);
        if (h.alt > 8) { first ??= t; last = t; if (!best || h.alt > best.alt) best = { ...h, t }; }
      }
      const now = bodyHor(body, date, o), ill = A.Illumination(body, date);
      const con = A.Constellation(now.ra / 15, now.dec);
      const elong = A.Elongation(body, date);
      let when;
      if (!best) when = elong.elongation < 15 ? '太靠近太陽，今晚看不到' : '今晚不在夜空中';
      else if (last - first > (t1 - t0) * 0.85) when = '整晚都看得到';
      else if (first - t0 < 1800000) when = `天黑時在${dir8(bodyHor(body, new Date(first), o).az)}方，${hm(new Date(last))} 前落下`;
      else if (t1 - last < 1800000) when = `${hm(new Date(first))} 後從${dir8(bodyHor(body, new Date(first), o).az)}方升起，看到天亮`;
      else when = `${hm(new Date(first))}–${hm(new Date(last))}`;
      out.push({ body, zh, mag: ill.mag, visible: !!best, when, span: best ? Math.round((last - first) / 60000) : 0, best, now, con: con.symbol, mansion: mansionOf(now.ra, mansions),
        naked: ill.mag < 6 });
    }
    return out;
  }

  // ---- satellites: visible passes = above 10°, observer in darkness (sun < -6°), satellite in sunlight
  function passes(satrec, from, hours, o, stepS = 20) {
    const gd = { longitude: o.lon * D2R, latitude: o.lat * D2R, height: (o.h || 0) / 1000 }, list = [];
    let cur = null;
    for (let t = +from; t <= +from + hours * 3600000; t += stepS * 1000) {
      const d = new Date(t), pv = S.propagate(satrec, d);
      if (!pv || !pv.position) { cur = null; continue; }
      const la = S.ecfToLookAngles(gd, S.eciToEcf(pv.position, S.gstime(d))), el = la.elevation * R2D;
      let ok = false;
      if (el > 10 && bodyHor('Sun', d, o).alt < -6) ok = S.shadowFraction(S.sunPos(S.jday(d)).rsun, pv.position) < 0.5;
      if (ok) {
        const pt = { t, alt: el, az: norm360(la.azimuth * R2D) };
        if (!cur) { cur = { start: pt, max: pt, end: pt, path: [] }; list.push(cur); }
        cur.end = pt; cur.path.push(pt); if (el > cur.max.alt) cur.max = pt;
      } else cur = null;
    }
    return list.filter(p => p.end.t - p.start.t >= 60000);
  }
  function satNow(satrec, date, o) {
    const pv = S.propagate(satrec, date);
    if (!pv || !pv.position) return null;
    const gd = { longitude: o.lon * D2R, latitude: o.lat * D2R, height: (o.h || 0) / 1000 };
    const la = S.ecfToLookAngles(gd, S.eciToEcf(pv.position, S.gstime(date)));
    return { alt: la.elevation * R2D, az: norm360(la.azimuth * R2D), lit: S.shadowFraction(S.sunPos(S.jday(date)).rsun, pv.position) < 0.5 };
  }

  function nextShower(date) {
    const y = date.getFullYear();
    const all = SHOWERS.flatMap(([name, m, d, zhr, ra, dec]) => [y, y + 1].map(yy => ({ name, zhr, ra, dec, peak: new Date(Date.UTC(yy, m - 1, d, 12)) })));
    const s = all.filter(x => x.peak > addDays(date, -1)).sort((a, b) => a.peak - b.peak)[0];
    s.moon = A.Illumination('Moon', s.peak).phase_fraction;
    s.days = Math.round((s.peak - date) / 86400000);
    return s;
  }

  return { frame, bodyHor, mansionOf, solarTerm, moonInfo, riseSet, night, planetsTonight, passes, satNow, nextShower };
}

const TPE = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }) : null;
export const hm = d => d ? TPE.format(d) : '—';
