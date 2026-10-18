// 3D 地形模式 for 台鐵即時列車: Tilezen terrain (×1.6) + hillshade lit from the sun's real position at the shown time
// (same light model as 光影台灣). Plain script; exposes window.Terrain3D.
(function () {
  const DEM = { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Terrain: Tilezen / AWS Open Data' };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(2)})`;
  function sun(date) {
    const A = window.Astronomy, o = new A.Observer(23.7, 121, 0), e = A.Equator('Sun', date, o, true, true), h = A.Horizon(date, o, e.ra, e.dec, 'normal');
    return { alt: h.altitude, az: h.azimuth };
  }
  function light(s) {
    const day = clamp((s.alt + 6) / 12), golden = clamp(s.alt > -6 && s.alt < 15 ? 1 - Math.abs(s.alt - 3) / 12 : 0);
    return {
      dir: (s.az + 360) % 360, ex: 0.35 + 0.55 * clamp(1 - s.alt / 60),
      hi: rgba(mix([120, 140, 190], mix([255, 255, 245], [255, 196, 120], golden), day), 0.12 + 0.28 * day + 0.2 * golden),
      sh: rgba(mix([0, 0, 8], mix([10, 14, 24], [60, 25, 35], golden * 0.6), day), 0.55 + 0.25 * clamp(1 - s.alt / 40)),
    };
  }
  let on = false, last = 0, map = null;
  function apply(date) {
    if (!on || !map.getLayer('t3d-shade')) return;
    const L = light(sun(date));
    map.setPaintProperty('t3d-shade', 'hillshade-illumination-direction', L.dir);
    map.setPaintProperty('t3d-shade', 'hillshade-exaggeration', L.ex);
    map.setPaintProperty('t3d-shade', 'hillshade-highlight-color', L.hi);
    map.setPaintProperty('t3d-shade', 'hillshade-shadow-color', L.sh);
  }
  window.Terrain3D = {
    get on() { return on; },
    enable(m, date) {
      map = m; on = true;
      if (!map.getSource('t3d-dem')) map.addSource('t3d-dem', DEM);
      if (!map.getSource('t3d-hill')) map.addSource('t3d-hill', { ...DEM, attribution: undefined });
      if (!map.getLayer('t3d-shade')) map.addLayer({ id: 't3d-shade', type: 'hillshade', source: 't3d-hill', paint: { 'hillshade-illumination-anchor': 'map', 'hillshade-accent-color': 'rgba(0,0,0,0)' } }, map.getLayer('lines') ? 'lines' : undefined);
      map.setTerrain({ source: 't3d-dem', exaggeration: 1.6 });
      map.setMaxPitch(80); map.easeTo({ pitch: 62, bearing: map.getBearing() || -18, duration: 1200 });
      last = 0; apply(date);
    },
    disable(m) {
      map = m; on = false; map.setTerrain(null);
      if (map.getLayer('t3d-shade')) map.removeLayer('t3d-shade');
      map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
    },
    // called from the render loop; re-light at most every 2 s of wall time
    tick(date) { const now = performance.now(); if (on && now - last > 2000) { last = now; apply(date); } },
    sunAt: sun,
  };
})();
