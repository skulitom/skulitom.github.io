// Generate a deterministic, already-growing state and its matching still.
// Run `node scripts/generate_life.js`; Python + Pillow encode the WebP poster.
import { Life, SIZE } from '../life.js';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const life = new Life();
for (let i = 0; i < 18; i++) {
  const angle = i * 2.399963;
  const radius = .05 + .26 * Math.sqrt(i / 18);
  life.plant(.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius, 3 + i % 3);
}
life.step(850);
const seed = new ArrayBuffer(SIZE * SIZE * 4);
const view = new DataView(seed);
for (let i = 0; i < SIZE * SIZE; i++) {
  view.setUint16(i * 4, Math.round(life.u[i] * 65535), true);
  view.setUint16(i * 4 + 2, Math.round(life.v[i] * 65535), true);
}
writeFileSync(resolve(root, 'assets/life-seed.bin'), new Uint8Array(seed));
const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
life.paint(pixels);
mkdirSync(resolve(root, 'output'), { recursive: true });
const raw = resolve(root, 'output/life.rgba');
writeFileSync(raw, pixels);
const result = spawnSync('python', ['-c',
  'from PIL import Image; import sys; im=Image.frombytes("RGBA", (160,160), open(sys.argv[1],"rb").read()); im.resize((640,640), Image.Resampling.BICUBIC).save(sys.argv[2], quality=90)',
  raw, resolve(root, 'assets/artificial-life.webp')], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr);
unlinkSync(raw);
console.log('Created life seed and matching WebP poster.');
