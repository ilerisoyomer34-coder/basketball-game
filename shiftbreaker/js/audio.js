// SHIFTBREAKER — procedural audio (Web Audio): layered engine, gearbox, tyres, world, one-shots, radio.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;

  class AudioSys {
    constructor() {
      this.ctx = null;
      this.ready = false;
      this.vol = { master: 0.8, engine: 1, sfx: 1, music: 0.55, amb: 0.6 };
      this.radio = 'off';
      this.lastBeep = 0;
    }
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(comp);
      const bus = () => { const g = ctx.createGain(); g.connect(this.master); return g; };
      this.engineBus = bus();
      this.sfxBus = bus();
      this.ambBus = bus();
      this.musicBus = bus();
      // shared noise
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      // brown-ish noise for rumble
      const bbuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const bd = bbuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
      this.brownBuf = bbuf;
      this.buildEngine();
      this.buildLoops();
      this.applyVolumes();
      this.ready = true;
    }
    applyVolumes(s) {
      if (s) this.vol = { master: s.vol, engine: s.volEngine, sfx: s.volSfx, music: s.volMusic, amb: s.volAmb };
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
      this.engineBus.gain.setTargetAtTime(this.vol.engine, t, 0.05);
      this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
      this.ambBus.gain.setTargetAtTime(this.vol.amb, t, 0.05);
      this.musicBus.gain.setTargetAtTime(this.vol.music, t, 0.05);
    }
    suspend(on) {
      if (!this.ctx) return;
      if (on) this.ctx.suspend(); else this.ctx.resume();
    }
    noise(loop, brown) {
      const s = this.ctx.createBufferSource();
      s.buffer = brown ? this.brownBuf : this.noiseBuf;
      s.loop = !!loop;
      return s;
    }
    osc(type, f) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      return o;
    }
    gain(v, dest) {
      const g = this.ctx.createGain();
      g.gain.value = v;
      if (dest) g.connect(dest);
      return g;
    }
    filter(type, f, q, dest) {
      const b = this.ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q || 1;
      if (dest) b.connect(dest);
      return b;
    }

    // ------------------------------------------------------------ engine voice
    buildEngine() {
      const c = this.ctx;
      const E = (this.eng = {});
      E.out = this.gain(0, this.engineBus);
      E.lp = this.filter('lowpass', 800, 1.4, E.out);
      E.shaper = c.createWaveShaper();
      E.shaper.curve = this.shaperCurve(2.2);
      E.shaper.connect(E.lp);
      E.mix = this.gain(1, E.shaper);
      E.a = this.osc('sawtooth', 40);
      E.b = this.osc('sawtooth', 40);
      E.b.detune.value = 9;
      E.sub = this.osc('square', 20);
      E.hi = this.osc('sawtooth', 80);
      E.ga = this.gain(0.38, E.mix); E.a.connect(E.ga);
      E.gb = this.gain(0.28, E.mix); E.b.connect(E.gb);
      E.gs = this.gain(0.16, E.mix); E.sub.connect(E.gs);
      E.gh = this.gain(0.08, E.mix); E.hi.connect(E.gh);
      // intake / induction roar
      E.n = this.noise(true);
      E.nbp = this.filter('bandpass', 400, 1.2);
      E.ng = this.gain(0, E.lp);
      E.n.connect(E.nbp); E.nbp.connect(E.ng);
      // AM for lugging / misfire / limiter stutter
      E.am = this.gain(1);
      E.out.disconnect();
      E.out.connect(E.am);
      E.am.connect(this.engineBus);
      // turbo whistle + straight-cut gear whine
      E.turbo = this.osc('sine', 3000);
      E.tg = this.gain(0, this.engineBus);
      E.turbo.connect(E.tg);
      E.whine = this.osc('triangle', 400);
      E.wg = this.gain(0, this.engineBus);
      E.whine.connect(E.wg);
      // starter motor
      E.st = this.osc('sawtooth', 180);
      E.stLfo = this.osc('square', 9);
      E.stAm = this.gain(0);
      E.stLfoG = this.gain(0.5);
      E.stLfo.connect(E.stLfoG);
      E.stLfoG.connect(E.stAm.gain);
      E.stLp = this.filter('lowpass', 900, 1);
      E.st.connect(E.stLp); E.stLp.connect(E.stAm);
      E.stOut = this.gain(0, this.engineBus);
      E.stAm.connect(E.stOut);
      for (const o of [E.a, E.b, E.sub, E.hi, E.n, E.turbo, E.whine, E.st, E.stLfo]) o.start();
    }
    shaperCurve(k) {
      const n = 1024, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); }
      return curve;
    }
    // s: {rpm, load, running, cranking, cyl, fuelCut, lug, misfire, boost, whine, redline}
    setEngine(s) {
      if (!this.ready) return;
      const E = this.eng, t = this.ctx.currentTime, tc = 0.02;
      const rpm = Math.max(0, s.rpm);
      const f = Math.max(8, (rpm / 60) * (s.cyl / 2));
      E.a.frequency.setTargetAtTime(f, t, tc);
      E.b.frequency.setTargetAtTime(f, t, tc);
      E.sub.frequency.setTargetAtTime(f / 2, t, tc);
      E.hi.frequency.setTargetAtTime(f * 2, t, tc);
      const rn = rpm / (s.redline || 7000);
      const load = s.load;
      E.lp.frequency.setTargetAtTime(180 + rpm * 0.22 + load * 2600 + (s.cyl === 6 ? 300 : 0), t, 0.03);
      E.nbp.frequency.setTargetAtTime(300 + rpm * 0.35, t, 0.05);
      const turning = s.running || rpm > 60;
      let g = turning ? (s.running ? 0.12 + 0.34 * load + 0.1 * rn : 0.06) : 0;
      if (s.fuelCut) g *= 0.45;
      E.out.gain.setTargetAtTime(g, t, s.fuelCut ? 0.005 : 0.03);
      E.ng.gain.setTargetAtTime(turning ? 0.02 + load * 0.12 * rn : 0, t, 0.04);
      let am = 1;
      if (s.lug) am = 0.65 + 0.35 * Math.sin(t * f * 0.25 * Math.PI * 2);
      if (s.misfire) am = 0.15;
      E.am.gain.setTargetAtTime(am, t, 0.01);
      E.tg.gain.setTargetAtTime(s.boost ? s.boost * 0.035 * load : 0, t, 0.1);
      E.turbo.frequency.setTargetAtTime(2400 + (s.boost || 0) * 5200, t, 0.1);
      E.wg.gain.setTargetAtTime(s.whine ? Math.min(0.05, s.whine * 0.0016) : 0, t, 0.05);
      E.whine.frequency.setTargetAtTime(120 + (s.whine || 0) * 38, t, 0.05);
      E.stOut.gain.setTargetAtTime(s.cranking ? 0.18 : 0, t, 0.03);
      E.stAm.gain.setTargetAtTime(s.cranking ? 0.5 : 0, t, 0.03);
    }

    // ------------------------------------------------------------ continuous loops
    buildLoops() {
      const L = (this.loops = {});
      const mk = (filterType, f, q, bus, brown) => {
        const n = this.noise(true, brown);
        const fl = this.filter(filterType, f, q);
        const g = this.gain(0, bus);
        n.connect(fl); fl.connect(g); n.start();
        return { n, f: fl, g };
      };
      // grinding: band noise chopped by a square LFO + metallic partials
      L.grind = mk('bandpass', 2300, 3.5, this.sfxBus);
      L.grindAm = this.gain(0);
      L.grind.g.disconnect();
      L.grind.g.connect(L.grindAm);
      L.grindAm.connect(this.sfxBus);
      L.grindLfo = this.osc('square', 52);
      L.grindLfoG = this.gain(0.5);
      L.grindLfo.connect(L.grindLfoG);
      L.grindLfoG.connect(L.grindAm.gain);
      L.grindLfo.start();
      L.metal = [this.osc('sine', 1730), this.osc('sine', 2417), this.osc('sine', 3190)];
      L.metalG = this.gain(0, L.grindAm);
      for (const o of L.metal) { o.connect(L.metalG); o.start(); }
      // tyre squeal: tonal + noise
      L.sq = this.osc('sawtooth', 820);
      L.sqLp = this.filter('bandpass', 1100, 5);
      L.sqG = this.gain(0, this.sfxBus);
      L.sq.connect(L.sqLp); L.sqLp.connect(L.sqG); L.sq.start();
      L.sqN = mk('bandpass', 1400, 2, this.sfxBus);
      L.wind = mk('lowpass', 500, 0.7, this.ambBus);
      L.rumble = mk('lowpass', 140, 1, this.sfxBus, true);
      L.rain = mk('highpass', 2500, 0.6, this.ambBus);
      L.city = mk('lowpass', 320, 0.6, this.ambBus, true);
      L.city.g.gain.value = 0.05;
      // horn
      L.h1 = this.osc('square', 415); L.h2 = this.osc('square', 520);
      L.hLp = this.filter('lowpass', 1800, 1);
      L.hG = this.gain(0, this.sfxBus);
      L.h1.connect(L.hLp); L.h2.connect(L.hLp); L.hLp.connect(L.hG);
      L.h1.start(); L.h2.start();
      // police siren (wail)
      L.sir = this.osc('sine', 900);
      L.sirLfo = this.osc('sine', 0.35);
      L.sirLfoG = this.gain(380);
      L.sirLfo.connect(L.sirLfoG); L.sirLfoG.connect(L.sir.frequency);
      L.sirG = this.gain(0, this.sfxBus);
      L.sir.connect(L.sirG); L.sir.start(); L.sirLfo.start();
    }
    setGrind(level) {
      if (!this.ready) return;
      const L = this.loops, t = this.ctx.currentTime;
      L.grind.g.gain.setTargetAtTime(level * 0.9, t, 0.02);
      L.metalG.gain.setTargetAtTime(level * 0.05, t, 0.02);
      L.grindAm.gain.setTargetAtTime(level ? 0.5 : 0, t, 0.02);
      L.grindLfo.frequency.setTargetAtTime(40 + Math.random() * 25, t, 0.05);
    }
    setTires(level, speed) {
      if (!this.ready) return;
      const L = this.loops, t = this.ctx.currentTime;
      L.sqG.gain.setTargetAtTime(level * 0.06, t, 0.04);
      L.sq.frequency.setTargetAtTime(680 + level * 260 + Math.sin(t * 23) * 25, t, 0.05);
      L.sqN.g.gain.setTargetAtTime(level * 0.1, t, 0.04);
      void speed;
    }
    setWorld(o) {
      if (!this.ready) return;
      const L = this.loops, t = this.ctx.currentTime;
      const v = Math.min(70, o.speed || 0);
      L.wind.g.gain.setTargetAtTime(Math.min(0.4, v * v * 0.00008), t, 0.1);
      L.wind.f.frequency.setTargetAtTime(300 + v * 14, t, 0.1);
      L.rumble.g.gain.setTargetAtTime(Math.min(0.5, (o.rumble || 0) * v * 0.02 + Math.min(0.08, v * 0.0015)), t, 0.06);
      L.rain.g.gain.setTargetAtTime((o.rain || 0) * 0.16, t, 0.3);
      L.city.g.gain.setTargetAtTime(0.03 + (o.city || 0) * 0.05, t, 0.5);
      L.hG.gain.setTargetAtTime(o.horn ? 0.12 : 0, t, 0.01);
      L.sirG.gain.setTargetAtTime(o.siren || 0, t, 0.1);
    }

    // ------------------------------------------------------------ one-shots
    env(node, t0, a, peak, decay) {
      node.gain.setValueAtTime(0, t0);
      node.gain.linearRampToValueAtTime(peak, t0 + a);
      node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + decay);
    }
    burst(f, q, peak, decay, type, bus) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const n = this.noise(false);
      const fl = this.filter(type || 'bandpass', f, q);
      const g = this.gain(0, bus || this.sfxBus);
      n.connect(fl); fl.connect(g);
      this.env(g, t, 0.003, peak, decay);
      n.start(t, Math.random());
      n.stop(t + decay + 0.1);
    }
    tone(f, peak, decay, type, bus, f2) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const o = this.osc(type || 'sine', f);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + decay);
      const g = this.gain(0, bus || this.sfxBus);
      o.connect(g);
      this.env(g, t, 0.004, peak, decay);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
    clank(k) {
      const s = k || 1;
      this.burst(180, 0.8, 0.9 * s, 0.25, 'lowpass');
      this.tone(95, 0.6 * s, 0.35, 'sine', null, 40);
      for (const f of [1210, 1790, 2630, 3480]) this.tone(f * (0.95 + Math.random() * 0.1), 0.08 * s, 0.6 + Math.random() * 0.4, 'sine');
    }
    grindBurst() { this.burst(2400, 3, 0.8, 0.5); this.burst(3600, 6, 0.4, 0.35); }
    thud(k) {
      const s = U.clamp(k, 0.05, 1);
      this.burst(140 + 300 * s, 0.7, 0.9 * s, 0.15 + 0.2 * s, 'lowpass');
      if (s > 0.35) for (const f of [900, 1400, 2100]) this.tone(f * (0.9 + Math.random() * 0.2), 0.05 * s, 0.4, 'triangle');
    }
    scrape(k) { this.burst(1800, 1.5, 0.25 * U.clamp(k, 0, 1), 0.3); }
    glass() { for (let i = 0; i < 6; i++) setTimeout(() => this.tone(3000 + Math.random() * 3000, 0.06, 0.3, 'triangle'), i * 25); this.burst(5000, 1, 0.3, 0.3, 'highpass'); }
    clatter(k) { this.tone(500 + Math.random() * 900, 0.05 * k, 0.12, 'square'); }
    explosion() {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const n = this.noise(false, true);
      const lp = this.filter('lowpass', 1800, 0.7);
      const g = this.gain(0, this.sfxBus);
      n.connect(lp); lp.connect(g);
      lp.frequency.setValueAtTime(3000, t);
      lp.frequency.exponentialRampToValueAtTime(140, t + 2.2);
      this.env(g, t, 0.01, 2.6, 2.8);
      n.start(t); n.stop(t + 3.2);
      this.tone(70, 1.4, 2.0, 'sine', null, 28);
      this.burst(900, 0.6, 1.2, 0.6);
      for (let i = 0; i < 9; i++) setTimeout(() => this.burst(1500 + Math.random() * 3000, 2, 0.25, 0.15), 120 + i * 90 + Math.random() * 80);
      setTimeout(() => this.glass(), 60);
    }
    backfire(k) {
      const s = k || 0.6;
      this.burst(420, 0.9, 0.9 * s, 0.09, 'lowpass');
      this.tone(110, 0.4 * s, 0.08, 'square');
    }
    blowoff() {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const n = this.noise(false);
      const bp = this.filter('bandpass', 2800, 2.5);
      const g = this.gain(0, this.sfxBus);
      n.connect(bp); bp.connect(g);
      bp.frequency.setValueAtTime(3200, t);
      bp.frequency.exponentialRampToValueAtTime(700, t + 0.45);
      this.env(g, t, 0.01, 0.35, 0.45);
      n.start(t); n.stop(t + 0.6);
    }
    cough() {
      for (let i = 0; i < 3; i++) setTimeout(() => { this.burst(160, 0.8, 0.6 - i * 0.15, 0.14, 'lowpass'); this.tone(55, 0.25, 0.12, 'square'); }, i * 140);
    }
    catchStart() { this.burst(220, 0.8, 0.5, 0.2, 'lowpass'); }
    valveFloat() { this.burst(3000, 2, 0.35, 0.5); this.tone(1900, 0.1, 0.5, 'sawtooth'); }
    shiftClick(k) { this.burst(1400, 2, 0.18 * (k || 1), 0.05); this.tone(320, 0.06, 0.05, 'square'); }
    clutchThunk() { this.tone(90, 0.12, 0.08, 'sine'); }
    click() { this.tone(2200, 0.04, 0.025, 'square'); }
    // police radio: a squelch burst with the key-up chirp
    radioSquelch() { this.burst(1900, 1.2, 0.14, 0.12); this.tone(1250, 0.05, 0.07, 'square'); setTimeout(() => this.burst(2400, 2, 0.08, 0.05), 160); }
    // handcuffs ratcheting shut
    cuffs() { for (let i = 0; i < 7; i++) setTimeout(() => this.tone(2900 + Math.random() * 900, 0.06, 0.018, 'square'), i * 26); setTimeout(() => { this.burst(3800, 3, 0.4, 0.05, 'highpass'); this.tone(1700, 0.09, 0.08, 'triangle'); }, 200); }
    // a tyre bursting on a spike strip
    tirePop() { this.burst(260, 0.7, 1, 0.16, 'lowpass'); this.tone(70, 0.5, 0.25, 'sine', null, 35); this.burst(3200, 0.8, 0.3, 0.9, 'highpass'); }
    tick() { this.tone(1300, 0.05, 0.02, 'square'); }
    beep(f, d, v) { this.tone(f || 1500, v || 0.12, d || 0.09, 'sine'); }
    chime() { [660, 880, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 0.5, 'sine', this.sfxBus), i * 90)); }
    fail() { [400, 300].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 0.3, 'triangle'), i * 140)); }
    alarm(pos) {
      void pos;
      let k = 0;
      const id = setInterval(() => {
        if (++k > 18) { clearInterval(id); return; }
        this.tone(k % 2 ? 1100 : 780, 0.07, 0.28, 'square');
      }, 320);
    }
    thunder() {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const n = this.noise(false, true);
      const lp = this.filter('lowpass', 400, 0.5);
      const g = this.gain(0, this.ambBus);
      n.connect(lp); lp.connect(g);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1.2, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
      n.start(t); n.stop(t + 3.6);
    }
    seagull() { this.tone(1500, 0.03, 0.25, 'sine', this.ambBus, 900); setTimeout(() => this.tone(1400, 0.025, 0.2, 'sine', this.ambBus, 950), 280); }
    parkBeep(dist) {
      if (!this.ready) return;
      const now = this.ctx.currentTime;
      const interval = dist < 0.4 ? 0.06 : U.lerp(0.12, 0.8, U.clamp((dist - 0.3) / 1.6, 0, 1));
      if (now - this.lastBeep < interval) return;
      this.lastBeep = now;
      this.tone(2000, 0.08, dist < 0.4 ? 0.06 : 0.07, 'sine');
    }

    // ------------------------------------------------------------ radio: generative fictional stations
    setRadio(station) {
      this.radio = station;
      if (!this.ready) return;
      if (this.radioTimer) { clearInterval(this.radioTimer); this.radioTimer = null; }
      if (station === 'off') return;
      const ctx = this.ctx;
      const st = station === 'kiyi'
        ? { bpm: 84, root: 57, scale: [0, 3, 5, 7, 10], chords: [[0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14], [-2, 2, 5, 9]], lead: 'triangle', bass: 'sine', swing: 0.12, hat: 0.03 }
        : { bpm: 118, root: 45, scale: [0, 2, 3, 7, 8, 10], chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], lead: 'sawtooth', bass: 'sawtooth', swing: 0, hat: 0.05 };
      const spb = 60 / st.bpm / 4;
      let step = 0, next = ctx.currentTime + 0.1;
      const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
      const note = (m, t, d, type, v, lp) => {
        const o = this.osc(type, mtof(m));
        const g = this.gain(0);
        const f = this.filter('lowpass', lp || 2400, 0.8);
        o.connect(f); f.connect(g); g.connect(this.musicBus);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(v, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.start(t); o.stop(t + d + 0.05);
      };
      const drum = (t, kind) => {
        if (kind === 'k') { const o = this.osc('sine', 120); const g = this.gain(0, this.musicBus); o.connect(g); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.start(t); o.stop(t + 0.3); }
        else { const n = this.noise(false); const f = this.filter(kind === 'h' ? 'highpass' : 'bandpass', kind === 'h' ? 7000 : 1800, 0.8); const g = this.gain(0, this.musicBus); n.connect(f); f.connect(g); g.gain.setValueAtTime(kind === 'h' ? st.hat : 0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'h' ? 0.04 : 0.16)); n.start(t, Math.random()); n.stop(t + 0.2); }
      };
      let lead = 0;
      this.radioTimer = setInterval(() => {
        while (next < ctx.currentTime + 0.25) {
          const bar = Math.floor(step / 16) % 4, s16 = step % 16;
          const ch = st.chords[bar];
          const t = next + (s16 % 2 ? st.swing * spb : 0);
          if (s16 % 4 === 0) drum(t, 'k');
          if (s16 === 4 || s16 === 12) drum(t, 's');
          if (s16 % 2 === 0) drum(t, 'h');
          if (s16 === 0) for (const iv of ch) note(st.root + 12 + iv, t, spb * 15, 'triangle', 0.035, 1400);
          if (s16 % 4 === 0 || (station !== 'kiyi' && s16 % 2 === 0)) note(st.root - 12 + ch[0] + (s16 === 8 ? 7 : 0), t, spb * 1.8, st.bass, 0.09, 600);
          if (Math.random() < (station === 'kiyi' ? 0.28 : 0.4) && s16 % 2 === 0) {
            lead = U.clamp(lead + Math.floor(Math.random() * 5) - 2, 0, st.scale.length * 2 - 1);
            const m = st.root + 24 + st.scale[lead % st.scale.length] + 12 * Math.floor(lead / st.scale.length);
            note(m, t, spb * (1.5 + Math.random() * 2), st.lead, 0.03, 2600);
          }
          step++;
          next += spb;
        }
      }, 60);
    }
  }

  SB.audio = new AudioSys();
})();
