// 此刻台灣的聲音 — WebAudio synthesis. No samples: every sound is built from noise, oscillators and envelopes.
import { CHORDS, midiHz, bell } from './scene.js';

export class Engine {
  constructor() {
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.out = C.createDynamicsCompressor(); this.out.threshold.value = -18; this.out.ratio.value = 3; this.out.connect(C.destination);
    this.master = C.createGain(); this.master.gain.value = 0.9; this.master.connect(this.out);
    this.groups = {}; for (const g of ['nature', 'life', 'music', 'quake']) { const n = C.createGain(); n.gain.value = 1; n.connect(this.master); this.groups[g] = n; }
    this.noise = { white: this.buf('white'), pink: this.buf('pink'), brown: this.buf('brown') };
    this.s = { rain: 0, wind: 0, gusty: 0, sea: 0, insects: 0, cicadas: 0, frogs: 0, birds: 0, thunder: false, mood: 'clear', root: 52 };
    this.listeners = [];
    this.build(); this.timers = [];
    this.loop(() => this.drops(), 50); this.loop(() => this.gusts(), 700); this.loop(() => this.waves(), 400);
    this.loop(() => this.crickets(), 120); this.loop(() => this.frogCall(), 300); this.loop(() => this.birdCall(), 250); this.loop(() => this.thunderRoll(), 1500);
  }
  on(fn) { this.listeners.push(fn); }
  emit(kind, data) { for (const f of this.listeners) f(kind, data); }
  buf(kind) {
    const C = this.ctx, n = C.sampleRate * 3, b = C.createBuffer(1, n, C.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') { b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852; b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926; }
      else { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return b;
  }
  src(kind) { const s = this.ctx.createBufferSource(); s.buffer = this.noise[kind]; s.loop = true; s.start(this.ctx.currentTime + Math.random() * 0.1, Math.random() * 2.5); return s; }
  filt(type, f, q = 0.7) { const x = this.ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }
  loop(fn, ms) { this.timers.push(setInterval(() => { if (this.ctx.state === 'running') fn(); }, ms)); }

  build() {
    const C = this.ctx, G = this.groups;
    // rain bed
    this.rainG = this.gain(); this.chain(this.src('pink'), this.filt('highpass', 500), this.filt('lowpass', 7000), this.rainG, G.nature);
    // wind: brown noise through a moving band-pass
    this.windBP = this.filt('bandpass', 500, 0.9); this.windG = this.gain(); this.chain(this.src('brown'), this.windBP, this.windG, G.nature);
    this.windHiss = this.gain(); this.chain(this.src('pink'), this.filt('bandpass', 2200, 1.4), this.windHiss, G.nature);
    // sea: low rumble whose level is driven by wave envelopes
    this.seaG = this.gain(); this.seaLP = this.filt('lowpass', 700); this.chain(this.src('brown'), this.seaLP, this.seaG, G.nature);
    this.foamG = this.gain(); this.chain(this.src('white'), this.filt('bandpass', 3000, 0.6), this.foamG, G.nature);
    // cicadas: narrow noise band, amplitude-modulated by a fast oscillator, slow swells
    this.cicG = this.gain(); const am = this.gain(0.5), lfo = C.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 38; const depth = this.gain(0.5); lfo.connect(depth); depth.connect(am.gain); lfo.start();
    this.chain(this.src('white'), this.filt('bandpass', 6200, 9), am, this.cicG, G.life);
    // crickets: a few sine voices gated by chirp envelopes
    this.crick = [4300, 4650, 5100].map(f => { const o = C.createOscillator(); o.frequency.value = f; const g = this.gain(); o.connect(g); g.connect(G.life); o.start(); return { g, next: 0, f }; });
    // pad
    this.padG = this.gain(0); this.padLP = this.filt('lowpass', 900); this.chain(this.padLP, this.padG, G.music);
    this.pad = []; this.setChord('clear', 52, true);
  }
  setChord(mood, root, now) {
    const C = this.ctx, t = C.currentTime, tones = CHORDS[mood] || CHORDS.clear;
    for (const v of this.pad) { v.g.gain.setTargetAtTime(0, t, 1.5); v.o.stop(t + 8); }
    this.pad = tones.map((st, i) => {
      const o = C.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = midiHz(root + st + (i > 2 ? 12 : 0)); o.detune.value = (Math.random() - 0.5) * 12;
      const g = this.gain(0); o.connect(g); g.connect(this.padLP); o.start();
      g.gain.setTargetAtTime(0.05 / (1 + i * 0.3), t + (now ? 0 : 2), 2.5);
      return { o, g };
    });
    this.chord = mood + root;
  }
  set(s) {
    const t = this.ctx.currentTime, k = 1.2; this.s = s;
    this.rainG.gain.setTargetAtTime(s.rain * 0.55, t, k);
    this.windG.gain.setTargetAtTime(s.wind * 0.9, t, k); this.windHiss.gain.setTargetAtTime(s.wind * s.wind * 0.12, t, k);
    this.cicG.gain.setTargetAtTime(s.cicadas * 0.05, t, k);
    this.padG.gain.setTargetAtTime(1, t, 2);
    this.padLP.frequency.setTargetAtTime(s.mood === 'clear' ? 1600 : s.mood === 'storm' ? 500 : 900, t, 3);
    if (this.chord !== s.mood + s.root) this.setChord(s.mood, s.root);
  }
  // ---- event sounds
  drops() {
    const s = this.s; if (s.rain < 0.03) return;
    const n = Math.random() < s.rain * 2 ? 1 + Math.floor(Math.random() * s.rain * 4) : 0;
    for (let i = 0; i < n; i++) {
      const C = this.ctx, t = C.currentTime + Math.random() * 0.05, src = C.createBufferSource(); src.buffer = this.noise.white;
      const bp = this.filt('bandpass', 1800 + Math.random() * 5000, 6), g = this.gain(0);
      this.chain(src, bp, g, this.groups.nature); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.12 * s.rain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.03);
      src.start(t, Math.random() * 2); src.stop(t + 0.08);
    }
    if (Math.random() < 0.02) this.emit('drop');
  }
  gusts() {
    const s = this.s, t = this.ctx.currentTime;
    if (s.wind < 0.03) return;
    const f = 250 + s.wind * 500 + Math.random() * (200 + s.gusty * 900);
    this.windBP.frequency.setTargetAtTime(f, t, 0.8 + Math.random());
    this.windG.gain.setTargetAtTime(s.wind * (0.6 + Math.random() * (0.4 + s.gusty)), t, 0.9);
  }
  waves() {
    const s = this.s; if (s.sea < 0.03) { this.seaG.gain.setTargetAtTime(0, this.ctx.currentTime, 1); this.foamG.gain.setTargetAtTime(0, this.ctx.currentTime, 1); return; }
    const C = this.ctx, t = C.currentTime;
    if (!this.waveEnd || t > this.waveEnd) {
      const rise = 2 + Math.random() * 2, fall = 3 + Math.random() * 3, peak = s.sea * (0.5 + Math.random() * 0.5);
      const g = this.seaG.gain, f = this.foamG.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(peak * 0.9, t + rise); g.linearRampToValueAtTime(peak * 0.15, t + rise + fall);
      f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.linearRampToValueAtTime(0.002, t + rise * 0.8); f.linearRampToValueAtTime(peak * 0.06, t + rise + 0.3); f.linearRampToValueAtTime(0.001, t + rise + fall * 0.8);
      this.seaLP.frequency.setTargetAtTime(400 + peak * 600, t, rise / 2);
      this.waveEnd = t + rise + fall * 0.85; this.emit('wave', { peak, rise });
    }
  }
  crickets() {
    const s = this.s, C = this.ctx, t = C.currentTime;
    for (const v of this.crick) {
      if (s.insects < 0.03 || t < v.next) continue;
      const pulses = 3 + Math.floor(Math.random() * 2), vol = s.insects * (0.02 + Math.random() * 0.02);
      for (let p = 0; p < pulses; p++) { const a = t + p * 0.045; v.g.gain.setValueAtTime(0, a); v.g.gain.linearRampToValueAtTime(vol, a + 0.006); v.g.gain.linearRampToValueAtTime(0, a + 0.028); }
      v.next = t + 0.5 + Math.random() * (1.4 - s.insects * 0.6);
      if (Math.random() < 0.2) this.emit('cricket');
    }
  }
  frogCall() {
    const s = this.s; if (s.frogs < 0.03 || Math.random() > s.frogs * 0.35) return;
    const C = this.ctx, t = C.currentTime + Math.random() * 0.2, n = 1 + Math.floor(Math.random() * 3), base = 140 + Math.random() * 120;
    for (let i = 0; i < n; i++) {
      const a = t + i * (0.16 + Math.random() * 0.05), o = C.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 1.15, a); o.frequency.exponentialRampToValueAtTime(base, a + 0.09);
      const lp = this.filt('bandpass', base * 3.2, 2.5), g = this.gain(0); this.chain(o, lp, g, this.groups.life);
      g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(0.12 * s.frogs, a + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, a + 0.12);
      o.start(a); o.stop(a + 0.15);
    }
    this.emit('frog');
  }
  birdCall() {
    const s = this.s; if (s.birds < 0.03 || Math.random() > s.birds * 0.18) return;
    const C = this.ctx, t = C.currentTime + Math.random() * 0.3, notes = 2 + Math.floor(Math.random() * 5), f0 = 2200 + Math.random() * 2400, kind = Math.random();
    for (let i = 0; i < notes; i++) {
      const a = t + i * (0.09 + Math.random() * 0.07), d = 0.05 + Math.random() * 0.07, o = C.createOscillator(), g = this.gain(0);
      const f1 = f0 * (kind < 0.5 ? 1 + Math.random() * 0.4 : 1 - Math.random() * 0.3);
      o.frequency.setValueAtTime(f0 * (0.9 + Math.random() * 0.2), a); o.frequency.exponentialRampToValueAtTime(f1, a + d);
      this.chain(o, g, this.groups.life); g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(0.035 * s.birds, a + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, a + d);
      o.start(a); o.stop(a + d + 0.02);
    }
    this.emit('bird');
  }
  thunderRoll() {
    if (!this.s.thunder || Math.random() > 0.08) return;
    const C = this.ctx, t = C.currentTime, src = C.createBufferSource(); src.buffer = this.noise.brown;
    const lp = this.filt('lowpass', 180 + Math.random() * 150), g = this.gain(0); this.chain(src, lp, g, this.groups.nature);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.2, t + 0.08); g.gain.setTargetAtTime(0.5, t + 0.3, 0.4); g.gain.setTargetAtTime(0, t + 1.5, 1.4);
    src.start(t, Math.random()); src.stop(t + 7); this.emit('thunder');
  }
  bell(mag) {
    const C = this.ctx, t = C.currentTime + 0.05, { midi, decay } = bell(mag), f = midiHz(midi);
    const car = C.createOscillator(), mod = C.createOscillator(), mg = this.gain(f * 2.2), g = this.gain(0);
    car.frequency.value = f; mod.frequency.value = f * 1.41; mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(this.groups.quake);
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + decay);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    car.start(t); mod.start(t); car.stop(t + decay + 0.1); mod.stop(t + decay + 0.1);
  }
  level(group, v) { this.groups[group].gain.setTargetAtTime(v, this.ctx.currentTime, 0.2); }
  async resume() { await this.ctx.resume(); }
  async suspend() { await this.ctx.suspend(); }
}
