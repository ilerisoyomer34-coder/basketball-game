// SHIFTBREAKER — police: wanted level and pursuit (heat, bounty, takedowns, roadblocks with spike strips,
// a helicopter with a searchlight), the officer's gun-drawn standoff, the pull-over ticket scene and the
// arrest scene (hands up, handcuffs, into the back of the cruiser).
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const T = THREE;
  const t = (k, p) => SB.i18n.t(k, p);
  const MAX = 5;
  const P2 = (x, z) => ({ x, z });
  const off = (o, a, ka, b, kb) => P2(o.x + a.x * ka + (b ? b.x * kb : 0), o.z + a.z * ka + (b ? b.z * kb : 0));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const cruiserLeft = (c) => P2(c.tz, -c.tx);

  // any solid world collider within r of (x, z)
  function blocked(W, x, z, r) {
    let hit = false;
    W.query(x, z, r + 6, (o) => {
      if (hit || !o.solid) return;
      if (o.type === 'circle') { if (Math.hypot(o.x - x, o.z - z) < o.r + r) hit = true; } else if (U.circleRect(x, z, r, o)) hit = true;
    });
    return hit;
  }
  function rectBlocked(W, R) {
    let hit = false;
    W.query(R.x, R.z, Math.max(R.hl, R.hw) + 6, (o) => {
      if (hit || !o.solid) return;
      if (o.type === 'circle' ? U.circleRect(o.x, o.z, o.r, R) : U.obbOverlap(R, o)) hit = true;
    });
    return hit;
  }

  // ------------------------------------------------------------------ spike strip
  let hazardTex = null;
  function hazard() {
    if (hazardTex) return hazardTex;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 16;
    const g = c.getContext('2d');
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#111' : '#f2c200'; g.beginPath(); g.moveTo(i * 8, 0); g.lineTo(i * 8 + 8, 0); g.lineTo(i * 8, 16); g.lineTo(i * 8 - 8, 16); g.fill(); }
    hazardTex = new T.CanvasTexture(c);
    hazardTex.wrapS = T.RepeatWrapping;
    return hazardTex;
  }
  class Spike {
    constructor(game, x, z, ang, half) {
      this.game = game;
      this.x = x; this.z = z;
      this.rect = { x, z, hl: 0.28, hw: half + 0.4, ang };
      this.t = 0;
      const W = 2 * (half + 0.4);
      const grp = (this.grp = new T.Group());
      const tex = hazard().clone();
      tex.needsUpdate = true;
      tex.repeat.set(W / 1.2, 1);
      const base = new T.Mesh(new T.BoxGeometry(W, 0.04, 0.32), new T.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      base.position.y = 0.03;
      base.receiveShadow = true;
      grp.add(base);
      const n = Math.max(8, Math.round(W / 0.25));
      const cones = (this.cones = new T.InstancedMesh(new T.ConeGeometry(0.025, 0.09, 4), new T.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 }), n * 2));
      const m = new T.Matrix4();
      for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) { m.makeTranslation(-W / 2 + (i + 0.5) * (W / n), 0.09, k ? 0.08 : -0.08); cones.setMatrixAt(i * 2 + k, m); }
      grp.add(cones);
      grp.position.set(x, game.world.heightAt(x, z), z);
      grp.rotation.y = ang;
      game.scene.add(grp);
    }
    // burst any player tyre that rolls over the spikes
    check(pl) {
      let n = 0;
      pl.wheels.forEach((w, i) => {
        if (w.burst || !w.contact) return;
        if (!U.circleRect(w.cp.x, w.cp.z, 0.16, this.rect)) return;
        w.burst = true;
        pl.damage.tires[i] = 1;
        this.game.fx.sparkBurst(w.cp, 14, 3);
        n++;
      });
      return n;
    }
    dispose() {
      this.game.scene.remove(this.grp);
      this.grp.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    }
  }

  // ------------------------------------------------------------------ helicopter with a searchlight
  let heliTex = null;
  function heliLabel() {
    if (heliTex) return heliTex;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#1e4fd8'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff';
    g.font = '900 48px "Barlow Condensed", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('POLİS', 128, 34);
    heliTex = new T.CanvasTexture(c);
    return heliTex;
  }
  class Heli {
    constructor(game) {
      this.game = game;
      const pl = game.player;
      const a = Math.random() * Math.PI * 2;
      this.pos = new T.Vector3(pl.pos.x + Math.cos(a) * 420, 0, pl.pos.z + Math.sin(a) * 420);
      this.pos.y = game.world.heightAt(this.pos.x, this.pos.z) + 58;
      this.vel = new T.Vector3();
      this.yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
      this.spot = new T.Vector3(pl.pos.x, 0, pl.pos.z);
      this.spotting = false;
      this.leaving = false;
      this.gone = false;
      this.t = 0;
      this.thumpT = 0;
      const S = (c, o) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.45, metalness: 0.3 }, o));
      const white = S(0xe9edf2), blue = S(0x1e4fd8), dark = S(0x1b1e22, { roughness: 0.7 }), glass = S(0x16202a, { roughness: 0.1, metalness: 0.7 });
      const grp = (this.grp = new T.Group());
      const body = new T.Group();
      grp.add(body);
      this.body = body;
      const mesh = (g, m, x, y, z, parent) => { const o = new T.Mesh(g, m); o.position.set(x || 0, y || 0, z || 0); o.castShadow = game.quality !== 'low'; (parent || body).add(o); return o; };
      mesh(new T.SphereGeometry(1, 18, 12).scale(1.2, 1.1, 2.25), white);
      mesh(new T.SphereGeometry(1, 18, 10).scale(1.22, 0.55, 2.27), blue, 0, -0.45, 0);
      mesh(new T.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1.02, 0.9, 1.25), glass, 0, 0.12, 1.05).rotation.x = 1.1;
      mesh(new T.CylinderGeometry(0.28, 0.13, 5.2, 10).rotateX(Math.PI / 2), white, 0, 0.3, -3.7);
      mesh(new T.BoxGeometry(0.08, 1.3, 0.85), blue, 0, 0.85, -6.15);
      mesh(new T.BoxGeometry(1.6, 0.06, 0.5), blue, 0, 0.35, -5.6);
      mesh(new T.CylinderGeometry(0.13, 0.16, 0.55, 8), dark, 0, 1.3, 0);
      for (const sx of [-1, 1]) {
        mesh(new T.CylinderGeometry(0.05, 0.05, 3.3, 6).rotateX(Math.PI / 2), dark, sx * 0.95, -1.5, 0.1);
        for (const z of [-0.8, 0.9]) mesh(new T.CylinderGeometry(0.035, 0.035, 0.6, 5), dark, sx * 0.85, -1.2, z).rotation.z = sx * 0.35;
        const lab = mesh(new T.PlaneGeometry(1.5, 0.38), new T.MeshStandardMaterial({ map: heliLabel(), roughness: 0.5 }), sx * 1.215, -0.05, -0.2);
        lab.rotation.y = sx * Math.PI / 2;
        lab.castShadow = false;
      }
      mesh(new T.CylinderGeometry(0.16, 0.2, 0.3, 10), dark, 0, -1.0, 1.55);
      // main rotor (blades + a faint blur disc), tail rotor
      const rotor = (this.rotor = new T.Group());
      rotor.position.set(0, 1.6, 0);
      body.add(rotor);
      for (let k = 0; k < 4; k++) { const b = mesh(new T.BoxGeometry(0.3, 0.04, 5.3).translate(0, 0, 2.65), dark, 0, 0, 0, rotor); b.rotation.y = (k * Math.PI) / 2; }
      const blur = new T.Mesh(new T.CircleGeometry(5.4, 32).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, depthWrite: false, side: T.DoubleSide }));
      blur.position.y = 1.62;
      body.add(blur);
      const tail = (this.tail = new T.Group());
      tail.position.set(0.12, 0.85, -6.15);
      body.add(tail);
      for (let k = 0; k < 2; k++) { const b = mesh(new T.BoxGeometry(0.03, 1.4, 0.12), dark, 0, 0, 0, tail); b.rotation.x = (k * Math.PI) / 2; }
      // beacons
      this.beacon = [mesh(new T.SphereGeometry(0.09, 8, 6), new T.MeshBasicMaterial({ color: 0xff2020 }), 0, 1.0, -1.6), mesh(new T.SphereGeometry(0.09, 8, 6), new T.MeshBasicMaterial({ color: 0x2060ff }), 0, -1.12, -1.0)];
      // searchlight beam and its pool on the ground
      this.coneMat = new T.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.1, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
      this.cone = new T.Mesh(new T.ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2), this.coneMat);
      this.cone.frustumCulled = false;
      this.poolMat = new T.MeshBasicMaterial({ color: 0xfff4d8, transparent: true, opacity: 0.3, blending: T.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
      this.pool = new T.Mesh(new T.CircleGeometry(1, 28).rotateX(-Math.PI / 2), this.poolMat);
      game.scene.add(grp, this.cone, this.pool);
    }
    leave() { if (!this.leaving) { this.leaving = true; this.away = new T.Vector3(this.pos.x - this.game.player.pos.x, 0, this.pos.z - this.game.player.pos.z).normalize(); this.t = 0; } }
    update(dt) {
      const g = this.game, pl = g.player, W = g.world;
      this.t += dt;
      let tx, tz;
      if (this.leaving) { tx = this.pos.x + this.away.x * 600; tz = this.pos.z + this.away.z * 600; } else {
        // hover a little behind the car so the beam slants onto it
        tx = pl.pos.x + pl.vel.x * 1.3 - pl.fwd.x * 16;
        tz = pl.pos.z + pl.vel.z * 1.3 - pl.fwd.z * 16;
      }
      const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
      const vmax = 46, vw = d > 0.5 ? Math.min(vmax, d * 0.7) : 0;
      const wx = d > 0.5 ? (dx / d) * vw : 0, wz = d > 0.5 ? (dz / d) * vw : 0;
      const ax = U.clamp(wx - this.vel.x, -11 * dt, 11 * dt), az = U.clamp(wz - this.vel.z, -11 * dt, 11 * dt);
      this.vel.x += ax; this.vel.z += az;
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      const gy = W.heightAt(this.pos.x, this.pos.z) + 58;
      this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 0.8);
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 3) this.yaw += U.clamp(U.angleWrap(Math.atan2(this.vel.x, this.vel.z) - this.yaw), -1.2 * dt, 1.2 * dt);
      this.grp.position.copy(this.pos);
      this.grp.rotation.y = this.yaw;
      // nose down when flying fast, bank into the acceleration
      const fwdA = (ax * Math.sin(this.yaw) + az * Math.cos(this.yaw)) / Math.max(dt, 1e-4);
      const sideA = (ax * Math.cos(this.yaw) - az * Math.sin(this.yaw)) / Math.max(dt, 1e-4);
      this.body.rotation.x = U.damp(this.body.rotation.x, U.clamp(sp / 46 * 0.22 + fwdA * 0.01, -0.3, 0.35), 2, dt);
      this.body.rotation.z = U.damp(this.body.rotation.z, U.clamp(-sideA * 0.03, -0.35, 0.35), 2, dt);
      this.rotor.rotation.y += dt * 38;
      this.tail.rotation.x += dt * 60;
      const blink = Math.floor(this.t * 3) % 2;
      this.beacon[0].visible = !!blink; this.beacon[1].visible = !blink;
      // searchlight: tracks the car at a limited rate
      const hz = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      let sx = pl.pos.x, sz = pl.pos.z;
      if (this.leaving || hz > 110) { sx = this.pos.x + Math.sin(this.yaw) * 30 + Math.sin(this.t * 0.7) * 12; sz = this.pos.z + Math.cos(this.yaw) * 30 + Math.cos(this.t * 0.9) * 12; }
      const mx = sx - this.spot.x, mz = sz - this.spot.z, md = Math.hypot(mx, mz), mv = 28 * dt;
      if (md > mv) { this.spot.x += (mx / md) * mv; this.spot.z += (mz / md) * mv; } else { this.spot.x = sx; this.spot.z = sz; }
      this.spot.y = W.heightAt(this.spot.x, this.spot.z);
      this.spotting = !this.leaving && Math.hypot(this.spot.x - pl.pos.x, this.spot.z - pl.pos.z) < 6.5 && hz < 110;
      const src = new T.Vector3(0, -1.0, 1.55).applyEuler(this.grp.rotation).add(this.pos);
      const L = src.distanceTo(this.spot), R = 5.5;
      this.cone.position.copy(src);
      this.cone.lookAt(this.spot);
      this.cone.scale.set(R, R, L);
      this.pool.position.set(this.spot.x, this.spot.y + 0.12, this.spot.z);
      this.pool.scale.setScalar(R);
      const night = g.env ? g.env.night : 0;
      // seen from inside the beam the back faces would wash the screen out
      const cp = g.camera.position, bx = this.spot.x - src.x, by = this.spot.y - src.y, bz = this.spot.z - src.z;
      const k = U.clamp(((cp.x - src.x) * bx + (cp.y - src.y) * by + (cp.z - src.z) * bz) / (L * L), 0, 1);
      const inside = Math.hypot(cp.x - (src.x + bx * k), cp.y - (src.y + by * k), cp.z - (src.z + bz * k)) < R * k + 0.5;
      this.coneMat.opacity = (0.03 + 0.11 * night) * (inside ? 0.35 : 1);
      this.poolMat.opacity = 0.12 + 0.45 * night;
      // rotor thump
      const ld = g.camera.position.distanceTo(this.pos);
      this.thumpT -= dt;
      if (this.thumpT <= 0 && ld < 420) { this.thumpT = 0.085; g.audio.burst(85, 1.4, 0.26 * (1 - ld / 420), 0.07, 'lowpass'); }
      if (this.leaving && (this.t > 25 || hz > 650)) this.gone = true;
    }
    dispose() {
      const sc = this.game.scene;
      sc.remove(this.grp, this.cone, this.pool);
      for (const root of [this.grp, this.cone, this.pool]) root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
  }

  // ------------------------------------------------------------------ police / wanted level
  class Police {
    constructor(game) {
      this.game = game;
      this.stars = 0;
      this.heli = null;
      this.spikes = [];
      this.scene = null;
      this.standoff = null;
      this.leftovers = [];
      this.clearChase();
    }
    clearChase() {
      this.escapeT = this.bustT = this.evadeT = this.heatT = this.chaseT = 0;
      this.bounty = 0;
      this.takedowns = 0;
      this.peak = 0;
      this.roadblockT = 8;
      this.lastCrime = null;
      this.heliSpot = false;
      this.near = Infinity;
      this.pullHint = false;
      this.radioT = {};
    }
    reset() {
      this.stars = 0;
      this.clearChase();
      this.endStandoff(true);
      this.removeHeli();
      this.clearSpikes();
      for (const l of this.leftovers) l.fig.dispose();
      this.leftovers = [];
      this.game.traffic.clearPolice();
    }
    escapeNeed() { return 8 + 3 * this.stars; }
    bustNeed() { return this.stars <= 1 ? 2.5 : this.stars >= 4 ? 2.4 : 3; }
    fine(amount, reason, points) {
      const g = this.game;
      if (!g.settings.fines) return;
      g.addCredits(-amount);
      g.save.licensePoints = Math.max(0, (g.save.licensePoints == null ? 100 : g.save.licensePoints) - (points || 0));
      g.hud.toast(t('fine.' + reason, { n: U.fmtInt(amount) }), 'bad', 3);
      g.audio.fail();
    }
    // police radio / megaphone line (toast + squelch), one per key every few seconds
    radio(key, vars) {
      const g = this.game, now = g.time;
      if (this.radioT[key] != null && now - this.radioT[key] < 12) return;
      this.radioT[key] = now;
      g.hud.toast('📻 ' + t('radio.p.' + key, vars), 'radio', 3.2);
      g.audio.radioSquelch && g.audio.radioSquelch();
    }
    crime(kind) {
      const g = this.game;
      const E = SB.DATA.ECONOMY;
      if (kind === 'radar') { this.fine(E.fines.speeding, 'speeding', E.points.speeding); return; }
      if (kind === 'wrongWay') { this.fine(E.fines.wrongWay, 'wrongWay', E.points.wrongWay); return; }
      if (kind === 'redLight') {
        const near = g.traffic.police.some((c) => Math.hypot(c.x - g.player.pos.x, c.z - g.player.pos.z) < 140);
        if (!g.settings.police || (!near && Math.random() < 0.7)) { this.fine(E.fines.redLight, 'redLight', E.points.redLight); return; }
      }
      if (!g.settings.police || (g.mode && g.mode.noPolice) || this.scene) return;
      const before = this.stars;
      if (!before) { this.clearChase(); this.lastCrime = kind; }
      if (kind === 'redLight' || kind === 'hitAndRun') this.stars = Math.max(this.stars, 1) + (this.stars ? 1 : 0);
      if (kind === 'hitPolice') this.stars += 1;
      if (kind === 'evade') this.stars = Math.max(this.stars, 2);
      // crimes reach four stars; the fifth is earned in the chase itself (heat, takedowns)
      this.stars = U.clamp(this.stars, 0, Math.max(before, 4));
      this.onStars(before);
    }
    raise(n) { const b = this.stars; this.stars = U.clamp(this.stars + n, 0, MAX); this.onStars(b); }
    onStars(before) {
      const g = this.game;
      if (this.stars <= before) return;
      this.escapeT = 0;
      this.heatT = 0;
      this.peak = Math.max(this.peak, this.stars);
      g.hud.big(t('police.wanted'), '★'.repeat(this.stars) + '☆'.repeat(MAX - this.stars), 2, 'bad');
      if (this.stars >= 2 && before < 2) this.radio('pursuit');
      else if (this.stars === 3) this.radio('backup');
      else if (this.stars === 4) this.radio('interceptor');
      if (this.stars >= 5) { this.radio('heli'); g.achieve('mostWanted'); }
    }
    // the player and a cruiser collided (dv: its velocity change, m/s; mine: the player drove into it)
    onRam(c, dv, mine) {
      const g = this.game;
      if (c.leftover || c.hold || g.state !== 'play') return;
      if (mine && dv > 1 && (!c.hitCd || g.time - c.hitCd > 1.5)) { c.hitCd = g.time; this.crime('hitPolice'); }
      c.dmg = (c.dmg || 0) + dv / 5.5;
      if (c.disabled || c.dmg < 1) return;
      c.disabled = true;
      c.disT = g.time;
      this.takedowns++;
      const bonus = 350 * Math.max(1, this.stars);
      this.bounty += bonus;
      g.hud.big(t('police.takedown'), t('police.takedownSub', { n: U.fmtInt(bonus) }), 2.2, 'good');
      g.audio.clank(0.6);
      g.fx.sparkBurst(new T.Vector3(c.x, g.world.heightAt(c.x, c.z) + 0.8, c.z), 40, 6);
      g.achieve('takedown');
      this.radio('down');
      if (this.stars >= 2) this.raise(1);
    }
    removeHeli() { if (this.heli) { this.heli.dispose(); this.heli = null; } this.heliSpot = false; }
    clearSpikes() { for (const s of this.spikes) s.dispose(); this.spikes = []; }

    // a roadblock across the road ahead; from four stars a spike strip in front of it
    roadblock() {
      const g = this.game, tr = g.traffic, W = g.world, pl = g.player;
      const sp = Math.hypot(pl.vel.x, pl.vel.z);
      if (sp < 10 || tr.free.police.length < 2) return false;
      const ahead = U.clamp(sp * 4.5, 80, 170);
      const x = pl.pos.x + (pl.vel.x / sp) * ahead, z = pl.pos.z + (pl.vel.z / sp) * ahead;
      if (!W.inPlay(x, z)) return false;
      const r = W.nearestRoad(x, z, true);
      if (!r || r.dist > 12 || r.edge.kind === 'lane') return false;
      const nx = r.tz, nz = -r.tx;
      const yaw = Math.atan2(r.tx, r.tz) + Math.PI / 2;
      for (const o of [-2.5, 2.5]) tr.addPolice(r.x + nx * o, r.z + nz * o, yaw + (o > 0 ? 0.18 : -0.18), true);
      if (this.stars >= 4) {
        const dir = Math.sign((pl.pos.x - r.x) * r.tx + (pl.pos.z - r.z) * r.tz) || 1;
        this.spikes.push(new Spike(g, r.x + r.tx * dir * 17, r.z + r.tz * dir * 17, Math.atan2(r.tx, r.tz), r.edge.w / 2));
        this.radio('spikes');
      } else this.radio('roadblock');
      return true;
    }

    update(dt) {
      const g = this.game, tr = g.traffic, pl = g.player;
      this.updateLeftovers(dt);
      if (!g.settings.police || (g.mode && g.mode.noPolice)) { if (this.stars || tr.police.length) this.reset(); g.sirenLevel = 0; return; }
      const want = this.stars;
      // tidy up: wrecked cruisers, roadblocks and spikes left far behind
      for (const c of tr.police.slice()) {
        const d = Math.hypot(c.x - pl.pos.x, c.z - pl.pos.z);
        if ((c.disabled && (d > 220 || g.time - c.disT > 45)) || (c.roadblock && d > 280)) tr.removePolice(c);
        else if (c.disabled && Math.random() < dt * 14) g.fx.puff(new T.Vector3(c.x + c.tx * 1.6, g.world.heightAt(c.x, c.z) + 1.1, c.z + c.tz * 1.6), { vy: 1.6, life: 2.2, s0: 0.5, s1: 2.6, a: 0.45, r: 0.12, g: 0.12, b: 0.13 });
      }
      for (let i = this.spikes.length - 1; i >= 0; i--) {
        const s = this.spikes[i];
        s.t += dt;
        if (s.t > 90 || Math.hypot(s.x - pl.pos.x, s.z - pl.pos.z) > 300) { s.dispose(); this.spikes.splice(i, 1); continue; }
        const n = s.check(pl);
        if (n) { g.audio.tirePop && g.audio.tirePop(); g.camShake(0.5); g.hud.big(t('police.spiked'), t('police.spikedSub'), 2.4, 'bad'); }
      }
      if (!want) {
        if (tr.police.some((c) => !c.leftover)) tr.clearPolice(true);
        if (this.heli) { this.heli.leave(); this.heli.update(dt); if (this.heli.gone) this.removeHeli(); }
        this.endStandoff();
        g.sirenLevel = 0;
        return;
      }
      const live = tr.police.filter((c) => !c.disabled && !c.leftover);
      const chasers = live.filter((c) => !c.roadblock);
      if (chasers.length < want && Math.random() < dt * (want >= 4 ? 3 : 2)) tr.spawnPolice(pl, false, want >= 4 && Math.random() < 0.5);
      this.roadblockT -= dt;
      if (want >= 3 && this.roadblockT <= 0) this.roadblockT = this.roadblock() ? 45 : 4;
      if (want >= 5 && !this.heli) this.heli = new Heli(g);
      if (this.heli) {
        if (want < 5) this.heli.leave();
        this.heli.update(dt);
        if (this.heli.gone) this.removeHeli();
      }
      this.heliSpot = !!(this.heli && this.heli.spotting);
      let near = Infinity, nearCar = null, close = 0;
      for (const c of live) {
        const d = Math.hypot(c.x - pl.pos.x, c.z - pl.pos.z);
        if (d < near) { near = d; nearCar = c; }
        if (d < 16) close++;
      }
      this.near = near;
      g.sirenLevel = U.clamp(1 - near / 220, 0, 1) * 0.08;
      this.chaseT += dt;
      const seen = near < 160 || this.heliSpot;
      if (want >= 2 && seen) this.bounty += dt * want * 14;
      // a long pursuit escalates
      if (want >= 2 && seen) { this.heatT += dt; if (this.heatT > 25 + want * 10) this.raise(1); }
      // escape: out of sight of every cruiser (and out of the searchlight)
      if (near > 150 && !this.heliSpot) {
        const was = this.escapeT;
        this.escapeT += dt * (this.heli ? 0.6 : 1);
        if (was < 1.5 && this.escapeT >= 1.5) this.radio('lost');
        if (this.escapeT >= this.escapeNeed()) { this.escaped(); return; }
      } else this.escapeT = Math.max(0, this.escapeT - dt * (near < 60 ? 3 : 1));
      // stopped next to a cruiser: the officers draw and the bust meter fills
      const slow = Math.abs(pl.speed) < 2.2 && !pl.exploded;
      const pinned = near < 10 || (close >= 2 && near < 14);
      if (this.bustGrace > 0) { this.bustGrace -= dt; this.bustT = 0; } else if (slow && pinned) this.bustT += dt; else this.bustT = Math.max(0, this.bustT - dt * 1.6);
      if (want >= 2 && this.bustT > 0.45 && nearCar && near < 14 && !this.standoff) this.startStandoff(nearCar);
      if (this.standoff) this.updateStandoff(dt);
      if (want === 1 && near < 45 && !this.pullHint) { this.pullHint = true; g.hud.toast(t('police.pullHint'), 'warn', 4); }
      if (this.bustT >= this.bustNeed() && nearCar) { this.begin(want === 1 ? 'ticket' : 'arrest', nearCar); return; }
      // one star: driving on with the cruiser behind you turns it into a pursuit
      if (want === 1 && near < 30 && Math.abs(pl.speed) > 5) { this.evadeT += dt; if (this.evadeT > 9) { this.evadeT = 0; this.crime('evade'); } } else this.evadeT = 0;
    }
    escaped() {
      const g = this.game;
      const pay = Math.round(this.bounty / 10) * 10;
      if (pay > 0) g.addCredits(pay);
      g.hud.big(t('police.escaped'), pay > 0 ? t('police.escapedPay', { n: U.fmtInt(pay), s: this.peak }) : '', 3, 'good');
      g.audio.chime();
      g.achieve('escape');
      this.radio('gone');
      this.reset();
    }

    // ---------------------------------------------------------------- gun-drawn standoff (before the bust)
    startStandoff(car) {
      const g = this.game, pl = g.player;
      if (car.speed > 1.5) return;
      const cl = cruiserLeft(car);
      const side = Math.sign((pl.pos.x - car.x) * cl.x + (pl.pos.z - car.z) * cl.z) || 1;
      const door = off(car, cl, side * 1.05, P2(car.tx, car.tz), 0.35);
      const fig = new SB.People.Figure(g, 'officer');
      fig.place(door.x, door.z, Math.atan2(cl.x * side, cl.z * side));
      fig.setPose('sit', true);
      this.standoff = { car, fig, t: 0, side, cl };
      g.hud.big(t('police.standoff'), t('police.standoffSub'), 2.4, 'bad');
      g.audio.radioSquelch && g.audio.radioSquelch();
      say(g, t('police.standoff'));
    }
    updateStandoff(dt) {
      const s = this.standoff, g = this.game, pl = g.player, f = s.fig;
      s.t += dt;
      if (s.t > 0.3 && f.pose === 'sit') {
        f.setPose('aim');
        const out = off(f, s.cl, s.side * 0.9);
        f.go([out], 1.8);
      }
      f.face(pl.pos.x, pl.pos.z);
      f.update(dt);
      shove(f, pl);
      if (this.bustT <= 0 || Math.abs(pl.speed) > 4 || s.car.speed > 2 || s.car.disabled) this.endStandoff();
    }
    // the officer holsters and walks back to the cruiser (or vanishes on a reset)
    endStandoff(now) {
      const s = this.standoff;
      if (!s) return;
      this.standoff = null;
      if (now) { s.fig.dispose(); return; }
      s.fig.setPose('stand');
      const door = off(s.car, s.cl, s.side * 1.05, P2(s.car.tx, s.car.tz), 0.35);
      s.fig.go([door], 3.2, (fg) => (fg.gone = true));
      this.leftovers.push({ fig: s.fig, car: s.car, t: 0 });
    }
    updateLeftovers(dt) {
      const g = this.game, pl = g.player;
      for (let i = this.leftovers.length - 1; i >= 0; i--) {
        const l = this.leftovers[i];
        l.t += dt;
        l.fig.update(dt);
        shove(l.fig, pl);
        if (l.fig.gone || l.t > 12) { l.fig.dispose(); this.leftovers.splice(i, 1); }
      }
      // a cruiser left parked after a ticket drives off once you are gone
      for (const c of g.traffic.police.slice()) if (c.leftover && (Math.hypot(c.x - pl.pos.x, c.z - pl.pos.z) > 70 || g.time - c.leftT > 30)) g.traffic.removePolice(c);
    }

    // ---------------------------------------------------------------- scenes
    begin(kind, car) {
      const g = this.game;
      this.endStandoff(true);
      this.scene = new Scene(this, kind, car);
      g.state = 'arrest';
      g.hideHud = true;
      g.audio.setGrind(0);
      g.audio.setTires(0);
      g.updateTouchVisibility();
    }
    skipScene() { if (this.scene) this.scene.input(); }
    // the officer at the window wants a search: the ticket becomes an arrest
    convertToArrest(sc) {
      const A = sc.A;
      sc.dispose(false);
      this.scene = null;
      this.peak = Math.max(this.peak, 2);
      this.stars = Math.max(this.stars, 2);
      this.begin('arrest', A);
    }
    // called by the scene when it is over
    endScene(kind, info) {
      const g = this.game, E = SB.DATA.ECONOMY;
      const sc = this.scene;
      if (kind === 'ticket') {
        this.scene = null;
        this.fine(E.fines.pullOver, 'pullOver', 5);
        // the officer walks back; the cruiser stays a moment, then leaves
        for (const f of sc.figs) {
          if (!f.vis || f === sc.D) continue;
          f.setPose('stand');
          f.go([sc.home(f)], 1.5, (fg) => (fg.gone = true));
          this.leftovers.push({ fig: f, car: sc.A, t: 0 });
        }
        const keep = sc.A;
        this.stars = 0;
        this.clearChase();
        this.removeHeli();
        this.clearSpikes();
        for (const c of g.traffic.police.slice()) if (c !== keep) g.traffic.removePolice(c);
        if (keep) { keep.hold = false; keep.leftover = true; keep.leftT = g.time; }
        sc.dispose(false);
        g.state = 'play';
        g.hideHud = false;
        g.camPos = null;
        g.camYaw = null;
        g.updateTouchVisibility();
        g.last = performance.now();
        return;
      }
      if (kind === 'escape') {
        // broke loose: back behind the wheel, the officers run for their cars
        this.scene = null;
        for (const f of sc.figs) {
          if (!f.vis || f === sc.D) continue;
          f.setPose('stand');
          f.go([sc.home(f)], 2.4, (fg) => (fg.gone = true));
          this.leftovers.push({ fig: f, car: sc.A, t: 0 });
        }
        for (const c of g.traffic.police) c.hold = false;
        const p = g.player;
        p.dt.running = true;
        p.dt.omegaE = p.car.engine.idle * SB.RPM2W;
        g.ignitionOn = true;
        this.bustT = 0;
        this.bustGrace = 4;
        this.escapeT = 0;
        sc.dispose(false);
        g.state = 'play';
        g.hideHud = false;
        g.camPos = null;
        g.camYaw = null;
        g.updateTouchVisibility();
        g.last = performance.now();
        this.raise(1);
        g.hud.toast(t('police.resisted'), 'bad', 3);
        return;
      }
      // arrest: the report over the scene, then the pound
      const fine = E.fines.busted + 600 * Math.max(0, this.peak - 2);
      const resist = sc.resisted ? E.fines.resist : 0;
      const seized = sc.found || 0;
      const rep = { photo: info.photo, mugs: info.mugs, resist, seized, chase: this.chaseT, stars: this.peak, takedowns: this.takedowns, bounty: Math.round(this.bounty / 10) * 10, fine, impound: E.fines.impound, points: 20 };
      g.save.stats.busted = (g.save.stats.busted || 0) + 1;
      rep.bail = E.bailPerStar * Math.max(2, this.peak);
      const release = (paid) => {
        this.scene = null;
        this.fine(fine + E.fines.impound + resist, 'busted', 20);
        if (paid) g.addCredits(-rep.bail);
        if (seized) g.addCredits(-seized);
        sc.dispose(true);
        this.reset();
        const p = g.player;
        p.wheels.forEach((w, i) => { if (w.burst) { w.burst = false; p.damage.tires[i] = 0; } });
        g.ui.close();
        g.state = 'play';
        g.hideHud = false;
        if (!paid) {
          // a night in the cell: out the next morning
          g.save.day = (g.save.day || 1) + 1;
          g.env.setTime(8.2);
          g._lastClock = g.env.time;
        }
        g.teleportToPOI('garage');
        g.prepareStart(false);
        g.camPos = null;
        g.camYaw = null;
        g.updateTouchVisibility();
        g.last = performance.now();
        g.persist();
        if (paid) g.hud.big(t('police.bailed'), t('police.bailedSub'), 3.5);
        else g.hud.big(t('police.released'), t('police.releasedSub'), 3.5);
      };
      g.ui.bustedReport(rep, () => release(true), () => release(false));
    }
  }

  // push a figure out of the player's car instead of letting it clip through
  function shove(f, pl) {
    const r = U.circleRect(f.x, f.z, 0.32, pl.carRect());
    if (!r) return;
    f.x -= r.nx * r.depth; f.z -= r.nz * r.depth;
  }

  // spoken lines through the browser's speech synthesis, when a voice for the UI language exists
  function say(game, text, opts) {
    try {
      if (!game.settings.policeVoice || !window.speechSynthesis || !game.audio.ready) return;
      const lang = SB.i18n.lang === 'en' ? 'en' : 'tr';
      const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith(lang));
      if (!v) return;
      const u = new SpeechSynthesisUtterance(text.replace(/[📢📻*]/gu, ''));
      u.voice = v;
      u.lang = v.lang;
      u.rate = (opts && opts.rate) || 1.08;
      u.pitch = (opts && opts.pitch) || 0.78;
      u.volume = U.clamp((game.settings.vol != null ? game.settings.vol : 0.8) * (game.settings.volSfx != null ? game.settings.volSfx : 1), 0, 1);
      speechSynthesis.speak(u);
    } catch (e) { /* no speech */ }
  }

  // ------------------------------------------------------------------ the ticket and the arrest
  class Scene {
    constructor(police, kind, car) {
      const g = (this.game = police.game);
      this.police = police;
      this.kind = kind;
      this.t = 0;
      this.bt = 0; // beat clock: stops while the driver struggles
      this.done = {};
      this.figs = [];
      this.ended = false;
      this.camShot = null;
      const p = g.player, W = g.world, tr = g.traffic;
      p.vel.set(0, 0, 0);
      p.angVel.set(0, 0, 0);
      const fl = Math.hypot(p.fwd.x, p.fwd.z) || 1;
      const F = (this.F = P2(p.fwd.x / fl, p.fwd.z / fl));
      this.L = P2(F.z, -F.x);
      this.yaw = Math.atan2(F.x, F.z);
      this.hl = p.bodyBox.hl;
      this.hw = p.bodyBox.hw;
      this.C = off(p.pos, F, p.bodyBox.zc || 0);
      const eye = p.visual.cockpitEye;
      // driver's door (left-hand drive); the other side if a wall is in the way
      let s = Math.sign(eye.x) || 1;
      const doorAt = (sg) => off(p.pos, F, eye.z, this.L, sg * (this.hw + 0.6));
      if (blocked(W, doorAt(s).x, doorAt(s).z, 0.45) && !blocked(W, doorAt(-s).x, doorAt(-s).z, 0.45)) s = -s;
      this.s = s;
      this.SL = P2(this.L.x * s, this.L.z * s);
      this.door = doorAt(s);
      this.seat = off(p.pos, F, eye.z - 0.3, this.L, eye.x || s * 0.38);
      this.window = off(p.pos, F, eye.z + 0.3, this.L, s * (this.hw + 0.5));
      this.carR = { x: this.C.x, z: this.C.z, hl: this.hl + 0.45, hw: this.hw + 0.45, ang: this.yaw };
      // engine off for the arrest (the ticket keeps it idling)
      if (kind === 'arrest') { p.dt.running = false; p.dt.fuelCut = false; p.dt.omegaE = 0; g.ignitionOn = false; }
      for (const c of tr.police) { c.hold = true; c.speed = 0; }
      // cruiser A pulls up behind; for an arrest with backup, B blocks the front
      const A = (this.A = car);
      const lenA = A.len || 4.7;
      this.stage(A, [
        [off(this.C, F, -(this.hl + 2.4 + lenA / 2), this.SL, kind === 'ticket' ? 0.7 : 1.5), this.yaw - 0.25 * s],
        [off(this.C, F, -(this.hl + 2.4 + lenA / 2), this.SL, 0), this.yaw],
      ]);
      this.B = null;
      if (kind === 'arrest' && police.peak >= 3) {
        let B = tr.police.filter((c) => c !== A && !c.disabled).sort((a, b) => dist(a, this.C) - dist(b, this.C))[0];
        let fresh = false;
        if (!B || dist(B, this.C) > 80) { B = tr.addPolice(this.C.x, this.C.z, this.yaw, false); fresh = true; }
        if (B) {
          B.hold = true;
          const ok = this.stage(B, [
            [off(this.C, F, this.hl + 2.6 + lenA / 2, this.SL, 2.2), this.yaw + Math.PI + 0.5 * s],
            [off(this.C, F, this.hl + 2.6 + lenA / 2, this.SL, 0.4), this.yaw + Math.PI],
          ]);
          if (ok) this.B = B; else if (fresh) tr.removePolice(B);
        }
      }
      // officers step out on the side facing the driver's door
      const out = (c, rear) => {
        const cl = cruiserLeft(c);
        const sd = Math.sign((this.door.x - c.x) * cl.x + (this.door.z - c.z) * cl.z) || 1;
        const pt = off(c, cl, sd * 1.05, P2(c.tx, c.tz), rear ? -0.6 : 0.35);
        const f = new SB.People.Figure(g, 'officer');
        f.place(pt.x, pt.z, Math.atan2(cl.x * sd, cl.z * sd));
        f.setPose('sit', true);
        f.homePt = pt;
        this.figs.push(f);
        return f;
      };
      this.O1 = out(A, false);
      if (kind === 'arrest') {
        this.O2 = out(A, true);
        if (this.B) this.O3 = out(this.B, false);
      }
      // the driver sits behind the wheel (seen through the glass) until told to get out
      this.D = new SB.People.Figure(g, 'driver');
      this.D.place(this.seat.x, this.seat.z, this.yaw);
      this.D.setPose('sit', true);
      this.figs.push(this.D);
      // cash found in the search: a share of what the driver carries
      const cr = Math.max(0, g.save.credits);
      this.cash = Math.round(U.clamp(cr * 0.35, Math.min(cr, 2500), 25000) / 100) * 100;
      this.searchCase = kind === 'ticket' && cr >= 15000 && Math.random() < 0.4;
      g.sirenLevel = 0.05;
      this.dom = document.getElementById('cine');
      this.dom.hidden = false;
      this.dom.className = 'cine ' + kind;
      this.subEl = document.getElementById('cineSub');
      this.bigEl = document.getElementById('cineBig');
      this.fadeEl = document.getElementById('cineFade');
      this.fadeEl.style.opacity = 0;
      this.subEl.innerHTML = '';
      this.bigEl.innerHTML = '';
      const sk = document.getElementById('cineSkip');
      sk.textContent = t('cine.skip', { key: g.keyLabel('interact') });
      sk.onclick = (e) => { e.preventDefault(); this.skip(); };
    }
    // put a cruiser on the first spot that is clear of buildings; false if none is
    stage(c, spots) {
      const W = this.game.world;
      for (const [pt, yaw] of spots) {
        const R = { x: pt.x, z: pt.z, hl: (c.len || 4.7) / 2, hw: (c.wid || 1.8) / 2, ang: yaw };
        if (rectBlocked(W, R) || U.obbOverlap(R, this.carR)) continue;
        c.x = pt.x; c.z = pt.z; c.yaw = yaw; c.tx = Math.sin(yaw); c.tz = Math.cos(yaw);
        c.speed = 0; c.vx = c.vz = 0; c.hold = true;
        return true;
      }
      return false;
    }
    home(f) { return f.homePt || P2(f.x, f.z); }
    // a walk from a to b that goes around the player's car
    route(a, b) {
      const R = this.carR;
      const clear = (p, q) => {
        const n = Math.ceil(dist(p, q) / 0.25);
        for (let i = 1; i < n; i++) { const k = i / n; if (U.circleRect(p.x + (q.x - p.x) * k, p.z + (q.z - p.z) * k, 0.12, R)) return false; }
        return true;
      };
      if (clear(a, b)) return [b];
      const F = this.F, L = this.L, cs = [];
      for (const fz of [-1, 1]) for (const lx of [-1, 1]) cs.push(off(this.C, F, fz * (this.hl + 0.95), L, lx * (this.hw + 0.95)));
      let best = null, bl = Infinity;
      for (const c of cs) if (clear(a, c) && clear(c, b)) { const l = dist(a, c) + dist(c, b); if (l < bl) { bl = l; best = [c, b]; } }
      if (!best) for (const c1 of cs) for (const c2 of cs) if (c1 !== c2 && clear(a, c1) && clear(c1, c2) && clear(c2, b)) { const l = dist(a, c1) + dist(c1, c2) + dist(c2, b); if (l < bl) { bl = l; best = [c1, c2, b]; } }
      return best || [b];
    }
    at(time, key, fn) { if (this.bt >= time && !this.done[key]) { this.done[key] = true; fn(); } }
    // same on the real clock (for what happens while the beat clock is held)
    atT(time, key, fn) { if (this.t >= time && !this.done[key]) { this.done[key] = true; fn(); } }
    // shout: an officer barking orders (bigger, shaking line)
    sub(who, text, dur, shout) {
      const el = this.subEl;
      el.classList.toggle('shout', !!shout);
      el.innerHTML = (who ? '<b></b>' : '') + '<span></span>';
      if (who) el.firstChild.textContent = who;
      el.lastChild.textContent = text;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
      clearTimeout(this._subT);
      this._subT = setTimeout(() => el.classList.remove('show'), (dur || 2.4) * 1000);
      if (who) say(this.game, text, who === t('cine.who.radio') ? { rate: 1.15, pitch: 1 } : shout ? { rate: 1.3, pitch: 0.7 } : null);
    }
    big(text, kind) {
      const el = this.bigEl;
      el.className = kind || '';
      el.textContent = text;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
    input() {
      const s = this.struggle;
      if (s && !s.done) { s.presses++; s.meter = Math.min(1, s.meter + s.gain); this.D.wiggle = 1; this.game.audio.thud(0.06); return; }
      this.skip();
    }
    skip() {
      if (this.ended || this.t < 0.6 || (this.struggle && !this.struggle.done) || this.swingAt != null || this.freeAt != null) return;
      if (this.kind === 'ticket') { this.finishTicket(); return; }
      if (!this.photo) this.photo = this.capture();
      this.fadeOut();
    }
    // a still of the current view; mug: a 4:5 crop of the middle
    capture(mug) {
      const g = this.game;
      try {
        g.render();
        const src = g.renderer.domElement;
        const c = document.createElement('canvas');
        if (mug) {
          const sh = src.height * 0.8, sw = sh * 0.8;
          c.width = 240; c.height = 300;
          c.getContext('2d').drawImage(src, (src.width - sw) / 2, src.height * 0.08, sw, sh, 0, 0, 240, 300);
        } else {
          c.width = 480;
          c.height = Math.round((480 * src.height) / Math.max(1, src.width));
          c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        }
        return c.toDataURL('image/jpeg', 0.82);
      } catch (e) { return null; }
    }
    fade(to, ms) {
      this.fadeEl.style.transition = 'opacity ' + (ms || 700) + 'ms ease';
      this.fadeEl.style.opacity = to;
    }
    fadeOut() {
      if (this.fading) return;
      this.fading = true;
      this.fade(1);
      setTimeout(() => {
        if (this.ended) return;
        this.ended = true;
        this.reportShot = true;
        this.dom.classList.add('report');
        this.fade(0.35);
        this.subEl.classList.remove('show');
        this.bigEl.classList.remove('show');
        document.getElementById('cineSkip').hidden = true;
        this.police.endScene('arrest', { photo: this.photo, mugs: this.mug1 ? [this.mug1, this.mug2] : null });
      }, 750);
    }
    finishTicket() {
      if (this.ended) return;
      this.ended = true;
      this.police.endScene('ticket');
    }
    update(dt) {
      this.t += dt;
      if (!this.paused) this.bt += dt;
      if (this.struggle && !this.struggle.done) this.updateStruggle(dt);
      if (this.indoor && this.D) {
        if (this.dragging) this.D.wiggle = Math.max(this.D.wiggle || 0, 0.35 + 0.35 * Math.max(0, Math.sin(this.t * 3)));
        if (this.D.sob > 0.5 && (this.sobT = (this.sobT || 0) - dt) <= 0) { this.sobT = 1.1 + Math.random() * 0.5; this.game.audio.burst(650, 2, 0.05, 0.28); }
      }
      if (this.kind === 'ticket') this.ticketBeats(); else if (this.phase === 'station') this.stationBeats(); else this.arrestBeats();
      if (this.room) this.room.update(dt);
      const pl = this.game.player;
      for (const f of this.figs) { f.update(dt); if (f !== this.D && !this.indoor) shove(f, pl); }
    }
    // ---------------------------------------------------------------- ticket (one star)
    ticketBeats() {
      const O = this.O1, W = this.window;
      this.at(0.1, 'mega', () => this.sub(t('cine.who.mega'), t('cine.t.pull')));
      this.at(0.35, 'out', () => { O.setPose('stand'); O.go(this.route(O, W), 1.5, () => { this.arrived = this.bt; O.face(this.C.x, this.C.z); O.setPose('talk'); }); });
      if (this.arrived == null) { if (this.bt > 14) this.finishTicket(); return; }
      const a = this.arrived;
      this.at(a + 0.2, 'hello', () => { this.sub(t('cine.who.officer'), t('cine.t.hello'), 2); this.D.j.neck.rotation.y = 0; this.D.lookSide = this.s * 0.9; });
      if (this.searchCase) {
        this.at(a + 1.7, 'search', () => { O.setPose('aimLow'); this.sub(t('cine.who.officer'), t('cine.t.search'), 1.6, true); });
        this.at(a + 2.6, 'convert', () => this.police.convertToArrest(this));
        return;
      }
      this.at(a + 1.7, 'write', () => {
        O.setPose('write');
        const why = this.police.lastCrime && t('cine.crime.' + this.police.lastCrime) !== 'cine.crime.' + this.police.lastCrime ? t('cine.crime.' + this.police.lastCrime) : t('cine.crime.traffic');
        this.sub(t('cine.who.officer'), t('cine.t.fine', { why, n: U.fmtInt(SB.DATA.ECONOMY.fines.pullOver) }), 2.4);
      });
      this.at(a + 3.9, 'bye', () => { O.setPose('talk'); this.sub(t('cine.who.officer'), t('cine.t.bye'), 1.8); });
      this.at(a + 5.0, 'end', () => this.finishTicket());
    }
    // ---------------------------------------------------------------- arrest: pulled out, put face down, cuffed
    arrestBeats() {
      const g = this.game, O1 = this.O1, O2 = this.O2, O3 = this.O3, D = this.D, SL = this.SL, F = this.F;
      const who = t('cine.who.officer');
      const aim1 = off(this.door, SL, 2.7, F, -1.9), aim3 = off(this.C, F, this.hl + 0.9, SL, this.hw + 2.5);
      const grab = off(this.door, SL, 0.65, F, -0.6);
      const ground = (this.ground = this.ground || off(this.door, SL, 0.55, F, -0.25));
      const target = () => (this.bt > 3 ? P2(D.x, D.z) : this.door);
      this.at(0.15, 'freeze', () => { this.sub(who, t('cine.a.freeze'), 1.8, true); g.audio.radioSquelch && g.audio.radioSquelch(); });
      this.at(0.35, 'o1', () => { O1.setPose('aim'); O1.go(this.route(O1, aim1), 1.9); });
      this.at(0.55, 'o2', () => { O2.setPose('aim'); O2.go(this.route(O2, grab), 1.8, () => { O2.face(this.door.x - SL.x, this.door.z - SL.z); O2.setPose('reach'); }); });
      if (O3) this.at(0.5, 'o3', () => { O3.setPose('aim'); O3.go(this.route(O3, aim3), 1.8); });
      for (const f of [O1, O3]) if (f && f.pose === 'aim' && !f.path) { const q = target(); f.face(q.x, q.z); }
      this.at(1.9, 'out', () => this.sub(who, t('cine.a.out'), 1.6, true));
      // the officer pulls the driver out and steps back with them
      this.at(3.0, 'pull', () => {
        this.sub(who, t('cine.a.pull'), 1.3, true);
        D.setPose('stand');
        D.go([this.door, ground], 1.5);
        O2.go([off(grab, SL, 0.55, F, -0.4)], 1.3, () => O2.face(ground.x, ground.z));
        g.audio.thud(0.2);
      });
      this.at(4.2, 'down', () => { D.face(ground.x + F.x * 5, ground.z + F.z * 5); D.setPose('kneelDown'); this.sub(who, t('cine.a.down'), 1.2, true); });
      this.at(4.5, 'okay', () => this.sub(t('cine.who.you'), t('cine.a.okay'), 1.0, true));
      this.at(5.3, 'still', () => this.sub(t('cine.who.officer2'), t('cine.a.still'), 1.2, true));
      this.at(4.8, 'lie', () => { D.lie(true); D.setPose('proneArms'); g.audio.thud(0.35); });
      this.at(5.0, 'kneel', () => {
        const hips = off(ground, F, 0.95), kp = off(hips, SL, 0.62);
        O2.setPose('stand');
        O2.go(this.route(O2, kp), 1.4, () => { O2.face(hips.x, hips.z); O2.setPose('kneel'); });
      });
      this.at(5.8, 'struggle', () => this.startStruggle());
      if (this.freeAt != null) { this.freeBeats(); return; }
      if (this.koAt != null) { this.koBeats(); return; }
      this.at(5.85, 'behind', () => D.setPose('handsBehind'));
      this.at(6.4, 'cuffL', () => { D.putCuffs('L'); g.audio.cuffs && g.audio.cuffs(); });
      this.at(6.75, 'cuffR', () => { D.putCuffs('R'); g.audio.cuffs && g.audio.cuffs(); this.big(t('cine.cuffed'), 'bad'); });
      this.at(7.0, 'photo', () => (this.photo = this.capture()));
      this.at(6.95, 'tight', () => this.sub(t('cine.who.you'), t('cine.a.tight'), 1.0));
      this.at(7.4, 'frisk', () => { O2.setPose('frisk'); this.sub(t('cine.who.officer2'), t('cine.a.frisk'), 1.2, true); });
      this.at(8.0, 'no2', () => { D.wiggle = 0.6; this.sub(t('cine.who.you'), t('cine.a.okay'), 0.9, true); });
      this.at(8.9, 'cash', () => {
        O2.setPose('kneel');
        O2.cash.visible = true;
        this.found = this.cash;
        this.big(t('cine.a.cashBig', { n: U.fmtInt(this.cash) }), 'bad');
        this.sub(t('cine.who.officer2'), t('cine.a.cash'), 1.6, true);
        g.audio.fail();
      });
      this.at(9.9, 'rights', () => { O2.cash.visible = false; this.sub(who, t('cine.a.rights'), 2.0); });
      this.at(10.5, 'up', () => { O2.setPose('stand'); D.lie(false); D.setPose('handsBehind'); this.sub(who, t('cine.a.up2'), 1.2, true); });
      this.at(11.3, 'walk', () => {
        const A = this.A, cl = cruiserLeft(A);
        const sd = Math.sign((D.x - A.x) * cl.x + (D.z - A.z) * cl.z) || 1;
        const rd = off(A, cl, sd * 1.15, P2(A.tx, A.tz), -0.55);
        D.go(this.route(D, rd), 1.25, () => { this.inAt = this.bt; D.face(A.x, A.z); D.setPose('sit'); });
        O2.setPose('escort');
        O2.follow = { fig: D, side: -0.42, back: 0.38 };
      });
      this.at(11.6, 'o1back', () => { O1.setPose('stand'); O1.go(this.route(O1, this.home(O1)), 1.4, (f) => f.show(false)); });
      if (O3) this.at(11.8, 'o3back', () => { O3.setPose('stand'); O3.go(this.route(O3, this.home(O3)), 1.4, (f) => f.show(false)); });
      if (this.inAt != null) {
        this.at(this.inAt + 0.55, 'in', () => { D.show(false); O2.follow = null; O2.setPose('stand'); g.audio.thud(0.25); });
        this.at(this.inAt + 0.8, 'radio', () => this.sub(t('cine.who.radio'), t('cine.a.radio'), 2.2));
        this.at(this.inAt + 2.6, 'toStation', () => this.toStation());
      }
      if (this.bt > 24) this.toStation();
    }
    // ---------------------------------------------------------------- resisting on the ground
    startStruggle() {
      const g = this.game, n = this.police.peak;
      this.paused = true;
      this.struggle = { t: 0, meter: 0, presses: 0, gain: n >= 5 ? 0.1 : n >= 4 ? 0.115 : 0.13, done: false };
      this.sub(t('cine.who.officer'), t('cine.a.hands'), 1.4, true);
      const el = document.getElementById('cineStruggle');
      el.hidden = false;
      el.querySelector('span').textContent = t(this.game.input.device === 'touch' ? 'cine.struggle.touch' : 'cine.struggle', { key: g.keyLabel('interact') });
      el.onpointerdown = (e) => { e.preventDefault(); this.input(); };
    }
    updateStruggle(dt) {
      const s = this.struggle;
      s.t += dt;
      s.meter = Math.max(0, s.meter - dt * 0.22);
      const el = document.getElementById('cineStruggle');
      el.querySelector('i').style.width = Math.round(s.meter * 100) + '%';
      el.querySelector('b').style.width = Math.round(U.clamp(1 - s.t / 3.2, 0, 1) * 100) + '%';
      if (s.meter >= 1) this.endStruggle('free');
      else if (s.t >= 3.2) this.endStruggle(s.presses ? 'ko' : 'calm');
    }
    endStruggle(how) {
      this.struggle.done = true;
      document.getElementById('cineStruggle').hidden = true;
      if (how === 'calm') { this.paused = false; return; }
      this.resisted = true;
      if (how === 'free') this.breakFree(); else this.knockOut();
    }
    // broke loose: up, the officer knocked off balance, back into the car
    breakFree() {
      const D = this.D, O2 = this.O2;
      this.freeAt = this.t;
      D.wiggle = 0;
      D.lie(false);
      D.setPose('stand');
      O2.setPose('stand');
      O2.go([off(O2, this.SL, 1.0, this.F, -0.4)], 2.6);
      this.big(t('cine.free'), 'good');
      this.game.audio.thud(0.4);
    }
    freeBeats() {
      const D = this.D;
      if (this.t > this.freeAt + 0.6 && !this.ranOff) {
        this.ranOff = true;
        this.sub(t('cine.who.officer'), t('cine.a.stop'), 1.2, true);
        D.go([this.door, this.seat], 2.8, () => { D.show(false); this.game.audio.thud(0.3); this.police.endScene('escape'); });
      }
      if (this.t > this.freeAt + 5 && !this.ended) { D.show(false); this.police.endScene('escape'); }
    }
    // didn't break loose: an officer runs in with the baton; the screen goes black on the swing
    knockOut() {
      const O1 = this.O1, D = this.D, F = this.F;
      this.koAt = this.t;
      const spot = off(this.ground, F, 1.35, this.SL, -0.6);
      O1.setPose('stand');
      O1.go(this.route(O1, spot), 3.6, () => { O1.face(D.x + F.x * 1.2, D.z + F.z * 1.2); O1.setPose('strikeUp'); this.swingAt = this.t; });
      this.sub(t('cine.who.officer'), t('cine.a.resist'), 1.2, true);
    }
    koBeats() {
      const g = this.game;
      if (this.swingAt == null && this.t > this.koAt + 4) { this.O1.path = null; this.O1.setPose('strikeUp'); this.swingAt = this.t; }
      if (this.swingAt == null) return;
      const w = this.swingAt;
      this.atT(w + 0.45, 'swing', () => {
        this.O1.setPose('strikeDown');
        g.camShake(0.8);
        g.audio.thud(0.9);
        this.fade(1, 90);
        this.big(t('cine.ko'), 'bad');
        this.subEl.classList.remove('show');
      });
      this.atT(w + 2.4, 'wake', () => this.enterStation(true));
    }
    // ---------------------------------------------------------------- the station: booking photos, cuffed to the pole
    toStation() {
      if (this.toSt) return;
      this.toSt = true;
      this.fade(1, 600);
      setTimeout(() => { if (!this.ended) this.enterStation(); }, 650);
    }
    enterStation(wake) {
      const g = this.game;
      const S = (this.room = Station.get(g));
      S.show(true);
      S.openDoor(true);
      this.indoor = true;
      this.paused = false;
      this.phase = 'station';
      this.st = this.bt;
      for (const f of this.figs) f.show(false);
      const D = this.D;
      D.floorY = S.y;
      D.lie(false);
      D.lean = 0;
      D.lookSide = 0;
      const entry = S.p(-1.0, 3.5);
      D.place(entry.x, entry.z, Math.PI);
      D.setPose('handsBehind', true);
      D.putCuffs('both');
      D.show(true);
      const S1 = (this.S1 = new SB.People.Figure(g, 'officer'));
      S1.floorY = S.y;
      const e1 = S.p(-0.6, 3.95);
      S1.place(e1.x, e1.z, Math.PI);
      S1.setPose('escort', true);
      const S2 = (this.S2 = new SB.People.Figure(g, 'officer'));
      S2.floorY = S.y;
      const e2 = S.p(-2.2, -0.45);
      S2.place(e2.x, e2.z, Math.PI);
      S2.setPose('stand', true);
      this.figs.push(S1, S2);
      S.placard(g.save.stats.busted || 1, g.save.day || 1);
      g.sirenLevel = 0;
      if (wake) {
        // knocked out: comes to on the bench, already cuffed to the pole, the cell shut
        this.woke = true;
        D.place(S.seat.x, S.seat.z, -Math.PI / 2);
        D.removeCuffs();
        D.setPose('sitCuffed', true);
        D.update(0);
        const w = D.wristPos('R', new T.Vector3());
        D.cuffTo(new T.Vector3(S.pole.x, w.y, S.pole.z));
        const o = S.p(0.6, -1.9);
        S1.place(o.x, o.z, Math.PI / 2);
        S1.setPose('stand', true);
        S1.face(D.x, D.z);
        S2.show(false);
        S.openDoor(false);
        S.doorK = 0;
        const v = document.getElementById('view');
        v.style.transition = 'none';
        v.style.filter = 'blur(7px) brightness(0.6)';
        this.fade(0, 1800);
        setTimeout(() => { v.style.transition = 'filter 3s ease'; v.style.filter = 'none'; }, 300);
        return;
      }
      D.sob = 1;
      this.fade(0, 700);
      this.big(t('cine.s.title'));
      g.audio.thud(0.3);
    }
    stationBeats() {
      const g = this.game, S = this.room, D = this.D, S1 = this.S1, S2 = this.S2, st = this.st;
      const who = t('cine.who.officer'), clerk = t('cine.who.clerk');
      if (this.woke) {
        this.at(st + 1.8, 'where', () => this.sub('', t('cine.s.where'), 1.8));
        this.at(st + 3.8, 'woke', () => this.sub(who, t('cine.s.woke'), 2.6));
        this.at(st + 6.6, 'bail', () => this.sub(who, t('cine.s.bail'), 2.6));
        this.at(st + 9.0, 'fade', () => this.fadeOut());
        return;
      }
      this.at(st + 1.4, 'sob', () => this.sub('', t('cine.s.sob'), 2));
      this.at(st + 0.4, 'walkIn', () => {
        D.go([S.p(-1.0, 2.6), S.p(-1.6, -1.6), S.p(-2.5, -2.7), S.mug], 1.4, () => { this.mugAt = this.bt; D.face(S.cam.x, S.cam.z); });
        S1.follow = { fig: D, side: -0.42, back: 0.4 };
      });
      if (this.mugAt != null) {
        const a = this.mugAt;
        this.at(a + 0.2, 'mugPrep', () => {
          S1.follow = null;
          S1.setPose('stand');
          S1.go([S.p(-1.15, -2.7)], 1.2, () => S1.face(D.x, D.z));
          S2.face(D.x, D.z);
          D.holdPlacard(S.placardMat);
          D.sob = 0.25;
          this.sub(clerk, t('cine.s.look'), 1.3);
        });
        this.at(a + 5.0, 'plead', () => this.sub(t('cine.who.you'), t('cine.s.plead'), 2));
        this.at(a + 1.4, 'flash1', () => { this.flash(); this.mug1 = this.capture(true); });
        this.at(a + 2.1, 'turn', () => { D.face(D.x - 5, D.z); this.sub(clerk, t('cine.s.side'), 1.1); });
        this.at(a + 3.2, 'flash2', () => { this.flash(); this.mug2 = this.capture(true); });
        this.at(a + 4.0, 'toCell', () => {
          D.dropPlacard();
          D.sob = 1;
          this.dragging = true;
          this.sub(who, t('cine.s.cell'), 1.4);
          S1.setPose('escort');
          S1.follow = { fig: D, side: -0.42, back: 0.4 };
          S2.setPose('stand');
          S2.go([S.p(-1.0, -1.1), S.p(0.8, -1.5), S.p(2.7, -1.5), S.p(4.0, -1.7)], 1.3, () => { S2.face(S.seat.x, S.seat.z); S2.setPose('reach'); });
          D.go([S.p(-1.2, -1.9), S.p(0.8, -1.9), S.p(2.7, -1.9), S.p(4.1, -2.1), S.seat], 1.1, () => {
            this.cellAt = this.bt;
            D.face(D.x - 5, D.z);
            D.setPose('sit');
            S1.follow = null;
            S1.setPose('stand');
            S1.go([S.p(4.15, -3.35)], 1.2, () => S1.face(S.pole.x, S.pole.z));
          });
        });
      }
      if (this.cellAt != null) {
        const c = this.cellAt;
        this.at(c + 0.7, 'cuffPrep', () => { S1.setPose('cuff'); D.removeCuffs(); this.sub(who, t('cine.s.calm'), 1.6); });
        this.at(c + 1.0, 'arm', () => D.setPose('sitCuffed'));
        this.at(c + 1.7, 'toPole', () => {
          const w = D.wristPos('R', new T.Vector3());
          D.cuffTo(new T.Vector3(S.pole.x, w.y, S.pole.z));
          g.audio.cuffs && g.audio.cuffs();
          this.big(t('cine.s.pole'), 'bad');
          this.dragging = false;
        });
        this.at(c + 2.5, 'leave', () => {
          S1.setPose('stand');
          S1.go([S.p(2.7, -1.9), S.p(0.6, -1.9)], 1.4, () => S1.face(D.x, D.z));
          S2.setPose('stand');
          S2.go([S.p(2.7, -1.5), S.p(0.3, -1.3)], 1.4, () => S2.face(D.x, D.z));
        });
        this.at(c + 4.6, 'door', () => { S.openDoor(false); g.audio.clank(0.45); });
        this.at(c + 5.2, 'bail', () => this.sub(who, t('cine.s.bail'), 2.8));
        this.at(c + 8.0, 'fade', () => this.fadeOut());
      }
      if (this.bt - st > 40) this.fadeOut();
    }
    flash() {
      const f = document.getElementById('flash');
      f.style.transition = 'none';
      f.style.opacity = 0.9;
      requestAnimationFrame(() => { f.style.transition = 'opacity 0.6s ease-out'; f.style.opacity = 0; });
      this.game.audio.click();
      this.game.audio.burst(5200, 1.5, 0.25, 0.08, 'highpass');
    }

    // ---------------------------------------------------------------- camera
    shot() {
      if (this.kind === 'ticket') return this.arrived == null ? 'tA' : 'tB';
      if (this.phase === 'station') {
        if (this.woke) return 'stBars';
        if (this.mugAt == null) return 'stIn';
        if (!this.done.toCell) return 'stMug';
        if (this.cellAt == null || this.bt < this.cellAt + 0.3) return 'stWalk';
        return this.bt < this.cellAt + 3.8 ? 'stPole' : 'stBars';
      }
      if (this.reportShot) return 'orbit';
      if ((this.struggle && !this.struggle.done) || this.koAt != null) return 'cuffs';
      if (this.freeAt != null) return 'wide';
      return this.bt < 2.9 ? 'shoulder' : this.bt < 5.9 ? 'wide' : this.bt < 10.4 ? 'cuffs' : 'orbit';
    }
    camera(cam, rdt) {
      const g = this.game, W = g.world;
      const shot = this.shot();
      const snap = shot !== this.camShot;
      this.camShot = shot;
      const gy = (p) => W.heightAt(p.x, p.z);
      let eye, look, fov = 52;
      const F = this.F, SL = this.SL, D = this.D;
      if (this.indoor) {
        const S = this.room, Y = S.y, head = () => new T.Vector3(D.x, Y + 1.45, D.z);
        if (shot === 'stIn') { eye = S.p(2.2, 2.3); eye.y = Y + 2.3; look = head(); fov = 55; } else if (shot === 'stMug') { eye = P2(S.cam.x, S.cam.z - 0.3); eye.y = Y + 1.5; look = new T.Vector3(S.mug.x, Y + 1.42, S.mug.z); fov = 34; } else if (shot === 'stWalk') { eye = S.p(-1.0, 1.4); eye.y = Y + 2.0; look = head(); fov = 55; } else if (shot === 'stPole') {
          eye = S.p(3.0, -1.55);
          eye.y = Y + 1.45;
          look = new T.Vector3((D.x + S.pole.x) / 2, Y + 1.0, (D.z + S.pole.z) / 2);
          fov = 42;
        } else { eye = S.p(0.7, -1.25); eye.y = Y + 1.45; look = new T.Vector3(S.seat.x, Y + 0.95, S.seat.z - 0.2); fov = 46; }
        this.camTo(cam, rdt, snap, new T.Vector3(eye.x, eye.y, eye.z), look, fov);
        return;
      }
      if (shot === 'shoulder') {
        const O = this.O1;
        const dx = this.door.x - O.x, dz = this.door.z - O.z, l = Math.hypot(dx, dz) || 1;
        const ux = dx / l, uz = dz / l;
        eye = P2(O.x - ux * 1.9 - uz * 1.25, O.z - uz * 1.9 + ux * 1.25);
        eye.y = gy(O) + 1.85;
        look = this.bt > 3.2 ? new T.Vector3(D.x, gy(D) + 1.1, D.z) : new T.Vector3(this.door.x, gy(this.door) + 1.0, this.door.z);
        fov = 48;
      } else if (shot === 'wide') {
        // high, square-on to the door: the officers stand in an arc below the line of sight
        eye = off(this.door, SL, 6.2, F, 0.9);
        eye.y = gy(eye) + 4.3;
        const q = off(this.door, SL, 0.6, F, 0.3);
        look = new T.Vector3(q.x, gy(q) + 0.8, q.z);
      } else if (shot === 'cuffs') {
        const w = D.wristPos('L', new T.Vector3()).lerp(D.wristPos('R', new T.Vector3()), 0.5);
        eye = off(w, F, 1.5, SL, 0.9);
        eye.y = gy(w) + 1.35;
        look = w;
        fov = 42;
      } else if (shot === 'tA') {
        eye = off(this.C, F, this.hl + 3.0, SL, this.hw + 2.6);
        eye.y = gy(eye) + 1.5;
        look = new T.Vector3(this.O1.x, gy(this.O1) + 1.3, this.O1.z);
      } else if (shot === 'tB') {
        const O = this.O1;
        eye = off(this.window, F, 1.7, SL, 1.4);
        eye.y = gy(eye) + 1.6;
        look = new T.Vector3((O.x + this.window.x) / 2 - SL.x * 0.5, gy(O) + 1.3, (O.z + this.window.z) / 2 - SL.z * 0.5);
      } else {
        const A = this.A;
        const c = D.vis ? P2((D.x + A.x) / 2, (D.z + A.z) / 2) : P2((this.C.x + A.x) / 2, (this.C.z + A.z) / 2);
        if (this.orbitA == null) this.orbitA = Math.atan2(SL.x, SL.z) + 0.7;
        this.orbitA += rdt * 0.2;
        eye = P2(c.x + Math.sin(this.orbitA) * 9, c.z + Math.cos(this.orbitA) * 9);
        eye.y = gy(c) + 3.4;
        look = new T.Vector3(c.x, gy(c) + 0.9, c.z);
      }
      // keep the camera out of walls: pull it toward the subject
      let ex = eye.x, ez = eye.z;
      for (let i = 0; i < 12 && blocked(W, ex, ez, 0.4); i++) { ex += (look.x - ex) * 0.2; ez += (look.z - ez) * 0.2; }
      this.camTo(cam, rdt, snap, new T.Vector3(ex, Math.max(eye.y, W.heightAt(ex, ez) + 0.5), ez), look, fov);
    }
    camTo(cam, rdt, snap, tgt, look, fov) {
      if (snap || !this.camLook) { cam.position.copy(tgt); this.camLook = look.clone(); } else {
        cam.position.lerp(tgt, 1 - Math.exp(-rdt * 4));
        this.camLook.lerp(look, 1 - Math.exp(-rdt * 6));
      }
      cam.up.set(0, 1, 0);
      cam.lookAt(this.camLook);
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    dispose(clearCars) {
      for (const f of this.figs) if (!this.police.leftovers.some((l) => l.fig === f)) f.dispose();
      this.figs = [];
      if (this.room) { this.room.show(false); this.room = null; }
      this.indoor = false;
      const v = document.getElementById('view');
      v.style.transition = 'none';
      v.style.filter = '';
      document.getElementById('cineStruggle').hidden = true;
      clearTimeout(this._subT);
      try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      this.dom.hidden = true;
      document.getElementById('cineSkip').hidden = false;
      this.fadeEl.style.transition = 'none';
      this.fadeEl.style.opacity = 0;
      if (clearCars) this.game.traffic.clearPolice();
    }
  }

  // ------------------------------------------------------------------ the police station set (built once, far above the city)
  function fitText(g, text, w, size, weight) {
    let px = size;
    g.font = weight + ' ' + px + 'px "Barlow Condensed", Arial, sans-serif';
    const m = g.measureText(text).width;
    if (m > w) { px = Math.floor((size * w) / m); g.font = weight + ' ' + px + 'px "Barlow Condensed", Arial, sans-serif'; }
  }
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tx = new T.CanvasTexture(c);
    tx.anisotropy = 4;
    return tx;
  }
  class Station {
    static get(game) { return game._station || (game._station = new Station(game)); }
    constructor(game) {
      this.game = game;
      this.x0 = 0; this.y = 640; this.z0 = 0;
      const grp = (this.grp = new T.Group());
      grp.position.set(this.x0, this.y, this.z0);
      grp.visible = false;
      game.scene.add(grp);
      const M = (o) => new T.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, o));
      const box = (w, h, d, m, x, y, z) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); grp.add(o); return o; };
      const tile = canvasTex(128, 128, (g) => { g.fillStyle = '#8d9496'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#7b8284'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.strokeRect(0, 0, 128, 128); });
      tile.wrapS = tile.wrapT = T.RepeatWrapping;
      tile.repeat.set(5, 4);
      const wallTex = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#d9dccf'; g.fillRect(0, 0, w, h); g.fillStyle = '#6f8f7d'; g.fillRect(0, h * 0.62, w, h * 0.38); g.fillStyle = '#4f6a5b'; g.fillRect(0, h * 0.6, w, h * 0.03); });
      wallTex.wrapS = T.RepeatWrapping;
      const floor = new T.Mesh(new T.PlaneGeometry(10, 8).rotateX(-Math.PI / 2), M({ map: tile, roughness: 0.6 }));
      grp.add(floor);
      box(10, 0.1, 8, M({ color: 0xe6e6e1 }), 0, 3.05, 0);
      for (const [w, x, z, ry] of [[10, 0, -4, 0], [10, 0, 4, 0], [8, -5, 0, Math.PI / 2], [8, 5, 0, Math.PI / 2]]) {
        const tx = wallTex.clone();
        tx.needsUpdate = true;
        tx.repeat.set(w / 1.5, 1);
        const o = new T.Mesh(new T.PlaneGeometry(w, 3.05), M({ map: tx, side: T.DoubleSide }));
        o.position.set(x, 1.525, z);
        o.rotation.y = ry;
        grp.add(o);
      }
      // ceiling lamps, doorway, desk, sign
      for (const [x, z] of [[-2.5, -2], [2.5, -2], [-2.5, 2], [2.5, 2]]) box(1.3, 0.04, 0.3, new T.MeshBasicMaterial({ color: 0xf4f7ff }), x, 2.98, z);
      box(1.1, 2.2, 0.06, M({ color: 0x3b3f44 }), -1.0, 1.1, 3.96);
      box(1.6, 0.06, 0.8, M({ color: 0x6b4f37 }), -4.1, 0.78, 2.0);
      for (const [x, z] of [[-4.8, 1.7], [-3.4, 1.7], [-4.8, 2.3], [-3.4, 2.3]]) box(0.05, 0.75, 0.05, M({ color: 0x333333 }), x, 0.375, z);
      box(0.5, 0.35, 0.05, M({ color: 0x15181c, emissive: 0x2a4f7a, emissiveIntensity: 0.6 }), -4.1, 1.0, 1.85);
      const sign = canvasTex(512, 96, (g, w, h) => { g.fillStyle = '#16233f'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; fitText(g, SB.i18n.t('cine.s.sign'), w * 0.92, 46, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(SB.i18n.t('cine.s.sign'), w / 2, h / 2 + 2); });
      const sg = new T.Mesh(new T.PlaneGeometry(2.4, 0.45), M({ map: sign }));
      sg.position.set(-4.96, 2.4, 0.2);
      sg.rotation.y = Math.PI / 2;
      grp.add(sg);
      const cellSign = canvasTex(512, 96, (g, w, h) => { g.fillStyle = '#7a1f1a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; fitText(g, SB.i18n.t('cine.s.cellSign'), w * 0.92, 54, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(SB.i18n.t('cine.s.cellSign'), w / 2, h / 2 + 2); });
      const cs = new T.Mesh(new T.PlaneGeometry(1.8, 0.34), M({ map: cellSign }));
      cs.position.set(1.44, 2.75, -2.0);
      cs.rotation.y = -Math.PI / 2;
      grp.add(cs);
      // height chart behind the booking spot, camera on a tripod
      const chart = canvasTex(256, 320, (g, w, h) => {
        g.fillStyle = '#e9ebe4'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#20242a'; g.font = '700 15px Arial, sans-serif'; g.textBaseline = 'middle';
        for (let cm = 0; cm <= 240; cm += 5) {
          const y = h - (cm / 240) * h;
          const big = cm % 50 === 0, mid = cm % 10 === 0;
          g.fillRect(0, y - (big ? 1.5 : 0.5), big ? w : mid ? w * 0.18 : w * 0.08, big ? 3 : 1);
          if (mid) { g.fillRect(w - (big ? w : w * 0.18), y - 0.5, w * 0.18, 1); }
          if (mid && cm >= 120 && cm <= 220) g.fillText(String(cm), w * 0.2, y - 7);
        }
      });
      const ch = new T.Mesh(new T.PlaneGeometry(2.0, 2.5), M({ map: chart }));
      ch.position.set(-2.5, 1.25, -3.98);
      grp.add(ch);
      const dark = M({ color: 0x1b1d20, roughness: 0.5 });
      for (let k = 0; k < 3; k++) { const leg = box(0.03, 1.4, 0.03, dark, -2.5 + Math.sin(k * 2.1) * 0.25, 0.68, -1.0 + Math.cos(k * 2.1) * 0.25); leg.rotation.set(Math.cos(k * 2.1) * 0.18, 0, -Math.sin(k * 2.1) * 0.18); }
      box(0.2, 0.15, 0.22, dark, -2.5, 1.45, -1.0);
      box(0.09, 0.09, 0.08, M({ color: 0x0a0a0a, metalness: 0.5, roughness: 0.2 }), -2.5, 1.45, -1.14);
      // holding cell: bars on x = 1.5 with a sliding door, wall at z = 0, a bench and the pole
      const steel = M({ color: 0x50565c, metalness: 0.8, roughness: 0.35 });
      const barG = new T.CylinderGeometry(0.022, 0.022, 3.0, 6);
      const bars = (z0, z1, parent, x) => { for (let z = z0; z <= z1 + 1e-6; z += 0.15) { const b = new T.Mesh(barG, steel); b.position.set(x, 1.5, z); parent.add(b); } for (const y of [0.08, 1.2, 2.95]) { const r = new T.Mesh(new T.BoxGeometry(0.05, 0.05, z1 - z0 + 0.05), steel); r.position.set(x, y, (z0 + z1) / 2); parent.add(r); } };
      bars(-3.95, -2.65, grp, 1.5);
      bars(-1.35, -0.05, grp, 1.5);
      const door = (this.door = new T.Group());
      bars(-2.6, -1.4, door, 1.45);
      grp.add(door);
      const cw = new T.Mesh(new T.PlaneGeometry(3.5, 3.05), M({ map: wallTex, side: T.DoubleSide }));
      cw.position.set(3.25, 1.525, 0);
      grp.add(cw);
      box(0.55, 0.45, 2.9, M({ color: 0x8a6a4c }), 4.7, 0.225, -2.45);
      this.poleLocal = new T.Vector3(4.86, 0, -2.98);
      const pole = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 3.0, 10), steel);
      pole.position.set(this.poleLocal.x, 1.5, this.poleLocal.z);
      grp.add(pole);
      grp.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      // spots in world coordinates
      this.mug = this.p(-2.5, -3.5);
      this.cam = this.p(-2.5, -1.0);
      this.seat = this.p(4.68, -2.45);
      this.pole = this.p(this.poleLocal.x, this.poleLocal.z);
      this.doorT = 1;
      this.doorK = 1;
      this.placardMat = new T.MeshStandardMaterial({ roughness: 0.7 });
    }
    p(x, z) { return P2(this.x0 + x, this.z0 + z); }
    show(on) {
      this.grp.visible = on;
      const sc = this.game.scene;
      if (on && !this.light) {
        // a room light only while the scene is on (adding it recompiles shaders, so it happens under the fade)
        this.light = new T.PointLight(0xf2f5ff, 1.7, 18, 1);
        this.light.position.set(this.x0, this.y + 2.7, this.z0 - 1.2);
        sc.add(this.light);
      } else if (!on && this.light) { sc.remove(this.light); this.light = null; }
    }
    openDoor(open) { this.doorT = open ? 1 : 0; if (open) { this.doorK = 1; this.door.position.z = 1.2; } }
    update(dt) {
      this.doorK += (this.doorT - this.doorK) * Math.min(1, dt * 5);
      this.door.position.z = 1.2 * this.doorK;
    }
    placard(n, day) {
      if (this.placardMat.map) this.placardMat.map.dispose();
      this.placardMat.map = canvasTex(320, 180, (g, w, h) => {
        g.fillStyle = '#121416'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#d9d9d9'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
        g.fillStyle = '#fff'; g.textAlign = 'center';
        g.font = '800 30px "Barlow Condensed", Arial, sans-serif'; g.fillText(SB.i18n.t('cine.s.board'), w / 2, 48);
        g.font = '700 50px "JetBrains Mono", monospace'; g.fillText(String(4200 + n).padStart(6, '0'), w / 2, 108);
        g.font = '600 24px "Barlow Condensed", Arial, sans-serif'; g.fillText(SB.i18n.t('cine.s.boardDay', { d: day }), w / 2, 150);
      });
      this.placardMat.needsUpdate = true;
    }
  }

  Police.Spike = Spike;
  Police.Heli = Heli;
  SB.Police = Police;
  SB.Modes = SB.Modes || {};
  SB.Modes.Police = Police;
})();
