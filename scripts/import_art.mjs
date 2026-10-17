// Refreshes the Pixelbolt pixel art in assets/pixel/ and the vendored Pixelbolt modules in assets/pixelbolt/.
// Usage: node scripts/import_art.mjs <profile-art folder> [Pixelbolt checkout]
// The profile-art folder holds one finished piece per subfolder (hero/, anode/, inkbolt/, cutbolt/, pixelbolt-card/,
// nestbolt/), each built by its own build.sh. Nothing here draws pixels: Pixelbolt renders every sheet, and this
// script cuts the hero's recipes into two crops and the layers a click can re-simulate (mostly still groups become a
// still and the small box that moves), verifies every cut against the approved art, then copies files.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [artDir, pixelboltDir = path.join(artDir ?? '', 'Pixelbolt')] = process.argv.slice(2);
if (!artDir) { console.error('Usage: node scripts/import_art.mjs <profile-art folder> [Pixelbolt checkout]'); process.exit(1); }
const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

// ---- the hero: two crops of the night workbench, each a still background plus looping layers cut from the piece's
// recipes. "wide" is the desktop hero from x 182 (the window, the coil, the flask and its steam, the monitor); "narrow"
// is the phone composition from y 50 (its quiet top wall dropped). Each is verified against the approved full stack.
const hero = path.join(artDir, 'hero');
const heroOut = path.join(site, 'assets', 'pixel', 'hero');
rmSync(heroOut, { recursive: true, force: true });
const recipe = name => resolved(path.join(hero, 'recipes', `${name}.json`));
const layerOf = (frame, name) => frame.layers.find(layer => layer.name === name);
const stillOf = name => readJSON(path.join(hero, 'out', `${name}.wrap.json`)).layers.find(layer => layer.still !== undefined).still;

// Stacks an RGBA layer onto a W x H image at (x0, y0), clipping at the edges. Art pixels are opaque or transparent.
function over(target, W, H, layer, lw, lh, x0, y0) {
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const s = (y * lw + x) * 4, tx = x + x0, ty = y + y0;
    if (!layer[s + 3] || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    if (layer[s + 3] !== 255) throw new Error('art pixels must be opaque or transparent');
    target.set(layer.subarray(s, s + 4), (ty * W + tx) * 4);
  }
}
const sameBytes = (a, b) => a.length === b.length && a.every((v, k) => v === b[k]);
// Only some layers of a recipe, rendered by Pixelbolt at the recipe's own size.
const renderLayers = (rec, names) => renderProject({ ...rec, frames: rec.frames.map(frame => ({ name: frame.name, duration: frame.duration, layers: frame.layers.filter(layer => names.includes(layer.name)) })) });
// A mostly still group: frame 0 with the box that ever changes cleared, plus that box from every frame as one strip.
function splitMoving(frames, W, H) {
  let [left, top, right, bottom] = [W, H, -1, -1];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    if (frames.some(data => data[k] !== frames[0][k] || data[k + 1] !== frames[0][k + 1] || data[k + 2] !== frames[0][k + 2] || data[k + 3] !== frames[0][k + 3])) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) [left, top, right, bottom] = [0, 0, 0, 0];
  const box = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  const still = Uint8ClampedArray.from(frames[0]);
  for (let y = box.y; y < box.y + box.height; y++) still.fill(0, (y * W + box.x) * 4, (y * W + box.x + box.width) * 4);
  const strip = new Uint8ClampedArray(box.width * box.height * frames.length * 4);
  frames.forEach((data, i) => {
    for (let y = 0; y < box.height; y++) {
      const from = ((box.y + y) * W + box.x) * 4;
      strip.set(data.subarray(from, from + box.width * 4), (i * box.height + y) * box.width * 4);
    }
  });
  return { still, strip, box };
}

const [leftFx, rightFx, mobileFx] = await Promise.all(['hero-left-fx', 'hero-right-fx', 'hero-mobile-fx'].map(recipe));
const COMPOSITIONS = {
  wide: {
    wrap: 'hero', crop: [182, 0], width: 234, height: 162,
    background: [['hero-left-bg', 0, 0], ['hero-right-bg', 208, 0]],
    effects: [[leftFx, 184, 16], [rightFx, 208, 0]],
    groups: [
      { name: 'under', parts: [[leftFx, ['clouds', 'front'], 184, 16], [rightFx, ['sky', 'clouds'], 208, 0]] },
      { name: 'steam', fluid: [rightFx, 208, 0], source: 'steam', compiled: 'steam' },
      { name: 'liquid', fluid: [rightFx, 208, 0], source: 'flask', compiled: 'flask' },
      { name: 'top', parts: [[rightFx, ['drip', 'front'], 208, 0]] }
    ]
  },
  narrow: {
    wrap: 'hero-mobile', crop: [0, 50], width: 156, height: 130,
    background: [['hero-mobile-bg', 0, 0]],
    effects: [[mobileFx, 0, 58]],
    groups: [
      { name: 'steam', fluid: [mobileFx, 0, 58], source: 'phone-steam', compiled: 'phone-steam' },
      { name: 'liquid', fluid: [mobileFx, 0, 58], source: 'flask', compiled: 'flask' },
      { name: 'top', parts: [[mobileFx, ['drip', 'front'], 0, 58]] }
    ]
  }
};
for (const [variant, spec] of Object.entries(COMPOSITIONS)) {
  const out = path.join(heroOut, variant), { width: W, height: H } = spec, [cx, cy] = spec.crop;
  const still = stillOf(spec.wrap), effects0 = spec.effects.at(-1)[0];
  const count = effects0.frames.length, duration = effects0.frames[0].duration;
  // The background: the still halves stacked as the wrapper stacks them, then cropped.
  const bg = new Uint8ClampedArray(W * H * 4);
  for (const [name, x, y] of spec.background) {
    const rec = await recipe(name);
    over(bg, W, H, renderProject(rec).frames[0].data, rec.width, rec.height, x - cx, y - cy);
  }
  write(path.join(out, 'bg.png'), encodePNG(bg, W, H));
  const layers = {}, order = [], drawn = [], fluids = {};
  const render = { palette: effects0.palette, ramps: effects0.ramps };
  for (const group of spec.groups) {
    order.push(group.name);
    if (group.fluid) {
      // A re-simulable layer: the compiled fluid frame plus the recipe's own ops on top, at the fluid's canvas size.
      const [rec, x0, y0] = group.fluid, first = layerOf(rec.frames[0], group.name);
      const source = await resolved(path.join(hero, 'src', 'fluids', `${group.source}.fluid.json`));
      const compiled = readJSON(path.join(hero, 'build', `${group.compiled}.json`)).frames;
      const extras = first.ops.slice((compiled[0].ops ?? []).length);
      rec.frames.forEach((frame, i) => {
        if (JSON.stringify(layerOf(frame, group.name).ops) !== JSON.stringify([...(compiled[i].ops ?? []), ...extras])) throw new Error(`${variant} ${group.name} ${i}: not the compiled frame plus the same ops`);
      });
      const project = renderProject({
        version: 1, name: group.name, width: source.width, height: source.height, palette: rec.palette, ramps: rec.ramps,
        sheet: { columns: 12 }, frames: rec.frames.map(frame => ({ name: frame.name, duration: frame.duration, ops: layerOf(frame, group.name).ops })),
        animations: { loop: { frames: rec.frames.map(frame => frame.name) } }
      });
      const atlas = buildAtlas(project);
      write(path.join(out, `${group.name}.png`), encodePNG(atlas.data, atlas.width, atlas.height));
      write(path.join(out, `${group.name}.atlas.json`), json(atlas.metadata));
      write(path.join(out, `${group.source}.fluid.json`), json(source));
      const at = [first.x + x0 - cx, first.y + y0 - cy];
      layers[group.name] = { x: at[0], y: at[1], width: project.width, height: project.height };
      drawn.push(i => [project.frames[i].data, project.width, project.height, ...at]);
      const effect = Object.values(source.effects)[0];
      // Steam: the vent, the art's two biggest billows (a visitor's heat burst re-times them) and the box the plume
      // fills in at least half the frames (a visitor's swirl stays inside it). Liquid: the flask's bulb.
      const plume = (() => {
        const counts = new Uint16Array(project.width * project.height);
        for (const frame of project.frames) for (let k = 0; k < counts.length; k++) if (frame.data[k * 4 + 3]) counts[k]++;
        let [x0, y0, x1, y1] = [project.width, project.height, -1, -1];
        counts.forEach((n, k) => { if (n * 2 < project.frames.length) return; const x = k % project.width, y = Math.floor(k / project.width); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
        return [x0, y0, x1, y1];
      })();
      fluids[group.name] = { source: `${group.source}.fluid.json`, effect: Object.keys(source.effects)[0], ...(group.name === 'steam' ? {
        vent: effect.emitters.find(e => e.name === 'breath').at, plume,
        billows: effect.emitters.filter(e => e.name.startsWith('billow')).sort((a, b) => b.radius * b.density - a.radius * a.density).slice(0, 2)
      } : { bulb: { at: effect.fill[0].at, radius: effect.fill[0].radius } }) };
      if (group.name === 'steam') render.steamExtras = extras;
    } else {
      // A mostly still group, stacked in recipe order into the composition and split into a still and a moving box.
      const frames = Array.from({ length: count }, () => new Uint8ClampedArray(W * H * 4));
      for (const [rec, names, x0, y0] of group.parts) {
        const project = renderLayers(rec, names);
        project.frames.forEach((frame, i) => over(frames[i], W, H, frame.data, project.width, project.height, x0 - cx, y0 - cy));
      }
      const { still: groupStill, strip, box } = splitMoving(frames, W, H);
      write(path.join(out, `${group.name}-still.png`), encodePNG(groupStill, W, H));
      write(path.join(out, `${group.name}-moving.png`), encodePNG(strip, box.width, box.height * count));
      layers[group.name] = { x: 0, y: 0, width: W, height: H, moving: box };
      drawn.push(() => [groupStill, W, H, 0, 0], i => [strip.subarray(i * box.width * box.height * 4, (i + 1) * box.width * box.height * 4), box.width, box.height, box.x, box.y]);
    }
  }
  // The cut must be invisible: our layers stacked equal the background plus the approved effects recipes, rendered
  // whole and cropped, frame by frame.
  const fullEffects = spec.effects.map(([rec, x, y]) => [renderProject(rec), x, y]);
  let stillImage = null;
  for (let i = 0; i < count; i++) {
    const mine = Uint8ClampedArray.from(bg), theirs = Uint8ClampedArray.from(bg);
    for (const draw of drawn) over(mine, W, H, ...draw(i));
    for (const [project, x, y] of fullEffects) over(theirs, W, H, project.frames[i].data, project.width, project.height, x - cx, y - cy);
    if (!sameBytes(mine, theirs)) throw new Error(`${variant}: the cut layers differ from the approved hero at frame ${i}`);
    if (i === still) stillImage = mine;
  }
  write(path.join(out, 'still.png'), encodePNG(stillImage, W, H));
  write(path.join(out, 'hero.json'), json({ width: W, height: H, frames: count, duration, still, order, layers, ...fluids, render }));
  console.log(`hero ${variant}: ${W}x${H}, ${count} frames verified against the approved hero; still frame ${still}`);
}

// ---- the footer: the strip under the same bench (416x42), its two still halves stacked plus one looping sheet
{
  const out = path.join(site, 'assets', 'pixel', 'footer');
  rmSync(out, { recursive: true, force: true });
  const wrap = readJSON(path.join(hero, 'out', 'footer.wrap.json'));
  const bg = new Uint8ClampedArray(wrap.width * wrap.height * 4);
  for (const layer of wrap.layers.filter(l => l.image)) {
    const image = decodePNG(readFileSync(path.join(hero, 'out', layer.image)));
    over(bg, wrap.width, wrap.height, image.data, image.width, image.height, layer.x, layer.y);
  }
  write(path.join(out, 'bg.png'), encodePNG(bg, wrap.width, wrap.height));
  const fx = wrap.layers.find(l => l.sheet), name = path.basename(fx.sheet, '.png');
  copyFileSync(path.join(hero, 'out', fx.sheet), path.join(out, `${name}.png`));
  copyFileSync(path.join(hero, 'out', fx.atlas), path.join(out, `${name}.atlas.json`));
  copyFileSync(path.join(hero, 'out', 'footer-still-1x.png'), path.join(out, 'still.png'));
  // The still must be the background plus the sheet's still frame.
  const atlas = readJSON(path.join(out, `${name}.atlas.json`)), sheet = decodePNG(readFileSync(path.join(out, `${name}.png`)));
  const entry = atlas.frames[atlas.animations[fx.animation].frames[fx.still]].frame;
  const frame = new Uint8ClampedArray(entry.w * entry.h * 4);
  for (let y = 0; y < entry.h; y++) frame.set(sheet.data.subarray(((entry.y + y) * sheet.width + entry.x) * 4, ((entry.y + y) * sheet.width + entry.x + entry.w) * 4), y * entry.w * 4);
  const composite = Uint8ClampedArray.from(bg);
  over(composite, wrap.width, wrap.height, frame, entry.w, entry.h, fx.x, fx.y);
  if (!sameBytes(composite, decodePNG(readFileSync(path.join(out, 'still.png'))).data)) throw new Error('footer: the still is not the background plus its still frame');
  write(path.join(out, 'footer.json'), json({ width: wrap.width, height: wrap.height, sheet: `${name}.atlas.json`, animation: fx.animation, x: fx.x, y: fx.y, still: fx.still }));
  console.log(`footer: ${wrap.width}x${wrap.height}, still frame ${fx.still}`);
}

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
