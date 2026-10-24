// Artifacts serve .json but not .glb: re-pack a GLB as glTF JSON with its binary chunk embedded
// as a base64 data URI (meshopt fallback buffers carry no data and stay as they are).
// Usage: node glb-to-json.mjs in.glb out.gltf.json
import fs from 'fs';
const [src, dst] = process.argv.slice(2);
const b = fs.readFileSync(src);
if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
const jl = b.readUInt32LE(12);
const json = JSON.parse(b.subarray(20, 20 + jl).toString());
const binOff = 20 + jl;
const bin = b.subarray(binOff + 8, binOff + 8 + b.readUInt32LE(binOff));
json.buffers[0].uri = 'data:application/octet-stream;base64,' + bin.toString('base64');
fs.writeFileSync(dst, JSON.stringify(json));
