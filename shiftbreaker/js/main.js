// SHIFTBREAKER — game core: fixed-step loop, cameras, rewind & replay, events, economy, save data.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const T = THREE;
  const t = (k, p) => SB.i18n.t(k, p);
  const SAVE_KEY = 'shiftbreaker.save.v1';
  const SET_KEY = 'shiftbreaker.settings.v1';

  function defaultSave() {
    const E = SB.DATA.ECONOMY;
    const cars = {};
    for (const id of SB.DATA.CAR_ORDER) cars[id] = { owned: E.startCars.includes(id), insured: false, premium: 0, repairUntil: 0, lost: false, upgrades: [], tune: {}, paint: SB.DATA.CARS[id].color, finish: 'gloss', rim: 0xb9bec4, odo: 0, fuel: null, damage: null };
    return { v: 2, credits: E.startCredits, cars, current: 'porsche', records: {}, collected: {}, achievements: {}, license: false, licensePoints: 100, stats: { explosions: 0, perfect: 0, stalls: 0, km: 0, starts: 0 }, clock: 9.2, day: 1, tipsSeen: false };
  }

  class Game {
    constructor() {
      const stored = U.store.get(SET_KEY, {});
      // rev 2: automatic clutch and traction control became the defaults for every device
      if (!(stored.rev >= 2)) { delete stored.clutchMode; delete stored.tcs; }
      // rev 3: the steering wheel became the default touch steering
      if (!(stored.rev >= 3)) delete stored.touchSteer;
      this.settings = U.deepMerge(U.clone(SB.DATA.SETTINGS_DEFAULT), stored);
      this.settings.rev = SB.DATA.SETTINGS_DEFAULT.rev;
      this.save = U.deepMerge(defaultSave(), U.store.get(SAVE_KEY, {}));
      // save v2: the real cars arrived; start in the Porsche once
      if (!(this.save.v >= 2)) { this.save.v = 2; this.save.current = 'porsche'; }
      if (!SB.DATA.CARS[this.save.current] || !this.save.cars[this.save.current].owned) this.save.current = SB.DATA.ECONOMY.startCars.find((id) => this.save.cars[id].owned) || 'lodos';
      SB.i18n.setLang(this.settings.lang);
      if (this.settings.clutchMode !== 'manual') this.settings.clutchMode = 'auto';
      this.quality = this.pickQuality();
      this.time = 0;
      this.timeScale = 1;
      this.state = 'boot';
      this.camMode = 0;
      this.camModes = ['chase', 'far', 'hood', 'bumper', 'cockpit'];
      this.shake = 0;
      this.fps = 60;
      this.rewindBuf = [];
      this.rewinding = false;
      this.explosion = null;
      this.cinematic = false;
      this.audio = SB.audio;
      this.debug = false;
      this.hideHud = false;
      this.ignitionOn = false;
      this.sirenLevel = 0;
      this.alarmed = new Set();
    }
    pickQuality() {
      const q = this.settings.quality;
      if (q !== 'auto') return q;
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
      return mobile ? 'low' : 'high';
    }

    // ---------------------------------------------------------------- boot
    async boot() {
      const el = document.getElementById('loadmsg');
      const step = (m) => new Promise((r) => { if (el) el.textContent = m; setTimeout(r, 30); });
      const canvas = document.getElementById('view');
      this.renderer = new T.WebGLRenderer({ canvas, antialias: this.quality === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: false });
      this.renderer.shadowMap.enabled = this.quality !== 'low';
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      // hex colours are authored for a linear framebuffer in r128; ACES keeps fire and headlights from clipping
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.1;
      SB.CarModel.initEnv(this.renderer);
      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(62, 1, 0.1, 4000);
      this.revCam = new T.PerspectiveCamera(70, 16 / 9, 0.05, 300);
      this.mirrorCam = new T.PerspectiveCamera(50, 4, 0.1, 600);
      this.resize();
      window.addEventListener('resize', () => this.resize());
      await step(t('load.city'));
      this.world = new SB.World(this.scene, { quality: this.quality, anisotropy: this.renderer.capabilities.getMaxAnisotropy() });
      await step(t('load.sky'));
      this.env = new SB.Env(this);
      this.env.setTime(this.save.clock || 9.2);
      if (this.settings.weather !== 'dynamic') this.env.setWeather(this.settings.weather, true);
      await step(t('load.traffic'));
      this.fx = new SB.FX(this);
      this.traffic = new SB.Traffic(this);
      this.hud = new SB.HUD(this);
      this.input = new SB.Input(this);
      this.police = new SB.Modes.Police(this);
      this.skills = new SB.Modes.Skills(this);
      this.ui = new SB.UI(this);
      await step(t('load.garage'));
      // the current car's model is fetched while loading (a slow network falls back to the simple body)
      const cur = SB.DATA.CARS[this.save.current];
      if (cur.glb && T.GLTFLoader) await Promise.race([SB.CarModel.loadGLB(cur.glb.hi).catch(() => null), new Promise((r) => setTimeout(r, 12000))]);
      this.spawnPlayer(this.save.current);
      this.mode = new SB.Modes.FreeRoam(this);
      this.mode.setVisible(false);
      this.applySettings();
      this.state = 'menu';
      this.ui.mainMenu();
      document.getElementById('loading').hidden = true;
      this.last = performance.now();
      this.acc = 0;
      requestAnimationFrame((ts) => this.frame(ts));
      // window.claude.hot: keep progress across live updates of the page
      try { if (window.claude && window.claude.hot && window.claude.hot.snapshot) window.claude.hot.snapshot(() => ({ save: this.save })); } catch (e) { /* not in a viewer */ }
    }
    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      const pr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.75 : this.quality === 'medium' ? 1.25 : 1) * (this.settings.renderScale || 1);
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.pxScale = (h * pr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      if (this.fx) this.fx.setScale(this.pxScale);
      if (this.traffic) this.traffic.lightMat.uniforms.uScale.value = this.pxScale;
    }

    // ---------------------------------------------------------------- car / save helpers
    makeCarData(id) {
      const base = U.clone(SB.DATA.CARS[id]);
      const sc = this.save.cars[id] || {};
      const tune = { power: 0, rev: 0, clutchCap: 0, shifter: 1, grip: 0, weight: 0, aero: 0, susp: 0, brakes: 0, lsd: 0 };
      for (const uid of sc.upgrades || []) {
        const u = SB.DATA.UPGRADES.find((x) => x.id === uid);
        if (!u) continue;
        for (const [k, v] of Object.entries(u.effect)) tune[k] = k === 'shifter' ? tune.shifter * v : (tune[k] || 0) + v;
      }
      const tn = sc.tune || {};
      for (let i = 1; i <= 6; i++) if (tn['g' + i]) base.gears.ratios[i - 1] *= tn['g' + i];
      if (tn.final) base.gears.final *= tn.final;
      Object.assign(tune, { springF: tn.springF, springR: tn.springR, arbF: tn.arbF, arbR: tn.arbR, damp: tn.damp, brakeBias: tn.brakeBias || 0, brakeForce: tn.brakeForce });
      // tyre pressure / camber shape grip a little
      const pf = tn.pressF || 2.2, pr = tn.pressR || 2.2, cam = (tn.camberF != null ? tn.camberF : -1) + (tn.camberR != null ? tn.camberR : -0.6);
      tune.grip += -Math.abs(pf - 2.2) * 0.03 - Math.abs(pr - 2.2) * 0.03 + U.clamp(-cam, 0, 3) * 0.008 - Math.max(0, -cam - 3) * 0.02;
      if (tn.diffLock != null && base.diff.type === 'lsd') base.diff.bias = 0.15 + tn.diffLock * 0.6;
      if (tune.lsd && base.diff.type !== 'lsd') base.diff = { type: 'lsd', preload: 60, bias: 0.3, k: 50 };
      if (tune.aero) base.aero.clA += tune.aero;
      base.tune = tune;
      return base;
    }
    spawnPlayer(id, at) {
      const prev = this.player;
      const sc = this.save.cars[id];
      const car = this.makeCarData(id);
      const v = new SB.Vehicle(this, car, { color: sc.paint, finish: sc.finish, rimColor: sc.rim });
      if (prev) {
        const p = at || { x: prev.pos.x, z: prev.pos.z, heading: prev.yaw };
        prev.dispose();
        v.place(p.x, p.z, p.heading);
      } else {
        const g = this.world.pois.find((x) => x.id === 'garage');
        v.place(g.x, g.z + 2, g.heading);
      }
      if (sc.fuel != null) v.dt.fuel = sc.fuel;
      if (sc.damage) Object.assign(v.dt.health, sc.damage);
      this.player = v;
      this.save.current = id;
      this.applySettings();
      if (this.input && this.input.touchRoot) this.input.buildTouch(this.input.touchRoot);
      this.rewindBuf = [];
      return v;
    }
    persist() {
      const p = this.player;
      if (p && this.save.cars[this.save.current]) {
        const sc = this.save.cars[this.save.current];
        sc.fuel = p.dt.fuel;
        sc.damage = p.dt.exploded ? null : Object.assign({}, p.dt.health);
      }
      this.save.clock = this.env ? this.env.time : this.save.clock;
      U.store.set(SAVE_KEY, this.save);
    }
    saveSettings() { U.store.set(SET_KEY, this.settings); }
    loadGhost(id) { return U.store.get('shiftbreaker.ghost.' + id, null); }
    saveGhost(id, g) { U.store.set('shiftbreaker.ghost.' + id, g); }
    addCredits(n) {
      this.save.credits = Math.round(this.save.credits + n);
      if (n > 0) this.hud.toast('+' + U.fmtInt(n) + ' ' + t('ui.cr'), 'good', 1.8);
      this.persist();
    }
    achieve(id) {
      if (this.save.achievements[id]) return;
      this.save.achievements[id] = Date.now();
      this.hud.big(t('ach.unlocked'), t('ach.' + id), 3, 'ach');
      this.audio.chime();
      this.persist();
    }
    keyLabel(action) {
      const d = this.input ? this.input.device : 'keyboard';
      if (d === 'touch') return t('keyname.touch.' + action) || action;
      if (d === 'gamepad') return { shiftUp: 'B', shiftDown: 'X', clutch: 'LB', handbrake: 'A', ignition: 'RB', interact: 'Y', rewind: 'Back' }[action] || '?';
      const k = (this.settings.keys || SB.DATA.KEYS_DEFAULT)[action];
      if (!k || !k.length) return '?';
      return SB.UI.keyName(k[0]);
    }
    rewindAllowance() {
      const d = this.settings.difficulty;
      return d === 'arcade' ? Infinity : d === 'normal' ? 3 : 0;
    }
    assistMultiplier() {
      const s = this.settings;
      let n = 0;
      for (const k of ['abs', 'tcs', 'esc', 'autoBlip', 'suggestGear', 'hillAssist']) if (s[k]) n++;
      return Math.max(SB.DATA.REWARD.minAssistMult, 1 - n * SB.DATA.REWARD.assistPenalty);
    }
    carValue(id) { return SB.DATA.CARS[id].price; }

    // ---------------------------------------------------------------- settings
    applySettings() {
      const s = this.settings;
      SB.i18n.setLang(s.lang);
      document.documentElement.lang = s.lang;
      this.audio.applyVolumes(s);
      if (this.audio.ready && this.audio.radio !== s.radio) this.audio.setRadio(s.radio);
      const p = this.player;
      if (p) {
        const o = p.dt.opts;
        const ro = this.raceOpts || {};
        const gb = ro.gearbox;
        o.stalling = s.stalling;
        o.autoClutch = gb ? gb !== 'clutch' : s.clutchMode === 'auto';
        o.autoShift = gb === 'auto';
        o.autoBlip = s.autoBlip;
        o.shifter = s.shifter;
        o.mechanical = s.damage === 'full';
        o.fuel = s.fuel;
        const inRace = this.mode && (this.mode.kind === 'race' || this.mode.kind === 'drag');
        const enabled = s.explosionRule && (!inRace || (ro.explosion != null ? ro.explosion : s.explosionInRace));
        o.explosion = { enabled, thr61: s.explodeAnySpeed ? 0 : s.thr61, thr6R: s.explodeAnySpeed ? 0 : s.thr6R };
        // a race gearbox can switch the clutch mode: rebuild the touch controls so the clutch pedal matches
        if (this.input && this.input.touchRoot && this.input.touchClutch !== !o.autoClutch) this.input.buildTouch(this.input.touchRoot);
      }
      if (this.renderer) {
        const sh = this.quality !== 'low';
        this.renderer.shadowMap.enabled = sh;
        if (this.env) this.env.sun.castShadow = sh;
        this.resize();
      }
      document.body.classList.toggle('bigtext', !!s.bigText);
      document.body.dataset.cb = s.colorblind;
      this.updateTouchVisibility();
      if (this.ui) this.ui.refreshTexts();
    }
    updateTouchVisibility() {
      if (!this.input) return;
      const s = this.settings;
      const root = document.getElementById('touch');
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      const want = s.touch === 'on' || (s.touch === 'auto' && (coarse || this.input.device === 'touch'));
      const show = want && (this.state === 'play');
      if (want && !this.input.touchRoot) this.input.buildTouch(root);
      root.hidden = !show;
      document.body.classList.toggle('touchui', !!show);
    }

    // ---------------------------------------------------------------- flow
    startFree() {
      this.audio.init();
      this.leaveMode();
      this.mode = new SB.Modes.FreeRoam(this);
      this.raceOpts = null;
      this.state = 'play';
      this.ui.close();
      this.applySettings();
      if (!this.save.tipsSeen) { this.ui.tips(); this.save.tipsSeen = true; this.persist(); }
      this.hud.big(t('free.welcome'), t('free.welcomeSub', { key: this.keyLabel('ignition') }), 4);
    }
    leaveMode() {
      this.goHintT = null;
      if (this.mode && this.mode.dispose) this.mode.dispose();
      this.mode = null;
      this.lockPlayer = null;
      this.police.reset();
      if (this.explosion) { this.explosion.stop(); this.explosion = null; }
      this.setTimeScale(1);
      this.setCinematic(false);
    }
    startEvent(ev, opts) {
      this.audio.init();
      this.ensureDrivable();
      this.leaveMode();
      this.raceOpts = opts;
      this.state = 'play';
      this.ui.close();
      this.repairForEvent();
      if (ev.type === 'drag') this.mode = new SB.Modes.Drag(this, ev, opts);
      else this.mode = new SB.Modes.Race(this, ev, opts);
      this.applySettings();
    }
    startParking(id) {
      this.audio.init();
      this.leaveMode();
      this.raceOpts = null;
      this.state = 'play';
      this.ui.close();
      this.mode = new SB.Modes.Parking(this, id);
      this.applySettings();
    }
    startLicense() {
      this.audio.init();
      this.leaveMode();
      this.raceOpts = null;
      this.state = 'play';
      this.ui.close();
      this.repairForEvent();
      this.mode = new SB.Modes.License(this);
      this.applySettings();
    }
    backToFree(where) {
      const pl = this.player;
      this.leaveMode();
      this.mode = new SB.Modes.FreeRoam(this);
      this.raceOpts = null;
      this.state = 'play';
      this.ui.close();
      if (where) this.teleportToPOI(where);
      else if (pl.exploded) this.teleportToPOI('garage');
      this.applySettings();
    }
    repairForEvent() {
      // events start with a working car; free-roam damage carries over
      if (this.player.exploded) { this.player.dt.repairAll(); this.player.restoreVisuals(); this.hud.tachBreak(false); }
    }
    ensureDrivable() {
      const sc = this.save.cars[this.save.current];
      if (sc && sc.owned && !sc.lost && !(sc.repairUntil > this.clockHours())) return true;
      const ok = SB.DATA.CAR_ORDER.find((id) => { const c = this.save.cars[id]; return c.owned && !c.lost && !(c.repairUntil > this.clockHours()); });
      if (ok) { this.spawnPlayer(ok); return true; }
      return false;
    }
    clockHours() { return (this.save.day || 1) * 24 + (this.env ? this.env.time : 0); }
    pause() {
      if (this.state !== 'play') return;
      this.state = 'pause';
      this.audio.setGrind(0);
      this.audio.setTires(0);
      this.ui.pauseMenu();
      this.updateTouchVisibility();
    }
    resume() {
      if (this.state !== 'pause' && this.state !== 'map') return;
      this.state = 'play';
      this.ui.close();
      this.hud.openMap(false);
      this.updateTouchVisibility();
      this.last = performance.now();
    }
    toMenu() {
      this.persist();
      this.leaveMode();
      this.mode = new SB.Modes.FreeRoam(this);
      this.mode.setVisible(false);
      this.state = 'menu';
      this.ui.mainMenu();
      this.updateTouchVisibility();
    }
    teleportToPOI(id) {
      const p = this.world.pois.find((x) => x.id === id);
      if (!p) return;
      const v = this.player;
      v.place(p.x, p.z, p.heading);
      this.rewindBuf = [];
    }
    resetCar() {
      const v = this.player;
      if (v.exploded) return;
      const r = this.world.respawnPoint(v.pos.x, v.pos.z, v.yaw);
      v.place(r.x, r.z, r.heading);
      this.hud.toast(t('msg.reset'), 'info', 1.5);
    }
    prepareStart(running) {
      const dt = this.player.dt;
      dt.reset();
      if (running) { dt.running = true; dt.omegaE = dt.car.engine.idle * SB.RPM2W; }
      this.ignitionOn = running;
      this.player.input.handbrake = 0;
      this.rewindBuf = [];
      this.hud.tachBreak(false);
      this.explosion = null;
    }

    // ---------------------------------------------------------------- actions (keyboard/pad/touch)
    action(a, down) {
      const p = this.player;
      if (a === 'horn') { p.horn = down; return; }
      if (!down) return;
      switch (a) {
        case 'pause': if (this.state === 'play') this.pause(); else this.resume(); break;
        case 'camera': this.camMode = (this.camMode + 1) % this.camModes.length; this.hud.toast(t('cam.' + this.camModes[this.camMode]), 'info', 1); break;
        case 'lights': p.lightsMode = (p.lightsMode + 1) % 3; this.audio.click(); break;
        case 'indL': p.ind = p.ind === -1 ? 0 : -1; break;
        case 'indR': p.ind = p.ind === 1 ? 0 : 1; break;
        case 'hazard': p.ind = p.ind === 2 ? 0 : 2; break;
        case 'map': if (this.state === 'play') { this.state = 'map'; this.hud.openMap(true); } else if (this.state === 'map') this.resume(); break;
        case 'photo': this.togglePhoto(); break;
        case 'interact': this.interact(); break;
        case 'tow': this.ui.roadside(); break;
        case 'radio': { const order = ['off', 'kiyi', 'redline']; this.settings.radio = order[(order.indexOf(this.settings.radio) + 1) % 3]; this.audio.init(); this.audio.setRadio(this.settings.radio); this.hud.toast(t('radio.' + this.settings.radio), 'info', 1.6); this.saveSettings(); break; }
        case 'debug': this.debug = !this.debug; break;
        case 'console': this.ui.console(); break;
        case 'rewind': this.beginRewind(); break;
        default: break;
      }
    }
    interact() {
      const m = this.mode;
      if (m && m.kind === 'free' && m.poi) this.ui.poiMenu(m.poi);
      else if (this.player.flipped > 1 || this.player.up.y < 0.4) this.resetCar();
    }
    togglePhoto() {
      if (this.state === 'play') {
        this.state = 'photo';
        this.photo = { yaw: this.player.yaw + Math.PI, pitch: 0.25, dist: 7, target: this.player.pos.clone() };
        this.hideHud = true;
        this.ui.photoBar(true);
      } else if (this.state === 'photo') {
        this.state = 'play';
        this.hideHud = false;
        this.ui.photoBar(false);
        this.last = performance.now();
      }
      this.updateTouchVisibility();
    }

    // ---------------------------------------------------------------- explosion
    setTimeScale(k) { this.timeScale = k; }
    setCinematic(on) { this.cinematic = on; if (on) this.cineA = this.player.yaw + 2.2; }
    camShake(a) { this.shake = Math.min(2.5, this.shake + a * this.settings.shake); }
    rumble(s, d) { this.input && this.input.rumble(s, d); }
    onExplosionResult(info) {
      this.save.stats.explosions++;
      this.achieve('vitesKirici');
      this.persist();
      this.lastExplosion = info;
      this.ui.explosionResult(info);
    }
    // after the result screen: consequences by difficulty
    explosionAftermath() {
      const s = this.settings, id = this.save.current, sc = this.save.cars[id], E = SB.DATA.ECONOMY;
      const inRace = this.mode && (this.mode.kind === 'race' || this.mode.kind === 'drag');
      if (inRace) { this.mode.finish && this.mode.finish(true); return; }
      const val = this.carValue(id);
      const fullRepair = () => { this.spawnPlayer(id, this.world.respawnPoint(this.player.pos.x, this.player.pos.z, this.player.yaw)); this.hud.tachBreak(false); };
      if (s.difficulty === 'arcade') {
        this.hud.big(t('boom.respawn'), '', 2);
        setTimeout(() => { fullRepair(); this.state = 'play'; this.ui.close(); }, 600);
      } else if (s.difficulty === 'normal') {
        const cost = Math.round(val * (sc.insured ? E.repairExplodeInsuredPct : E.repairExplodePct)) + E.towFee;
        this.save.credits -= cost;
        sc.repairUntil = this.clockHours() + E.repairHoursExplode;
        this.hud.toast(t('boom.towed', { n: U.fmtInt(cost) }), 'bad', 4);
        this.spawnPlayer(id, this.poiPose('garage'));
        this.persist();
        this.ui.garage(true);
      } else {
        if (sc.insured) {
          sc.premium = Math.round((sc.premium || val * E.insurePct) * E.premiumGrowth);
          this.hud.toast(t('boom.insured', { n: U.fmtInt(sc.premium) }), 'warn', 4);
          sc.repairUntil = this.clockHours() + E.repairHoursExplode;
          this.spawnPlayer(id, this.poiPose('garage'));
        } else {
          sc.lost = true;
          sc.owned = false;
          this.hud.big(t('boom.lost'), SB.DATA.CARS[id].name, 4, 'bad');
          const other = SB.DATA.CAR_ORDER.find((c) => this.save.cars[c].owned && !this.save.cars[c].lost);
          if (!other) { this.save.cars.lodos = Object.assign(this.save.cars.lodos, { owned: true, lost: false, upgrades: [], damage: { engine: 0.7, gearbox: 0.8, clutch: 0.6, radiator: 0.9 } }); this.hud.toast(t('boom.charity'), 'info', 5); }
          this.spawnPlayer(other || 'lodos', this.poiPose('garage'));
        }
        this.persist();
        this.ui.garage(true);
      }
    }
    poiPose(id) { const p = this.world.pois.find((x) => x.id === id); return { x: p.x, z: p.z, heading: p.heading }; }

    // ---------------------------------------------------------------- rewind / replay
    record() {
      const p = this.player;
      this.rewindBuf.push({ t: this.time, s: p.snapshot(), ex: p.exploded, mode: this.mode && this.mode.snapshot ? this.mode.snapshot() : null, race: this.raceSnapshot() });
      if (this.rewindBuf.length > 30 * 10) this.rewindBuf.shift();
    }
    raceSnapshot() {
      const m = this.mode;
      if (!m || m.kind !== 'race') return null;
      return { t: m.t, cpi: m.cpi, lap: m.lap, pS: m.pS, pLap: m.pLap, pHint: m.pHint, rivals: m.rivals.map((r) => [r.s, r.v, r.lap, r.gear, r.lat, r.finished]) };
    }
    raceRestore(rs) {
      const m = this.mode;
      if (!m || m.kind !== 'race' || !rs) return;
      Object.assign(m, { t: rs.t, cpi: rs.cpi, lap: rs.lap, pS: rs.pS, pLap: rs.pLap, pHint: rs.pHint });
      rs.rivals.forEach((a, i) => { const r = m.rivals[i]; if (!r) return; [r.s, r.v, r.lap, r.gear, r.lat, r.finished] = a; r.latT = r.lat; r.place(); });
      m.updateGates();
    }
    beginRewind() {
      if (this.state !== 'play' || this.rewinding) return;
      const m = this.mode;
      let allow = this.settings.difficulty === 'hardcore' ? 0 : Infinity;
      if (m && (m.kind === 'race' || m.kind === 'drag')) allow = m.rewinds;
      if (this.player.exploded && !this.settings.explosionRewind) { this.hud.toast(t('rewind.noBoom'), 'warn', 2); return; }
      if (!(allow > 0) || this.rewindBuf.length < 10) { this.hud.toast(t('rewind.none'), 'warn', 1.6); return; }
      if (m && isFinite(m.rewinds)) m.rewinds--;
      this.rewinding = true;
      this.rewindIdx = this.rewindBuf.length - 1;
      document.getElementById('rewindFx').hidden = false;
    }
    updateRewind(rdt) {
      if (!this.input.rewindHeld || this.rewindIdx <= 0) {
        // resume from the current frame
        this.rewinding = false;
        this.rewindBuf.length = this.rewindIdx + 1;
        document.getElementById('rewindFx').hidden = true;
        this.last = performance.now();
        return;
      }
      this.rewindIdx = Math.max(0, this.rewindIdx - Math.max(1, Math.round(rdt * 30 * 1.4)));
      const f = this.rewindBuf[this.rewindIdx];
      const p = this.player;
      const wasExploded = p.exploded;
      p.restore(f.s);
      if (wasExploded && !f.s.dt.exploded) {
        if (this.explosion) { this.explosion.stop(); this.explosion = null; }
        p.restoreVisuals();
        this.fx.clearDebris();
        this.fx.fire.clear();
        this.hud.tachBreak(false);
        this.setTimeScale(1);
        this.setCinematic(false);
        this.ui.close();
        this.state = 'play';
      }
      this.raceRestore(f.race);
      p.syncVisual(rdt, this.time);
    }
    startReplay() {
      const buf = this.rewindBuf;
      const ei = buf.findIndex((f) => f.ex);
      if (ei < 0) return;
      this.replay = { frames: buf.slice(Math.max(0, ei - 60)), i: 0, exAt: Math.min(60, ei), boom: null, k: 0 };
      this.player.restoreVisuals();
      this.fx.clearDebris();
      this.state = 'replay';
      this.ui.close();
      this.hideHud = true;
      this.setCinematic(true);
      this.cineA = this.player.yaw + 1.6;
    }
    updateReplay(rdt) {
      const R = this.replay;
      R.k += rdt * 30 * (R.boom && R.boom.t > 0.6 && R.boom.t < 2.4 ? 0.3 : 0.6);
      const i = Math.floor(R.k);
      if (i >= R.frames.length - 1) {
        this.state = 'result';
        this.hideHud = false;
        if (R.boom) R.boom.stop();
        this.replay = null;
        this.player.restore(this.rewindBuf[this.rewindBuf.length - 1].s);
        this.ui.explosionResult(this.lastExplosion);
        return;
      }
      const f = R.frames[i];
      this.player.restore(f.s);
      this.player.syncVisual(rdt, this.time);
      if (i >= R.exAt && !R.boom) R.boom = new SB.Explosion(this, this.player, this.lastExplosion, true);
      if (R.boom) R.boom.update(rdt, rdt);
      this.fx.update(rdt);
    }

    // ---------------------------------------------------------------- per-step & per-frame
    controls() {
      const p = this.player, st = this.input.state, s = this.settings;
      const inp = p.input;
      if (p.exploded) { inp.throttle = 0; inp.brake = 0; inp.steer = st.steer; inp.handbrake = 0; inp.clutch = 0; return; }
      inp.steer = st.steer;
      inp.throttle = st.throttle;
      inp.brake = st.brake;
      inp.handbrake = st.handbrake;
      inp.clutch = st.clutch;
      // automatic gearbox (race lobby): brake reverses at a standstill, pedals swap while in R
      if (p.dt.opts.autoShift && p.dt.state === 'ENG' && p.dt.gear === -1) { inp.throttle = st.brake; inp.brake = st.throttle; }
      if (this.lockPlayer === 'hold') { inp.handbrake = 1; }
      // a parked car keeps its parking brake on until the engine has been started
      if (!this.ignitionOn && !p.dt.running && !p.dt.cranking && st.throttle < 0.05 && Math.abs(p.speed) < 0.5) inp.handbrake = Math.max(inp.handbrake, 1);
      p.dt.input.ignition = !!this.input.ignitionHeld;
      if (this.input.ignitionHeld && !p.dt.running) this.ignitionOn = true;
      void s;
    }
    physicsStep(h) {
      const p = this.player;
      this.controls();
      p.step(h, this.envState);
      // moving obstacles: traffic, police, rivals
      for (const o of this.traffic.nearby(p.pos, 12)) {
        const r = this.traffic.rectOf(o);
        if (p.collideDynamic(r)) this.traffic.hit(o, r);
      }
      const m = this.mode;
      if (m && m.rivals) for (const rv of m.rivals) {
        if (rv.eliminated) continue;
        if ((rv.x - p.pos.x) ** 2 + (rv.z - p.pos.z) ** 2 > 100) continue;
        const r = rv.rect();
        if (p.collideDynamic(r)) rv.bump(r);
      }
    }
    frame(ts) {
      requestAnimationFrame((x) => this.frame(x));
      let rdt = (ts - this.last) / 1000;
      this.last = ts;
      if (!(rdt > 0)) rdt = 0.016;
      rdt = Math.min(rdt, 0.1);
      if (this.settings.fpsCap && rdt < 1 / this.settings.fpsCap - 0.002) { this.last -= rdt * 1000; return; }
      this.fps = U.lerp(this.fps, 1 / rdt, 0.05);
      this.input.update(rdt);
      const p = this.player;
      this.envState = { grip: this.env.grip, wet: this.env.wet, aquaplane: this.env.aquaplane, wind: this.env.wind };
      if (this.state === 'play') {
        if (this.rewinding) this.updateRewind(rdt);
        else {
          const hz = this.quality === 'low' ? SB.DATA.RULES.physicsHzLow : SB.DATA.RULES.physicsHz;
          this.physHz = hz;
          const h = 1 / hz;
          this.acc += rdt * this.timeScale;
          let n = 0;
          const maxSteps = Math.ceil(hz * 0.1);
          while (this.acc >= h && n < maxSteps) { this.physicsStep(h); this.acc -= h; n++; }
          if (n >= maxSteps) this.acc = 0;
          const gdt = rdt * this.timeScale;
          this.frameDt = gdt;
          this.time += gdt;
          this.handleEvents();
          this.traffic.update(gdt, p);
          if (this.mode && this.mode.update) this.mode.update(gdt);
          this.police.update(gdt);
          if (this.mode && this.mode.kind === 'free' && !p.exploded) this.skills.update(gdt);
          if (this.explosion) this.explosion.update(rdt, gdt);
          this.fx.carEffects(p, gdt);
          this.fx.update(gdt);
          this.tickClock(gdt);
          this.recordT = (this.recordT || 0) + gdt;
          if (this.recordT >= 1 / 30) { this.recordT = 0; this.record(); }
          this.save.stats.km += Math.abs(p.speed) * gdt / 1000;
          if (p.submerged > 2) this.onWater();
          this.reverseAids();
          this.coach(gdt);
        }
      } else if (this.state === 'replay') this.updateReplay(rdt);
      else if (this.state === 'menu') {
        this.time += rdt;
        this.hud.root.classList.add('hidden');
        this.traffic.update(rdt, { pos: this.camera.position, vel: new T.Vector3(), carRect: () => ({ x: 1e5, z: 1e5, hl: 1, hw: 1, ang: 0 }), bodyBox: { hl: 1 }, fwd: new T.Vector3(0, 0, 1) });
      } else if (this.state === 'result') {
        if (this.explosion) this.explosion.update(rdt, rdt);
        this.fx.update(rdt);
      }
      if (this.state !== 'replay') p.syncVisual(rdt, this.time);
      this.world.update(this.state === 'pause' ? 0 : rdt * (this.state === 'play' ? this.timeScale : 1), this.env);
      this.updateCamera(rdt);
      this.world.cullChunks(this.camera.position);
      this.env.update(this.state === 'pause' ? 0 : rdt * this.timeScale, this.camera.position, this.state === 'menu' ? this.camera.position : p.pos);
      this.updateAudio(rdt);
      this.render();
      if (this.state === 'play' || this.state === 'result' || this.state === 'map' || this.state === 'pause') this.hud.update(rdt);
      this.input.updateTouchWidget();
    }
    // pulling-away coach: when the throttle can't move the car, say why
    coachHint(key) {
      const d = this.player.dt, touch = this.input.device === 'touch';
      const seq = this.settings.shifter === 'SEQ' || d.dogBox() || this.input.device === 'gamepad';
      if (key === 'neutral' || key === 'started') key = seq ? 'neutralSeq' : d.opts.autoClutch ? 'neutral' : 'neutralClutch';
      const vars = { ign: this.keyLabel('ignition'), clutch: this.keyLabel('clutch'), hand: this.keyLabel('handbrake'), up: this.keyLabel('shiftUp'), g1: this.keyLabel('g1') };
      return t('coach.' + key + (touch ? '.touch' : ''), vars);
    }
    coach(dt) {
      const p = this.player, d = p.dt, st = this.input.state;
      if (this.startHintT != null && (this.startHintT -= dt) <= 0) {
        this.startHintT = null;
        if (d.running && d.state === 'N' && Math.abs(p.speed) < 1) { this.hud.big(t('coach.started.t'), this.coachHint('started'), 4); this.coachShown = true; }
      }
      // race start: still in neutral a moment after the lights went green
      if (this.goHintT != null && (this.goHintT -= dt) <= 0) {
        this.goHintT = null;
        if (d.running && d.state === 'N' && Math.abs(p.speed) < 1 && !d.opts.autoShift) { this.hud.big(t('coach.neutral.t'), this.coachHint('neutral'), 3, 'warn'); this.coachShown = true; this.coachCd = 3; }
      }
      // the hint goes away as soon as the car pulls away
      if (this.coachShown && Math.abs(p.speed) > 1.5) { this.coachShown = false; this.hud.clearBig(); }
      this.coachCd = Math.max(0, (this.coachCd || 0) - dt);
      const stuck = st.throttle > 0.3 && Math.abs(p.speed) < 1 && !p.exploded && !d.seized && !this.lockPlayer && !this.cinematic;
      this.coachT = stuck ? (this.coachT || 0) + dt : 0;
      if (this.coachT < 0.6 || this.coachCd > 0) return;
      let key = null;
      if (!d.running && !d.cranking) key = 'engineOff';
      else if (!d.running) return;
      else if (d.state === 'N' || d.state === 'GRIND') key = 'neutral';
      else if (d.state === 'ENG' && !d.opts.autoClutch && d.clutchPedal > 0.8) key = 'clutchDown';
      else if (st.handbrake > 0.5) key = 'handbrake';
      if (!key) return;
      this.hud.big(t('coach.' + key + '.t'), this.coachHint(key), 3, 'warn');
      this.coachShown = true;
      this.coachCd = 4.5;
      this.coachT = 0;
    }
    tickClock(gdt) {
      if (this._lastClock != null && this.env.time < this._lastClock - 12) this.save.day = (this.save.day || 1) + 1;
      this._lastClock = this.env.time;
      this.autosaveT = (this.autosaveT || 0) + gdt;
      if (this.autosaveT > 20) { this.autosaveT = 0; this.persist(); }
    }
    onWater() {
      const p = this.player;
      if (this._waterT) return;
      this._waterT = true;
      this.fx.splash(p.pos);
      this.audio.burst(500, 0.6, 0.8, 0.8, 'lowpass');
      this.hud.big(t('msg.water'), t('msg.waterSub'), 2.5, 'bad');
      setTimeout(() => {
        this._waterT = false;
        const r = this.world.respawnPoint(this.world.edges[0].pts[0], 0, 0);
        const near = this.world.respawnPoint(p.pos.x < 500 ? 330 : 670, p.pos.z, p.yaw);
        void r;
        if (this.settings.damage === 'full') p.dt.health.engine = Math.max(0.05, p.dt.health.engine - 0.3);
        p.dt.stall('water');
        p.place(near.x, near.z, near.heading);
        if (this.settings.difficulty !== 'arcade') this.addCredits(-SB.DATA.ECONOMY.towFee);
      }, 2200);
    }
    // reverse light → parking sensor beeps and the reverse camera inset
    reverseAids() {
      const p = this.player;
      const inR = p.dt.state === 'ENG' && p.dt.gear === -1 && !p.exploded;
      this.showRevCam = inR && !this.cinematic;
      this.showMirror = this.quality !== 'low' && (this.camModes[this.camMode] === 'cockpit' || this.camModes[this.camMode] === 'hood') && !this.cinematic;
      if (!inR) { this.sensorDist = null; return; }
      // nearest obstacle behind the car
      const rect = p.carRect();
      const bx = rect.x - p.fwd.x * rect.hl, bz = rect.z - p.fwd.z * rect.hl;
      let best = 9;
      const probe = (cx, cz, r) => {
        const dx = cx - bx, dz = cz - bz;
        const back = -(dx * p.fwd.x + dz * p.fwd.z);
        const side = Math.abs(dx * p.left.x + dz * p.left.z);
        if (back > -0.5 && back < 3 && side < rect.hw + 0.6) best = Math.min(best, Math.max(0, back - r));
      };
      this.world.query(bx, bz, 5, (c) => {
        if (!c.solid) return;
        if (c.type === 'circle') probe(c.x, c.z, c.r);
        else {
          // sample the box's nearest point
          const q = SB.U.circleRect(bx, bz, 3.2, c);
          if (q) probe(q.px, q.pz, 0);
        }
      });
      for (const o of this.traffic.nearby(p.pos, 8)) probe(o.x - o.tx * o.len / 2, o.z - o.tz * o.len / 2, 0);
      this.sensorDist = best < 3 ? best : null;
      if (this.sensorDist != null) this.audio.parkBeep(this.sensorDist);
      const el = document.getElementById('sensor');
      el.hidden = this.sensorDist == null;
      if (this.sensorDist != null) el.dataset.level = this.sensorDist < 0.4 ? 3 : this.sensorDist < 1.0 ? 2 : 1;
    }

    handleEvents() {
      const p = this.player, A = this.audio, hud = this.hud, m = this.mode;
      const evs = p.dt.drainEvents();
      p._evIdx = 0;
      for (const e of evs) {
        if (m && m.onEvent) m.onEvent(e);
        switch (e.type) {
          case 'start':
            A.catchStart();
            this.ignitionOn = true;
            this.save.stats.starts++;
            // next step after the first start of the session (after the achievement banner, if one shows)
            if (!this.startHintShown && !this.lockPlayer) { this.startHintShown = true; this.startHintT = this.save.achievements.firstStart ? 0.4 : 3; }
            this.achieve('firstStart');
            break;
          case 'off': this.ignitionOn = false; hud.toast(t('msg.engineOff'), 'info', 1.4); break;
          case 'stall':
            A.cough();
            this.camShake(0.35);
            this.rumble(0.6, 0.25);
            this.save.stats.stalls++;
            hud.big(t('msg.stall'), t('msg.stall.' + e.reason, { key: this.keyLabel('ignition'), clutch: this.keyLabel('clutch') }), 2.6, 'warn');
            this.achieve('firstStall');
            this.skills.lose();
            break;
          case 'grind':
            this.rumble(0.5, 0.35);
            this.camShake(0.12);
            hud.toast(t('grind.' + (e.kind || 'noclutch'), { clutch: this.keyLabel('clutch') }), 'bad', 1.8);
            this.skills.lose();
            break;
          case 'engage': A.shiftClick(e.clutchless ? 1.3 : 1); if (m && m.onShift) m.onShift(e); break;
          case 'clutchless': this.skills.add('clutchless', 300); hud.toast(t('skill.clutchless'), 'good', 1.2); this.achieve('clutchless'); break;
          case 'perfectShift':
            this.skills.add('perfect', 250);
            hud.toast(t('msg.perfect'), 'good', 1.1);
            this.save.stats.perfect++;
            if (this.save.stats.perfect >= 10) this.achieve('perfect10');
            if (m && m.onPerfect) m.onPerfect();
            break;
          case 'revMatch': this.skills.add('revMatch', 300); hud.toast(t('skill.revMatch'), 'good', 1.1); break;
          case 'shiftBlocked': hud.toast(t('msg.blocked', { clutch: this.keyLabel('clutch') }), 'warn', 2); break;
          case 'clank': A.clank(0.8); this.camShake(0.8); this.rumble(1, 0.4); hud.toast(t('msg.clank'), 'bad', 2.5); break;
          case 'gearboxBreak':
            A.clank(1.3); A.grindBurst(); this.camShake(1.2); this.rumble(1, 0.7);
            this.fx.sparkBurst(p.pos.clone().addScaledVector(p.up, -0.4), 60, 5);
            hud.big(t('msg.gearboxBreak'), t('msg.gearboxBreakSub'), 3, 'bad');
            break;
          case 'gearBroken': hud.toast(t('msg.gearBroken', { g: e.gear === -1 ? 'R' : e.gear }), 'bad', 2); break;
          case 'explode':
            this.explosion = new SB.Explosion(this, p, e, false);
            this.ignitionOn = false;
            break;
          case 'valveFloat': if (!e.continuous) { A.valveFloat(); hud.toast(t('msg.valveFloat', { r: Math.round(e.rpm) }), 'warn', 2.2); } break;
          case 'engineDamage': A.clank(0.5); A.valveFloat(); this.camShake(0.5); hud.big(t('msg.engineDamage'), t('msg.overRev', { r: Math.round(e.rpm) }), 2.6, 'bad'); break;
          case 'seize': A.clank(1); this.camShake(1); this.rumble(1, 0.6); hud.big(t('msg.seize'), t('msg.seizeSub', { key: this.keyLabel('tow'), r: Math.round(e.rpm) }), 4, 'bad'); break;
          case 'blowoff': A.blowoff(); break;
          case 'backfire': A.backfire(e.small ? 0.35 : 0.7); this.fx.backfire(p, !!e.small); break;
          case 'misfire': A.backfire(0.25); break;
          case 'lug': this.camShake(0.06); if (!this._lugTip || this.time - this._lugTip > 12) { this._lugTip = this.time; hud.toast(t('msg.lug'), 'warn', 1.8); } break;
          case 'clutchHot': hud.toast(t('msg.clutchHot'), 'warn', 2.2); break;
          case 'clutchBurn': hud.toast(t('msg.clutchBurn'), 'bad', 2.5); break;
          case 'overheat': hud.toast(t('msg.overheat'), 'bad', 2.5); break;
          case 'noFuel': hud.big(t('msg.noFuel'), t('msg.noFuelSub', { key: this.keyLabel('tow') }), 3, 'bad'); break;
          case 'antiStall': this.camShake(0.15); break;
          case 'rLocked': hud.toast(t('msg.rLocked'), 'warn', 1.6); break;
          case 'jolt': this.camShake(0.4 * (e.strength || 0.5)); break;
          case 'crank': break;
          default: break;
        }
      }
      for (const e of p.events) {
        if (e.type === 'impact') {
          const k = U.clamp(e.speed / 14, 0, 1);
          A.thud(k);
          this.camShake(k * 0.7);
          this.rumble(k, 0.2);
          if (e.speed > 3) this.fx.sparkBurst(e.p, Math.round(8 + k * 30), 3 + k * 5, e.n.x, e.n.z);
          if (e.speed > 9) A.glass();
          if (e.speed > 2.5) this.skills.lose();
          const par = e.other && e.other.parked;
          if (par && !this.alarmed.has(par)) { this.alarmed.add(par); A.alarm(par); this.traffic.alarmsT.push({ p: par, t: 7 }); this.traffic.nudgeParked(par, -e.n.x * Math.min(0.4, e.speed * 0.03), -e.n.z * Math.min(0.4, e.speed * 0.03)); }
          if (m && m.onImpact) m.onImpact(e);
        } else if (e.type === 'scrape') A.scrape(e.speed / 8);
        else if (e.type === 'cone') {
          const c = e.c;
          if (!c._hitT || this.time - c._hitT > 2) { c._hitT = this.time; A.thud(0.15); if (m && m.onCone) m.onCone(); }
        }
      }
      p.events.length = 0;
    }

    // ---------------------------------------------------------------- audio mix
    updateAudio() {
      const A = this.audio;
      if (!A.ready) return;
      const p = this.player, dt = p.dt;
      const live = this.state === 'play' || this.state === 'result' || this.state === 'replay';
      if (!live) { A.setEngine({ rpm: 0, load: 0, running: false, cranking: false, cyl: 4 }); A.setGrind(0); A.setTires(0); A.setWorld({ speed: 0, rain: this.env.rainLevel || 0, city: 0.4 }); return; }
      A.setEngine({ rpm: dt.rpm(), load: dt.running ? dt.thrEff : 0, running: dt.running, cranking: dt.cranking, cyl: p.car.engine.cylinders, fuelCut: dt.fuelCut, lug: dt.lugging, misfire: dt.misfireT > 0, boost: p.car.engine.turbo ? dt.boost : 0, whine: p.car.straightCut ? Math.abs(p.speed) : 0, redline: dt.redline() });
      A.setGrind(dt.state === 'GRIND' ? (dt.grindKind === 'fast' ? 1 : 0.75) : 0);
      let skid = 0, rumble = 0;
      for (const w of p.wheels) {
        if (!w.contact) continue;
        skid = Math.max(skid, w.skid);
        const S = SB.DATA.SURFACES[w.surf];
        rumble = Math.max(rumble, S ? S.rumble : 0);
      }
      A.setTires(this.rewinding ? 0 : skid, p.speed);
      const nearCoast = p.pos.x > 300 && p.pos.x < 700;
      if (nearCoast && Math.random() < 0.002) A.seagull();
      A.setWorld({ speed: Math.abs(p.speed), rumble, rain: this.env.rainLevel || 0, city: this.world.zoneAt(p.pos.x, p.pos.z) === 'business' ? 1 : 0.5, horn: p.horn, siren: this.sirenLevel });
      p.wipersOn = (this.env.rainLevel || 0) > 0.05 || (this.env.W().snow > 0.1);
    }

    // ---------------------------------------------------------------- camera
    updateCamera(rdt) {
      const cam = this.camera, p = this.player;
      if (!p) return;
      const look = this.input.state;
      this.shake = Math.max(0, this.shake - rdt * 2.2);
      const sh = this.shake * this.shake * 0.12;
      const shx = (Math.random() - 0.5) * sh, shy = (Math.random() - 0.5) * sh;
      p.visual.interior.visible = false;
      if (this.state === 'menu') {
        const a = this.time * 0.035;
        cam.position.set(500 + Math.cos(a) * 260, 60 + Math.sin(a * 0.7) * 15, Math.sin(a) * 260);
        cam.lookAt(500, 15, 0);
        cam.fov = 55;
        cam.updateProjectionMatrix();
        return;
      }
      if (this.state === 'photo') {
        const ph = this.photo;
        const k = this.input;
        const rot = (k.held('left') ? 1 : 0) - (k.held('right') ? 1 : 0);
        const tilt = (k.held('throttle') ? 1 : 0) - (k.held('brake') ? 1 : 0);
        ph.yaw += rot * rdt * 1.2 + (k.mouse.dragging ? 0 : 0);
        ph.pitch = U.clamp(ph.pitch + tilt * rdt * 0.6, -0.1, 1.4);
        ph.yaw += k.mouse.lookX * 0.02;
        const x = ph.target.x + Math.sin(ph.yaw) * Math.cos(ph.pitch) * ph.dist;
        const z = ph.target.z + Math.cos(ph.yaw) * Math.cos(ph.pitch) * ph.dist;
        const y = Math.max(this.world.heightAt(x, z) + 0.4, ph.target.y + Math.sin(ph.pitch) * ph.dist);
        cam.position.set(x, y, z);
        cam.lookAt(ph.target.x, ph.target.y + 0.4, ph.target.z);
        return;
      }
      if (this.cinematic || this.state === 'replay') {
        this.cineA = (this.cineA || 0) + rdt * 0.35;
        const d = 10, hgt = 3.2;
        const tx = p.pos.x, tz = p.pos.z, ty = Math.max(p.pos.y, this.world.heightAt(tx, tz) + 0.5);
        const x = tx + Math.sin(this.cineA) * d, z = tz + Math.cos(this.cineA) * d;
        const y = Math.max(this.world.heightAt(x, z) + 1, ty + hgt);
        cam.position.lerp(new T.Vector3(x, y, z), 1 - Math.exp(-rdt * 4));
        cam.position.x += shx; cam.position.y += shy;
        cam.lookAt(tx, ty + 0.6, tz);
        cam.fov = U.damp(cam.fov, 50, 3, rdt);
        cam.updateProjectionMatrix();
        return;
      }
      const mode = this.camModes[this.camMode];
      const sp = Math.abs(p.speed);
      if (p.teleported) { p.teleported = false; this.camYaw = p.yaw; this.camPos = null; }
      if (mode === 'chase' || mode === 'far') {
        const dist = mode === 'far' ? 9.5 : 6.2, hgt = mode === 'far' ? 3.0 : 2.0;
        // heading follows the car's yaw (smoothed), not its pitch/roll
        const yawT = p.yaw + look.lookX;
        if (this.camYaw == null) this.camYaw = yawT;
        this.camYaw += U.angleWrap(yawT - this.camYaw) * (1 - Math.exp(-rdt * (this.input.mouse.dragging ? 14 : 5)));
        const cy = this.camYaw;
        const tx = p.pos.x - Math.sin(cy) * dist, tz = p.pos.z - Math.cos(cy) * dist;
        let ty = p.pos.y + hgt + look.lookY * 2;
        ty = Math.max(ty, this.world.heightAt(tx, tz) + 0.8);
        if (!this.camPos) this.camPos = new T.Vector3(tx, ty, tz);
        const k = 1 - Math.exp(-rdt * 9);
        this.camPos.x = U.lerp(this.camPos.x, tx, k);
        this.camPos.z = U.lerp(this.camPos.z, tz, k);
        this.camPos.y = U.lerp(this.camPos.y, ty, 1 - Math.exp(-rdt * 5));
        cam.position.copy(this.camPos);
        cam.position.x += shx; cam.position.y += shy;
        cam.up.set(0, 1, 0);
        cam.lookAt(p.pos.x + Math.sin(cy) * 2.5, p.pos.y + 0.9, p.pos.z + Math.cos(cy) * 2.5);
        cam.fov = U.damp(cam.fov, 60 + Math.min(16, sp * 0.3), 3, rdt);
      } else {
        const v = p.visual;
        const eye = mode === 'hood' ? v.hoodEye : mode === 'bumper' ? v.bumperEye : v.cockpitEye;
        if (mode === 'cockpit' && !v.glb) v.interior.visible = true;
        cam.position.copy(eye).applyQuaternion(p.quat).add(p.pos);
        cam.position.x += shx * 0.4; cam.position.y += shy * 0.4;
        const q = new T.Quaternion().setFromEuler(new T.Euler(-look.lookY * 0.6 - 0.04, Math.PI + look.lookX, 0, 'YXZ'));
        cam.quaternion.copy(p.quat).multiply(q);
        cam.fov = U.damp(cam.fov, mode === 'cockpit' ? 70 : 66, 4, rdt);
        this.camPos = null;
      }
      cam.updateProjectionMatrix();
      this.camYaw = mode === 'chase' || mode === 'far' ? this.camYaw : p.yaw;
    }

    render() {
      const R = this.renderer, cam = this.camera;
      const w = window.innerWidth, h = window.innerHeight;
      R.setScissorTest(false);
      R.setViewport(0, 0, w, h);
      R.render(this.scene, cam);
      const p = this.player;
      // inset views: reverse camera (R engaged) and rear-view mirror (cockpit/hood)
      if ((this.showRevCam || this.showMirror) && this.state === 'play') {
        R.autoClear = false;
        R.setScissorTest(true);
        if (this.showRevCam) {
          const el = document.getElementById('revcam').getBoundingClientRect();
          const rc = this.revCam;
          rc.aspect = el.width / el.height;
          rc.updateProjectionMatrix();
          const back = new T.Vector3(0, 0.25, -p.bodyBox.hl + p.zShift).applyQuaternion(p.quat).add(p.pos);
          rc.position.copy(back);
          const tgt = new T.Vector3(0, -0.6, -p.bodyBox.hl - 5 + p.zShift).applyQuaternion(p.quat).add(p.pos);
          rc.up.copy(p.up);
          rc.lookAt(tgt);
          R.setViewport(el.left, h - el.bottom, el.width, el.height);
          R.setScissor(el.left, h - el.bottom, el.width, el.height);
          R.clearDepth();
          R.render(this.scene, rc);
        }
        if (this.showMirror) {
          const el = document.getElementById('mirror').getBoundingClientRect();
          const mc = this.mirrorCam;
          mc.aspect = el.width / el.height;
          mc.updateProjectionMatrix();
          mc.position.copy(new T.Vector3(0, p.bodyBox.y1 + 0.15, p.zShift).applyQuaternion(p.quat).add(p.pos));
          mc.up.copy(p.up);
          mc.lookAt(new T.Vector3(0, p.bodyBox.y1 - 0.2, -30).applyQuaternion(p.quat).add(p.pos));
          R.setViewport(el.left, h - el.bottom, el.width, el.height);
          R.setScissor(el.left, h - el.bottom, el.width, el.height);
          R.clearDepth();
          R.render(this.scene, mc);
        }
        R.setScissorTest(false);
        R.autoClear = true;
      }
    }

    // ---------------------------------------------------------------- photo
    takePhoto() {
      this.render();
      try {
        const url = this.renderer.domElement.toDataURL('image/jpeg', 0.92);
        this.ui.showPhoto(url);
      } catch (e) { this.hud.toast(t('photo.fail'), 'bad', 2); }
    }
  }

  SB.Game = Game;
  window.addEventListener('DOMContentLoaded', () => {
    const go = () => {
      const g = (SB.game = new Game());
      g.boot().catch((e) => {
        const el = document.getElementById('loadmsg');
        if (el) el.textContent = 'Error: ' + (e && e.message ? e.message : e);
        console.error(e);
      });
    };
    if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(go); else go();
  });
})();
