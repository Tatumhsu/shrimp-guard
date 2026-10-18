// 鐵道出走沙盤 — planner engine (pure functions, no DOM).
// All times are minutes after midnight (local, Taiwan). Timetable rows come from the official
// TRA daily JSON (see tools/extract_timetable.py); walking times are estimates (data/pois.json).

export const CONNECT_BUFFER_MIN = 5;   // minimum time between stepping onto the platform and a departure

export function hm(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}
export function fmt(min) {
  if (min == null || !isFinite(min)) return '--:--';
  const m = Math.round(min);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
export function fmtDur(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} 分`;
  return `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}`;
}

export function dateKey(dateStr) { return dateStr.replace(/-/g, ''); }

export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ---------- timetable ----------
export function dayTrains(timetable, dateStr) {
  const day = timetable && timetable.dates && timetable.dates[dateKey(dateStr)];
  return day ? day.trains : null;
}
export function supportedRange(timetable) {
  const ks = Object.keys((timetable && timetable.dates) || {}).sort();
  if (!ks.length) return null;
  const f = k => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
  return { from: f(ks[0]), to: f(ks[ks.length - 1]), days: ks.length };
}

function legOf(train, from, to) {
  const si = train.stops.findIndex(x => x.s === from);
  const ti = train.stops.findIndex(x => x.s === to);
  if (si < 0 || ti < 0 || si >= ti) return null;
  const dep = hm(train.stops[si].dep), arr = hm(train.stops[ti].arr);
  if (dep == null || arr == null || arr < dep) return null;
  return { train: train.train, type: train.type, note: train.note, from, to, dep, arr, dir: train.dir };
}

// All direct trains from -> to, sorted by departure.
export function connections(trains, from, to) {
  const out = [];
  for (const t of trains || []) { const l = legOf(t, from, to); if (l) out.push(l); }
  return out.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
}
export function nextTrain(trains, from, to, notBefore) {
  return connections(trains, from, to).find(l => l.dep >= notBefore) || null;
}
export function lastTrain(trains, from, to) {
  const c = connections(trains, from, to);
  return c.length ? c[c.length - 1] : null;
}
// Latest train that arrives at `to` no later than `arriveBy`.
export function latestArriving(trains, from, to, arriveBy) {
  const c = connections(trains, from, to).filter(l => l.arr <= arriveBy);
  return c.length ? c[c.length - 1] : null;
}

// ---------- opening hours ----------
// Returns null when the place has no time constraint, else {open, close, lastEntry, closed, text}.
export function openWindow(poi, dateStr) {
  const h = poi.hours || {};
  if (h.kind === 'always' || !h.kind) return null;
  const wd = weekdayOf(dateStr);
  if (h.kind === 'daily') {
    if (Array.isArray(h.closed_weekdays) && h.closed_weekdays.includes(wd)) return { closed: true, text: h.text };
    return { open: hm(h.open), close: hm(h.close), lastEntry: h.last_entry ? hm(h.last_entry) : null, closed: false, text: h.text };
  }
  if (h.kind === 'seasonal') {
    const month = +dateStr.slice(5, 7);
    const r = (h.rules || []).find(x => x.months.includes(month));
    if (!r) return { closed: true, text: h.text };
    return { open: hm(r.open), close: hm(r.close), lastEntry: r.last_entry ? hm(r.last_entry) : null, closed: false, text: h.text };
  }
  return null;
}

// ---------- walking (estimate) ----------
export function haversineM(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const p1 = toR(a.lat), p2 = toR(b.lat), d1 = p2 - p1, d2 = toR(b.lng - a.lng);
  const x = Math.sin(d1 / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(d2 / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function walkEstimate(a, b, model) {
  const m = model || { path_factor: 1.3, meters_per_min: 75, min_minutes: 2 };
  return Math.max(m.min_minutes, Math.ceil(haversineM(a, b) * m.path_factor / m.meters_per_min));
}

// ---------- plan ----------
// input: {date:'YYYY-MM-DD', origin:'7360', departAfter:'09:00', returnBy:'14:00',
//         stops:[{station:'7332', pois:[{id:'shifen-old-street', stay:50}, ...]}, ...]}
// data:  {timetable, stations:{stations:[...]}, pois:{pois:[...], walk_model}}
export function plan(input, data) {
  const problems = [], warnings = [], segments = [];
  const res = { ok: false, status: 'INVALID', problems, warnings, segments, summary: null, input };
  const sMap = Object.fromEntries((data.stations.stations || []).map(s => [s.code, s]));
  const pMap = Object.fromEntries((data.pois.pois || []).map(p => [p.id, p]));
  const walkModel = data.pois.walk_model;

  if (!input || !sMap[input.origin]) { problems.push({ code: 'INVALID', message: '請選擇出發站。' }); return res; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) { problems.push({ code: 'INVALID', message: '請選擇日期。' }); return res; }
  const t0 = hm(input.departAfter), tEnd = hm(input.returnBy);
  if (t0 == null || tEnd == null) { problems.push({ code: 'INVALID', message: '出發時間或最晚返回時間格式不正確。' }); return res; }
  if (tEnd <= t0) { problems.push({ code: 'INVALID', message: '最晚返回時間必須晚於出發時間。' }); return res; }

  const trains = dayTrains(data.timetable, input.date);
  if (!trains) {
    const r = supportedRange(data.timetable);
    res.status = 'NO_DATA';
    problems.push({ code: 'NO_DATA', message: r ? `${input.date} 沒有官方時刻表資料。目前支援 ${r.from} ～ ${r.to}（共 ${r.days} 天）。` : '尚未載入時刻表資料。' });
    return res;
  }

  const stops = Array.isArray(input.stops) ? input.stops : [];
  let t = t0, cur = input.origin;
  let walkMin = 0, trainMin = 0, visitMin = 0, trainCount = 0;
  const originName = sMap[input.origin].name;

  const rideTo = (dest, idx) => {
    const notBefore = idx === 0 ? t : t + CONNECT_BUFFER_MIN;
    const leg = nextTrain(trains, cur, dest, notBefore);
    if (!leg) {
      const last = lastTrain(trains, cur, dest);
      problems.push({
        code: 'NO_TRAIN', legIndex: idx,
        message: last
          ? `${fmt(notBefore)} 之後 ${sMap[cur].name} 已沒有往 ${sMap[dest].name} 的班次（當日最後一班 ${fmt(last.dep)} 發車，${last.type} ${last.train} 次）。`
          : `${input.date} ${sMap[cur].name} → ${sMap[dest].name} 沒有直達班次。`,
      });
      return false;
    }
    if (leg.dep - t > 0) segments.push({ kind: 'wait', station: cur, start: t, end: leg.dep, minutes: leg.dep - t });
    segments.push({ kind: 'train', ...leg, fromName: sMap[cur].name, toName: sMap[dest].name, minutes: leg.arr - leg.dep });
    trainMin += leg.arr - leg.dep; trainCount++;
    t = leg.arr; cur = dest;
    return true;
  };

  let aborted = false;
  for (let i = 0; i < stops.length && !aborted; i++) {
    const st = stops[i];
    if (!sMap[st.station]) { problems.push({ code: 'INVALID', message: `第 ${i + 1} 個停靠點的車站不在本線上。` }); aborted = true; break; }
    if (st.station !== cur && !rideTo(st.station, i)) { aborted = true; break; }
    const stName = sMap[st.station].name;
    let at = { lat: sMap[st.station].lat, lng: sMap[st.station].lng, isStation: true };
    const pois = (st.pois || []).map(p => ({ ...p, def: pMap[p.id] })).filter(p => p.def && p.def.station === st.station);
    for (const p of pois) {
      const w = at.isStation ? p.def.walk_min : walkEstimate(at, p.def, walkModel);
      segments.push({ kind: 'walk', from: at.isStation ? stName : at.name, to: p.def.name, minutes: w, estimate: true, start: t, end: t + w });
      walkMin += w; t += w;
      const stay = Math.max(0, Math.round(+p.stay || p.def.stay_default || 0));
      const win = openWindow(p.def, input.date);
      const seg = { kind: 'visit', station: st.station, poi: p.id, name: p.def.name, start: t, end: t + stay, minutes: stay, hoursText: win ? win.text : (p.def.hours && p.def.hours.text) };
      if (win) {
        if (win.closed) { seg.problem = '當日休館'; problems.push({ code: 'CLOSED', poi: p.id, message: `${p.def.name} 當日不開放（${win.text}）。請移除或改日期。` }); }
        else {
          if (t < win.open) { seg.problem = `尚未開放（${fmt(win.open)} 開）`; problems.push({ code: 'CLOSED', poi: p.id, message: `抵達 ${p.def.name} 時（${fmt(t)}）尚未開放，${fmt(win.open)} 才開放。` }); }
          else if (win.lastEntry != null && t > win.lastEntry) { seg.problem = `已過最後入園 ${fmt(win.lastEntry)}`; problems.push({ code: 'CLOSED', poi: p.id, message: `抵達 ${p.def.name} 時（${fmt(t)}）已過最後入園時間 ${fmt(win.lastEntry)}。` }); }
          else if (t >= win.close) { seg.problem = `已關閉（${fmt(win.close)} 關）`; problems.push({ code: 'CLOSED', poi: p.id, message: `抵達 ${p.def.name} 時（${fmt(t)}）已過關閉時間 ${fmt(win.close)}。` }); }
          else if (t + stay > win.close) { seg.warning = `${fmt(win.close)} 關閉，停留會被截短`; warnings.push({ code: 'CLOSES_EARLY', poi: p.id, message: `${p.def.name} ${fmt(win.close)} 關閉，預定停留到 ${fmt(t + stay)} 會被截短。` }); }
        }
      }
      segments.push(seg);
      visitMin += stay; t += stay;
      at = { lat: p.def.lat, lng: p.def.lng, name: p.def.name, walkBack: p.def.walk_min };
    }
    if (!at.isStation) {
      const w = at.walkBack;
      segments.push({ kind: 'walk', from: at.name, to: stName, minutes: w, estimate: true, start: t, end: t + w });
      walkMin += w; t += w;
    }
  }

  if (!aborted && cur !== input.origin) {
    if (!rideTo(input.origin, stops.length)) aborted = true;
  }

  const returnAt = aborted ? null : t;
  res.summary = {
    date: input.date, origin: input.origin, originName, departAt: t0, returnBy: tEnd, returnAt,
    totalMin: returnAt != null ? returnAt - t0 : null, trainMin, walkMin, visitMin, trainCount,
    slack: returnAt != null ? tEnd - returnAt : null, stops: stops.length,
  };
  if (aborted) { res.status = problems.some(p => p.code === 'NO_TRAIN') ? 'NO_TRAIN' : 'INVALID'; return res; }
  if (returnAt > tEnd) {
    res.status = 'OVERTIME';
    const latest = latestArriving(trains, stops.length ? stops[stops.length - 1].station : input.origin, input.origin, tEnd);
    const lastStop = stops.length ? sMap[stops[stops.length - 1].station].name : originName;
    problems.push({
      code: 'OVERTIME',
      message: `回到 ${originName} 的時間是 ${fmt(returnAt)}，超過最晚返回 ${fmt(tEnd)} 共 ${fmtDur(returnAt - tEnd)}。` +
        (latest && stops.length ? ` 要在 ${fmt(tEnd)} 前回到 ${originName}，最晚需搭 ${lastStop} ${fmt(latest.dep)} 發車的 ${latest.type} ${latest.train} 次。` : ''),
    });
    return res;
  }
  if (problems.some(p => p.code === 'CLOSED')) { res.status = 'CLOSED'; return res; }
  res.ok = true; res.status = 'OK';
  return res;
}

// Next departures from a station in both directions (for the station card).
export function departuresFrom(trains, station, notBefore, stationsOrdered, limit = 3) {
  const idx = stationsOrdered.findIndex(s => s.code === station);
  const out = { toEnd: [], toStart: [] };
  if (idx < 0) return out;
  const endCode = stationsOrdered[stationsOrdered.length - 1].code, startCode = stationsOrdered[0].code;
  if (station !== endCode) out.toEnd = connections(trains, station, endCode).filter(l => l.dep >= notBefore).slice(0, limit);
  if (station !== startCode) out.toStart = connections(trains, station, startCode).filter(l => l.dep >= notBefore).slice(0, limit);
  return out;
}

// ---------- export ----------
export function exportTrip(result, data, meta = {}) {
  const sMap = Object.fromEntries((data.stations.stations || []).map(s => [s.code, s]));
  const day = data.timetable.dates[dateKey(result.input.date)];
  return {
    schema: 'rail-trip.trip.v1',
    app: '鐵道出走沙盤',
    exported_at: meta.now || new Date().toISOString(),
    status: result.status,
    input: result.input,
    summary: result.summary && {
      ...result.summary,
      departAt: fmt(result.summary.departAt), returnBy: fmt(result.summary.returnBy), returnAt: fmt(result.summary.returnAt),
    },
    itinerary: result.segments.map(s => ({
      ...s, start: s.start != null ? fmt(s.start) : undefined, end: s.end != null ? fmt(s.end) : undefined,
      dep: s.dep != null ? fmt(s.dep) : undefined, arr: s.arr != null ? fmt(s.arr) : undefined,
      from: s.fromName || s.from, to: s.toName || s.to, fromName: undefined, toName: undefined,
    })),
    problems: result.problems, warnings: result.warnings,
    sources: {
      timetable: { ...data.timetable.source, date_file_update_time: day && day.update_time, extracted_at: data.timetable.generated_at },
      stations: data.stations.source, pois: data.pois.source,
    },
    disclaimers: ['班次依臺鐵開放資料當日時刻表，實際運行以現場為準。', '步行時間與火車動畫位置為估算，非即時 GPS。', '景點開放時間取自新北市觀光旅遊網景點頁，出發前請再確認。'],
    stationNames: Object.fromEntries(Object.values(sMap).map(s => [s.code, s.name])),
  };
}

export function tripText(result, data) {
  const sMap = Object.fromEntries((data.stations.stations || []).map(s => [s.code, s]));
  const L = [`鐵道出走沙盤 — 平溪線半日行程 ${result.input.date}`];
  L.push(`出發站 ${sMap[result.input.origin]?.name || result.input.origin}，${result.input.departAfter} 後出發，最晚 ${result.input.returnBy} 返回`);
  for (const s of result.segments) {
    if (s.kind === 'train') L.push(`🚆 ${fmt(s.dep)} ${s.fromName} → ${fmt(s.arr)} ${s.toName}（${s.type} ${s.train} 次）`);
    else if (s.kind === 'walk') L.push(`🚶 ${fmt(s.start)} ${s.from} → ${s.to}（約 ${s.minutes} 分，估算）`);
    else if (s.kind === 'visit') L.push(`📍 ${fmt(s.start)}–${fmt(s.end)} ${s.name}${s.problem ? `（${s.problem}）` : ''}`);
    else if (s.kind === 'wait') L.push(`⏳ ${fmt(s.start)} ${sMap[s.station]?.name || ''} 候車 ${s.minutes} 分`);
  }
  if (result.summary && result.summary.returnAt != null) L.push(`🏁 ${fmt(result.summary.returnAt)} 回到 ${result.summary.originName}，全程 ${fmtDur(result.summary.totalMin)}`);
  for (const p of result.problems) L.push(`⚠ ${p.message}`);
  for (const w of result.warnings) L.push(`ℹ ${w.message}`);
  L.push('資料：臺鐵開放資料時刻表、新北市觀光旅遊網；步行時間為估算。');
  return L.join('\n');
}
