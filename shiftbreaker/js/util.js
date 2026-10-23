// SHIFTBREAKER — shared helpers (no dependencies; also loads in Node for tests)
(function (root) {
  'use strict';
  const SB = (root.SB = root.SB || {});
  const U = (SB.U = {});

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.invLerp = (a, b, v) => U.clamp((v - a) / (b - a), 0, 1);
  U.smoothstep = (a, b, x) => {
    const t = U.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  // Frame-rate independent exponential smoothing.
  U.damp = (a, b, lambda, dt) => U.lerp(a, b, 1 - Math.exp(-lambda * dt));
  U.sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  U.angleWrap = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  U.mulberry32 = (seed) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  U.range = (a, b) => a + Math.random() * (b - a);
  U.pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];

  // Piecewise-linear lookup in a sorted [[x, y], ...] table.
  U.interp = (table, x) => {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (x <= table[i][0]) {
        const a = table[i - 1], b = table[i];
        return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
      }
    }
    return table[table.length - 1][1];
  };

  U.fmtTime = (s) => {
    if (!isFinite(s) || s < 0) return '--:--.---';
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
  };
  U.fmtInt = (n) => {
    const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '-' : '') + s;
  };

  // Browser storage that never throws (private windows, blocked storage, previews).
  U.store = {
    get(k, d) {
      try {
        const v = root.localStorage && root.localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        root.localStorage && root.localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* storage unavailable — progress lives for this session only */
      }
    },
  };

  U.deepMerge = (base, over) => {
    if (over == null || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(over)) {
      const b = base ? base[k] : undefined;
      out[k] = b && typeof b === 'object' && !Array.isArray(b) ? U.deepMerge(b, over[k]) : over[k];
    }
    return out;
  };
  U.clone = (o) => JSON.parse(JSON.stringify(o));

  // 2D helpers on the ground plane (x, z).
  U.dist2 = (ax, az, bx, bz) => {
    const dx = ax - bx, dz = az - bz;
    return dx * dx + dz * dz;
  };
  // Segment p→q crosses segment a→b? returns t along p→q or -1.
  U.segCross = (px, pz, qx, qz, ax, az, bx, bz) => {
    const rx = qx - px, rz = qz - pz, sx = bx - ax, sz = bz - az;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) return -1;
    const t = ((ax - px) * sz - (az - pz) * sx) / den;
    const u = ((ax - px) * rz - (az - pz) * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
  };

  // Oriented rectangle SAT on the ground plane. Returns null or {nx, nz, depth, px, pz}
  // where n points from B toward A and (px, pz) is A's deepest corner (contact point).
  const _ca = [0, 0, 0, 0, 0, 0, 0, 0], _cb = [0, 0, 0, 0, 0, 0, 0, 0];
  function corners(r, out) {
    const c = Math.cos(r.ang), s = Math.sin(r.ang);
    // forward axis (sin, cos) — matches yaw = atan2(fx, fz)
    const fx = s * r.hl, fz = c * r.hl, lx = c * r.hw, lz = -s * r.hw;
    out[0] = r.x + fx + lx; out[1] = r.z + fz + lz;
    out[2] = r.x + fx - lx; out[3] = r.z + fz - lz;
    out[4] = r.x - fx - lx; out[5] = r.z - fz - lz;
    out[6] = r.x - fx + lx; out[7] = r.z - fz + lz;
    return out;
  }
  U.rectCorners = corners;
  U.obbOverlap = (A, B) => {
    corners(A, _ca);
    corners(B, _cb);
    const axes = [Math.sin(A.ang), Math.cos(A.ang), Math.cos(A.ang), -Math.sin(A.ang), Math.sin(B.ang), Math.cos(B.ang), Math.cos(B.ang), -Math.sin(B.ang)];
    let best = Infinity, bnx = 0, bnz = 0;
    for (let i = 0; i < 8; i += 2) {
      const ax = axes[i], az = axes[i + 1];
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (let k = 0; k < 8; k += 2) {
        const pa = _ca[k] * ax + _ca[k + 1] * az;
        const pb = _cb[k] * ax + _cb[k + 1] * az;
        if (pa < amin) amin = pa; if (pa > amax) amax = pa;
        if (pb < bmin) bmin = pb; if (pb > bmax) bmax = pb;
      }
      const o = Math.min(amax, bmax) - Math.max(amin, bmin);
      if (o <= 0) return null;
      if (o < best) {
        best = o;
        const ca = (amin + amax) * 0.5, cb = (bmin + bmax) * 0.5;
        const sg = ca >= cb ? 1 : -1;
        bnx = ax * sg; bnz = az * sg;
      }
    }
    // contact: corner of A deepest along -n, else corner of B deepest along +n
    let px = A.x, pz = A.z, dmin = Infinity;
    for (let k = 0; k < 8; k += 2) {
      const d = _ca[k] * bnx + _ca[k + 1] * bnz;
      if (d < dmin) { dmin = d; px = _ca[k]; pz = _ca[k + 1]; }
    }
    // if that corner isn't inside B, use B's corner inside A instead
    let bestB = -Infinity, bpx = px, bpz = pz;
    for (let k = 0; k < 8; k += 2) {
      const d = _cb[k] * bnx + _cb[k + 1] * bnz;
      if (d > bestB) { bestB = d; bpx = _cb[k]; bpz = _cb[k + 1]; }
    }
    if (!U.pointInRect(px, pz, B)) { px = bpx; pz = bpz; }
    return { nx: bnx, nz: bnz, depth: best, px, pz };
  };
  U.pointInRect = (x, z, r) => {
    const dx = x - r.x, dz = z - r.z;
    const s = Math.sin(r.ang), c = Math.cos(r.ang);
    const f = dx * s + dz * c, l = dx * c - dz * s;
    return Math.abs(f) <= r.hl + 1e-6 && Math.abs(l) <= r.hw + 1e-6;
  };
  // Circle vs oriented rect: returns null or {nx, nz, depth, px, pz} (n from circle toward rect)
  U.circleRect = (cx, cz, cr, R) => {
    const dx = cx - R.x, dz = cz - R.z;
    const s = Math.sin(R.ang), c = Math.cos(R.ang);
    const f = dx * s + dz * c, l = dx * c - dz * s;
    const qf = U.clamp(f, -R.hl, R.hl), ql = U.clamp(l, -R.hw, R.hw);
    const ef = f - qf, el = l - ql;
    const d2 = ef * ef + el * el;
    if (d2 > cr * cr) return null;
    let nf, nl, depth;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      nf = -ef / d; nl = -el / d; depth = cr - d;
    } else {
      const pf = R.hl - Math.abs(f), pl = R.hw - Math.abs(l);
      if (pf < pl) { nf = -Math.sign(f) || 1; nl = 0; depth = pf + cr; } else { nf = 0; nl = -Math.sign(l) || 1; depth = pl + cr; }
    }
    // closest point on rect in world, and normal back to world (pointing rect←circle)
    const px = R.x + qf * s + ql * c, pz = R.z + qf * c - ql * s;
    return { nx: nf * s + nl * c, nz: nf * c - nl * s, depth, px, pz };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
