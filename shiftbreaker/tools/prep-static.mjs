// Converts a Sketchfab building / prop / vehicle GLB into a game asset:
//   ground at y = 0, footprint centred on the origin (or kept at the model origin), +Z = street side;
//   one "model" node (vehicles: "front" + "rear" sections split at the articulation);
//   materials merged, geometry simplified, textures resized to WebP, meshopt-compressed.
// Writes out/<id>.glb and out/<id>.json (footprint, height, collision boxes in model space).
// Usage: node prep-static.mjs <id>   (needs @gltf-transform/{core,functions,extensions}@4, meshoptimizer, sharp)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMaterialsSpecular, KHRMaterialsIOR } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplifyPrimitive, compactPrimitive, join, textureCompress, transformPrimitive, quantize, metalRough } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

const U = '/root/.claude/uploads/cd537e86-e984-516e-a089-79fd3da27a9e/';
const PROPS = {
  panel: { src: U + '5bc02f15-124-87-117_building.glb', scale: 0.85, budget: 12000, tex: 1024, colliders: 'box' },
  stalin: { src: U + '06b583f0-soviet_building_from_the_stalin_era.glb', scale: 1, budget: 10000, tex: 1024, colliders: 'box' },
  nyc: { src: U + '191aab51-new_york_styled_hi_rise_apartment_building.glb', scale: 0.0075, budget: 8000, tex: 1024, colliders: 'box' },
  // photogrammetry: the scan's plaza sits at y ≈ -0.41; the soil block under it is cut away
  mosque: { src: U + '370a8457-great_mosque_of_tirana_albania.glb', scale: 7.5, ground: -0.41, clipBelow: -0.55, budget: 45000, tex: 2048, colliders: 'grid', cell: 1.5 },
  // the canopy stands at the model origin: keep it as the anchor; +Z is the forecourt / street side
  gas: { src: U + '457a55cf-gas-station.glb', scale: 0.9, anchor: 'origin', budget: 45000, tex: 1024, colliders: 'grid', cell: 1.0 },
  // articulated trolleybus, modelled facing -Z; split into two sections at the turntable
  trolley: { src: U + '4785c335-umz_t1.glb', scale: 0.85, flip: true, anchor: 'origin', budget: 26000, tex: 512, colliders: 'none', split: { z: 1.43 } }, // split z in source coordinates (the coupling)
};

const id = process.argv[2];
const cfg = PROPS[id];
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(cfg.src);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];
const buffer = () => root.listBuffers()[0];

// ---------------------------------------------------------------- matrices (column-major)
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const trs = (tx, ty, tz, sc) => [sc, 0, 0, 0, 0, sc, 0, 0, 0, 0, sc, 0, tx, ty, tz, 1];

// ---------------------------------------------------------------- primitives baked to world space
const cloneDeep = (prim) => {
  const p = prim.clone();
  for (const sem of p.listSemantics()) p.setAttribute(sem, p.getAttribute(sem).clone());
  if (p.getIndices()) p.setIndices(p.getIndices().clone());
  for (const t of p.listTargets()) p.removeTarget(t);
  return p;
};
const triIndex = (prim) => {
  const idx = prim.getIndices();
  if (idx) return idx.getArray();
  return Uint32Array.from({ length: prim.getAttribute('POSITION').getCount() }, (_, i) => i);
};
let prims = [];
scene.traverse((node) => {
  const mesh = node.getMesh();
  if (!mesh) return;
  const W = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue;
    const p = cloneDeep(prim);
    transformPrimitive(p, W);
    prims.push(p);
  }
});
const bboxOf = (list) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], v = [0, 0, 0];
  for (const p of list) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } } }
  return { mn, mx };
};
// new primitive with only the given triangles (compacted)
const extract = (prim, tris) => {
  const idx = triIndex(prim);
  const remap = new Map(), order = [];
  const outIdx = new Uint32Array(tris.length * 3);
  let o = 0;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const vi = idx[t * 3 + k];
    let ni = remap.get(vi);
    if (ni === undefined) { ni = order.length; remap.set(vi, ni); order.push(vi); }
    outIdx[o++] = ni;
  }
  const p = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(4);
  for (const sem of prim.listSemantics()) {
    const a = prim.getAttribute(sem), size = a.getElementSize(), src = a.getArray();
    const dst = new src.constructor(order.length * size);
    for (let i = 0; i < order.length; i++) for (let k = 0; k < size; k++) dst[i * size + k] = src[order[i] * size + k];
    p.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setNormalized(a.getNormalized()).setBuffer(buffer()));
  }
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(outIdx).setBuffer(buffer()));
  return p;
};
// triangles whose centroid passes the test
const filterTris = (prim, test) => {
  const idx = triIndex(prim), pos = prim.getAttribute('POSITION'), v = [0, 0, 0], keep = [];
  for (let t = 0; t < idx.length / 3; t++) {
    let x = 0, y = 0, z = 0, ymin = Infinity;
    for (let k = 0; k < 3; k++) { pos.getElement(idx[t * 3 + k], v); x += v[0]; y += v[1]; z += v[2]; ymin = Math.min(ymin, v[1]); }
    if (test(x / 3, y / 3, z / 3, ymin)) keep.push(t);
  }
  return keep;
};

// ---------------------------------------------------------------- orient, cut, scale, anchor
if (cfg.flip) for (const p of prims) transformPrimitive(p, rotY(Math.PI));
if (cfg.clipBelow != null) {
  // drop the scanned soil: triangles lying entirely under the cut
  const out = [];
  for (const p of prims) {
    const idx = triIndex(p), pos = p.getAttribute('POSITION'), v = [0, 0, 0], keep = [];
    for (let t = 0; t < idx.length / 3; t++) {
      let ymax = -Infinity;
      for (let k = 0; k < 3; k++) { pos.getElement(idx[t * 3 + k], v); ymax = Math.max(ymax, v[1]); }
      if (ymax > cfg.clipBelow) keep.push(t);
    }
    if (keep.length) out.push(keep.length === idx.length / 3 ? p : extract(p, keep));
  }
  prims = out;
}
{
  const b = bboxOf(prims);
  const ground = cfg.ground != null ? cfg.ground : b.mn[1];
  const cx = cfg.anchor === 'origin' ? 0 : (b.mn[0] + b.mx[0]) / 2, cz = cfg.anchor === 'origin' ? 0 : (b.mn[2] + b.mx[2]) / 2;
  const M = mul(trs(0, 0, 0, cfg.scale), trs(-cx, -ground, -cz, 1));
  for (const p of prims) transformPrimitive(p, M);
  if (cfg.split) cfg.split.z = (cfg.split.z - cz) * cfg.scale * (cfg.flip ? -1 : 1);
}

// ---------------------------------------------------------------- collision boxes (before simplification)
const colliders = [];
const bb = bboxOf(prims);
if (cfg.colliders === 'box') {
  colliders.push([+bb.mn[0].toFixed(2), +bb.mn[2].toFixed(2), +bb.mx[0].toFixed(2), +bb.mx[2].toFixed(2), 0, +bb.mx[1].toFixed(2)]);
} else if (cfg.colliders === 'grid') {
  // cells touched by geometry in the car-body band (0.35–2.6 m) are solid; roofs and pavement are not
  const c = cfg.cell, x0 = bb.mn[0], z0 = bb.mn[2];
  const nx = Math.ceil((bb.mx[0] - x0) / c) + 1, nz = Math.ceil((bb.mx[2] - z0) / c) + 1;
  const solid = new Uint8Array(nx * nz), top = new Float32Array(nx * nz);
  const v0 = [0, 0, 0], v1 = [0, 0, 0], v2 = [0, 0, 0];
  for (const p of prims) {
    const idx = triIndex(p), pos = p.getAttribute('POSITION');
    for (let t = 0; t < idx.length / 3; t++) {
      pos.getElement(idx[t * 3], v0); pos.getElement(idx[t * 3 + 1], v1); pos.getElement(idx[t * 3 + 2], v2);
      const ylo = Math.min(v0[1], v1[1], v2[1]), yhi = Math.max(v0[1], v1[1], v2[1]);
      if (yhi < 0.35 || ylo > 2.6) continue;
      const L = Math.max(Math.hypot(v1[0] - v0[0], v1[2] - v0[2]), Math.hypot(v2[0] - v0[0], v2[2] - v0[2]), Math.hypot(v2[0] - v1[0], v2[2] - v1[2]), yhi - ylo);
      const n = Math.min(64, Math.ceil(L / (c * 0.5)) + 1);
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const a = i / n, b2 = j / n, w = 1 - a - b2;
        const y = v0[1] * w + v1[1] * a + v2[1] * b2;
        if (y < 0.35 || y > 2.6) continue;
        const x = v0[0] * w + v1[0] * a + v2[0] * b2, z = v0[2] * w + v1[2] * a + v2[2] * b2;
        const k = Math.floor((z - z0) / c) * nx + Math.floor((x - x0) / c);
        solid[k] = 1;
        top[k] = Math.max(top[k], yhi);
      }
    }
  }
  // greedy merge into rectangles
  const used = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!solid[k] || used[k]) continue;
    let w = 1;
    while (i + w < nx && solid[j * nx + i + w] && !used[j * nx + i + w]) w++;
    let h = 1;
    grow: while (j + h < nz) { for (let q = 0; q < w; q++) if (!solid[(j + h) * nx + i + q] || used[(j + h) * nx + i + q]) break grow; h++; }
    let ytop = 0;
    for (let jj = j; jj < j + h; jj++) for (let ii = i; ii < i + w; ii++) { used[jj * nx + ii] = 1; ytop = Math.max(ytop, top[jj * nx + ii]); }
    colliders.push([+(x0 + i * c).toFixed(2), +(z0 + j * c).toFixed(2), +(x0 + (i + w) * c).toFixed(2), +(z0 + (j + h) * c).toFixed(2), 0, +Math.max(2.6, ytop).toFixed(2)]);
  }
}

// ---------------------------------------------------------------- scene graph: one node, or two vehicle sections
for (const n of scene.listChildren()) scene.removeChild(n);
for (const n of root.listNodes()) n.dispose();
const addNode = (name, list, offset) => {
  const mesh = doc.createMesh(name);
  for (const p of list) { if (offset) transformPrimitive(p, trs(-offset[0], -offset[1], -offset[2], 1)); mesh.addPrimitive(p); }
  const node = doc.createNode(name).setMesh(mesh);
  if (offset) node.setTranslation(offset);
  scene.addChild(node);
};
if (cfg.split) {
  // the rear section pivots on the joint: both nodes have their origin there
  const zj = cfg.split.z, front = [], rear = [];
  for (const p of prims) {
    const f = filterTris(p, (x, y, z) => z >= zj), r = filterTris(p, (x, y, z) => z < zj);
    if (f.length) front.push(extract(p, f));
    if (r.length) rear.push(extract(p, r));
  }
  addNode('front', front, [0, 0, zj]);
  addNode('rear', rear, [0, 0, zj]);
} else addNode('model', prims);

// ---------------------------------------------------------------- materials
await doc.transform(metalRough());
for (const E of [KHRMaterialsSpecular, KHRMaterialsIOR]) doc.createExtension(E).dispose();
// untextured materials → vertex colours on a few shared materials (three r128 reads only UV set 0)
{
  const groups = new Map();
  const untextured = (m) => !(m.getBaseColorTexture() || m.getNormalTexture() || m.getMetallicRoughnessTexture() || m.getEmissiveTexture() || m.getOcclusionTexture());
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial();
    if (!m || !untextured(m)) continue;
    const e = m.getEmissiveFactor();
    if (e[0] + e[1] + e[2] > 0.01) continue;
    const c = m.getBaseColorFactor();
    const blend = m.getAlphaMode() === 'BLEND';
    const rq = Math.round(m.getRoughnessFactor() * 4) / 4, mq = Math.round(m.getMetallicFactor() * 2) / 2, aq = blend ? Math.round(c[3] * 4) / 4 : 1;
    const key = [m.getAlphaMode(), m.getDoubleSided(), rq, mq, aq].join('|');
    let g = groups.get(key);
    if (!g) groups.set(key, (g = doc.createMaterial('merged_' + groups.size).setAlphaMode(m.getAlphaMode()).setDoubleSided(m.getDoubleSided()).setRoughnessFactor(rq).setMetallicFactor(mq).setBaseColorFactor([1, 1, 1, aq])));
    const n = prim.getAttribute('POSITION').getCount();
    const old = prim.getAttribute('COLOR_0');
    const col = new Float32Array(n * 3), tmp = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      let r = c[0], gg = c[1], b = c[2];
      if (old) { old.getElement(i, tmp); r *= tmp[0]; gg *= tmp[1]; b *= tmp[2]; }
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
    }
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buffer()));
    for (const sem of prim.listSemantics()) if (sem.startsWith('TEXCOORD') || sem === 'TANGENT') prim.setAttribute(sem, null);
    prim.setMaterial(g);
  }
  for (const m of root.listMaterials()) {
    for (const [get, set] of [['getNormalTexture', 'setNormalTexture'], ['getOcclusionTexture', 'setOcclusionTexture'], ['getEmissiveTexture', 'setEmissiveTexture'], ['getMetallicRoughnessTexture', 'setMetallicRoughnessTexture'], ['getBaseColorTexture', 'setBaseColorTexture']]) {
      const info = m[get + 'Info']();
      if (m[get]() && info && info.getTexCoord() !== 0) m[set](null);
    }
  }
}
await doc.transform(dedup(), join({ keepMeshes: true, keepNamed: true }), weld());

// ---------------------------------------------------------------- simplification to the budget
const primTris = (p) => (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
const meshTris = (m) => m.listPrimitives().reduce((a, p) => a + primTris(p), 0);
const count = () => root.listMeshes().reduce((s, m) => s + meshTris(m), 0);
const sloppy = (p, ratio, err) => {
  const idx = Uint32Array.from(triIndex(p));
  if (idx.length < 6) return;
  const target = Math.min(idx.length, Math.max(3, Math.floor((idx.length * ratio) / 3) * 3));
  const [out] = MeshoptSimplifier.simplifySloppy(idx, p.getAttribute('POSITION').getArray(), 3, null, target, err);
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(out)).setBuffer(buffer()));
  compactPrimitive(p);
};
for (const [kind, err] of [['s', 0.002], ['s', 0.01], ['x', 0.01]]) {
  const t = count();
  if (t <= cfg.budget * 1.05) break;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    if (kind === 's') simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: Math.min(1, cfg.budget / t), error: err, lockBorder: false });
    else sloppy(p, Math.min(1, cfg.budget / t), err);
  }
}
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) if (primTris(p) < 1) { mesh.removePrimitive(p); p.dispose(); }
const tris = count();

await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 80 }), quantize());
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

const meta = {
  id,
  tris: Math.round(tris),
  drawCalls: root.listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0),
  footprint: [+(bb.mx[0] - bb.mn[0]).toFixed(2), +(bb.mx[2] - bb.mn[2]).toFixed(2)],
  bounds: [bb.mn.map((v) => +v.toFixed(2)), bb.mx.map((v) => +v.toFixed(2))],
  height: +bb.mx[1].toFixed(2),
  split: cfg.split ? +cfg.split.z.toFixed(3) : undefined,
  colliders,
  materials: root.listMaterials().map((m) => m.getName()),
};
fs.mkdirSync('out', { recursive: true });
await io.write(`out/${id}.glb`, doc);
fs.writeFileSync(`out/${id}.json`, JSON.stringify(meta));
console.log(id, (fs.statSync(`out/${id}.glb`).size / 1e6).toFixed(2) + 'MB', 'tris', meta.tris, 'calls', meta.drawCalls, 'footprint', meta.footprint.join('x'), 'h', meta.height, 'colliders', colliders.length, 'mats', meta.materials.length);
