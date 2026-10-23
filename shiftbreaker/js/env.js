// SHIFTBREAKER — environment: day/night cycle, sky, sun & moon light, weather (rain, snow, fog, storm).
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const T = THREE;

  const KEYS = [
    // sunElevation → colours
    { e: -0.35, top: [0.01, 0.015, 0.04], hor: [0.04, 0.05, 0.09], sun: [0.32, 0.4, 0.62], si: 0.22, hs: [0.08, 0.1, 0.18], hg: [0.03, 0.03, 0.04], hi: 0.55 },
    { e: -0.08, top: [0.06, 0.07, 0.16], hor: [0.35, 0.22, 0.24], sun: [0.45, 0.42, 0.6], si: 0.25, hs: [0.2, 0.18, 0.26], hg: [0.06, 0.05, 0.05], hi: 0.55 },
    { e: 0.05, top: [0.22, 0.32, 0.55], hor: [0.98, 0.58, 0.36], sun: [1.0, 0.56, 0.3], si: 0.75, hs: [0.55, 0.48, 0.48], hg: [0.25, 0.18, 0.13], hi: 0.42 },
    { e: 0.25, top: [0.25, 0.47, 0.8], hor: [0.75, 0.78, 0.82], sun: [1.0, 0.88, 0.72], si: 0.95, hs: [0.6, 0.7, 0.88], hg: [0.36, 0.3, 0.24], hi: 0.45 },
    { e: 1.0, top: [0.2, 0.45, 0.85], hor: [0.68, 0.79, 0.9], sun: [1.0, 0.97, 0.92], si: 1.05, hs: [0.62, 0.74, 0.92], hg: [0.38, 0.33, 0.26], hi: 0.48 },
  ];
  const lerp3 = (a, b, t, out) => out.setRGB(U.lerp(a[0], b[0], t), U.lerp(a[1], b[1], t), U.lerp(a[2], b[2], t));

  class Env {
    constructor(game) {
      this.game = game;
      const scene = game.scene;
      this.time = 9.2;
      this.weather = 'sunny';
      this.nextWeather = 'sunny';
      this.blend = 1;
      this.wet = 0;
      this.snowCover = 0;
      this.weatherTimer = 600;
      this.sunDir = new T.Vector3(0.3, 0.8, 0.2);
      this.sunColor = new T.Color(1, 1, 1);
      this.horizon = new T.Color();
      this.top = new T.Color();
      this.night = 0;
      this.grip = 1;
      this.wind = new T.Vector3();
      this.lightning = 0;
      this.nextBolt = 8;
      // lights
      this.sun = new T.DirectionalLight(0xffffff, 1.4);
      const q = game.quality;
      this.sun.castShadow = q !== 'low';
      const sm = q === 'high' ? 2048 : 1024;
      this.sun.shadow.mapSize.set(sm, sm);
      const sc = this.sun.shadow.camera;
      sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.03;
      scene.add(this.sun, this.sun.target);
      this.hemi = new T.HemisphereLight(0xaaccff, 0x554433, 0.6);
      scene.add(this.hemi);
      this.fog = new T.Fog(0xbfd0de, 150, 1400);
      scene.fog = this.fog;
      this.buildSky(scene);
      this.buildPrecip(scene);
      this.buildPuddles(scene);
    }

    buildSky(scene) {
      const mat = new T.ShaderMaterial({
        uniforms: { top: { value: new T.Color() }, hor: { value: new T.Color() }, sunDir: { value: new T.Vector3() }, sunCol: { value: new T.Color() }, night: { value: 0 }, cloud: { value: 0 } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }',
        fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night; uniform float cloud; varying vec3 vDir;
          void main(){
            float h = clamp(vDir.y, -0.2, 1.0);
            vec3 c = mix(hor, top, pow(max(h,0.0), 0.55));
            if (h < 0.0) c = mix(hor, hor*0.6, -h*5.0);
            float sd = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
            c += sunCol * (pow(sd, 900.0) * 6.0 + pow(sd, 12.0) * 0.35) * (1.0 - cloud*0.8);
            vec3 md = -normalize(sunDir);
            float m = max(dot(normalize(vDir), md), 0.0);
            c += vec3(0.75,0.8,0.9) * pow(m, 1400.0) * 3.0 * night;
            c = mix(c, vec3(dot(c, vec3(0.33))) * 0.9, cloud*0.55);
            gl_FragColor = vec4(c, 1.0);
          }`,
        side: T.BackSide,
        depthWrite: false,
        fog: false,
      });
      this.skyMat = mat;
      this.sky = new T.Mesh(new T.SphereGeometry(3000, 32, 16), mat);
      this.sky.renderOrder = -1;
      scene.add(this.sky);
      // stars
      const n = 1400, p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
        p[i * 3] = r * Math.cos(a) * 2800; p[i * 3 + 1] = Math.abs(u) * 2800; p[i * 3 + 2] = r * Math.sin(a) * 2800;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(p, 3));
      this.starMat = new T.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
      this.stars = new T.Points(g, this.starMat);
      scene.add(this.stars);
      // clouds
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const cg = c.getContext('2d');
      for (let i = 0; i < 30; i++) {
        const x = 20 + Math.random() * 88, y = 40 + Math.random() * 48, r = 14 + Math.random() * 26;
        const gr = cg.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.35)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        cg.fillStyle = gr;
        cg.fillRect(0, 0, 128, 128);
      }
      const ctex = new T.CanvasTexture(c);
      this.clouds = [];
      for (let i = 0; i < 18; i++) {
        const m = new T.SpriteMaterial({ map: ctex, transparent: true, opacity: 0.7, depthWrite: false, fog: false });
        const s = new T.Sprite(m);
        const sz = 380 + Math.random() * 420;
        s.scale.set(sz, sz * 0.45, 1);
        s.position.set((Math.random() - 0.5) * 3600, 330 + Math.random() * 200, (Math.random() - 0.5) * 3600);
        scene.add(s);
        this.clouds.push(s);
      }
    }

    buildPrecip(scene) {
      const n = this.game.quality === 'low' ? 1200 : 2600;
      this.rainN = n;
      const p = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * 60, y = Math.random() * 30, z = (Math.random() - 0.5) * 60;
        p.set([x, y, z, x, y - 0.6, z], i * 6);
      }
      const g = new T.BufferGeometry();
      this.rainAttr = new T.BufferAttribute(p, 3);
      this.rainAttr.setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', this.rainAttr);
      this.rain = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xaabbd0, transparent: true, opacity: 0.45, depthWrite: false }));
      this.rain.frustumCulled = false;
      this.rain.visible = false;
      scene.add(this.rain);
      const sn = 1600, sp = new Float32Array(sn * 3);
      for (let i = 0; i < sn; i++) sp.set([(Math.random() - 0.5) * 60, Math.random() * 30, (Math.random() - 0.5) * 60], i * 3);
      const sg = new T.BufferGeometry();
      this.snowAttr = new T.BufferAttribute(sp, 3);
      this.snowAttr.setUsage(T.DynamicDrawUsage);
      sg.setAttribute('position', this.snowAttr);
      this.snow = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }));
      this.snow.frustumCulled = false;
      this.snow.visible = false;
      scene.add(this.snow);
    }

    buildPuddles(scene) {
      const W = this.game.world;
      const r = U.mulberry32(77);
      this.puddles = [];
      const p = {};
      const mat = new T.MeshStandardMaterial({ color: 0x1b2227, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
      this.puddleMat = mat;
      const geo = new T.CircleGeometry(1, 20);
      geo.rotateX(-Math.PI / 2);
      for (const e of W.edges) {
        if (e.kind !== 'highway' && e.kind !== 'avenue') continue;
        if (r() > 0.25) continue;
        W.edgePoint(e, e.len * (0.2 + r() * 0.6), p);
        const off = (r() - 0.5) * e.w * 0.5;
        const x = p.x - p.tz * off, z = p.z + p.tx * off;
        const m = new T.Mesh(geo, mat);
        const sx = 2.5 + r() * 3, sz = 1.4 + r() * 2;
        m.scale.set(sx, 1, sz);
        m.rotation.y = Math.atan2(p.tx, p.tz);
        m.position.set(x, W.heightAt(x, z) + 0.05, z);
        scene.add(m);
        this.puddles.push({ x, z, r: Math.max(sx, sz) });
      }
      W.isPuddle = (x, z) => this.wet > 0.6 && this.puddles.some((q) => (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < q.r * q.r * 0.6);
    }

    setWeather(w, instant) {
      if (!SB.DATA.WEATHER[w]) return;
      this.nextWeather = w;
      if (instant) { this.weather = w; this.blend = 1; } else this.blend = 0;
    }
    setTime(h) { this.time = ((h % 24) + 24) % 24; }

    W() {
      const a = SB.DATA.WEATHER[this.weather], b = SB.DATA.WEATHER[this.nextWeather];
      const t = this.blend;
      const o = {};
      for (const k of Object.keys(a)) o[k] = U.lerp(a[k], b[k], t);
      return o;
    }

    update(dt, camPos, focus) {
      const st = this.game.settings;
      if (!st.timeFixed) this.time = (this.time + (dt * 24) / (Math.max(4, st.dayLength) * 60)) % 24;
      // weather progression
      if (this.blend < 1) {
        this.blend = Math.min(1, this.blend + dt / 45);
        if (this.blend >= 1) this.weather = this.nextWeather;
      }
      if (st.weather === 'dynamic') {
        this.weatherTimer -= dt;
        if (this.weatherTimer <= 0) {
          this.weatherTimer = 240 + Math.random() * 360;
          const opts = ['sunny', 'sunny', 'cloudy', 'cloudy', 'fog', 'rain', 'rain', 'storm', 'snow'];
          this.setWeather(U.pick(opts));
        }
      } else if (st.weather !== this.nextWeather) this.setWeather(st.weather);
      const w = this.W();
      // wetness and snow accumulate / dry slowly
      if (w.wet > this.wet) this.wet = Math.min(w.wet, this.wet + dt / 25);
      else this.wet = Math.max(w.wet, this.wet - dt / 120);
      this.snowCover = U.clamp(this.snowCover + (w.snow > 0.5 ? dt / 60 : -dt / 200), 0, 1);
      this.grip = w.grip * (1 - this.snowCover * 0.25);
      this.aquaplane = this.wet > 0.6 && w.rain > 0.5;
      this.puddleMat.opacity = U.clamp((this.wet - 0.4) * 1.6, 0, 0.85);

      // sun
      const ang = ((this.time - 6) / 12) * Math.PI;
      const el = Math.sin(ang);
      const az = ang * 0.9 + 0.6;
      this.sunDir.set(Math.cos(az) * Math.cos(Math.asin(U.clamp(el, -1, 1))), el, Math.sin(az) * Math.cos(Math.asin(U.clamp(el, -1, 1)))).normalize();
      let i = 0;
      while (i < KEYS.length - 2 && el > KEYS[i + 1].e) i++;
      const A = KEYS[i], B = KEYS[i + 1];
      const t = U.clamp((el - A.e) / (B.e - A.e), 0, 1);
      lerp3(A.top, B.top, t, this.top);
      lerp3(A.hor, B.hor, t, this.horizon);
      lerp3(A.sun, B.sun, t, this.sunColor);
      const hs = lerp3(A.hs, B.hs, t, new T.Color()), hg = lerp3(A.hg, B.hg, t, new T.Color());
      const cloud = U.clamp((w.fog - 1) * 0.5 + w.rain * 0.4 + w.snow * 0.3, 0, 1);
      this.night = U.clamp((0.08 - el) / 0.2, 0, 1);
      const si = U.lerp(A.si, B.si, t) * (1 - cloud * 0.65);
      const isMoon = el < -0.05;
      if (isMoon) this.sunDir.multiplyScalar(-1);
      this.sun.intensity = isMoon ? 0.22 * (1 - cloud * 0.6) : si;
      this.sun.color.copy(isMoon ? new T.Color(0.45, 0.55, 0.85) : this.sunColor);
      this.hemi.color.copy(hs).lerp(new T.Color(0.5, 0.52, 0.55), cloud * 0.5);
      this.hemi.groundColor.copy(hg);
      this.hemi.intensity = U.lerp(A.hi, B.hi, t) * (1 + cloud * 0.25);
      // lightning
      if (w.rain > 1.2) {
        this.nextBolt -= dt;
        if (this.nextBolt <= 0) {
          this.nextBolt = 6 + Math.random() * 12;
          this.lightning = 1;
          setTimeout(() => this.game.audio && this.game.audio.thunder(), 600 + Math.random() * 2000);
        }
      }
      if (this.lightning > 0) {
        this.lightning = Math.max(0, this.lightning - dt * 5);
        this.hemi.intensity += this.lightning * 2.5 * (Math.random() < 0.5 ? 1 : 0.4);
      }
      // wind gusts in storms
      const gust = w.rain > 1.2 ? (Math.sin(this.game.time * 0.7) * 0.5 + Math.sin(this.game.time * 2.3) * 0.3) * 1.4 : 0;
      this.wind.set(gust * 0.8, 0, gust * 0.6);
      // fog
      const fogCol = this.horizon.clone().lerp(new T.Color(0.6, 0.63, 0.66), cloud * 0.6);
      if (this.night > 0) fogCol.lerp(new T.Color(0.03, 0.04, 0.07), this.night * 0.8);
      this.fog.color.copy(fogCol);
      this.fog.near = 120 / w.fog;
      this.fog.far = 1500 / Math.pow(w.fog, 1.15);
      this.game.renderer.setClearColor(fogCol);
      // sky
      const u = this.skyMat.uniforms;
      u.top.value.copy(this.top).lerp(fogCol, cloud * 0.7);
      u.hor.value.copy(fogCol);
      u.sunDir.value.copy(isMoon ? this.sunDir.clone().multiplyScalar(-1) : this.sunDir);
      u.sunCol.value.copy(this.sunColor);
      u.night.value = this.night;
      u.cloud.value = cloud;
      this.sky.position.copy(camPos);
      this.stars.position.copy(camPos);
      this.starMat.opacity = this.night * (1 - cloud) * 0.95;
      for (const c of this.clouds) {
        c.position.x += dt * 3;
        if (c.position.x > camPos.x + 1800) c.position.x -= 3600;
        c.material.opacity = U.clamp(0.25 + cloud * 0.75, 0, 1) * (1 - this.night * 0.7);
        c.material.color.copy(this.horizon).lerp(new T.Color(1, 1, 1), 0.5 - this.night * 0.4).multiplyScalar(1 - cloud * 0.35);
      }
      // shadow camera follows the focus point
      const f = focus || camPos;
      this.sun.position.copy(f).addScaledVector(this.sunDir, 160);
      this.sun.target.position.copy(f);
      // precipitation
      this.rain.visible = w.rain > 0.05;
      if (this.rain.visible) {
        const P = this.rainAttr.array;
        const fall = 16 * dt, wx = this.wind.x * dt * 3, wz = this.wind.z * dt * 3;
        const n = Math.floor(this.rainN * U.clamp(w.rain, 0, 1.8) / 1.8);
        for (let k = 0; k < this.rainN; k++) {
          const o = k * 6;
          if (k > n) { P[o + 1] = P[o + 4] = -999; continue; }
          let x = P[o] + wx, y = P[o + 1] - fall, z = P[o + 2] + wz;
          if (y < camPos.y - 8 || Math.abs(x - camPos.x) > 30 || Math.abs(z - camPos.z) > 30 || P[o + 1] < -900) {
            x = camPos.x + (Math.random() - 0.5) * 60; y = camPos.y + 14 + Math.random() * 12; z = camPos.z + (Math.random() - 0.5) * 60;
          }
          P[o] = x; P[o + 1] = y; P[o + 2] = z;
          P[o + 3] = x - wx * 2; P[o + 4] = y - 0.7; P[o + 5] = z - wz * 2;
        }
        this.rainAttr.needsUpdate = true;
        this.rain.material.opacity = 0.25 + 0.25 * Math.min(1, w.rain);
      }
      this.snow.visible = w.snow > 0.05;
      if (this.snow.visible) {
        const P = this.snowAttr.array;
        for (let k = 0; k < P.length; k += 3) {
          let x = P[k] + Math.sin(this.game.time + k) * dt * 0.8, y = P[k + 1] - 1.6 * dt, z = P[k + 2] + Math.cos(this.game.time * 0.7 + k) * dt * 0.8;
          if (y < camPos.y - 6 || Math.abs(x - camPos.x) > 30 || Math.abs(z - camPos.z) > 30) {
            x = camPos.x + (Math.random() - 0.5) * 60; y = camPos.y + 12 + Math.random() * 14; z = camPos.z + (Math.random() - 0.5) * 60;
          }
          P[k] = x; P[k + 1] = y; P[k + 2] = z;
        }
        this.snowAttr.needsUpdate = true;
      }
      this.rainLevel = w.rain;
    }
    clockText() {
      const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60);
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }
  }

  SB.Env = Env;
})();
