// Refreshes the Pixelbolt pixel art in assets/pixel/ and the vendored Pixelbolt modules in assets/pixelbolt/.
// Usage: node scripts/import_art.mjs <profile-art folder> [Pixelbolt checkout]
// The profile-art folder holds one finished piece per subfolder (hero/, anode/, inkbolt/, cutbolt/, pixelbolt-card/,
// nestbolt/), each built by its own build.sh. Nothing here draws pixels: Pixelbolt renders every sheet, and this
// script only splits the phone hero's effects recipe into the layers a click can re-simulate, then copies files.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [artDir, pixelboltDir = path.join(artDir ?? '', 'Pixelbolt')] = process.argv.slice(2);
if (!artDir) { console.error('Usage: node scripts/import_art.mjs <profile-art folder> [Pixelbolt checkout]'); process.exit(1); }
const site = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const pb = await import(pathToFileURL(path.join(pixelboltDir, 'src', 'index.js')).href);
const { renderProject, buildAtlas, encodePNG, decodePNG, resolveReferences } = pb;
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, data) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data); };
const json = value => `${JSON.stringify(value)}\n`;
async function resolved(file) {
  return (await resolveReferences(readJSON(file), { baseDir: path.dirname(file) })).document;
}

// ---- vendored Pixelbolt: the fluid compiler, the renderer and the canvas player, unmodified
const VENDORED = ['fluid.js', 'core.js', 'authoring.js', 'craft.js', 'autotile.js', 'font.js', 'runtime.js'];
const vendor = path.join(site, 'assets', 'pixelbolt');
rmSync(vendor, { recursive: true, force: true });
for (const file of VENDORED) { mkdirSync(path.join(vendor, 'src'), { recursive: true }); copyFileSync(path.join(pixelboltDir, 'src', file), path.join(vendor, 'src', file)); }
copyFileSync(path.join(pixelboltDir, 'LICENSE'), path.join(vendor, 'LICENSE'));
const commit = execFileSync('git', ['-C', pixelboltDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
write(path.join(vendor, 'SOURCE.txt'), `Pixelbolt (https://github.com/skulitom/Pixelbolt), MIT licence (LICENSE).\nCommit ${commit}.\nsrc/ holds ${VENDORED.join(', ')}, copied unmodified.\n`);

// ---- the hero: the phone composition (156x180) as a still background and three looping layers
const hero = path.join(artDir, 'hero');
const out = path.join(site, 'assets', 'pixel', 'hero');
rmSync(out, { recursive: true, force: true });
const bgRecipe = await resolved(path.join(hero, 'recipes', 'hero-mobile-bg.json'));
const fxRecipe = await resolved(path.join(hero, 'recipes', 'hero-mobile-fx.json'));
const FX_Y = readJSON(path.join(hero, 'build', 'hero-mobile-layout.json')).layers.find(([name]) => name === 'hero-mobile-fx')[2];
const still = readJSON(path.join(hero, 'build', 'hero-mobile-layout.json')).still;
const compiledSteam = readJSON(path.join(hero, 'build', 'phone-steam.json')).frames;
const layerOf = (frame, name) => frame.layers.find(layer => layer.name === name);
const steam0 = layerOf(fxRecipe.frames[0], 'steam'), liquid0 = layerOf(fxRecipe.frames[0], 'liquid');
// The steam layer is the compiled gas frame plus the same recipe ops every frame (the quiet band under the name
// block and the flask's mint light); the browser re-renders it from a new compile with these ops.
const steamExtras = steam0.ops.slice((compiledSteam[0].ops ?? []).length);
fxRecipe.frames.forEach((frame, i) => {
  const ops = layerOf(frame, 'steam').ops, own = compiledSteam[i].ops ?? [];
  if (JSON.stringify(ops) !== JSON.stringify([...own, ...steamExtras])) throw new Error(`steam layer ${i} is not compiled frame + extras`);
});
const steamSource = readJSON(path.join(hero, 'src', 'fluids', 'phone-steam.fluid.json'));
const flaskSource = readJSON(path.join(hero, 'src', 'fluids', 'flask.fluid.json'));
const layerRecipe = (name, width, height, frames) => ({
  version: 1, name, width, height, palette: fxRecipe.palette, ramps: fxRecipe.ramps, sheet: { columns: 12 },
  frames, animations: { loop: { frames: frames.map(f => f.name) } }
});
const recipes = {
  steam: layerRecipe('steam', steamSource.width, steamSource.height, fxRecipe.frames.map(f => ({ name: f.name, duration: f.duration, ops: layerOf(f, 'steam').ops }))),
  liquid: layerRecipe('liquid', flaskSource.width, flaskSource.height, fxRecipe.frames.map(f => ({ name: f.name, duration: f.duration, ops: layerOf(f, 'liquid').ops }))),
  top: { ...layerRecipe('top', fxRecipe.width, fxRecipe.height, fxRecipe.frames.map(f => ({ name: f.name, duration: f.duration, layers: f.layers.filter(l => !['steam', 'liquid'].includes(l.name)) }))), sheet: { columns: 8 } }
};
const place = { steam: [steam0.x, steam0.y + FX_Y], liquid: [liquid0.x, liquid0.y + FX_Y], top: [0, FX_Y] };
const rendered = {};
for (const [name, recipe] of Object.entries(recipes)) {
  const project = renderProject(recipe), atlas = buildAtlas(project);
  rendered[name] = project;
  write(path.join(out, `${name}.png`), encodePNG(atlas.data, atlas.width, atlas.height));
  write(path.join(out, `${name}.atlas.json`), json(atlas.metadata));
}
const bg = renderProject(bgRecipe).frames[0];
write(path.join(out, 'bg.png'), encodePNG(bg.data, bg.width ?? bgRecipe.width, bg.height ?? bgRecipe.height));

// The split must be invisible: bg + steam + liquid + top equals bg + the approved effects sheet, frame by frame.
const W = bgRecipe.width, H = bgRecipe.height;
function over(target, layer, lw, lh, x0, y0) {
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const s = (y * lw + x) * 4, tx = x + x0, ty = y + y0;
    if (!layer[s + 3] || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    if (layer[s + 3] !== 255) throw new Error('art pixels must be opaque or transparent');
    target.set(layer.subarray(s, s + 4), (ty * W + tx) * 4);
  }
}
const official = renderProject(fxRecipe);
const composites = official.frames.map((frame, i) => {
  const mine = Uint8ClampedArray.from(bg.data), theirs = Uint8ClampedArray.from(bg.data);
  for (const name of ['steam', 'liquid', 'top']) over(mine, rendered[name].frames[i].data, rendered[name].width, rendered[name].height, ...place[name]);
  over(theirs, frame.data, official.width, official.height, 0, FX_Y);
  if (!mine.every((v, k) => v === theirs[k])) throw new Error(`split layers differ from the approved effects at frame ${i}`);
  return mine;
});
write(path.join(out, 'hero-still.png'), encodePNG(composites[still], W, H));

// Fluid sources with the shared palette inlined, so the browser compiles exactly what the art compiled.
const steamFluid = await resolved(path.join(hero, 'src', 'fluids', 'phone-steam.fluid.json'));
const flaskFluid = await resolved(path.join(hero, 'src', 'fluids', 'flask.fluid.json'));
write(path.join(out, 'steam.fluid.json'), json(steamFluid));
write(path.join(out, 'flask.fluid.json'), json(flaskFluid));
const steamEffect = Object.values(steamFluid.effects)[0], flaskEffect = Object.values(flaskFluid.effects)[0];
const vent = steamEffect.emitters.find(e => e.name === 'breath').at, fill = flaskEffect.fill[0];
write(path.join(out, 'hero.json'), json({
  width: W, height: H, frames: official.frames.length, duration: official.frames[0].duration, still,
  layers: Object.fromEntries(Object.entries(place).map(([name, [x, y]]) => [name, { x, y, width: rendered[name].width, height: rendered[name].height }])),
  // Where a click lands in each fluid's own canvas: the steam vent (neck mouth) and the flask's bulb.
  steam: { source: 'steam.fluid.json', effect: Object.keys(steamFluid.effects)[0], vent },
  liquid: { source: 'flask.fluid.json', effect: Object.keys(flaskFluid.effects)[0], bulb: { at: fill.at, radius: fill.radius } },
  render: { palette: fxRecipe.palette, ramps: fxRecipe.ramps, steamExtras }
}));
console.log(`hero: ${official.frames.length} frames verified against the approved effects; still frame ${still}`);

// ---- tool cards: the finished bundles' sheets and atlases, unmodified, plus each piece's 1x still
const CARDS = { anode: 'anode', inkbolt: 'inkbolt', cutbolt: 'cutbolt', pixelbolt: 'pixelbolt-card', nestbolt: 'nestbolt' };
for (const [card, piece] of Object.entries(CARDS)) {
  const dest = path.join(site, 'assets', 'pixel', 'cards', card);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const [from, name] of [[path.join(artDir, piece, 'out', piece), piece], [path.join(artDir, piece, 'burst', `${piece}-burst`), `${piece}-burst`]]) {
    copyFileSync(path.join(from, `${name}.png`), path.join(dest, `${name}.png`));
    copyFileSync(path.join(from, `${name}.atlas.json`), path.join(dest, `${name}.atlas.json`));
  }
  copyFileSync(path.join(artDir, piece, 'out', `${piece}-still-1x.png`), path.join(dest, `${piece}-still.png`));
  // The page starts each loop on its still's frame (data-pixel-still in index.html), so find that frame.
  const atlas = readJSON(path.join(dest, `${piece}.atlas.json`));
  const sheet = decodePNG(readFileSync(path.join(dest, `${piece}.png`))), stillPNG = decodePNG(readFileSync(path.join(dest, `${piece}-still.png`)));
  const html = readFileSync(path.join(site, 'index.html'), 'utf8');
  const [, stated, loopName] = html.match(new RegExp(`data-pixel-still="(\\d+)" data-pixel-loop="assets/pixel/cards/${card}/${piece}\\.atlas\\.json#([\\w-]+)"`)) ?? [];
  if (!loopName) throw new Error(`${piece}: index.html has no data-pixel-still/data-pixel-loop pair for this card`);
  const frames = atlas.animations[loopName].frames;
  const index = frames.findIndex(name => {
    const { x, y, w, h } = atlas.frames[name].frame;
    for (let row = 0; row < h; row++) for (let k = 0; k < w * 4; k++) if (sheet.data[((y + row) * sheet.width + x) * 4 + k] !== stillPNG.data[row * w * 4 + k]) return false;
    return true;
  });
  if (index < 0) throw new Error(`${piece}: the still is not a frame of its loop`);
  if (Number(stated) !== index) throw new Error(`${piece}: set data-pixel-still="${index}" in index.html (it says ${stated})`);
  console.log(`card ${card}: ${piece} loop, burst and still (frame ${index})`);
}
