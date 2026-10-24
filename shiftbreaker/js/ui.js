// SHIFTBREAKER — menus & screens: main menu, settings (all live), controls, garage, gallery, tuning,
// race lobby, POI services, results, explosion report, console, photo mode.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const t = (k, p) => SB.i18n.t(k, p);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const KEYNAMES = { Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', AltLeft: 'L-Alt', AltRight: 'R-Alt', ControlLeft: 'L-Ctrl', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'Backspace', Escape: 'Esc', Backquote: '`', Enter: 'Enter', Tab: 'Tab' };

  class UI {
    constructor(game) {
      this.game = game;
      this.root = $('ui');
      this.current = null;
    }
    static keyName(code) {
      if (KEYNAMES[code]) return KEYNAMES[code];
      if (/^Key/.test(code)) return code.slice(3);
      if (/^Digit/.test(code)) return code.slice(5);
      return code;
    }
    // ------------------------------------------------------------ helpers
    el(tag, cls, html) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html != null) e.innerHTML = html;
      return e;
    }
    btn(label, fn, cls) {
      const b = this.el('button', 'btn ' + (cls || ''));
      b.type = 'button';
      b.innerHTML = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.game.audio.init(); this.game.audio.click(); fn(); });
      return b;
    }
    open(node, cls, rerender) {
      this.root.innerHTML = '';
      this.root.className = 'ui ' + (cls || '');
      this.root.appendChild(node);
      this.root.hidden = false;
      this.current = rerender || null;
      this.game.updateTouchVisibility();
    }
    close() {
      this.root.hidden = true;
      this.root.innerHTML = '';
      this.current = null;
      this.game.updateTouchVisibility();
    }
    refreshTexts() {
      if (this.current) this.current();
      document.querySelectorAll('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n)));
    }
    panel(title, sub) {
      const p = this.el('div', 'panel');
      const h = this.el('div', 'panel-head');
      h.appendChild(this.el('h2', '', esc(title)));
      if (sub) h.appendChild(this.el('p', 'sub', sub));
      p.appendChild(h);
      const body = this.el('div', 'panel-body');
      p.appendChild(body);
      const foot = this.el('div', 'panel-foot');
      p.appendChild(foot);
      return { p, body, foot };
    }

    // ------------------------------------------------------------ main menu
    mainMenu() {
      const g = this.game;
      const wrap = this.el('div', 'menu');
      const left = this.el('div', 'menu-left');
      left.innerHTML = `<div class="logo"><svg viewBox="0 0 240 120" aria-hidden="true"><g stroke="currentColor" stroke-width="7" stroke-linecap="round" fill="none"><path d="M40 60H200M40 20V60M90 20V100M150 20V100M200 20V100"/></g><path d="M206 100 C 236 100 236 8 96 8" stroke="#e5482d" stroke-width="5" stroke-dasharray="9 7" fill="none"/><path d="M90 0 L100 16 L80 16 Z" fill="#e5482d"/><g font-family="Chakra Petch" font-weight="700" font-size="20" text-anchor="middle" fill="currentColor"><text x="40" y="14">R</text><text x="90" y="14">1</text><text x="150" y="14">3</text><text x="200" y="14">5</text><text x="90" y="118">2</text><text x="150" y="118">4</text><text x="200" y="118" fill="#e5482d">6</text></g></svg></div>
        <h1 class="title">SHIFTBREAKER</h1><div class="tagline">${esc(t('menu.tagline'))}</div>`;
      const list = this.el('div', 'menu-list');
      const item = (k, fn, cls) => { const b = this.btn(`<span>${esc(t(k))}</span><small>${esc(t(k + '.d'))}</small>`, fn, 'menu-item ' + (cls || '')); list.appendChild(b); };
      item('menu.free', () => g.startFree(), 'primary');
      item('menu.race', () => this.raceLobby());
      item('menu.license', () => g.startLicense());
      item('menu.garage', () => this.garage());
      item('menu.settings', () => this.settings());
      item('menu.ach', () => this.achievements());
      left.appendChild(list);
      const foot = this.el('div', 'menu-foot');
      const lang = this.el('div', 'seg');
      for (const l of ['tr', 'en']) {
        const b = this.btn(l.toUpperCase(), () => { g.settings.lang = l; g.applySettings(); g.saveSettings(); this.mainMenu(); }, g.settings.lang === l ? 'on' : '');
        lang.appendChild(b);
      }
      foot.appendChild(lang);
      foot.appendChild(this.el('div', 'cr', `${U.fmtInt(g.save.credits)} ${esc(t('ui.cr'))}`));
      foot.appendChild(this.btn(esc(t('menu.help')), () => this.tips()));
      left.appendChild(foot);
      wrap.appendChild(left);
      // current car card
      const id = g.save.current, car = SB.DATA.CARS[id];
      const card = this.el('div', 'carcard');
      card.innerHTML = `<div class="cc-make" lang="en">${esc(car.make)}</div><div class="cc-name" lang="en">${esc(car.name)}</div>${this.carSpecs(id)}`;
      card.prepend(this.silhouette(id, 260, 90));
      wrap.appendChild(card);
      wrap.appendChild(this.el('div', 'menu-note', esc(t('menu.note'))));
      this.open(wrap, 'menu-screen', () => this.mainMenu());
    }
    carSpecs(id) {
      const c = this.game.makeCarData(id);
      const pp = SB.DATA.performancePoints(c, c.tune);
      const kw = Math.round((c.engine.maxTorque * (1 + c.tune.power) * c.engine.redline * 0.88 * 2 * Math.PI) / 60 / 1000);
      return `<div class="specs"><div><b>${esc(c.cls)}</b><span>${pp} PP</span></div><div><b>${esc(c.drive)}</b><span>${esc(t('car.drive'))}</span></div><div><b>${esc(t('gb.' + c.gearbox))}</b><span>${esc(t('car.gearbox'))}</span></div><div><b>${kw} kW</b><span>${esc(c.engine.type)}</span></div><div><b>${U.fmtInt(c.mass)} kg</b><span>${esc(t('car.mass'))}</span></div><div><b>${(c.engine.redline / 1000).toFixed(1)}k</b><span>${esc(t('car.redline'))}</span></div></div>${c.glb ? this.carCredit(c.glb.credit) : ''}`;
    }
    // attribution for the Sketchfab models (CC BY / BY-SA / BY-NC-SA): title, author, licence, source
    carCredit(cr) {
      const link = `<a href="${esc(cr.url)}" target="_blank" rel="noopener">${esc(cr.title)}</a>`;
      return `<div class="credit">${t('car.credit', { title: link, author: esc(cr.author), license: esc(cr.license) })}</div>`;
    }
    silhouette(id, w, h) {
      const c = document.createElement('canvas');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
      c.className = 'sil';
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      const car = SB.DATA.CARS[id];
      const P = SB.CarModel.PROFILES[car.body];
      const sc = (w * 0.9) / P.L;
      const X = (x) => w / 2 - x * sc, Y = (y) => h - 10 - y * sc;
      const sc2 = this.game.save.cars[id];
      g.fillStyle = '#' + (sc2 ? sc2.paint : car.color).toString(16).padStart(6, '0');
      g.beginPath();
      const lw = P.lower;
      g.moveTo(X(P.front[0]), Y(P.front[1]));
      for (const p of lw) g.lineTo(X(p[0]), Y(p[1]));
      g.lineTo(X(-P.L / 2 + 0.1), Y(0.28));
      g.lineTo(X(P.L / 2 - 0.1), Y(0.28));
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(20,28,36,0.92)';
      g.beginPath();
      P.glass.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
      g.closePath();
      g.fill();
      g.fillStyle = '#121316';
      const R = car.wheel.radius;
      for (const ax of [car.wheelbase / 2, -car.wheelbase / 2]) { g.beginPath(); g.arc(X(ax), Y(R), R * sc, 0, Math.PI * 2); g.fill(); g.fillStyle = '#9aa0a6'; g.beginPath(); g.arc(X(ax), Y(R), R * sc * 0.55, 0, Math.PI * 2); g.fill(); g.fillStyle = '#121316'; }
      return c;
    }

    // ------------------------------------------------------------ pause
    pauseMenu() {
      const g = this.game;
      const { p, body, foot } = this.panel(t('pause.title'), g.mode && g.mode.kind !== 'free' ? t('mode.' + g.mode.kind) : '');
      const list = this.el('div', 'stack');
      list.appendChild(this.btn(esc(t('pause.resume')), () => g.resume(), 'primary'));
      list.appendChild(this.btn(esc(t('pause.map')), () => { g.state = 'map'; this.close(); g.hud.openMap(true); }));
      if (g.mode && g.mode.kind !== 'free') list.appendChild(this.btn(esc(t('pause.quitEvent')), () => g.backToFree()));
      list.appendChild(this.btn(esc(t('pause.reset')), () => { g.resetCar(); g.resume(); }));
      list.appendChild(this.btn(esc(t('pause.garage')), () => { g.backToFree('garage'); }));
      list.appendChild(this.btn(esc(t('menu.settings')), () => this.settings(null, () => this.pauseMenu())));
      list.appendChild(this.btn(esc(t('menu.help')), () => this.tips(() => this.pauseMenu())));
      list.appendChild(this.btn(esc(t('pause.menu')), () => g.toMenu()));
      body.appendChild(list);
      void foot;
      this.open(p, 'center', () => this.pauseMenu());
    }

    // ------------------------------------------------------------ settings
    settings(tab, back) {
      const g = this.game, s = g.settings;
      this.setBack = back || this.setBack || (() => this.mainMenu());
      const tabs = ['drive', 'boom', 'diff', 'world', 'controls', 'gfx', 'audio', 'hud', 'access'];
      tab = tab || this.setTab || 'drive';
      this.setTab = tab;
      const { p, body, foot } = this.panel(t('menu.settings'), t('set.live'));
      p.classList.add('wide');
      const bar = this.el('div', 'tabs');
      for (const k of tabs) bar.appendChild(this.btn(esc(t('set.tab.' + k)), () => this.settings(k, back), k === tab ? 'on' : ''));
      body.appendChild(bar);
      const list = this.el('div', 'setlist');
      body.appendChild(list);
      const apply = () => { g.applySettings(); g.saveSettings(); };
      const row = (label, ctrl, hint) => {
        const r = this.el('div', 'srow');
        r.appendChild(this.el('label', '', esc(label) + (hint ? `<small>${esc(hint)}</small>` : '')));
        r.appendChild(ctrl);
        list.appendChild(r);
      };
      const toggle = (key, label, hint, obj) => {
        const o = obj || s;
        const b = this.el('button', 'switch' + (o[key] ? ' on' : ''));
        b.type = 'button';
        b.setAttribute('role', 'switch');
        b.setAttribute('aria-checked', String(!!o[key]));
        b.id = 'set-' + key;
        b.innerHTML = `<i></i><span>${esc(o[key] ? t('ui.on') : t('ui.off'))}</span>`;
        b.onclick = () => { o[key] = !o[key]; apply(); this.settings(tab, back); };
        row(label, b, hint);
      };
      const choice = (key, label, opts, hint, onSet) => {
        const seg = this.el('div', 'seg');
        for (const [v, lk] of opts) seg.appendChild(this.btn(esc(t(lk)), () => { s[key] = v; if (onSet) onSet(v); apply(); this.settings(tab, back); }, s[key] === v ? 'on' : ''));
        row(label, seg, hint);
      };
      const slider = (key, label, min, max, step, fmt, hint, onSet) => {
        const w = this.el('div', 'slider');
        const inp = this.el('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = s[key]; inp.id = 'set-' + key;
        const out = this.el('output', '', fmt ? fmt(s[key]) : String(s[key]));
        inp.oninput = () => { s[key] = parseFloat(inp.value); out.textContent = fmt ? fmt(s[key]) : String(s[key]); if (onSet) onSet(s[key]); apply(); };
        w.appendChild(inp); w.appendChild(out);
        row(label, w, hint);
      };
      const pct = (v) => Math.round(v * 100) + '%';
      if (tab === 'drive') {
        choice('shifter', t('set.shifter'), [['H', 'set.shifter.H'], ['SEQ', 'set.shifter.SEQ']], t('set.shifter.h'));
        choice('clutchMode', t('set.clutch'), [['manual', 'set.clutch.manual'], ['auto', 'set.clutch.auto']], t('set.clutch.h'));
        toggle('stalling', t('set.stalling'), t('set.stalling.h'));
        toggle('autoBlip', t('set.autoBlip'), t('set.autoBlip.h'));
        toggle('hillAssist', t('set.hillAssist'), t('set.hillAssist.h'));
        toggle('abs', 'ABS');
        toggle('tcs', t('set.tcs'));
        toggle('esc', t('set.esc'));
        toggle('suggestGear', t('set.suggest'));
        toggle('racingLine', t('set.racingLine'));
        slider('clutchPress', t('set.clutchPress'), 2, 14, 0.5, (v) => v.toFixed(1) + '/s');
        slider('clutchRelease', t('set.clutchRelease'), 0.6, 8, 0.1, (v) => v.toFixed(1) + '/s', t('set.clutchRelease.h'));
      } else if (tab === 'boom') {
        toggle('explosionRule', t('set.boomRule'), t('set.boomRule.h'));
        slider('thr61', t('set.thr61'), 0, 120, 1, (v) => v + ' ' + t('ui.kmh'));
        slider('thr6R', t('set.thr6R'), 0, 60, 1, (v) => v + ' ' + t('ui.kmh'));
        toggle('explodeAnySpeed', t('set.anySpeed'));
        toggle('explosionInRace', t('set.boomRace'));
        toggle('slowmo', t('set.slowmo'));
        toggle('explosionRewind', t('set.boomRewind'));
      } else if (tab === 'diff') {
        choice('difficulty', t('set.difficulty'), [['arcade', 'diff.arcade'], ['normal', 'diff.normal'], ['hardcore', 'diff.hardcore']], t('set.difficulty.h.' + s.difficulty));
        choice('damage', t('set.damage'), [['off', 'set.damage.off'], ['visual', 'set.damage.visual'], ['full', 'set.damage.full']]);
        toggle('police', t('set.police'));
        toggle('policeVoice', t('set.voice'));
        toggle('fines', t('set.fines'));
        toggle('fuel', t('set.fuel'));
        slider('aiLevel', t('set.ai'), 0, 7, 1, (v) => t('ai.' + v));
      } else if (tab === 'world') {
        slider('traffic', t('set.traffic'), 0, 3, 1, (v) => t('dens.' + v));
        slider('peds', t('set.peds'), 0, 3, 1, (v) => t('dens.' + v));
        slider('dayLength', t('set.dayLength'), 8, 120, 1, (v) => v + ' ' + t('ui.min'));
        toggle('timeFixed', t('set.timeFixed'));
        const tw = this.el('div', 'slider');
        const ti = this.el('input');
        ti.type = 'range'; ti.min = 0; ti.max = 23.9; ti.step = 0.1; ti.value = g.env.time; ti.id = 'set-clock';
        const to = this.el('output', '', g.env.clockText());
        ti.oninput = () => { g.env.setTime(parseFloat(ti.value)); to.textContent = g.env.clockText(); };
        tw.appendChild(ti); tw.appendChild(to);
        row(t('set.clock'), tw);
        choice('weather', t('set.weather'), [['dynamic', 'w.dynamic'], ['sunny', 'w.sunny'], ['cloudy', 'w.cloudy'], ['fog', 'w.fog'], ['rain', 'w.rain'], ['storm', 'w.storm'], ['snow', 'w.snow']], null, (v) => { if (v !== 'dynamic') g.env.setWeather(v); });
      } else if (tab === 'controls') {
        const b = this.btn(esc(t('set.keys')), () => this.controlsScreen(() => this.settings('controls', back)));
        row(t('set.keys.l'), b);
        slider('steerSens', t('set.steerSens'), 0.4, 1.5, 0.05, pct);
        slider('deadzone', t('set.deadzone'), 0, 0.3, 0.01, pct);
        slider('ffb', t('set.ffb'), 0, 1, 0.05, pct, t('set.ffb.h'));
        row(t('set.wheel'), this.btn(esc(t('set.wheel.b')), () => this.calibrateWheel(() => this.settings('controls', back))), t('set.wheel.h'));
        choice('touch', t('set.touch'), [['auto', 'ui.auto'], ['on', 'ui.on'], ['off', 'ui.off']]);
        choice('touchSteer', t('set.touchSteer'), [['wheel', 'set.ts.wheel'], ['slider', 'set.ts.slider'], ['buttons', 'set.ts.buttons'], ['tilt', 'set.ts.tilt']], t('set.touchSteer.h'), () => { if (g.input.touchRoot) g.input.buildTouch(g.input.touchRoot); });
        slider('touchOpacity', t('set.touchOpacity'), 0.2, 1, 0.05, pct, null, () => g.input.touchRoot && g.input.applyTouchLayout());
        slider('gyroSens', t('set.gyro'), 0.4, 2, 0.05, pct);
        row(t('set.layout'), this.btn(esc(t('set.layout.b')), () => this.touchEditor()));
      } else if (tab === 'gfx') {
        choice('quality', t('set.quality'), [['auto', 'ui.auto'], ['low', 'q.low'], ['medium', 'q.medium'], ['high', 'q.high']], t('set.quality.h'), (v) => { g.quality = v === 'auto' ? g.pickQuality() : v; });
        slider('renderScale', t('set.renderScale'), 0.5, 1, 0.05, pct);
        choice('fpsCap', t('set.fpsCap'), [[0, 'ui.unlimited'], [30, 'fps.30'], [60, 'fps.60']]);
      } else if (tab === 'audio') {
        slider('vol', t('set.vol'), 0, 1, 0.05, pct);
        slider('volEngine', t('set.volEngine'), 0, 1.5, 0.05, pct);
        slider('volSfx', t('set.volSfx'), 0, 1.5, 0.05, pct);
        slider('volMusic', t('set.volMusic'), 0, 1, 0.05, pct);
        slider('volAmb', t('set.volAmb'), 0, 1, 0.05, pct);
        choice('radio', t('set.radio'), [['off', 'radio.off'], ['kiyi', 'radio.kiyi'], ['redline', 'radio.redline']]);
      } else if (tab === 'hud') {
        choice('lang', t('set.lang'), [['tr', 'lang.tr'], ['en', 'lang.en']]);
        choice('units', t('set.units'), [['kmh', 'units.kmh'], ['mph', 'units.mph']]);
        for (const k of ['tach', 'map', 'damage', 'pedals', 'pattern']) toggle(k, t('hud.' + k), null, s.hud);
        const hb = this.el('button', 'switch' + (g.hideHud ? ' on' : ''));
        hb.type = 'button';
        hb.innerHTML = `<i></i><span>${esc(g.hideHud ? t('ui.on') : t('ui.off'))}</span>`;
        hb.onclick = () => { g.hideHud = !g.hideHud; this.settings(tab, back); };
        row(t('set.cineHud'), hb);
      } else if (tab === 'access') {
        choice('colorblind', t('set.cb'), [['off', 'ui.off'], ['deuter', 'cb.deuter'], ['prot', 'cb.prot'], ['trit', 'cb.trit']]);
        toggle('bigText', t('set.bigText'));
        slider('vibration', t('set.vibration'), 0, 1, 0.05, pct);
        slider('shake', t('set.shake'), 0, 1, 0.05, pct);
      }
      foot.appendChild(this.btn(esc(t('ui.back')), () => { this.setTab = null; const b2 = this.setBack; this.setBack = null; b2(); }, 'primary'));
      foot.appendChild(this.btn(esc(t('set.reset')), () => { const lang = s.lang; g.settings = U.clone(SB.DATA.SETTINGS_DEFAULT); g.settings.lang = lang; apply(); this.settings(tab, back); }));
      this.open(p, 'center', () => this.settings(tab, back));
    }

    controlsScreen(back) {
      const g = this.game;
      const keys = g.settings.keys || U.clone(SB.DATA.KEYS_DEFAULT);
      const { p, body, foot } = this.panel(t('set.keys'), t('keys.hint'));
      p.classList.add('wide');
      const list = this.el('div', 'keylist');
      for (const a of Object.keys(SB.DATA.KEYS_DEFAULT)) {
        const r = this.el('div', 'krow');
        r.appendChild(this.el('span', '', esc(t('act.' + a))));
        const b = this.btn(esc((keys[a] || []).map(UI.keyName).join(' / ') || '—'), () => {
          b.textContent = t('keys.press');
          g.input.capture = (code) => {
            g.input.capture = null;
            if (code !== 'Escape') { keys[a] = [code]; g.settings.keys = keys; g.saveSettings(); }
            this.controlsScreen(back);
          };
        }, 'key');
        r.appendChild(b);
        list.appendChild(r);
      }
      body.appendChild(list);
      body.appendChild(this.el('div', 'note', esc(t('keys.pad'))));
      foot.appendChild(this.btn(esc(t('ui.back')), () => back ? back() : this.settings('controls'), 'primary'));
      foot.appendChild(this.btn(esc(t('keys.default')), () => { g.settings.keys = null; g.saveSettings(); this.controlsScreen(back); }));
      this.open(p, 'center', () => this.controlsScreen(back));
    }

    calibrateWheel(back) {
      const g = this.game;
      const steps = ['steer', 'gas', 'brake', 'clutch', 1, 2, 3, 4, 5, 6, -1, 'paddleUp', 'paddleDown'];
      const map = { gears: {} };
      let i = 0;
      const { p, body, foot } = this.panel(t('cal.title'), t('cal.sub'));
      const msg = this.el('div', 'calmsg');
      body.appendChild(msg);
      const next = () => {
        if (i >= steps.length) { g.settings.wheelMap = map; g.saveSettings(); msg.textContent = t('cal.done'); return; }
        const k = steps[i];
        msg.textContent = t('cal.step.' + (typeof k === 'number' ? 'gear' : k), { g: k === -1 ? 'R' : k });
        g.input.calibrateStep(k, (res) => {
          if (res) {
            if (k === 'steer' || k === 'gas' || k === 'brake' || k === 'clutch') map[k] = res;
            else if (typeof k === 'number') map.gears[res.button] = k;
            else map[k] = res.button;
          }
          i++;
          next();
        });
      };
      foot.appendChild(this.btn(esc(t('cal.start')), () => { i = 0; next(); }, 'primary'));
      foot.appendChild(this.btn(esc(t('cal.skip')), () => { i++; next(); }));
      foot.appendChild(this.btn(esc(t('cal.clear')), () => { g.settings.wheelMap = null; g.saveSettings(); msg.textContent = t('cal.cleared'); }));
      foot.appendChild(this.btn(esc(t('ui.back')), () => back()));
      if (!navigator.getGamepads || !Array.from(navigator.getGamepads()).some((x) => x)) msg.textContent = t('cal.none');
      this.open(p, 'center');
    }

    touchEditor() {
      const g = this.game;
      g.settings.touch = 'on';
      g.applySettings();
      this.close();
      const root = $('touch');
      root.hidden = false;
      if (!g.input.touchRoot) g.input.buildTouch(root);
      const bar = this.el('div', 'editbar');
      bar.innerHTML = `<span>${esc(t('layout.hint'))}</span>`;
      const sz = this.el('input');
      sz.type = 'range'; sz.min = 0.6; sz.max = 1.8; sz.step = 0.05; sz.value = 1; sz.id = 'layout-size';
      sz.oninput = () => g.input.setSelectedScale(parseFloat(sz.value));
      bar.appendChild(sz);
      bar.appendChild(this.btn(esc(t('layout.reset')), () => { g.settings.touchLayout = null; g.input.buildTouch(root); g.input.editLayout(true, sz); }));
      bar.appendChild(this.btn(esc(t('layout.done')), () => { g.input.editLayout(false); bar.remove(); this.settings('controls'); }, 'primary'));
      document.body.appendChild(bar);
      g.input.editLayout(true, sz);
    }

    // ------------------------------------------------------------ garage / gallery / tuning
    garage(forced) {
      const g = this.game, S = g.save;
      const { p, body, foot } = this.panel(t('garage.title'), forced ? t('garage.forced') : t('garage.sub'));
      p.classList.add('wide');
      const grid = this.el('div', 'cars');
      const now = g.clockHours();
      for (const id of SB.DATA.CAR_ORDER) {
        const sc = S.cars[id], car = SB.DATA.CARS[id];
        const c = this.el('div', 'car' + (S.current === id ? ' sel' : ''));
        c.appendChild(this.silhouette(id, 220, 74));
        let status = '';
        if (sc.lost) status = `<span class="pill bad">${esc(t('garage.lost'))}</span>`;
        else if (!sc.owned) status = `<span class="pill">${esc(t('garage.notOwned'))}</span>`;
        else if (sc.repairUntil > now) status = `<span class="pill warn">${esc(t('garage.inRepair', { h: Math.ceil(sc.repairUntil - now) }))}</span>`;
        else status = `<span class="pill good">${esc(t('garage.ready'))}</span>`;
        if (sc.insured) status += `<span class="pill">${esc(t('garage.insured'))}</span>`;
        c.appendChild(this.el('div', 'car-h', `<div class="cc-make" lang="en">${esc(car.make)}</div><div class="cc-name" lang="en">${esc(car.name)}</div>${status}`));
        c.appendChild(this.el('div', '', this.carSpecs(id)));
        const acts = this.el('div', 'acts');
        if (sc.owned && !sc.lost) {
          if (!(sc.repairUntil > now)) acts.appendChild(this.btn(esc(t('garage.drive')), () => { g.spawnPlayer(id, g.state === 'menu' ? null : g.poiPose('garage')); g.persist(); this.garage(forced); }, S.current === id ? 'primary' : ''));
          else acts.appendChild(this.btn(esc(t('garage.wait')), () => { const hrs = sc.repairUntil - now; g.env.setTime(g.env.time + hrs); if (g.env.time < hrs) S.day++; sc.repairUntil = 0; g.persist(); this.garage(forced); }));
          const dmg = this.repairCost(id);
          if (dmg > 0 && !(sc.repairUntil > now)) acts.appendChild(this.btn(esc(t('garage.repair', { n: U.fmtInt(dmg) })), () => this.doRepair(id, dmg, () => this.garage(forced))));
          const prem = Math.round(sc.premium || car.price * SB.DATA.ECONOMY.insurePct);
          if (!sc.insured) acts.appendChild(this.btn(esc(t('garage.insure', { n: U.fmtInt(prem) })), () => { if (S.credits < prem) return g.hud.toast(t('ui.noMoney'), 'bad', 2); S.credits -= prem; sc.insured = true; sc.premium = prem; g.persist(); this.garage(forced); }));
          acts.appendChild(this.btn(esc(t('garage.tune')), () => this.tuning(id, () => this.garage(forced))));
        } else {
          acts.appendChild(this.btn(esc(t('garage.toGallery')), () => this.gallery(() => this.garage(forced))));
        }
        c.appendChild(acts);
        grid.appendChild(c);
      }
      body.appendChild(grid);
      foot.appendChild(this.btn(esc(t('ui.back')), () => { if (g.state === 'menu') this.mainMenu(); else { if (!g.ensureDrivable()) { g.hud.toast(t('garage.noCar'), 'bad', 3); return; } this.close(); g.state = 'play'; g.updateTouchVisibility(); } }, 'primary'));
      foot.appendChild(this.btn(esc(t('garage.gallery')), () => this.gallery(() => this.garage(forced))));
      foot.appendChild(this.el('div', 'cr', `${U.fmtInt(S.credits)} ${esc(t('ui.cr'))}`));
      if (g.state === 'play') g.state = 'pause';
      this.open(p, 'center', () => this.garage(forced));
    }
    repairCost(id) {
      const g = this.game;
      const val = SB.DATA.CARS[id].price;
      if (id !== g.save.current) { const d = g.save.cars[id].damage; if (!d) return 0; return Math.round(((1 - d.engine) + (1 - d.gearbox) + (1 - d.clutch) + (1 - d.radiator)) * 25 * val * SB.DATA.ECONOMY.repairPerPct); }
      const p = g.player, dt = p.dt;
      let pct = (1 - dt.health.engine) * 40 + (1 - dt.health.gearbox) * 25 + (1 - dt.health.clutch) * 10 + (1 - dt.health.radiator) * 10 + p.damage.body * 20 + p.damage.steering * 10;
      for (const k of Object.keys(dt.gearHealth)) pct += (1 - dt.gearHealth[k]) * 4;
      pct += p.damage.susp.reduce((a, b) => a + b, 0) * 5 + p.wheels.reduce((a, w) => a + w.wear * 4 + (w.burst ? 6 : 0), 0) + (dt.wrongFuel > 0 ? 4 : 0);
      if (dt.exploded) pct = 25 / SB.DATA.ECONOMY.repairPerPct / 100;
      return Math.round(pct * val * SB.DATA.ECONOMY.repairPerPct);
    }
    doRepair(id, cost, after) {
      const g = this.game, S = g.save;
      if (S.credits < cost) return g.hud.toast(t('ui.noMoney'), 'bad', 2);
      S.credits -= cost;
      if (id === S.current) {
        const pose = { x: g.player.pos.x, z: g.player.pos.z, heading: g.player.yaw };
        S.cars[id].damage = null;
        g.spawnPlayer(id, pose);
        g.player.dt.fuel = S.cars[id].fuel != null ? S.cars[id].fuel : g.player.dt.fuel;
      } else S.cars[id].damage = null;
      g.hud.toast(t('repair.done'), 'good', 2);
      g.persist();
      after();
    }
    gallery(back) {
      const g = this.game, S = g.save;
      const { p, body, foot } = this.panel(t('gallery.title'), t('gallery.sub'));
      p.classList.add('wide');
      const grid = this.el('div', 'cars');
      for (const id of SB.DATA.CAR_ORDER) {
        const car = SB.DATA.CARS[id], sc = S.cars[id];
        const c = this.el('div', 'car');
        c.appendChild(this.silhouette(id, 220, 74));
        c.appendChild(this.el('div', 'car-h', `<div class="cc-make" lang="en">${esc(car.make)}</div><div class="cc-name" lang="en">${esc(car.name)}</div>`));
        c.appendChild(this.el('div', '', this.carSpecs(id)));
        const acts = this.el('div', 'acts');
        const used = Math.round(car.price * (1 - SB.DATA.ECONOMY.usedDiscount));
        if (!sc.owned) {
          acts.appendChild(this.btn(esc(t('gallery.buyNew', { n: U.fmtInt(car.price) })), () => this.buy(id, car.price, false, back), 'primary'));
          acts.appendChild(this.btn(esc(t('gallery.buyUsed', { n: U.fmtInt(used) })), () => this.buy(id, used, true, back)));
        } else {
          const sell = Math.round(car.price * SB.DATA.ECONOMY.sellPct);
          if (S.current !== id) acts.appendChild(this.btn(esc(t('gallery.sell', { n: U.fmtInt(sell) })), () => { sc.owned = false; sc.upgrades = []; sc.insured = false; S.credits += sell; g.persist(); this.gallery(back); }));
          else acts.appendChild(this.el('span', 'pill good', esc(t('gallery.yours'))));
        }
        c.appendChild(acts);
        grid.appendChild(c);
      }
      body.appendChild(grid);
      foot.appendChild(this.btn(esc(t('ui.back')), () => (back ? back() : this.closeToPlay()), 'primary'));
      foot.appendChild(this.el('div', 'cr', `${U.fmtInt(S.credits)} ${esc(t('ui.cr'))}`));
      this.open(p, 'center', () => this.gallery(back));
    }
    buy(id, price, used, back) {
      const g = this.game, S = g.save, sc = S.cars[id];
      if (S.credits < price) return g.hud.toast(t('ui.noMoney'), 'bad', 2);
      S.credits -= price;
      Object.assign(sc, { owned: true, lost: false, repairUntil: 0, upgrades: [], tune: {}, insured: false, premium: 0 });
      sc.damage = used ? { engine: 0.82 + Math.random() * 0.1, gearbox: 0.85 + Math.random() * 0.1, clutch: 0.7 + Math.random() * 0.2, radiator: 0.9 } : null;
      sc.odo = used ? 40000 + Math.round(Math.random() * 80000) : 0;
      g.hud.toast(t('gallery.bought', { name: SB.DATA.CARS[id].name }), 'good', 2.5);
      g.persist();
      this.gallery(back);
    }
    closeToPlay() {
      const g = this.game;
      if (g.state === 'menu') return this.mainMenu();
      this.close();
      g.state = 'play';
      g.updateTouchVisibility();
    }
    tuning(id, back, tab) {
      const g = this.game, S = g.save, sc = S.cars[id];
      tab = tab || 'parts';
      const { p, body, foot } = this.panel(t('tune.title', { name: SB.DATA.CARS[id].name }), t('tune.sub'));
      p.classList.add('wide');
      const bar = this.el('div', 'tabs');
      for (const k of ['parts', 'setup', 'look', 'profiles']) bar.appendChild(this.btn(esc(t('tune.tab.' + k)), () => this.tuning(id, back, k), k === tab ? 'on' : ''));
      body.appendChild(bar);
      const list = this.el('div', 'setlist');
      body.appendChild(list);
      const pp = SB.DATA.performancePoints(g.makeCarData(id), g.makeCarData(id).tune);
      body.prepend(this.el('div', 'ppbar', `<b>${pp}</b> PP · ${esc(SB.DATA.CARS[id].cls)}`));
      let dirty = false;
      if (tab === 'parts') {
        for (const u of SB.DATA.UPGRADES) {
          const have = sc.upgrades.includes(u.id);
          const r = this.el('div', 'srow');
          r.appendChild(this.el('label', '', `${esc(t('up.' + u.id))}<small>${esc(t('upg.' + u.group))}</small>`));
          r.appendChild(have ? this.btn(esc(t('tune.remove')), () => { sc.upgrades = sc.upgrades.filter((x) => x !== u.id); g.persist(); this.applyTune(id); this.tuning(id, back, tab); }) : this.btn(esc(t('tune.buy', { n: U.fmtInt(u.price) })), () => {
            if (S.credits < u.price) return g.hud.toast(t('ui.noMoney'), 'bad', 2);
            if (u.id === 'semiSlick') sc.upgrades = sc.upgrades.filter((x) => x !== 'sportTires');
            if (u.id === 'sportTires') sc.upgrades = sc.upgrades.filter((x) => x !== 'semiSlick');
            S.credits -= u.price; sc.upgrades.push(u.id); g.persist(); this.applyTune(id); this.tuning(id, back, tab);
          }, 'primary'));
          list.appendChild(r);
        }
      } else if (tab === 'setup') {
        let group = '';
        for (const d of SB.DATA.TUNE_SLIDERS) {
          if (d.key === 'diffLock' && SB.DATA.CARS[id].diff.type !== 'lsd' && !sc.upgrades.includes('lsd')) continue;
          if (d.group !== group) { group = d.group; list.appendChild(this.el('div', 'sgroup', esc(t('tg.' + group)))); }
          const v = sc.tune[d.key] != null ? sc.tune[d.key] : d.key === 'brakeBias' ? 0.62 : d.def;
          const w = this.el('div', 'slider');
          const inp = this.el('input');
          inp.type = 'range'; inp.min = d.min; inp.max = d.max; inp.step = d.step; inp.value = v; inp.id = 'tune-' + d.key;
          const fmt = (x) => (d.group === 'gears' ? (d.key === 'final' ? (SB.DATA.CARS[id].gears.final * x).toFixed(2) : (SB.DATA.CARS[id].gears.ratios[+d.key.slice(1) - 1] * x).toFixed(2)) : d.key.startsWith('press') ? x.toFixed(2) + ' bar' : d.key.startsWith('camber') || d.key === 'toeF' ? x.toFixed(1) + '°' : d.key === 'brakeBias' ? Math.round(x * 100) + '% ' + t('tune.front') : Math.round(x * 100) + '%');
          const out = this.el('output', '', fmt(+v));
          inp.oninput = () => { sc.tune[d.key] = parseFloat(inp.value); out.textContent = fmt(sc.tune[d.key]); dirty = true; };
          w.appendChild(inp); w.appendChild(out);
          const r = this.el('div', 'srow');
          r.appendChild(this.el('label', '', esc(t('tune.' + d.key))));
          r.appendChild(w);
          list.appendChild(r);
        }
      } else if (tab === 'look') {
        const pal = this.el('div', 'palette');
        for (const c of SB.DATA.PAINT) {
          const b = this.el('button', 'sw' + (sc.paint === c ? ' on' : ''));
          b.type = 'button';
          b.style.background = '#' + c.toString(16).padStart(6, '0');
          b.setAttribute('aria-label', '#' + c.toString(16));
          b.onclick = () => { sc.paint = c; g.persist(); this.applyTune(id); this.tuning(id, back, tab); };
          pal.appendChild(b);
        }
        const r1 = this.el('div', 'srow'); r1.appendChild(this.el('label', '', esc(t('tune.paint')))); r1.appendChild(pal); list.appendChild(r1);
        const seg = this.el('div', 'seg');
        for (const f of SB.DATA.FINISHES) seg.appendChild(this.btn(esc(t('fin.' + f)), () => { sc.finish = f; g.persist(); this.applyTune(id); this.tuning(id, back, tab); }, sc.finish === f ? 'on' : ''));
        const r2 = this.el('div', 'srow'); r2.appendChild(this.el('label', '', esc(t('tune.finish')))); r2.appendChild(seg); list.appendChild(r2);
        const rim = this.el('div', 'palette');
        for (const c of [0xb9bec4, 0x1b1d22, 0xd4af37, 0xe5482d, 0xffffff]) {
          const b = this.el('button', 'sw' + (sc.rim === c ? ' on' : ''));
          b.type = 'button';
          b.style.background = '#' + c.toString(16).padStart(6, '0');
          b.onclick = () => { sc.rim = c; g.persist(); this.applyTune(id); this.tuning(id, back, tab); };
          rim.appendChild(b);
        }
        const r3 = this.el('div', 'srow'); r3.appendChild(this.el('label', '', esc(t('tune.rims')))); r3.appendChild(rim); list.appendChild(r3);
      } else if (tab === 'profiles') {
        sc.profiles = sc.profiles || [null, null, null];
        for (let i = 0; i < 3; i++) {
          const r = this.el('div', 'srow');
          r.appendChild(this.el('label', '', esc(t('tune.slot', { n: i + 1 })) + (sc.profiles[i] ? '' : `<small>${esc(t('tune.empty'))}</small>`)));
          const box = this.el('div', 'seg');
          box.appendChild(this.btn(esc(t('tune.save')), () => { sc.profiles[i] = U.clone(sc.tune); g.persist(); this.tuning(id, back, tab); }));
          if (sc.profiles[i]) box.appendChild(this.btn(esc(t('tune.load')), () => { sc.tune = U.clone(sc.profiles[i]); g.persist(); this.applyTune(id); this.tuning(id, back, tab); }));
          r.appendChild(box);
          list.appendChild(r);
        }
        const r = this.el('div', 'srow');
        r.appendChild(this.el('label', '', esc(t('tune.defaults'))));
        r.appendChild(this.btn(esc(t('tune.resetSetup')), () => { sc.tune = {}; g.persist(); this.applyTune(id); this.tuning(id, back, tab); }));
        list.appendChild(r);
      }
      foot.appendChild(this.btn(esc(t('tune.apply')), () => { if (dirty) { g.persist(); this.applyTune(id); } back ? back() : this.closeToPlay(); }, 'primary'));
      foot.appendChild(this.el('div', 'cr', `${U.fmtInt(S.credits)} ${esc(t('ui.cr'))}`));
      this.open(p, 'center', () => this.tuning(id, back, tab));
    }
    applyTune(id) {
      const g = this.game;
      if (g.save.current !== id || !g.player) return;
      const pl = g.player;
      const pose = { x: pl.pos.x, z: pl.pos.z, heading: pl.yaw };
      const fuel = pl.dt.fuel, health = Object.assign({}, pl.dt.health), gh = Object.assign({}, pl.dt.gearHealth), running = pl.dt.running;
      g.spawnPlayer(id, pose);
      g.player.dt.fuel = fuel;
      g.player.dt.health = health;
      g.player.dt.gearHealth = gh;
      if (running) { g.player.dt.running = true; g.player.dt.omegaE = g.player.car.engine.idle * SB.RPM2W; }
    }

    // ------------------------------------------------------------ POIs
    poiMenu(poi) {
      const g = this.game;
      g.state = 'pause';
      g.audio.setGrind(0);
      if (poi.type === 'garage') return this.garage();
      if (poi.type === 'gallery') return this.gallery();
      if (poi.type === 'modshop') return this.tuning(g.save.current);
      if (poi.type === 'gas') return this.gasStation();
      if (poi.type === 'repair') return this.repairShop();
      if (poi.type === 'license') return this.licenseIntro();
      if (poi.type === 'drag') return this.raceLobby('drag');
      if (poi.type === 'streetRace') return this.raceLobby(null, poi.event);
      if (poi.type === 'parking') return this.parkingIntro(poi.mission);
      this.closeToPlay();
    }
    gasStation() {
      const g = this.game, pl = g.player, dt = pl.dt, car = pl.car;
      const { p, body, foot } = this.panel(t('gas.title'), t('gas.sub'));
      let type = car.fuelType;
      let liters = Math.max(0, Math.floor(car.fuelTank - dt.fuel));
      const info = this.el('div', 'note');
      const seg = this.el('div', 'seg');
      const render = () => {
        seg.innerHTML = '';
        for (const f of ['petrol', 'diesel']) seg.appendChild(this.btn(esc(t('fuel.' + f)), () => { type = f; render(); }, type === f ? 'on' : ''));
        const price = Math.round(liters * SB.DATA.ECONOMY.fuelPrice[type]);
        info.innerHTML = `${esc(t('gas.level', { n: dt.fuel.toFixed(1), max: car.fuelTank }))}<br>${esc(t('gas.carUses', { f: t('fuel.' + car.fuelType) }))}<br><b>${esc(t('gas.price', { l: liters, n: U.fmtInt(price) }))}</b>`;
      };
      const r1 = this.el('div', 'srow'); r1.appendChild(this.el('label', '', esc(t('gas.type')))); r1.appendChild(seg); body.appendChild(r1);
      const w = this.el('div', 'slider');
      const inp = this.el('input');
      inp.type = 'range'; inp.min = 0; inp.max = Math.max(1, Math.floor(car.fuelTank - dt.fuel)); inp.step = 1; inp.value = liters; inp.id = 'gas-liters';
      const out = this.el('output', '', liters + ' L');
      inp.oninput = () => { liters = +inp.value; out.textContent = liters + ' L'; render(); };
      w.appendChild(inp); w.appendChild(out);
      const r2 = this.el('div', 'srow'); r2.appendChild(this.el('label', '', esc(t('gas.amount')))); r2.appendChild(w); body.appendChild(r2);
      body.appendChild(info);
      render();
      foot.appendChild(this.btn(esc(t('gas.fill')), () => {
        const price = Math.round(liters * SB.DATA.ECONOMY.fuelPrice[type]);
        if (g.save.credits < price) return g.hud.toast(t('ui.noMoney'), 'bad', 2);
        if (dt.running) return g.hud.toast(t('gas.engineOn', { key: g.keyLabel('ignition') }), 'warn', 2.5);
        g.save.credits -= price;
        dt.fuel = Math.min(car.fuelTank, dt.fuel + liters);
        if (type !== car.fuelType) { dt.wrongFuel += liters; g.hud.toast(t('gas.wrong'), 'bad', 4); }
        g.audio.chime();
        g.persist();
        this.closeToPlay();
      }, 'primary'));
      foot.appendChild(this.btn(esc(t('ui.back')), () => this.closeToPlay()));
      this.open(p, 'center');
    }
    repairShop() {
      const g = this.game, id = g.save.current;
      const cost = this.repairCost(id);
      const { p, body, foot } = this.panel(t('repair.title'), t('repair.sub'));
      const dt = g.player.dt, pl = g.player;
      const items = [['engine', dt.health.engine], ['gearbox', Math.min(dt.health.gearbox, ...Object.values(dt.gearHealth))], ['clutch', dt.health.clutch], ['radiator', dt.health.radiator], ['body', 1 - pl.damage.body], ['susp', 1 - Math.max(...pl.damage.susp)], ['tires', 1 - Math.max(...pl.wheels.map((w) => (w.burst ? 1 : w.wear)))]];
      const list = this.el('div', 'dmglist');
      for (const [k, v] of items) list.appendChild(this.el('div', 'drow', `<span>${esc(t('part.' + k))}</span><i style="--v:${Math.round(v * 100)}%" class="${v > 0.75 ? 'good' : v > 0.4 ? 'warn' : 'bad'}"></i><b>${Math.round(v * 100)}%</b>`));
      if (dt.wrongFuel > 0) list.appendChild(this.el('div', 'note bad', esc(t('repair.wrongFuel'))));
      body.appendChild(list);
      if (cost > 0) foot.appendChild(this.btn(esc(t('repair.do', { n: U.fmtInt(cost) })), () => this.doRepair(id, cost, () => this.closeToPlay()), 'primary'));
      else body.appendChild(this.el('div', 'note', esc(t('repair.none'))));
      foot.appendChild(this.btn(esc(t('ui.back')), () => this.closeToPlay()));
      this.open(p, 'center');
    }
    licenseIntro() {
      const g = this.game;
      const { p, body, foot } = this.panel(t('lic.title'), g.save.license ? t('lic.have') : t('lic.intro'));
      body.appendChild(this.el('div', 'note', esc(t('lic.desc'))));
      foot.appendChild(this.btn(esc(t('lic.start')), () => g.startLicense(), 'primary'));
      foot.appendChild(this.btn(esc(t('ui.back')), () => this.closeToPlay()));
      this.open(p, 'center');
    }
    parkingIntro(id) {
      const g = this.game;
      const best = g.save.records['park_' + id] || 0;
      const { p, body, foot } = this.panel(t('park.title.' + id), t('park.goal.' + id));
      body.appendChild(this.el('div', 'note', esc(t('park.rules')) + (best ? `<br><b>${'★'.repeat(best)}${'☆'.repeat(3 - best)}</b>` : '')));
      foot.appendChild(this.btn(esc(t('park.start')), () => g.startParking(id), 'primary'));
      foot.appendChild(this.btn(esc(t('ui.back')), () => this.closeToPlay()));
      this.open(p, 'center');
    }
    roadside() {
      const g = this.game;
      if (g.state !== 'play') return;
      g.state = 'pause';
      const E = SB.DATA.ECONOMY;
      const { p, body, foot } = this.panel(t('road.title'), t('road.sub'));
      const list = this.el('div', 'stack');
      list.appendChild(this.btn(esc(t('road.tow', { n: U.fmtInt(E.towFee) })), () => {
        g.addCredits(-E.towFee);
        const shops = g.world.pois.filter((x) => x.type === 'repair' || x.type === 'garage');
        let best = shops[0], bd = Infinity;
        for (const s of shops) { const d = Math.hypot(s.x - g.player.pos.x, s.z - g.player.pos.z); if (d < bd) { bd = d; best = s; } }
        if (g.player.exploded || g.player.dt.seized) { g.player.dt.repairAll(); g.player.restoreVisuals(); g.hud.tachBreak(false); g.addCredits(-Math.round(SB.DATA.CARS[g.save.current].price * 0.08)); }
        g.backToFree(best.id);
      }));
      list.appendChild(this.btn(esc(t('road.fuel', { n: U.fmtInt(E.roadsideFee) })), () => { g.addCredits(-E.roadsideFee); g.player.dt.fuel = Math.min(g.player.car.fuelTank, g.player.dt.fuel + 5); this.closeToPlay(); }));
      list.appendChild(this.btn(esc(t('road.reset')), () => { g.resetCar(); this.closeToPlay(); }));
      body.appendChild(list);
      foot.appendChild(this.btn(esc(t('ui.back')), () => this.closeToPlay()));
      this.open(p, 'center');
    }

    // ------------------------------------------------------------ race lobby
    raceLobby(filter, preselect) {
      const g = this.game;
      if (g.state === 'play') g.state = 'pause';
      const events = SB.RACES.filter((e) => (filter ? e.type === filter : true));
      let sel = events.find((e) => e.id === preselect) || events[0];
      // gearbox follows the clutch setting: manual gears with the automatic clutch unless the manual clutch is chosen
      const opts = this.lobbyOpts || { ai: g.settings.aiLevel, gearbox: g.settings.clutchMode === 'manual' ? 'clutch' : 'manual', rivals: null, explosion: g.settings.explosionInRace, rubber: true, laps: null };
      this.lobbyOpts = opts;
      const { p, body, foot } = this.panel(t('lobby.title'), t('lobby.sub'));
      p.classList.add('wide');
      const cols = this.el('div', 'lobby');
      const list = this.el('div', 'evlist');
      const detail = this.el('div', 'evdetail');
      cols.appendChild(list);
      cols.appendChild(detail);
      body.appendChild(cols);
      const renderDetail = () => {
        detail.innerHTML = '';
        const ev = sel;
        const rec = g.save.records['ta_' + ev.id] || g.save.records['drag_' + ev.dist];
        detail.appendChild(this.el('h3', '', esc(t('ev.' + ev.id))));
        detail.appendChild(this.el('p', 'sub', esc(t('evd.' + ev.id)) + (rec ? ` · ${esc(t('race.best'))}: ${ev.type === 'drag' ? rec.toFixed(3) : U.fmtTime(rec)}` : '')));
        const row = (label, ctrl) => { const r = this.el('div', 'srow'); r.appendChild(this.el('label', '', esc(label))); r.appendChild(ctrl); detail.appendChild(r); };
        const seg = (vals, key) => { const s = this.el('div', 'seg'); for (const [v, lk] of vals) s.appendChild(this.btn(esc(t(lk)), () => { opts[key] = v; renderDetail(); }, opts[key] === v ? 'on' : '')); return s; };
        if (ev.type !== 'drift' && ev.type !== 'timeattack') {
          const w = this.el('div', 'slider');
          const inp = this.el('input');
          inp.type = 'range'; inp.min = 0; inp.max = 7; inp.step = 1; inp.value = opts.ai; inp.id = 'lobby-ai';
          const out = this.el('output', '', t('ai.' + opts.ai));
          inp.oninput = () => { opts.ai = +inp.value; out.textContent = t('ai.' + opts.ai); };
          w.appendChild(inp); w.appendChild(out);
          row(t('lobby.ai'), w);
        }
        row(t('lobby.gearbox'), seg([['auto', 'lobby.gb.auto'], ['manual', 'lobby.gb.manual'], ['clutch', 'lobby.gb.clutch']], 'gearbox'));
        if (ev.rivals && ev.type !== 'elimination') {
          const w = this.el('div', 'slider');
          const inp = this.el('input');
          inp.type = 'range'; inp.min = 1; inp.max = 11; inp.step = 1; inp.value = opts.rivals || ev.rivals; inp.id = 'lobby-rivals';
          const out = this.el('output', '', String(opts.rivals || ev.rivals));
          inp.oninput = () => { opts.rivals = +inp.value; out.textContent = String(opts.rivals); };
          w.appendChild(inp); w.appendChild(out);
          row(t('lobby.rivals'), w);
        }
        if (ev.type === 'circuit') {
          row(t('lobby.laps'), seg([[null, 'lobby.lapsDef'], [1, 'n.1'], [3, 'n.3'], [5, 'n.5']], 'laps'));
        }
        row(t('lobby.boom'), seg([[true, 'ui.on'], [false, 'ui.off']], 'explosion'));
        if (ev.rivals) row(t('lobby.rubber'), seg([[true, 'ui.on'], [false, 'ui.off']], 'rubber'));
        const mult = SB.DATA.REWARD.aiMult[opts.ai] * SB.DATA.REWARD.gearbox[opts.gearbox] * g.assistMultiplier();
        const rw = g.rewindAllowance();
        detail.appendChild(this.el('div', 'note', `${esc(t('lobby.reward', { n: U.fmtInt(ev.reward), m: mult.toFixed(2) }))}<br>${esc(t('lobby.rewind', { n: isFinite(rw) ? rw : '∞' }))}`));
      };
      for (const ev of events) {
        const b = this.btn(`<b>${esc(t('ev.' + ev.id))}</b><small>${esc(t('type.' + ev.type))}</small>`, () => { sel = ev; for (const x of list.children) x.classList.remove('on'); b.classList.add('on'); renderDetail(); }, 'evitem' + (ev === sel ? ' on' : ''));
        list.appendChild(b);
      }
      renderDetail();
      foot.appendChild(this.btn(esc(t('lobby.start')), () => this.launch(sel, Object.assign({}, opts)), 'primary'));
      foot.appendChild(this.btn(esc(t('ui.back')), () => (g.state === 'menu' ? this.mainMenu() : this.closeToPlay())));
      this.open(p, 'center');
    }
    launch(ev, opts) {
      const g = this.game;
      if (ev.type === 'championship') {
        this.champ = { ev, opts, i: 0, points: {}, names: null };
        return this.champNext();
      }
      this.champ = null;
      g.startEvent(ev, opts);
    }
    champNext() {
      const c = this.champ;
      const ev = SB.RACES.find((e) => e.id === c.ev.events[c.i]);
      this.game.startEvent(ev, Object.assign({}, c.opts, { champ: true }));
    }

    // ------------------------------------------------------------ results
    raceResult(race) {
      const g = this.game, r = race.result;
      g.state = 'pause';
      const title = r.dnf ? t('res.dnf') : race.ev.type === 'drift' ? t('res.drift', { n: U.fmtInt(r.drift) }) : race.rivals.length ? t('res.pos', { n: r.pos }) : t('res.time', { t: U.fmtTime(r.time) });
      const { p, body, foot } = this.panel(title, t('ev.' + race.ev.id));
      const rows = [];
      const me = { name: t('res.you'), time: r.time, me: true, prog: race.playerProgress() };
      const all = [me].concat(race.rivals.map((rv) => ({ name: rv.name, time: rv.finished ? rv.finishT : r.time + Math.max(0, (race.laps * race.route.len - rv.progress()) / Math.max(5, rv.v)), out: rv.eliminated })));
      all.sort((a, b) => (a.out ? 1 : 0) - (b.out ? 1 : 0) || a.time - b.time);
      if (race.rivals.length) {
        const tb = this.el('div', 'restable');
        all.forEach((x, i) => tb.appendChild(this.el('div', 'rrow' + (x.me ? ' me' : ''), `<span>${i + 1}</span><b>${esc(x.name)}</b><i>${x.out ? esc(t('res.out')) : U.fmtTime(x.time)}</i>`)));
        body.appendChild(tb);
      }
      if (race.ev.type === 'drift') body.appendChild(this.el('div', 'stars', '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars)));
      if (isFinite(r.best) && race.ev.closed) body.appendChild(this.el('div', 'note', esc(t('race.best')) + ': ' + U.fmtTime(r.best)));
      body.appendChild(this.el('div', 'reward', `+${U.fmtInt(r.reward)} ${esc(t('ui.cr'))}`));
      void rows;
      // championship points
      const c = this.champ;
      if (c && race.opts.champ) {
        const pts = SB.DATA.REWARD.champPoints;
        all.forEach((x, i) => { c.points[x.name] = (c.points[x.name] || 0) + (x.out ? 0 : pts[i] || 0); });
        const tb = this.el('div', 'restable');
        Object.entries(c.points).sort((a, b) => b[1] - a[1]).forEach(([n, v], i) => tb.appendChild(this.el('div', 'rrow' + (n === t('res.you') ? ' me' : ''), `<span>${i + 1}</span><b>${esc(n)}</b><i>${v} ${esc(t('res.pts'))}</i>`)));
        body.appendChild(this.el('h3', '', esc(t('champ.standings', { n: c.i + 1, total: c.ev.events.length }))));
        body.appendChild(tb);
        c.i++;
        if (c.i < c.ev.events.length) foot.appendChild(this.btn(esc(t('champ.next')), () => this.champNext(), 'primary'));
        else {
          const top = Object.entries(c.points).sort((a, b) => b[1] - a[1])[0];
          if (top && top[0] === t('res.you')) { g.addCredits(c.ev.reward); g.achieve('champion'); body.appendChild(this.el('div', 'reward', esc(t('champ.won')))); }
          this.champ = null;
        }
      }
      if (!c || !race.opts.champ) foot.appendChild(this.btn(esc(t('res.retry')), () => g.startEvent(race.ev, race.opts), 'primary'));
      foot.appendChild(this.btn(esc(t('res.free')), () => g.backToFree()));
      this.open(p, 'center');
    }
    dragResult(d) {
      const g = this.game, r = d.result;
      g.state = 'pause';
      const { p, body, foot } = this.panel(r.foul ? t('drag.foul') : r.win ? t('drag.win') : t('drag.lose'), t('drag.title', { n: d.ev.dist }));
      if (!r.foul) {
        const tb = this.el('div', 'restable');
        const line = (k, v) => tb.appendChild(this.el('div', 'rrow', `<b>${esc(k)}</b><i>${v}</i>`));
        line(t('drag.et'), r.et.toFixed(3) + ' s');
        line(t('drag.trap'), Math.round(r.trap) + ' ' + t('ui.kmh'));
        line(t('drag.react'), r.react.toFixed(3) + ' s');
        line(t('drag.perfectN'), String(r.perfect));
        if (r.rivalEt) line(t('drag.rival'), r.rivalEt.toFixed(3) + ' s');
        body.appendChild(tb);
        body.appendChild(this.el('div', 'reward', `+${U.fmtInt(r.reward)} ${esc(t('ui.cr'))}`));
      }
      foot.appendChild(this.btn(esc(t('res.retry')), () => g.startEvent(d.ev, d.opts), 'primary'));
      foot.appendChild(this.btn(esc(t('res.free')), () => g.backToFree()));
      this.open(p, 'center');
    }
    parkResult(park, r) {
      const g = this.game;
      g.state = 'pause';
      const { p, body, foot } = this.panel(t('park.done'), t('park.title.' + park.id));
      body.appendChild(this.el('div', 'stars', '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars)));
      const tb = this.el('div', 'restable');
      const line = (k, v) => tb.appendChild(this.el('div', 'rrow', `<b>${esc(k)}</b><i>${v}</i>`));
      line(t('park.timeL'), r.time.toFixed(1) + ' s');
      line(t('park.hits'), String(r.hits));
      line(t('park.moves'), String(r.moves));
      line(t('park.angle'), r.angErr.toFixed(1) + '°');
      line(t('park.stalls'), String(park.stalls));
      body.appendChild(tb);
      body.appendChild(this.el('div', 'reward', `+${U.fmtInt(r.reward)} ${esc(t('ui.cr'))}`));
      foot.appendChild(this.btn(esc(t('res.retry')), () => g.startParking(park.id), 'primary'));
      foot.appendChild(this.btn(esc(t('res.free')), () => g.backToFree()));
      this.open(p, 'center');
    }
    licenseResult(pass, errs) {
      const g = this.game;
      g.state = 'pause';
      const { p, body, foot } = this.panel(pass ? t('lic.pass') : t('lic.fail'), t('lic.errors', { n: errs }));
      body.appendChild(this.el('div', 'note', esc(pass ? t('lic.passSub') : t('lic.failSub'))));
      foot.appendChild(this.btn(esc(t('res.retry')), () => g.startLicense(), pass ? '' : 'primary'));
      foot.appendChild(this.btn(esc(t('res.free')), () => g.backToFree(), pass ? 'primary' : ''));
      this.open(p, 'center');
    }
    explosionResult(info) {
      const g = this.game;
      g.state = 'result';
      const wrap = this.el('div', 'boom');
      const to = info.to === -1 ? 'R' : String(info.to);
      wrap.innerHTML = `<div class="boom-k">${esc(t('boom.title'))}</div><div class="boom-big">6 → ${to}</div>
        <div class="boom-stats"><div><b>${Math.round(info.kmh)}</b><span>${esc(t('ui.kmh'))}</span></div><div><b>${U.fmtInt(Math.round(info.rpm))}</b><span>${esc(t('boom.peak'))}</span></div><div><b>${g.save.stats.explosions}</b><span>${esc(t('boom.count'))}</span></div></div>
        <div class="boom-sub">${esc(t('boom.after.' + (g.mode && (g.mode.kind === 'race' || g.mode.kind === 'drag') ? 'race' : g.settings.difficulty)))}</div>`;
      const acts = this.el('div', 'acts');
      acts.appendChild(this.btn(esc(t('boom.replay')), () => g.startReplay()));
      if (g.settings.explosionRewind && g.rewindBuf.length > 20) acts.appendChild(this.btn(esc(t('boom.rewind', { key: g.keyLabel('rewind') })), () => { this.close(); g.state = 'play'; g.input.touch.rewind = false; g.hud.toast(t('boom.rewindHint', { key: g.keyLabel('rewind') }), 'info', 3); }));
      acts.appendChild(this.btn(esc(t('ui.continue')), () => { this.close(); g.state = 'play'; if (g.explosion) { g.explosion.stop(); g.explosion = null; } g.setCinematic(false); g.explosionAftermath(); }, 'primary'));
      wrap.appendChild(acts);
      this.open(wrap, 'boom-screen');
    }

    // ------------------------------------------------------------ police: arrest report
    bustedReport(r, done) {
      const g = this.game;
      const { p, body, foot } = this.panel(t('bust.title'), t('bust.sub'));
      p.classList.add('bust');
      const s = Math.floor(r.chase);
      const total = r.fine + r.impound;
      const photo = r.photo ? `<img alt="" src="${r.photo}">` : '';
      const rows = [
        [t('bust.chase'), Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')],
        [t('bust.stars'), '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)],
        [t('bust.takedowns'), String(r.takedowns)],
        [t('bust.bounty'), '−' + U.fmtInt(r.bounty) + ' ' + t('ui.cr')],
        [t('bust.fine'), '−' + U.fmtInt(r.fine) + ' ' + t('ui.cr')],
        [t('bust.impound'), '−' + U.fmtInt(r.impound) + ' ' + t('ui.cr')],
        [t('bust.points'), '−' + r.points],
      ];
      body.appendChild(this.el('div', 'bust-grid', `<div class="bust-photo">${photo}<span class="cap">${esc(t('bust.photo'))} · ${esc(g.env.clockText())}</span><span class="stamp">${esc(t('bust.stamp'))}</span></div>
        <div class="bust-rows">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}<div class="tot"><span>${esc(t('bust.total'))}</span><b>−${U.fmtInt(g.settings.fines ? total : 0)} ${esc(t('ui.cr'))}</b></div></div>`));
      foot.appendChild(this.btn(esc(t('bust.leave')), done, 'primary'));
      this.open(p, 'center');
    }

    // ------------------------------------------------------------ misc
    tips(back) {
      const g = this.game;
      const d = g.input.device;
      const { p, body, foot } = this.panel(t('tips.title'), t('tips.sub'));
      p.classList.add('wide');
      const K = (a) => `<kbd>${esc(g.keyLabel(a))}</kbd>`;
      const rows = d === 'touch' ? t('tips.touch') : d === 'gamepad' ? t('tips.pad') : t('tips.kb', { ign: K('ignition'), clutch: K('clutch'), half: K('halfClutch'), up: K('shiftUp'), down: K('shiftDown'), hand: K('handbrake'), cam: K('camera'), rew: K('rewind'), map: K('map'), f: K('interact'), tow: K('tow') });
      body.appendChild(this.el('div', 'tips', rows));
      body.appendChild(this.el('div', 'tips how', t('tips.how', { ign: K('ignition'), clutch: K('clutch') })));
      body.appendChild(this.el('div', 'warnbox', t('tips.boom')));
      // model credits (Sketchfab artists)
      const cr = [];
      for (const id of SB.DATA.CAR_ORDER) { const c = SB.DATA.CARS[id]; if (c.glb) cr.push([c.make + ' ' + c.name, c.glb.credit]); }
      for (const [id, P] of Object.entries(SB.DATA.PROPS)) cr.push([t('prop.' + id), P.credit]);
      body.appendChild(this.el('div', 'credits-list', `<h4>${esc(t('tips.credits'))}</h4>` + cr.map(([what, c]) => `<div><b>${esc(what)}</b> · ${this.carCredit(c).replace(/^<div class="credit">|<\/div>$/g, '')}</div>`).join('')));
      foot.appendChild(this.btn(esc(t('ui.ok')), () => (back ? back() : g.state === 'menu' ? this.mainMenu() : this.closeToPlay()), 'primary'));
      foot.appendChild(this.btn(esc(t('menu.license')), () => g.startLicense()));
      if (g.state === 'play') g.state = 'pause';
      this.open(p, 'center');
    }
    achievements() {
      const g = this.game;
      const { p, body, foot } = this.panel(t('menu.ach'), t('ach.sub', { n: Object.keys(g.save.achievements).length, total: SB.DATA.ACHIEVEMENTS.length }));
      const list = this.el('div', 'achs');
      for (const a of SB.DATA.ACHIEVEMENTS) {
        const have = !!g.save.achievements[a];
        list.appendChild(this.el('div', 'ach' + (have ? ' on' : ''), `<b>${esc(t('ach.' + a))}</b><small>${esc(t('achd.' + a))}</small>`));
      }
      body.appendChild(list);
      const st = g.save.stats;
      body.appendChild(this.el('div', 'note', esc(t('stats.line', { km: st.km.toFixed(1), e: st.explosions, s: st.stalls, p: st.perfect }))));
      foot.appendChild(this.btn(esc(t('ui.back')), () => this.mainMenu(), 'primary'));
      this.open(p, 'center');
    }
    console() {
      const g = this.game;
      if ($('console')) { $('console').remove(); return; }
      const box = this.el('form', 'console');
      box.id = 'console';
      const inp = this.el('input');
      inp.id = 'console-input';
      inp.placeholder = t('console.ph');
      inp.autocomplete = 'off';
      const out = this.el('pre', 'console-out', esc(t('console.help')));
      box.appendChild(out);
      box.appendChild(inp);
      box.addEventListener('submit', (e) => {
        e.preventDefault();
        const [cmd, ...a] = inp.value.trim().split(/\s+/);
        inp.value = '';
        let msg = 'ok';
        try {
          if (cmd === 'car' && SB.DATA.CARS[a[0]]) { g.save.cars[a[0]].owned = true; g.spawnPlayer(a[0]); }
          else if (cmd === 'tp') { const poi = g.world.pois.find((x) => x.id === a[0]); if (poi) g.teleportToPOI(poi.id); else g.player.place(+a[0], +a[1], 0); }
          else if (cmd === 'weather') { g.settings.weather = a[0]; g.env.setWeather(a[0]); }
          else if (cmd === 'time') g.env.setTime(+a[0]);
          else if (cmd === 'money') g.addCredits(+a[0]);
          else if (cmd === 'repair') { g.spawnPlayer(g.save.current); }
          else if (cmd === 'fuel') g.player.dt.fuel = g.player.car.fuelTank;
          else if (cmd === 'police') { const n = U.clamp(+a[0] || 0, 0, 5); if (!n) g.police.reset(); else { if (!g.police.stars) g.police.clearChase(); const b = g.police.stars; g.police.stars = n; g.police.onStars(b); } }
          else if (cmd === 'explode') { const d = g.player.dt; d.lastEngaged = 6; d.left6At = d.time; d.selStartKmh = 99; d.checkExplosion(1); }
          else if (cmd === 'debug') g.debug = !g.debug;
          else if (cmd === 'help') msg = t('console.help');
          else msg = t('console.unknown');
        } catch (err) { msg = String(err); }
        out.textContent = msg;
      });
      document.body.appendChild(box);
      setTimeout(() => inp.focus(), 30);
    }
    photoBar(on) {
      const g = this.game;
      const old = $('photobar');
      if (old) old.remove();
      if (!on) return;
      const bar = this.el('div', 'photobar');
      bar.id = 'photobar';
      bar.appendChild(this.el('span', '', esc(t('photo.hint'))));
      bar.appendChild(this.btn(esc(t('photo.shoot')), () => g.takePhoto(), 'primary'));
      bar.appendChild(this.btn(esc(t('photo.exit')), () => g.togglePhoto()));
      document.body.appendChild(bar);
    }
    showPhoto(url) {
      const box = this.el('div', 'photoview');
      box.innerHTML = `<img alt="${esc(t('photo.alt'))}" src="${url}"><p>${esc(t('photo.save'))}</p>`;
      box.appendChild(this.btn(esc(t('ui.close')), () => box.remove(), 'primary'));
      document.body.appendChild(box);
    }
  }

  SB.UI = UI;
})();
