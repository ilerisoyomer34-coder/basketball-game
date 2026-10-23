// SHIFTBREAKER — HUD: tachometer with shift lights and big gear indicator, H-pattern, pedals,
// damage schematic, gauges, warning lamps, minimap/GPS, big map, toasts, race panel, debug overlay.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const $ = (id) => document.getElementById(id);

  class HUD {
    constructor(game) {
      this.game = game;
      this.root = $('hud');
      this.tach = $('tach');
      this.tg = this.tach.getContext('2d');
      this.pat = $('pattern');
      this.pg = this.pat.getContext('2d');
      this.dmg = $('damage');
      this.dg = this.dmg.getContext('2d');
      this.mini = $('minimap');
      this.mg = this.mini.getContext('2d');
      this.toasts = $('toasts');
      this.broken = false;
      this.needleSpin = 0;
      this.cracks = null;
      this.allWarnings = false;
      this.cache = {};
      this.route = null;
      this.waypoint = null;
      this.flashT = 0;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const c of [this.tach, this.pat, this.dmg, this.mini]) {
        const w = c.width, h = c.height;
        c.width = w * this.dpr; c.height = h * this.dpr;
        c.style.width = w + 'px'; c.style.height = h + 'px';
        c.getContext('2d').scale(this.dpr, this.dpr);
      }
      $('prompt').addEventListener('pointerdown', (e) => { e.preventDefault(); this.game.interact(); });
      this.bigMap = $('bigmap');
      this.bigMap.addEventListener('click', (e) => this.onBigMapClick(e));
    }
    setText(id, v) {
      if (this.cache[id] === v) return;
      this.cache[id] = v;
      const el = $(id);
      if (el) el.textContent = v;
    }
    setHTML(id, v) {
      if (this.cache[id] === v) return;
      this.cache[id] = v;
      const el = $(id);
      if (el) el.innerHTML = v;
    }
    show(id, on) {
      const el = $(id);
      if (el && el.hidden === !!on) el.hidden = !on;
    }
    setDevice(d) {
      document.body.dataset.device = d;
      this.game.updateTouchVisibility();
    }
    colors() {
      const cb = this.game.settings.colorblind;
      if (cb === 'deuter' || cb === 'prot') return { ok: '#3b8cff', mid: '#f2c14e', bad: '#ff8c1a', led: ['#3b8cff', '#f2c14e', '#ff8c1a'] };
      if (cb === 'trit') return { ok: '#2bd3c4', mid: '#ff8fa3', bad: '#e83e5c', led: ['#2bd3c4', '#ff8fa3', '#e83e5c'] };
      return { ok: '#3fd47a', mid: '#f2b13b', bad: '#e5482d', led: ['#3fd47a', '#f2b13b', '#e5482d'] };
    }

    // ---------------------------------------------------------------- messages
    toast(text, kind, dur) {
      const d = document.createElement('div');
      d.className = 'toast ' + (kind || 'info');
      d.textContent = text;
      this.toasts.appendChild(d);
      while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
      setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, (dur || 2.4) * 1000);
    }
    big(text, sub, dur, kind) {
      const el = $('bigmsg');
      el.className = 'bigmsg ' + (kind || '');
      el.innerHTML = '<div class="bm-main"></div><div class="bm-sub"></div>';
      el.firstChild.textContent = text;
      el.lastChild.textContent = sub || '';
      el.hidden = false;
      clearTimeout(this._bigT);
      this._bigT = setTimeout(() => (el.hidden = true), (dur || 2) * 1000);
    }
    prompt(text) {
      const el = $('prompt');
      if (!text) { if (!el.hidden) el.hidden = true; return; }
      this.setText('prompt', text);
      el.hidden = false;
    }
    flash() {
      const f = $('flash');
      f.style.transition = 'none';
      f.style.opacity = this.game.settings.shake < 0.5 ? 0.45 : 0.95;
      requestAnimationFrame(() => { f.style.transition = 'opacity 0.9s ease-out'; f.style.opacity = 0; });
    }
    tachBreak(on) {
      this.broken = on;
      this.needleSpin = on ? 14 : 0;
      this.needleA = null;
      if (on) {
        const cr = [];
        for (let i = 0; i < 9; i++) {
          const a = Math.random() * Math.PI * 2;
          const pts = [[0, 0]];
          let r = 0, ang = a;
          while (r < 110) { r += 12 + Math.random() * 22; ang += (Math.random() - 0.5) * 0.5; pts.push([Math.cos(ang) * r, Math.sin(ang) * r]); }
          cr.push(pts);
        }
        this.cracks = { cx: (Math.random() - 0.5) * 50, cy: (Math.random() - 0.5) * 50, lines: cr };
      } else { this.cracks = null; this.allWarnings = false; }
    }

    // ---------------------------------------------------------------- tachometer
    drawTach(dt, frameDt) {
      const g = this.tg, S = 230, cx = S / 2, cy = S / 2, R = 100;
      const car = this.game.player.car;
      const redline = dt.redline();
      const maxR = Math.ceil((dt.limiter() + 1200) / 1000) * 1000;
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      const ang = (r) => a0 + (a1 - a0) * U.clamp(r / maxR, 0, 1.08);
      const C = this.colors();
      g.clearRect(0, 0, S, S);
      g.fillStyle = 'rgba(12,13,17,0.78)';
      g.beginPath(); g.arc(cx, cy, R + 12, 0, Math.PI * 2); g.fill();
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
      g.strokeStyle = C.bad;
      g.beginPath(); g.arc(cx, cy, R, ang(redline), a1); g.stroke();
      g.lineCap = 'butt';
      g.font = '600 13px "Chakra Petch", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let r = 0; r <= maxR; r += 500) {
        const a = ang(r), major = r % 1000 === 0;
        const r0 = major ? R - 16 : R - 9;
        g.strokeStyle = r >= redline ? C.bad : 'rgba(240,240,240,0.85)';
        g.lineWidth = major ? 3 : 1.5;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * (R - 3), cy + Math.sin(a) * (R - 3)); g.stroke();
        if (major) { g.fillStyle = r >= redline ? C.bad : '#d9dbe0'; g.fillText(String(r / 1000), cx + Math.cos(a) * (R - 30), cy + Math.sin(a) * (R - 30)); }
      }
      // needle
      const rpm = dt.rpm();
      let na = ang(rpm);
      if (this.broken) {
        if (this.needleA == null) this.needleA = na;
        this.needleA += this.needleSpin * frameDt;
        this.needleSpin *= Math.pow(0.4, frameDt);
        na = this.needleA;
      }
      g.strokeStyle = '#ff4a2e';
      g.lineWidth = 3.5;
      g.lineCap = 'round';
      g.beginPath();
      const off = this.broken ? 28 : 0;
      g.moveTo(cx + Math.cos(na) * (14 + off), cy + Math.sin(na) * (14 + off) + (this.broken ? 30 : 0));
      g.lineTo(cx + Math.cos(na) * (R - 8 + off * 0.2), cy + Math.sin(na) * (R - 8 + off * 0.2) + (this.broken ? 30 : 0));
      g.stroke();
      g.fillStyle = '#1b1d22';
      g.beginPath(); g.arc(cx, cy, 13, 0, Math.PI * 2); g.fill();
      // gear indicator
      const gearTxt = this.gearText(dt);
      const wrong = dt.lugging || (rpm > dt.limiter() + 100) || dt.state === 'GRIND';
      const blink = Math.floor(this.game.time * 6) % 2 === 0;
      g.font = '700 64px "Chakra Petch", monospace';
      g.fillStyle = dt.exploded ? '#ff4a2e' : wrong && blink ? C.bad : dt.state === 'SEL' ? 'rgba(255,255,255,0.45)' : '#f4f1ea';
      g.fillText(gearTxt, cx, cy - 6);
      // speed
      const units = this.game.settings.units;
      const spd = Math.abs(this.game.player.speed) * (units === 'mph' ? 2.23694 : 3.6);
      g.font = '700 24px "Chakra Petch", monospace';
      g.fillStyle = '#f4f1ea';
      g.fillText(String(Math.round(spd)), cx, cy + 46);
      g.font = '600 11px "Barlow Condensed", sans-serif';
      g.fillStyle = 'rgba(230,230,230,0.6)';
      g.fillText(units === 'mph' ? 'MPH' : 'KM/S', cx, cy + 64);
      g.font = '600 11px "Chakra Petch", monospace';
      g.fillText((rpm / 1000).toFixed(1) + 'k', cx, cy + 82);
      // cracked glass
      if (this.cracks) {
        g.save();
        g.beginPath(); g.arc(cx, cy, R + 11, 0, Math.PI * 2); g.clip();
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.lineWidth = 1.2;
        for (const l of this.cracks.lines) {
          g.beginPath();
          l.forEach(([x, y], i) => (i ? g.lineTo(cx + this.cracks.cx + x, cy + this.cracks.cy + y) : g.moveTo(cx + this.cracks.cx + x, cy + this.cracks.cy + y)));
          g.stroke();
        }
        g.restore();
      }
      // suggested gear
      const sug = this.game.settings.suggestGear ? this.suggest(dt, car) : 0;
      this.setText('suggest', sug > 0 ? '▲' : sug < 0 ? '▼' : '');
      // shift lights
      const leds = $('leds');
      if (!leds.children.length) for (let i = 0; i < 10; i++) leds.appendChild(document.createElement('i'));
      const r0 = redline * 0.72, r1 = redline * 0.97;
      const lit = U.clamp(Math.round(((rpm - r0) / (r1 - r0)) * 10), 0, 10);
      const flashAll = rpm >= r1 && blink;
      for (let i = 0; i < 10; i++) {
        const c = i < 4 ? C.led[0] : i < 7 ? C.led[1] : C.led[2];
        const on = flashAll || i < lit;
        const el = leds.children[i];
        const bg = on ? (flashAll ? '#4aa3ff' : c) : 'rgba(255,255,255,0.08)';
        if (el._bg !== bg) { el._bg = bg; el.style.background = bg; el.style.boxShadow = on ? '0 0 8px ' + bg : 'none'; }
      }
    }
    gearText(dt) {
      if (dt.exploded) return '✖';
      if (dt.state === 'ENG') return dt.gear === -1 ? 'R' : String(dt.gear);
      if (dt.state === 'GRIND') return '!';
      return 'N';
    }
    suggest(dt, car) {
      if (dt.state !== 'ENG' || dt.gear < 1) return 0;
      const rpm = dt.rpm(), rl = dt.redline();
      const thr = this.game.player.input.throttle;
      if (dt.gear < 6 && (rpm > rl * 0.93 || (thr < 0.35 && rpm > rl * 0.6))) return 1;
      if (dt.gear > 1 && rpm < SB.DATA.RULES.lug.base + 250) return -1;
      void car;
      return 0;
    }

    drawPattern(dt) {
      const g = this.pg, W = 96, H = 76;
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(12,13,17,0.7)';
      g.fillRect(0, 0, W, H);
      const car = this.game.player.car;
      const C = this.colors();
      if (dt.seqMode()) {
        g.strokeStyle = 'rgba(230,230,230,0.55)';
        g.lineWidth = 5;
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(W / 2, 14); g.lineTo(W / 2, H - 14); g.stroke();
        g.font = '700 14px "Chakra Petch", monospace';
        g.fillStyle = '#ddd';
        g.textAlign = 'center';
        g.fillText('+', W / 2 + 20, 18);
        g.fillText('−', W / 2 + 20, H - 12);
        g.fillStyle = dt.state === 'GRIND' ? C.bad : '#ffb43a';
        g.beginPath(); g.arc(W / 2, H / 2 - dt.lever.y * 22, 7, 0, Math.PI * 2); g.fill();
        return;
      }
      const lay = SB.DATA.LAYOUTS[car.layout] || SB.DATA.LAYOUTS.A;
      const xs = Object.values(lay).map((p) => p[0]);
      const mn = Math.min(...xs), mx = Math.max(...xs);
      const px = (x) => 14 + ((x - mn) / (mx - mn || 1)) * (W - 28);
      const py = (y) => H / 2 - y * 22;
      g.strokeStyle = 'rgba(230,230,230,0.5)';
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(px(mn), py(0)); g.lineTo(px(mx), py(0)); g.stroke();
      g.font = '700 10px "Chakra Petch", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const [k, p] of Object.entries(lay)) {
        g.beginPath(); g.moveTo(px(p[0]), py(0)); g.lineTo(px(p[0]), py(p[1])); g.stroke();
        const gear = +k;
        g.fillStyle = dt.state === 'ENG' && dt.gear === gear ? '#ffb43a' : 'rgba(235,235,235,0.75)';
        g.fillText(gear === -1 ? 'R' : String(gear), px(p[0]) + 8, py(p[1] * 1.05));
      }
      g.fillStyle = dt.state === 'GRIND' ? C.bad : dt.state === 'ENG' ? '#ffb43a' : '#f4f1ea';
      g.beginPath(); g.arc(px(dt.lever.x), py(dt.lever.y), 5.5, 0, Math.PI * 2); g.fill();
    }

    drawDamage(car) {
      const g = this.dg, W = 70, H = 120;
      const dt = car.dt, C = this.colors();
      g.clearRect(0, 0, W, H);
      const col = (hp) => (hp > 0.75 ? C.ok : hp > 0.4 ? C.mid : C.bad);
      g.fillStyle = 'rgba(12,13,17,0.7)';
      g.fillRect(0, 0, W, H);
      // body outline
      g.strokeStyle = col(1 - car.damage.body);
      g.lineWidth = 2.5;
      g.beginPath();
      g.roundRect ? g.roundRect(17, 8, 36, 104, 10) : g.rect(17, 8, 36, 104);
      g.stroke();
      const box = (x, y, w, h, hp) => { g.fillStyle = col(hp); g.fillRect(x, y, w, h); };
      box(23, 12, 24, 4, dt.health.radiator);
      box(25, 19, 20, 16, dt.health.engine);
      box(30, 37, 10, 6, dt.health.clutch);
      let gb = dt.health.gearbox;
      for (const k of Object.keys(dt.gearHealth)) gb = Math.min(gb, dt.gearHealth[k] * 0.7 + 0.3);
      box(29, 44, 12, 16, gb);
      const w = car.wheels;
      const tire = (i) => 1 - Math.max(car.damage.tires[i], w[i].wear, w[i].burst ? 1 : 0);
      box(9, 22, 8, 16, Math.min(tire(0), 1 - car.damage.susp[0]));
      box(53, 22, 8, 16, Math.min(tire(1), 1 - car.damage.susp[1]));
      box(9, 82, 8, 16, Math.min(tire(2), 1 - car.damage.susp[2]));
      box(53, 82, 8, 16, Math.min(tire(3), 1 - car.damage.susp[3]));
      box(31, 62, 8, 30, 1 - car.damage.steering);
    }

    drawMinimap(player) {
      const g = this.mg, S = 170, W = this.game.world;
      const map = W.map;
      const [px, py] = W.toMap(player.pos.x, player.pos.z);
      const zoom = U.lerp(1.6, 0.9, U.clamp(Math.abs(player.speed) / 40, 0, 1));
      g.save();
      g.clearRect(0, 0, S, S);
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
      g.fillStyle = '#1b2228';
      g.fillRect(0, 0, S, S);
      g.translate(S / 2, S / 2);
      g.rotate(-player.yaw);
      g.scale(zoom, zoom);
      g.drawImage(map.canvas, -px, -py);
      // GPS route
      const drawPoly = (pts, color, width) => {
        g.strokeStyle = color;
        g.lineWidth = width / zoom;
        g.lineJoin = 'round';
        g.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          const [x, y] = W.toMap(pts[i], pts[i + 1]);
          i ? g.lineTo(x - px, y - py) : g.moveTo(x - px, y - py);
        }
        g.stroke();
      };
      if (this.route) drawPoly(this.route, '#7fd3ff', 4);
      const mode = this.game.mode;
      if (mode && mode.routePts) drawPoly(mode.routePts, 'rgba(255,196,58,0.85)', 4);
      const dot = (x, z, color, r, label) => {
        const [mx, my] = W.toMap(x, z);
        g.fillStyle = color;
        g.beginPath(); g.arc(mx - px, my - py, r / zoom, 0, Math.PI * 2); g.fill();
        if (label) {
          g.save();
          g.translate(mx - px, my - py);
          g.rotate(player.yaw);
          g.fillStyle = '#111';
          g.font = `700 ${9 / zoom}px "Barlow Condensed", sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(label, 0, 0.5 / zoom);
          g.restore();
        }
      };
      for (const p of W.pois) dot(p.x, p.z, POI_COLORS[p.type] || '#ddd', 6.5, POI_GLYPH[p.type]);
      if (mode && mode.minimapDots) mode.minimapDots(dot);
      for (const c of this.game.traffic.police) dot(c.x, c.z, Math.floor(this.game.time * 6) % 2 ? '#ff3b30' : '#2f7dff', 4.5);
      if (this.waypoint) dot(this.waypoint.x, this.waypoint.z, '#7fd3ff', 6, '★');
      g.restore();
      // player arrow
      g.fillStyle = '#ffb43a';
      g.beginPath(); g.moveTo(S / 2, S / 2 - 9); g.lineTo(S / 2 + 6, S / 2 + 7); g.lineTo(S / 2, S / 2 + 3); g.lineTo(S / 2 - 6, S / 2 + 7); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.stroke();
      // north marker
      g.fillStyle = '#e5482d';
      g.font = '700 11px "Barlow Condensed", sans-serif';
      g.textAlign = 'center';
      g.fillText(SB.i18n.t('map.north'), S / 2 - Math.sin(player.yaw) * (S / 2 - 12), S / 2 - Math.cos(player.yaw) * (S / 2 - 12) + 4);
    }

    // ---------------------------------------------------------------- big map + GPS
    openMap(on) {
      const el = $('mapview');
      el.hidden = !on;
      if (on) this.drawBigMap();
    }
    drawBigMap() {
      const c = this.bigMap, W = this.game.world;
      const r = c.getBoundingClientRect();
      c.width = r.width * this.dpr;
      c.height = r.height * this.dpr;
      const g = c.getContext('2d');
      const m = W.map;
      const sc = Math.min(c.width / m.w, c.height / m.h);
      this.bigScale = sc;
      this.bigOff = [(c.width - m.w * sc) / 2, (c.height - m.h * sc) / 2];
      g.fillStyle = '#12171b';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(m.canvas, this.bigOff[0], this.bigOff[1], m.w * sc, m.h * sc);
      const tp = (x, z) => { const [mx, my] = W.toMap(x, z); return [this.bigOff[0] + mx * sc, this.bigOff[1] + my * sc]; };
      if (this.route) {
        g.strokeStyle = '#7fd3ff';
        g.lineWidth = 4 * this.dpr;
        g.beginPath();
        for (let i = 0; i < this.route.length; i += 2) { const [x, y] = tp(this.route[i], this.route[i + 1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
      g.font = `700 ${12 * this.dpr}px "Barlow Condensed", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const p of W.pois) {
        const [x, y] = tp(p.x, p.z);
        g.fillStyle = POI_COLORS[p.type] || '#ddd';
        g.beginPath(); g.arc(x, y, 8 * this.dpr, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111';
        g.fillText(POI_GLYPH[p.type] || '', x, y + 1);
      }
      const labels = [['map.historic', -470, -470], ['map.business', 60, 480], ['map.port', 170, -560], ['map.forest', -470, 520], ['map.strait', 500, 300], ['map.airport', 790, -250], ['map.center', -60, 30]];
      g.font = `600 ${13 * this.dpr}px "Barlow Condensed", sans-serif`;
      for (const [k, x, z] of labels) { const [lx, ly] = tp(x, z); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillText(SB.i18n.t(k).toLocaleUpperCase(SB.i18n.locale()), lx, ly); }
      const pl = this.game.player;
      const [x, y] = tp(pl.pos.x, pl.pos.z);
      g.fillStyle = '#ffb43a';
      g.beginPath(); g.arc(x, y, 7 * this.dpr, 0, Math.PI * 2); g.fill();
      if (this.waypoint) { const [wx, wy] = tp(this.waypoint.x, this.waypoint.z); g.fillStyle = '#7fd3ff'; g.font = `700 ${20 * this.dpr}px sans-serif`; g.fillText('★', wx, wy); }
    }
    onBigMapClick(e) {
      const c = this.bigMap, W = this.game.world;
      const r = c.getBoundingClientRect();
      const px = ((e.clientX - r.left) * this.dpr - this.bigOff[0]) / this.bigScale;
      const py = ((e.clientY - r.top) * this.dpr - this.bigOff[1]) / this.bigScale;
      const [x, z] = W.fromMap(px, py);
      this.setWaypoint(x, z);
      this.drawBigMap();
    }
    setWaypoint(x, z) {
      const W = this.game.world;
      const pl = this.game.player;
      const a = W.nearestNode(pl.pos.x, pl.pos.z, false), b = W.nearestNode(x, z, false);
      const path = a && b ? W.findPath(a.id, b.id, false) : null;
      this.waypoint = { x: b ? b.x : x, z: b ? b.z : z };
      this.route = path ? W.pathPolyline(path) : null;
      this.game.audio.click();
    }
    clearWaypoint() { this.waypoint = null; this.route = null; }

    // ---------------------------------------------------------------- per frame
    update(frameDt) {
      const game = this.game, car = game.player;
      if (!car) return;
      const dt = car.dt, s = game.settings;
      const hudOn = !game.hideHud;
      this.root.classList.toggle('hidden', !hudOn);
      if (!hudOn) return;
      this.root.classList.toggle('big', !!s.bigText);
      this.show('tachWrap', s.hud.tach);
      this.show('mapWrap', s.hud.map);
      this.show('damage', s.hud.damage);
      this.show('pedals', s.hud.pedals);
      this.show('pattern', s.hud.pattern);
      if (s.hud.tach) this.drawTach(dt, frameDt);
      if (s.hud.pattern) this.drawPattern(dt);
      if (s.hud.damage) this.drawDamage(car);
      if (s.hud.map) this.drawMinimap(car);
      // pedals
      if (s.hud.pedals) {
        const inp = car.input;
        $('pThr').style.height = Math.round(inp.throttle * 100) + '%';
        $('pBrk').style.height = Math.round(Math.max(inp.brake, inp.handbrake) * 100) + '%';
        $('pClu').style.height = Math.round(dt.clutchPedal * 100) + '%';
        const bite = 1 - car.car.clutch.bite;
        $('pBite').style.bottom = Math.round(bite * 100) + '%';
      }
      // gauges
      const fuelF = U.clamp(dt.fuel / car.car.fuelTank, 0, 1);
      $('gFuel').style.width = Math.round(fuelF * 100) + '%';
      $('gFuel').classList.toggle('low', fuelF < 0.12);
      const tF = U.clamp((dt.engineTemp - 40) / 90, 0, 1);
      $('gTemp').style.width = Math.round(tF * 100) + '%';
      $('gTemp').classList.toggle('low', dt.engineTemp > SB.DATA.RULES.engineHeat.overheat);
      const lps = dt.lps || 0;
      const kmh = Math.abs(car.speed) * 3.6;
      this.setText('consume', kmh > 5 ? ((lps * 3600) / kmh * 100).toFixed(1) + ' L/100' : (lps * 3600).toFixed(1) + ' L/h');
      // warning lamps
      const all = this.allWarnings;
      const lamp = (id, on) => { const el = $(id); const v = !!(on || all); if (el._on !== v) { el._on = v; el.classList.toggle('on', v); } };
      lamp('wHand', car.input.handbrake > 0.3);
      lamp('wEngine', dt.health.engine < 0.7 || dt.seized || dt.misfireT > 0);
      lamp('wBatt', !dt.running && game.ignitionOn);
      lamp('wOil', (!dt.running && game.ignitionOn) || dt.health.engine < 0.3);
      lamp('wTemp', dt.engineTemp > SB.DATA.RULES.engineHeat.overheat);
      lamp('wClutch', dt.clutchTemp > SB.DATA.RULES.clutchHeat.hot);
      lamp('wAbs', car.absActive > 0);
      lamp('wTcs', car.tcsActive > 0 || car.escActive > 0);
      lamp('wBeam', car.lightsMode === 2);
      lamp('wFuel', fuelF < 0.12 && s.fuel);
      const blink = Math.floor(game.time * 2.6) % 2 === 0;
      lamp('wIndL', (car.ind === -1 || car.ind === 2) && blink);
      lamp('wIndR', (car.ind === 1 || car.ind === 2) && blink);
      car.absActive = Math.max(0, (car.absActive || 0) - frameDt);
      car.tcsActive = Math.max(0, (car.tcsActive || 0) - frameDt);
      car.escActive = Math.max(0, (car.escActive || 0) - frameDt);
      // top bar
      this.setText('credits', U.fmtInt(game.save.credits) + ' ' + SB.i18n.t('ui.cr'));
      this.setText('clock', game.env.clockText());
      this.setText('weatherIco', WEATHER_ICON[game.env.nextWeather] || '');
      const stars = game.police ? game.police.stars : 0;
      this.setHTML('wanted', stars ? '<b>' + '★'.repeat(stars) + '</b>' + '☆'.repeat(3 - stars) : '');
      this.show('wanted', stars > 0);
      // reverse camera frame
      this.show('revcam', game.showRevCam);
      this.show('mirror', game.showMirror);
      // debug overlay
      if (game.debug) this.drawDebug(car);
      this.show('debug', !!game.debug);
    }
    drawDebug(car) {
      const dt = car.dt;
      const w = car.wheels.map((x, i) => `${['FL', 'FR', 'RL', 'RR'][i]} Fz ${x.Fz.toFixed(0)} sr ${x.sr.toFixed(2)} ρ ${x.rho.toFixed(2)} ω ${x.omega.toFixed(1)} ${x.surf}`).join('\n');
      const txt = [
        `FPS ${this.game.fps.toFixed(0)}  physics ${this.game.physHz} Hz  ×${this.game.timeScale.toFixed(2)}`,
        `rpm ${dt.rpm().toFixed(0)}  Te ${dt.Te.toFixed(0)} Nm  thrEff ${dt.thrEff.toFixed(2)}  boost ${dt.boost.toFixed(2)}`,
        `clutch pedal ${dt.clutchPedal.toFixed(2)} eng ${dt.engagement.toFixed(2)} Tcap ${dt.Tcap.toFixed(0)} Tc ${dt.Tc.toFixed(0)} slip ${dt.slipW.toFixed(1)} rad/s ${dt.locked ? 'LOCKED' : 'SLIP'}`,
        `gearbox ${dt.state} gear ${dt.gear} target ${dt.target} grind ${dt.grindKind || '-'} last ${dt.lastEngaged} t6 ${(dt.time - dt.left6At).toFixed(2)}s`,
        `health eng ${dt.health.engine.toFixed(2)} gb ${dt.health.gearbox.toFixed(2)} clu ${dt.health.clutch.toFixed(2)} rad ${dt.health.radiator.toFixed(2)}  gears ${Object.entries(dt.gearHealth).map(([k, v]) => k + ':' + v.toFixed(2)).join(' ')}`,
        `temps eng ${dt.engineTemp.toFixed(0)}°C clutch ${dt.clutchTemp.toFixed(0)}°C  fuel ${dt.fuel.toFixed(1)} L`,
        `v ${(car.speed * 3.6).toFixed(1)} km/h  steer ${car.steerAngle.toFixed(2)}  pos ${car.pos.x.toFixed(0)},${car.pos.z.toFixed(0)} y ${car.pos.y.toFixed(1)}`,
        w,
      ].join('\n');
      this.setText('debug', txt);
    }
  }

  const POI_COLORS = { garage: '#7ad37a', gas: '#5fb7ff', repair: '#ff8a5c', gallery: '#e7d36a', modshop: '#ff7ad0', license: '#ffffff', drag: '#ffb43a', streetRace: '#ff4a2e', parking: '#9aa7ff' };
  const POI_GLYPH = { garage: 'G', gas: 'Y', repair: 'T', gallery: '₲', modshop: 'M', license: 'E', drag: 'D', streetRace: 'S', parking: 'P' };
  const WEATHER_ICON = { sunny: '☀', cloudy: '☁', fog: '🌫', rain: '🌧', storm: '⛈', snow: '❄' };
  HUD.POI_COLORS = POI_COLORS;
  SB.HUD = HUD;
})();
