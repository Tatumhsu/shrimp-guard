// 週末出走 planner — pure functions, no DOM. Times are minutes after 00:00 of the travel date
// (values ≥ 1440 mean after midnight). Only direct trains are considered (no transfers).

export const LOCAL_TYPES = new Set(['區間車', '區間快']);

export function fmt(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function dur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h} 小時 ${m} 分` : `${h} 小時`) : `${m} 分`;
}

// trains: [[no, type, [[stationIdx, arr, dep], ...]], ...]
// returns Map(destIdx -> {out:[legs], back:[legs]}) where leg = {no,type,dep,arr}
export function directLegs(trains, origin, { leaveAfter, returnBy, localOnly = false }) {
  const res = new Map();
  const get = i => { let r = res.get(i); if (!r) res.set(i, r = { out: [], back: [] }); return r; };
  for (const [no, type, stops] of trains) {
    if (localOnly && !LOCAL_TYPES.has(type)) continue;
    const k = stops.findIndex(s => s[0] === origin);
    if (k < 0) continue;
    const o = stops[k];
    if (o[2] >= leaveAfter) {
      for (let j = k + 1; j < stops.length; j++) get(stops[j][0]).out.push({ no, type, dep: o[2], arr: stops[j][1] });
    }
    if (o[1] <= returnBy) {
      for (let j = 0; j < k; j++) get(stops[j][0]).back.push({ no, type, dep: stops[j][2], arr: o[1] });
    }
  }
  for (const r of res.values()) {
    r.out.sort((a, b) => a.arr - b.arr || b.dep - a.dep);
    r.back.sort((a, b) => b.dep - a.dep || a.arr - b.arr);
  }
  return res;
}

// Direct + one-transfer itineraries. itin = {legs:[{no,type,dep,arr,from,to}], dep, arr, via, no, type}
// (no/type = the train you board first, so code written for direct legs keeps working).
// Only Pareto-useful options are kept per destination; a transfer must beat a direct option by
// more than XFER_PENALTY minutes to push it out. Transfers never pass back through the origin.
export const XFER_PENALTY = 30;
export function trips(trains, origin, { leaveAfter, returnBy, localOnly = false, direct = false, minXfer = 6, maxWait = 60, maxRide = Infinity }) {
  const T = localOnly ? trains.filter(t => LOCAL_TYPES.has(t[1])) : trains;
  const at = new Map();
  T.forEach((t, ti) => t[2].forEach((s, k) => { let a = at.get(s[0]); if (!a) at.set(s[0], a = []); a.push([ti, k]); }));
  const out = new Map(), back = new Map();
  const put = (m, d, key, better, mk) => { let b = m.get(d); if (!b) m.set(d, b = new Map()); const cur = b.get(key); if (!cur || better(cur)) b.set(key, mk()); };
  const leg = (t, a, b) => ({ no: t[0], type: t[1], dep: a[2], arr: b[1], from: a[0], to: b[0] });
  const itin = (legs, via) => ({ legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, via, no: legs[0].no, type: legs[0].type });
  for (const [ti, k] of at.get(origin) || []) {
    const t = T[ti], st = t[2], o = st[k];
    if (o[2] >= leaveAfter) {
      for (let j = k + 1; j < st.length; j++) {
        const s = st[j];
        if (s[1] - o[2] > maxRide) break;
        // out: key by arrival, keep the latest departure (direct wins ties)
        put(out, s[0], s[1], c => o[2] > c.dep || (o[2] === c.dep && c.legs.length > 1), () => itin([leg(t, o, s)], null));
        if (direct) continue;
        for (const [tj, m] of at.get(s[0]) || []) {
          if (tj === ti) continue;
          const t2 = T[tj], st2 = t2[2], d2 = st2[m][2];
          if (d2 < s[1] + minXfer || d2 > s[1] + maxWait) continue;
          if (d2 - o[2] >= maxRide) continue;
          for (let q = m + 1; q < st2.length; q++) {
            const z = st2[q];
            if (z[0] === origin || z[1] - o[2] > maxRide) break;
            put(out, z[0], z[1], c => o[2] > c.dep, () => itin([leg(t, o, s), leg(t2, st2[m], z)], s[0]));
          }
        }
      }
    }
    if (o[1] <= returnBy) {
      for (let j = k - 1; j >= 0; j--) {
        const s = st[j];
        if (o[1] - s[2] > maxRide) break;
        // back: key by departure from the destination, keep the earliest arrival home
        put(back, s[0], s[2], c => o[1] < c.arr || (o[1] === c.arr && c.legs.length > 1), () => itin([leg(t, s, o)], null));
        if (direct) continue;
        for (const [tj, m] of at.get(s[0]) || []) {
          if (tj === ti) continue;
          const t2 = T[tj], st2 = t2[2], a2 = st2[m][1];
          if (a2 > s[2] - minXfer || a2 < s[2] - maxWait) continue;
          if (o[1] - a2 >= maxRide) continue;
          for (let q = m - 1; q >= 0; q--) {
            const z = st2[q];
            if (z[0] === origin || o[1] - z[2] > maxRide) break;
            put(back, z[0], z[2], c => o[1] < c.arr, () => itin([leg(t2, z, st2[m]), leg(t, s, o)], s[0]));
          }
        }
      }
    }
  }
  const pen = it => (it.legs.length - 1) * XFER_PENALTY;
  const res = new Map();
  for (const [d, m] of out) {
    const keep = []; let best = -Infinity;
    for (const it of [...m.values()].sort((a, b) => (a.arr + pen(a)) - (b.arr + pen(b)) || b.dep - a.dep || a.legs.length - b.legs.length)) {
      if (it.dep > best) { keep.push(it); best = it.dep; }
    }
    res.set(d, { out: keep.sort((a, b) => a.arr - b.arr || b.dep - a.dep), back: [] });
  }
  for (const [d, m] of back) {
    const keep = []; let best = Infinity;
    for (const it of [...m.values()].sort((a, b) => (b.dep - pen(b)) - (a.dep - pen(a)) || a.arr - b.arr || a.legs.length - b.legs.length)) {
      if (it.arr < best) { keep.push(it); best = it.arr; }
    }
    let r = res.get(d); if (!r) res.set(d, r = { out: [], back: [] });
    r.back = keep.sort((a, b) => b.dep - a.dep || a.arr - b.arr);
  }
  return res;
}

export const xfers = it => (it.legs ? it.legs.length - 1 : 0);

// One candidate per destination: earliest useful arrival, latest return, stay time.
export function candidates(legs, stations, origin, opt) {
  const { maxRide = 120, minStay = 180 } = opt;
  const out = [];
  for (const [idx, { out: go, back }] of legs) {
    if (idx === origin || !go.length || !back.length) continue;
    // earliest arrival among trains within the ride limit
    // a transfer is only suggested when it buys more than XFER_PENALTY minutes over a direct train
    const pick = (ls, key) => ls.reduce((b, l) => (b == null || key(l) < key(b) ? l : b), null);
    const first = pick(go.filter(l => l.arr - l.dep <= maxRide), l => l.arr + xfers(l) * XFER_PENALTY);
    const last = first && pick(back.filter(l => l.arr - l.dep <= maxRide && l.dep > first.arr), l => -(l.dep - xfers(l) * XFER_PENALTY));
    if (!first || !last) continue;
    const stay = last.dep - first.arr;
    if (stay < minStay) continue;
    const ride = first.arr - first.dep;
    if (ride < 10) continue; // next-door stations are not a trip
    const st = stations[idx];
    const f = st.f || { n: 0, hid: 0, good: 0 };
    const xf = xfers(first) + xfers(last);
    const score = Math.log1p(f.n) * 10 + Math.min(f.hid, 10) * 1.5 + Math.min(f.good, 20) * 0.5 + Math.min(stay, 480) / 60 - ride / 30 - xf * 1.5;
    out.push({ idx, st, first, last, stay, ride, score, xf,
      goCount: go.filter(l => l.arr - l.dep <= maxRide && l.arr < last.dep).length,
      backCount: back.filter(l => l.arr - l.dep <= maxRide && l.dep > first.arr).length });
  }
  return out;
}

export function sortCandidates(list, mode) {
  const by = {
    best: (a, b) => b.score - a.score,
    near: (a, b) => a.ride - b.ride || b.score - a.score,
    long: (a, b) => b.stay - a.stay || b.score - a.score,
    food: (a, b) => (b.st.f?.n || 0) - (a.st.f?.n || 0) || b.score - a.score,
  }[mode] || ((a, b) => b.score - a.score);
  return [...list].sort(by);
}

// ---- opening hours (only simple, common forms; anything else → null = unknown) ----
const DAY = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 0 };
const ZH = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

function daysOf(spec) {
  const set = new Set();
  for (const part of spec.split(',')) {
    const m = part.trim().toLowerCase().match(/^(mo|tu|we|th|fr|sa|su)(?:\s*-\s*(mo|tu|we|th|fr|sa|su))?$/);
    if (!m) return null;
    const a = DAY[m[1]], b = m[2] ? DAY[m[2]] : a;
    for (let d = a, n = 0; n < 8; d = (d + 1) % 7, n++) { set.add(d); if (d === b) break; }
  }
  return set;
}

function spans(txt) {
  const out = [];
  const re = /(\d{1,2})[:：](\d{2})\s*[-–~～至到]\s*(\d{1,2})[:：](\d{2})/g;
  let m;
  while ((m = re.exec(txt))) {
    const a = +m[1] * 60 + +m[2];
    let b = +m[3] * 60 + +m[4];
    if (b <= a) b += 1440;
    out.push([a, b]);
  }
  return out;
}

// Returns {open:true|false|null, note}. weekday: 0=Sun..6=Sat. at: minutes (optional).
export function openOn(hours, weekday, at) {
  if (!hours || typeof hours !== 'string') return { open: null, note: '營業時間未提供' };
  const h = hours.trim();
  if (/^24\/7$/.test(h)) return { open: true, note: '24 小時' };
  // explicit closed day in Chinese, e.g. 週一公休 / 星期日休息
  const closed = h.match(/(?:週|星期|周)([一二三四五六日天])(?:公休|休息|店休)/);
  if (closed && ZH[closed[1]] === weekday) return { open: false, note: '資料標示這天公休' };
  // OSM style: "Mo-Fr 11:00-20:00; Sa,Su 10:00-21:00" (also "PH off" parts ignored)
  if (/\b(mo|tu|we|th|fr|sa|su)\b/i.test(h)) {
    let matched = null, unknown = false;
    for (const rule of h.split(';')) {
      const r = rule.trim();
      if (!r || /^ph\b/i.test(r)) continue;
      const m = r.match(/^([A-Za-z,\s-]+?)\s+(.*)$/);
      if (!m) { unknown = true; continue; }
      const ds = daysOf(m[1]);
      if (!ds) { unknown = true; continue; }
      if (!ds.has(weekday)) continue;
      if (/^off|closed$/i.test(m[2].trim())) matched = { off: true };
      else { const sp = spans(m[2]); if (sp.length) matched = { sp }; else unknown = true; }
    }
    if (matched?.off) return { open: false, note: '資料標示這天公休' };
    if (matched) return withTime(matched.sp, at);
    if (unknown) return { open: null, note: hours };
    return { open: false, note: '資料標示這天公休' };
  }
  const sp = spans(h);
  if (sp.length && !/[一二三四五六日]/.test(h.replace(/(?:週|星期|周)[一二三四五六日天](?:公休|休息|店休)/g, ''))) return withTime(sp, at);
  return { open: null, note: hours };
}

function withTime(sp, at) {
  const txt = sp.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join('、');
  if (at == null) return { open: true, note: txt };
  const ok = sp.some(([a, b]) => at >= a && at <= b);
  return { open: ok, note: txt, atOk: ok };
}

// Suggested half-day: lunch/snack near arrival, then dessert/coffee, then a gift shop.
export function suggest(food, weekday, arr, dep) {
  const pick = (kinds, at, used) => food.find(s => kinds.includes(s.k) && !used.has(s.n) && openOn(s.h, weekday, at).open !== false);
  const used = new Set(), plan = [];
  const mealAt = Math.max(arr + 20, Math.min(12 * 60, dep - 120));
  const meal = pick(['小吃', '餐廳', '早餐', '夜市'], mealAt, used);
  if (meal) { used.add(meal.n); plan.push({ at: mealAt, what: '吃一頓', s: meal }); }
  const sweetAt = Math.min(dep - 60, mealAt + 90);
  const sweet = sweetAt > arr ? pick(['甜點', '咖啡茶飲'], sweetAt, used) : null;
  if (sweet) { used.add(sweet.n); plan.push({ at: sweetAt, what: '甜點或咖啡', s: sweet }); }
  const giftAt = dep - 40;
  const gift = giftAt > arr ? pick(['伴手禮'], giftAt, used) : null;
  if (gift) plan.push({ at: giftAt, what: '帶伴手禮', s: gift });
  return plan;
}
