// The uploaded Bugatti GLB was cut 4,932 bytes short, inside its last texture (the wheel normal map).
// Pad the file to its declared length first, then run this to fill the lost rows with a flat normal.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('bugatti_padded.glb');
const tex = doc.getRoot().listTextures()[15];
const { data, info } = await sharp(Buffer.from(tex.getImage()), { failOn: 'none' }).raw().toBuffer({ resolveWithObject: true });
// rows lost to the truncation decode as pure black: fill them with a flat normal (128,128,255)
let fixedRows = 0;
for (let y = 0; y < info.height; y++) {
  let black = true;
  for (let x = 0; x < info.width && black; x++) { const i = (y * info.width + x) * info.channels; if (data[i] || data[i + 1] || data[i + 2]) black = false; }
  if (!black) continue;
  fixedRows++;
  for (let x = 0; x < info.width; x++) { const i = (y * info.width + x) * info.channels; data[i] = 128; data[i + 1] = 128; data[i + 2] = 255; }
}
const png = await sharp(data, { raw: info }).png().toBuffer();
tex.setImage(new Uint8Array(png));
await io.write('bugatti_fixed.glb', doc);
console.log('fixed rows', fixedRows, 'of', info.height);
