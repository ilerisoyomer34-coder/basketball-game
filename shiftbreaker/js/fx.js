// SHIFTBREAKER — particles, skidmarks, debris and the 6→1 engine explosion sequence.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const T = THREE;

  function spriteTexture(kind) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    if (kind === 'spark') {
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    } else if (kind === 'fire') {
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.4, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    } else {
      for (let i = 0; i < 14; i++) {
        const x = 20 + Math.random() * 24, y = 20 + Math.random() * 24, r = 10 + Math.random() * 14;
        const g2 = g.createRadialGradient(x, y, 0, x, y, r);
        g2.addColorStop(0, 'rgba(255,255,255,0.22)');
        g2.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = g2;
        g.fillRect(0, 0, 64, 64);
      }
    }
    return new T.CanvasTexture(c);
  }

  class Particles {
    constructor(scene, max, kind, additive) {
      this.max = max;
      this.n = 0;
      this.pos = new Float32Array(max * 3);
      this.vel = new Float32Array(max * 3);
      this.col = new Float32Array(max * 4);
      this.size = new Float32Array(max);
      this.life = new Float32Array(max);
      this.maxLife = new Float32Array(max);
      this.s0 = new Float32Array(max);
      this.s1 = new Float32Array(max);
      this.a0 = new Float32Array(max);
      this.rgb0 = new Float32Array(max * 3);
      this.rgb1 = new Float32Array(max * 3);
      this.grav = new Float32Array(max);
      this.drag = new Float32Array(max);
      this.head = 0;
      const geo = new T.BufferGeometry();
      this.aPos = new T.BufferAttribute(this.pos, 3);
      this.aCol = new T.BufferAttribute(this.col, 4);
      this.aSize = new T.BufferAttribute(this.size, 1);
      this.aPos.setUsage(T.DynamicDrawUsage);
      this.aCol.setUsage(T.DynamicDrawUsage);
      this.aSize.setUsage(T.DynamicDrawUsage);
      geo.setAttribute('position', this.aPos);
      geo.setAttribute('aColor', this.aCol);
      geo.setAttribute('aSize', this.aSize);
      this.mat = new T.ShaderMaterial({
        uniforms: { map: { value: spriteTexture(kind) }, uScale: { value: 600 } },
        vertexShader: 'attribute vec4 aColor; attribute float aSize; varying vec4 vC; uniform float uScale; void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb * t.rgb, vC.a * t.a); if (gl_FragColor.a < 0.004) discard; }',
        transparent: true,
        depthWrite: false,
        blending: additive ? T.AdditiveBlending : T.NormalBlending,
      });
      this.points = new T.Points(geo, this.mat);
      this.points.frustumCulled = false;
      scene.add(this.points);
      for (let i = 0; i < max; i++) this.life[i] = 0;
    }
    // o: {x,y,z, vx,vy,vz, life, s0, s1, a, r,g,b, r1,g1,b1, grav, drag}
    emit(o) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
      this.vel[i * 3] = o.vx || 0; this.vel[i * 3 + 1] = o.vy || 0; this.vel[i * 3 + 2] = o.vz || 0;
      this.life[i] = this.maxLife[i] = o.life || 1;
      this.s0[i] = o.s0 || 1; this.s1[i] = o.s1 != null ? o.s1 : this.s0[i];
      this.a0[i] = o.a != null ? o.a : 1;
      this.rgb0[i * 3] = o.r; this.rgb0[i * 3 + 1] = o.g; this.rgb0[i * 3 + 2] = o.b;
      this.rgb1[i * 3] = o.r1 != null ? o.r1 : o.r; this.rgb1[i * 3 + 1] = o.g1 != null ? o.g1 : o.g; this.rgb1[i * 3 + 2] = o.b1 != null ? o.b1 : o.b;
      this.grav[i] = o.grav || 0;
      this.drag[i] = o.drag != null ? o.drag : 0.5;
    }
    update(dt, ground) {
      const P = this.pos, V = this.vel, C = this.col;
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) { if (C[i * 4 + 3] !== 0) { C[i * 4 + 3] = 0; this.size[i] = 0; } continue; }
        this.life[i] -= dt;
        const k = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
        const d = Math.max(0, 1 - this.drag[i] * dt);
        V[i * 3] *= d; V[i * 3 + 1] = V[i * 3 + 1] * d - this.grav[i] * dt; V[i * 3 + 2] *= d;
        P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
        if (ground && this.grav[i] > 0) {
          const gy = ground(P[i * 3], P[i * 3 + 2]);
          if (P[i * 3 + 1] < gy) { P[i * 3 + 1] = gy; V[i * 3 + 1] *= -0.35; V[i * 3] *= 0.6; V[i * 3 + 2] *= 0.6; }
        }
        this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
        C[i * 4] = this.rgb0[i * 3] + (this.rgb1[i * 3] - this.rgb0[i * 3]) * k;
        C[i * 4 + 1] = this.rgb0[i * 3 + 1] + (this.rgb1[i * 3 + 1] - this.rgb0[i * 3 + 1]) * k;
        C[i * 4 + 2] = this.rgb0[i * 3 + 2] + (this.rgb1[i * 3 + 2] - this.rgb0[i * 3 + 2]) * k;
        const fadeIn = Math.min(1, k * 8);
        C[i * 4 + 3] = this.a0[i] * fadeIn * (1 - k) * (1 - k * 0.3);
      }
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aSize.needsUpdate = true;
    }
    clear() { for (let i = 0; i < this.max; i++) this.life[i] = 0; }
  }

  class Skidmarks {
    constructor(scene, max) {
      this.max = max;
      this.pos = new Float32Array(max * 4 * 3);
      this.alpha = new Float32Array(max * 4);
      const idx = new Uint32Array(max * 6);
      for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      const geo = new T.BufferGeometry();
      this.aPos = new T.BufferAttribute(this.pos, 3);
      this.aA = new T.BufferAttribute(this.alpha, 1);
      this.aPos.setUsage(T.DynamicDrawUsage);
      geo.setAttribute('position', this.aPos);
      geo.setAttribute('aA', this.aA);
      geo.setIndex(new T.BufferAttribute(idx, 1));
      const mat = new T.ShaderMaterial({
        uniforms: T.UniformsUtils.merge([T.UniformsLib.fog]),
        vertexShader: 'attribute float aA; varying float vA;\n#include <fog_pars_vertex>\nvoid main(){ vA = aA; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
        fragmentShader: 'varying float vA;\n#include <fog_pars_fragment>\nvoid main(){ gl_FragColor = vec4(0.04,0.04,0.045, vA*0.78);\n#include <fog_fragment>\n}',
        transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
      });
      this.mesh = new T.Mesh(geo, mat);
      this.mesh.frustumCulled = false;
      scene.add(this.mesh);
      this.head = 0;
      this.last = new Map();
    }
    add(id, p, side, width, a) {
      const prev = this.last.get(id);
      if (a <= 0.02) { this.last.delete(id); return; }
      const cur = { x: p.x, y: p.y + 0.035, z: p.z, sx: side.x * width * 0.5, sz: side.z * width * 0.5, a };
      if (prev && (cur.x - prev.x) ** 2 + (cur.z - prev.z) ** 2 > 0.09) {
        if ((cur.x - prev.x) ** 2 + (cur.z - prev.z) ** 2 < 9) {
          const i = this.head;
          this.head = (this.head + 1) % this.max;
          const P = this.pos;
          const set = (k, x, y, z) => { P[(i * 4 + k) * 3] = x; P[(i * 4 + k) * 3 + 1] = y; P[(i * 4 + k) * 3 + 2] = z; };
          set(0, prev.x - prev.sx, prev.y, prev.z - prev.sz);
          set(1, prev.x + prev.sx, prev.y, prev.z + prev.sz);
          set(2, cur.x + cur.sx, cur.y, cur.z + cur.sz);
          set(3, cur.x - cur.sx, cur.y, cur.z - cur.sz);
          this.alpha[i * 4] = this.alpha[i * 4 + 1] = prev.a;
          this.alpha[i * 4 + 2] = this.alpha[i * 4 + 3] = a;
          this.aPos.needsUpdate = true;
          this.aA.needsUpdate = true;
        }
        this.last.set(id, cur);
      } else if (!prev) this.last.set(id, cur);
    }
    cut(id) { this.last.delete(id); }
  }

  class FX {
    constructor(game) {
      this.game = game;
      const s = game.scene;
      const q = game.quality === 'low' ? 0.5 : 1;
      this.smoke = new Particles(s, Math.round(2600 * q), 'smoke', false);
      this.fire = new Particles(s, Math.round(1800 * q), 'fire', true);
      this.sparks = new Particles(s, Math.round(1200 * q), 'spark', true);
      this.skids = new Skidmarks(s, game.quality === 'low' ? 1200 : 3500);
      this.debris = [];
      this.lights = [];
      this.rings = [];
      this.ground = (x, z) => game.world.heightAt(x, z) + 0.05;
      this.emitAcc = {};
    }
    setScale(px) { for (const p of [this.smoke, this.fire, this.sparks]) p.mat.uniforms.uScale.value = px; }

    rate(key, perSec, dt) {
      const a = (this.emitAcc[key] || 0) + perSec * dt;
      const n = Math.floor(a);
      this.emitAcc[key] = a - n;
      return n;
    }

    puff(p, o) {
      this.smoke.emit(Object.assign({ x: p.x, y: p.y, z: p.z, life: 2, s0: 0.6, s1: 3, a: 0.5, r: 0.8, g: 0.8, b: 0.8, drag: 0.8 }, o));
    }
    flame(p, o) {
      this.fire.emit(Object.assign({ x: p.x, y: p.y, z: p.z, life: 0.45, s0: 0.9, s1: 0.2, a: 1, r: 1, g: 0.75, b: 0.3, r1: 0.9, g1: 0.25, b1: 0.05, drag: 1.2 }, o));
    }
    spark(p, o) {
      this.sparks.emit(Object.assign({ x: p.x, y: p.y, z: p.z, life: 0.6, s0: 0.12, s1: 0.04, a: 1, r: 1, g: 0.85, b: 0.4, r1: 1, g1: 0.4, b1: 0.1, grav: 9.8, drag: 0.2 }, o));
    }

    sparkBurst(p, n, speed, dirx, dirz) {
      for (let i = 0; i < n; i++) {
        this.spark(p, { vx: (dirx || 0) * speed + (Math.random() - 0.5) * speed, vy: Math.random() * speed * 0.7, vz: (dirz || 0) * speed + (Math.random() - 0.5) * speed, life: 0.3 + Math.random() * 0.5 });
      }
    }
    glassBurst(p, n) {
      for (let i = 0; i < n; i++) this.sparks.emit({ x: p.x + (Math.random() - 0.5), y: p.y + Math.random() * 0.5, z: p.z + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 9, vy: 2 + Math.random() * 6, vz: (Math.random() - 0.5) * 9, life: 0.8 + Math.random() * 0.8, s0: 0.09, s1: 0.06, a: 0.9, r: 0.75, g: 0.9, b: 1, grav: 9.8, drag: 0.1 });
    }
    splash(p) {
      for (let i = 0; i < 90; i++) this.smoke.emit({ x: p.x + (Math.random() - 0.5) * 3, y: 0.2, z: p.z + (Math.random() - 0.5) * 3, vx: (Math.random() - 0.5) * 6, vy: 4 + Math.random() * 8, vz: (Math.random() - 0.5) * 6, life: 1.4, s0: 0.5, s1: 1.6, a: 0.8, r: 0.92, g: 0.96, b: 1, grav: 9.8, drag: 0.4 });
    }

    flash(p, color, intensity, decay, dist) {
      const l = new T.PointLight(color, intensity, dist || 40, 2);
      l.position.copy(p);
      this.game.scene.add(l);
      this.lights.push({ l, decay, i0: intensity });
      return l;
    }
    shockwave(p) {
      const m = new T.Mesh(new T.RingGeometry(0.6, 1.4, 48), new T.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, this.game.world.heightAt(p.x, p.z) + 0.3, p.z);
      this.game.scene.add(m);
      const ball = new T.Mesh(new T.SphereGeometry(1, 20, 14), new T.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false }));
      ball.position.copy(p);
      this.game.scene.add(ball);
      this.rings.push({ m, t: 0, kind: 'ring' }, { m: ball, t: 0, kind: 'ball' });
    }

    // detach a mesh from the car and throw it
    throwPart(mesh, vel, spin) {
      const wp = new T.Vector3(), wq = new T.Quaternion(), ws = new T.Vector3();
      mesh.updateWorldMatrix(true, false);
      mesh.matrixWorld.decompose(wp, wq, ws);
      mesh.parent && mesh.parent.remove(mesh);
      mesh.position.copy(wp);
      mesh.quaternion.copy(wq);
      this.game.scene.add(mesh);
      this.debris.push({ mesh, v: vel.clone(), w: spin.clone(), t: 0, owned: false });
    }
    spawnChunk(p, vel, size, color) {
      const mesh = new T.Mesh(new T.BoxGeometry(size, size * 0.7, size * 1.2), new T.MeshStandardMaterial({ color: color || 0x2a2a2a, roughness: 0.7, metalness: 0.5 }));
      mesh.position.copy(p);
      mesh.castShadow = true;
      this.game.scene.add(mesh);
      this.debris.push({ mesh, v: vel.clone(), w: new T.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10), t: 0, owned: true });
    }
    clearDebris() {
      for (const d of this.debris) { this.game.scene.remove(d.mesh); if (d.owned) d.mesh.geometry.dispose(); }
      this.debris = [];
    }

    // continuous effects from the player car each frame
    carEffects(car, dt) {
      const v = car.visual;
      const dtr = car.dt;
      const tmp = new T.Vector3();
      for (let i = 0; i < 4; i++) {
        const w = car.wheels[i];
        if (w.contact && w.skid > 0.05) {
          const side = car.left;
          this.skids.add('p' + i, w.cp, side, car.car.wheel.width, w.skid);
          const n = this.rate('ts' + i, 38 * w.skid, dt);
          const dusty = w.surf === 'dirt' || w.surf === 'gravel' || w.surf === 'grass';
          for (let k = 0; k < n; k++) {
            this.puff(w.cp, {
              y: w.cp.y + 0.25, vx: (Math.random() - 0.5) * 1.5 - car.vel.x * 0.1, vy: 0.6 + Math.random(), vz: (Math.random() - 0.5) * 1.5 - car.vel.z * 0.1,
              life: 1.8 + Math.random(), s0: 0.7, s1: 3.6, a: 0.32 * w.skid, r: dusty ? 0.55 : 0.86, g: dusty ? 0.47 : 0.86, b: dusty ? 0.36 : 0.86,
            });
          }
        } else this.skids.cut('p' + i);
      }
      // exhaust
      for (const e of v.exhaust) {
        tmp.copy(e).applyQuaternion(car.quat).add(car.pos);
        const dmg = 1 - dtr.health.engine;
        if (dtr.running) {
          const n = this.rate('ex', 3 + dtr.thrEff * 6 + dmg * 20, dt);
          for (let k = 0; k < n; k++) {
            const dark = dmg > 0.3 ? 0.25 : 0.7;
            this.puff(tmp, { vx: -car.fwd.x * 1.5, vy: 0.3, vz: -car.fwd.z * 1.5, life: 0.9 + dmg, s0: 0.15, s1: 0.9 + dmg * 2, a: 0.08 + dmg * 0.4, r: dark, g: dark, b: dark + 0.05 });
          }
        }
      }
      // engine bay: steam (radiator), black smoke (engine), clutch smoke from under the car
      const bay = tmp.copy(v.enginePos).applyQuaternion(car.quat).add(car.pos);
      const rad = 1 - dtr.health.radiator;
      if (rad > 0.25 && !car.exploded) {
        const n = this.rate('steam', rad * 14, dt);
        for (let k = 0; k < n; k++) this.puff(bay, { y: bay.y + 0.4, vy: 1.4, vx: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6, life: 1.6, s0: 0.4, s1: 2, a: 0.25 * rad, r: 0.95, g: 0.95, b: 0.97 });
      }
      if (dtr.health.engine < 0.5 && !car.exploded) {
        const n = this.rate('esmoke', (0.5 - dtr.health.engine) * 26, dt);
        for (let k = 0; k < n; k++) this.puff(bay, { y: bay.y + 0.4, vy: 1.2, life: 2.2, s0: 0.5, s1: 2.6, a: 0.3, r: 0.18, g: 0.18, b: 0.19 });
      }
      if (dtr.clutchTemp > SB.DATA.RULES.clutchHeat.hot) {
        const n = this.rate('clutch', (dtr.clutchTemp - 250) * 0.25, dt);
        const under = tmp.copy(car.pos).addScaledVector(car.up, -0.3);
        for (let k = 0; k < n; k++) this.puff(under, { vy: 0.5, life: 1.6, s0: 0.4, s1: 2.2, a: 0.28, r: 0.7, g: 0.7, b: 0.72 });
      }
    }

    backfire(car, small) {
      const v = car.visual;
      for (const e of v.exhaust) {
        const p = e.clone().applyQuaternion(car.quat).add(car.pos);
        const n = small ? 3 : 9;
        for (let i = 0; i < n; i++) this.flame(p, { vx: -car.fwd.x * (5 + Math.random() * 5) + car.vel.x, vy: Math.random(), vz: -car.fwd.z * (5 + Math.random() * 5) + car.vel.z, life: 0.12 + Math.random() * 0.1, s0: small ? 0.35 : 0.7, s1: 0.1 });
      }
      if (!small) this.flash(car.pos.clone().addScaledVector(car.fwd, -2.3), 0xff8a30, 2.2, 14, 9);
    }

    update(dt) {
      this.smoke.update(dt, null);
      this.fire.update(dt, null);
      this.sparks.update(dt, this.ground);
      for (let i = this.lights.length - 1; i >= 0; i--) {
        const L = this.lights[i];
        L.l.intensity -= L.decay * dt * (L.i0 / 10 + 1);
        if (L.flicker) L.l.intensity = Math.max(0, L.base * (0.75 + Math.random() * 0.5) * L.fade);
        if (L.l.intensity <= 0.01 && !L.keep) { this.game.scene.remove(L.l); this.lights.splice(i, 1); }
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.t += dt;
        if (r.kind === 'ring') {
          const s = 1 + r.t * 46;
          r.m.scale.set(s, s, s);
          r.m.material.opacity = Math.max(0, 0.9 - r.t * 1.4);
        } else {
          const s = 1 + Math.sqrt(r.t) * 7;
          r.m.scale.set(s, s, s);
          r.m.material.opacity = Math.max(0, 0.85 - r.t * 1.7);
          r.m.material.color.setRGB(1, Math.max(0.2, 0.7 - r.t), Math.max(0.05, 0.3 - r.t));
        }
        if (r.t > 1.2) { this.game.scene.remove(r.m); r.m.geometry.dispose(); this.rings.splice(i, 1); }
      }
      for (const d of this.debris) {
        if (d.rest) continue;
        d.t += dt;
        d.v.y -= 9.8 * dt;
        d.mesh.position.addScaledVector(d.v, dt);
        d.mesh.rotation.x += d.w.x * dt; d.mesh.rotation.y += d.w.y * dt; d.mesh.rotation.z += d.w.z * dt;
        const gy = this.game.world.heightAt(d.mesh.position.x, d.mesh.position.z) + 0.05;
        if (d.mesh.position.y < gy) {
          d.mesh.position.y = gy;
          d.v.y *= -0.3;
          d.v.x *= 0.55; d.v.z *= 0.55;
          d.w.multiplyScalar(0.5);
          if (Math.abs(d.v.y) < 0.6 && d.v.lengthSq() < 0.5) d.rest = true;
          if (Math.abs(d.v.y) > 2) this.game.audio && this.game.audio.clatter(Math.min(1, Math.abs(d.v.y) / 8));
        }
      }
    }
  }

  // ------------------------------------------------------------------ explosion sequence
  // Timeline in real seconds (spec §5.2). visualOnly: replay mode (no forces, no game state).
  class Explosion {
    constructor(game, car, info, visualOnly) {
      this.game = game;
      this.car = car;
      this.info = info;
      this.visualOnly = !!visualOnly;
      this.t = 0;
      this.done = {};
      this.burnT = 0;
      this.fireLight = null;
      this.active = true;
    }
    at(t, key, fn) {
      if (this.t >= t && !this.done[key]) { this.done[key] = true; fn(); }
    }
    bay() { return this.car.visual.enginePos.clone().applyQuaternion(this.car.quat).add(this.car.pos); }
    update(rdt, gdt) {
      const g = this.game, fx = g.fx, car = this.car, v = car.visual;
      this.t += rdt;
      const vo = this.visualOnly;
      this.at(0, 'clank', () => {
        g.audio.clank(1.0);
        g.audio.grindBurst();
        g.camShake(1.1);
        if (!vo) {
          g.hud.tachBreak(true);
          g.rumble(1, 0.6);
        }
        fx.sparkBurst(this.bay(), 40, 6);
      });
      this.at(0.15, 'sparks', () => {
        fx.sparkBurst(this.bay(), 80, 9);
        for (let i = 0; i < 40; i++) fx.puff(this.bay(), { vx: (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.8, s0: 0.2, s1: 0.6, a: 0.8, r: 0.08, g: 0.07, b: 0.05 });
        if (v.hood) { v.hood.position.y += 0.05; v.hood.rotation.x -= 0.08; }
        if (!vo) g.hud.allWarnings = true;
      });
      this.at(0.4, 'flames', () => {
        g.audio.backfire(1);
        fx.backfire(car, false);
        this.fireLight = fx.flash(this.bay(), 0xff7a2a, 4, 0, 18);
        const L = fx.lights[fx.lights.length - 1];
        L.keep = true; L.flicker = true; L.base = 4; L.fade = 1;
      });
      if (this.t > 0.4 && this.t < 1.0) {
        const n = fx.rate('xf1', 120, rdt);
        const bay = this.bay();
        for (let i = 0; i < n; i++) fx.flame(bay, { y: bay.y + 0.3, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 2, life: 0.35, s0: 1.1, s1: 0.3 });
        const m = fx.rate('xs1', 50, rdt);
        for (let i = 0; i < m; i++) fx.puff(bay, { y: bay.y + 0.6, vy: 2.5, life: 2.5, s0: 0.8, s1: 4, a: 0.55, r: 0.06, g: 0.06, b: 0.07 });
        if (Math.random() < rdt * 6) { g.audio.backfire(0.6); fx.backfire(car, true); }
      }
      this.at(0.8, 'slowmo', () => {
        if (g.settings.slowmo) g.setTimeScale(0.25);
        g.setCinematic(true);
      });
      this.at(1.0, 'boom', () => {
        const p = this.bay();
        g.audio.explosion();
        fx.shockwave(p);
        fx.flash(p, 0xffb060, 30, 40, 60);
        g.hud.flash();
        g.camShake(2.2);
        for (let i = 0; i < 160; i++) {
          const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 10;
          fx.flame(p, { vx: Math.cos(a) * s, vy: 2 + Math.random() * 9, vz: Math.sin(a) * s, life: 0.6 + Math.random() * 0.6, s0: 2.4, s1: 0.6, drag: 2.2 });
        }
        for (let i = 0; i < 70; i++) {
          const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
          fx.puff(p, { vx: Math.cos(a) * s, vy: 3 + Math.random() * 5, vz: Math.sin(a) * s, life: 3.5 + Math.random() * 2, s0: 1.4, s1: 7, a: 0.7, r: 0.07, g: 0.065, b: 0.07, drag: 1.2 });
        }
        fx.sparkBurst(p, 140, 14);
        fx.glassBurst(car.pos.clone().addScaledVector(car.up, 0.6), 160);
        v.glassMesh.visible = false;
        if (v.hood && v.hood.parent) {
          const hv = car.vel.clone().addScaledVector(car.up, 13 + Math.random() * 4).addScaledVector(car.fwd, 4 + Math.random() * 3).addScaledVector(car.left, (Math.random() - 0.5) * 5);
          fx.throwPart(v.hood, hv, new T.Vector3(6 + Math.random() * 6, Math.random() * 4, Math.random() * 3));
        }
        for (let i = 0; i < 7; i++) {
          const dv = car.vel.clone().add(new T.Vector3((Math.random() - 0.5) * 14, 6 + Math.random() * 12, (Math.random() - 0.5) * 14));
          fx.spawnChunk(p, dv, 0.15 + Math.random() * 0.3, i % 3 ? 0x2b2b2b : 0x6b6e72);
        }
        car.setCharred(1);
        if (!vo) {
          car.explodeImpulse(1);
          g.traffic && g.traffic.flee(p, 45);
          g.rumble(1, 1.2);
        }
      });
      this.at(2.5, 'normal', () => {
        g.setTimeScale(1);
        if (!vo) {
          g.audio.alarm(car.pos);
          g.traffic && g.traffic.alarms(car.pos, 40);
        }
      });
      // burning wreck: fire + smoke fade over ~16 s
      if (this.t > 1.0) {
        this.burnT += rdt;
        const f = U.clamp(1 - this.burnT / 16, 0, 1);
        if (f > 0) {
          const bay = this.bay();
          const n = fx.rate('xbf', 70 * f + 10, rdt);
          for (let i = 0; i < n; i++) fx.flame(bay, { x: bay.x + (Math.random() - 0.5) * 1.4, y: bay.y + 0.2, z: bay.z + (Math.random() - 0.5) * 1.4, vx: (Math.random() - 0.5), vy: 2 + Math.random() * 2.5, vz: (Math.random() - 0.5), life: 0.5 + Math.random() * 0.3, s0: 1.3 * (0.4 + f), s1: 0.2 });
          const m = fx.rate('xbs', 26 * f + 4, rdt);
          for (let i = 0; i < m; i++) fx.puff(bay, { y: bay.y + 0.8, vx: (Math.random() - 0.5), vy: 2.2 + Math.random(), vz: (Math.random() - 0.5), life: 4, s0: 1, s1: 6, a: 0.45 * (0.3 + f), r: 0.07, g: 0.07, b: 0.08, drag: 0.4 });
          if (this.fireLight) {
            this.fireLight.position.copy(bay).addScaledVector(car.up, 1);
            const L = fx.lights.find((x) => x.l === this.fireLight);
            if (L) L.fade = f;
          }
        } else if (this.fireLight) {
          const L = fx.lights.find((x) => x.l === this.fireLight);
          if (L) { L.keep = false; L.flicker = false; L.l.intensity = 0; }
          this.fireLight = null;
        }
      }
      this.at(4.2, 'result', () => { if (!vo) g.onExplosionResult(this.info); });
    }
    stop() {
      const fx = this.game.fx;
      if (this.fireLight) {
        const L = fx.lights.find((x) => x.l === this.fireLight);
        if (L) { L.keep = false; L.flicker = false; L.l.intensity = 0; }
        this.fireLight = null;
      }
      this.active = false;
    }
  }

  // charring, hood/glass restore for the player car
  SB.Vehicle.prototype.setCharred = function (k) {
    const m = this.visual.mats;
    if (!this._paintColor) this._paintColor = m.paint.color.clone();
    m.paint.color.copy(this._paintColor).lerp(new T.Color(0x141210), k);
    m.paint.roughness = U.lerp(0.32, 1, k);
    m.paint.metalness = U.lerp(0.15, 0, k);
    this.charred = k;
  };
  SB.Vehicle.prototype.restoreVisuals = function () {
    const v = this.visual;
    this.setCharred(0);
    v.glassMesh.visible = true;
    if (v.hood && v.hood.parent !== v.body) {
      if (v.hood.parent) v.hood.parent.remove(v.hood);
      v.body.add(v.hood);
      v.hood.position.copy(v.hood.userData.home.p);
      v.hood.rotation.copy(v.hood.userData.home.r);
      this.game.fx.debris = this.game.fx.debris.filter((d) => d.mesh !== v.hood);
    } else if (v.hood) {
      v.hood.position.copy(v.hood.userData.home.p);
      v.hood.rotation.copy(v.hood.userData.home.r);
    }
  };

  SB.FX = FX;
  SB.Explosion = Explosion;
})();
