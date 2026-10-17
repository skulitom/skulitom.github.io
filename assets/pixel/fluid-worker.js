/* Re-simulates one of the hero's fluids off the main thread with Pixelbolt's own compiler and renderer (vendored,
 * unmodified, in assets/pixelbolt/). The page sends the hero crop, the extra emitters for a click and the live
 * settings; the worker compiles that crop's fluid source with them, renders the layer exactly as the art's recipe
 * does, and returns the frames as RGBA. */
import { compileFluid } from '../pixelbolt/src/fluid.js';
import { renderProject } from '../pixelbolt/src/core.js';

const files = new Map();
const version = new URL(import.meta.url).searchParams.get('v');
function load(name) {
  if (!files.has(name)) {
    const url = new URL(`hero/${name}`, import.meta.url);
    if (version) url.searchParams.set('v', version);
    files.set(name, fetch(url).then(response => {
      if (!response.ok) throw new Error(`Could not load ${name}: HTTP ${response.status}`);
      return response.json();
    }));
  }
  return files.get(name);
}

async function simulate({ variant, layer, emitters, settings }) {
  const hero = await load(`${variant}/hero.json`);
  const spec = hero[layer];
  const source = structuredClone(await load(`${variant}/${spec.source}`));
  const effect = source.effects[spec.effect];
  const { frames = effect.frames, offset = 0, ...rest } = settings;
  if (frames < effect.frames) {
    // A shorter live loop keeps the art's steady emitters and the timed ones that start inside [offset, offset +
    // frames), moved to the start of the shorter loop.
    effect.emitters = effect.emitters
      .filter(e => e.start === undefined || (e.start >= offset && e.start < offset + frames))
      .map(e => e.start === undefined ? e : { ...e, start: e.start - offset, ...(e.end !== undefined && { end: Math.min(e.end - offset, frames) }) });
    effect.frames = frames;
  }
  effect.emitters.push(...emitters);
  Object.assign(effect, rest);
  const started = performance.now();
  const { recipe } = compileFluid(source);
  // The steam layer carries the art's own recipe ops on top of the gas (its fade and the flask's mint light).
  const extras = layer === 'steam' ? hero.render.steamExtras : [];
  const rendered = recipe.frames
    .filter(frame => frame.name.slice(0, frame.name.lastIndexOf('-')) === spec.effect)
    .map(frame => ({ name: frame.name, duration: frame.duration, ops: [...(frame.ops ?? []), ...extras] }));
  const project = renderProject({
    version: 1, name: layer, width: recipe.width, height: recipe.height, palette: hero.render.palette,
    ramps: hero.render.ramps, frames: rendered, animations: { loop: { frames: rendered.map(frame => frame.name) } }
  });
  const ms = performance.now() - started;
  const size = project.width * project.height * 4;
  const pixels = new Uint8ClampedArray(size * project.frames.length);
  project.frames.forEach((frame, i) => pixels.set(frame.data, i * size));
  return { width: project.width, height: project.height, count: project.frames.length, ms, pixels };
}

self.addEventListener('message', async ({ data }) => {
  if (data.warm) {
    // Fetch the crop's sources ahead of the first click; the modules above are already loaded.
    load(`${data.warm}/hero.json`).then(hero => Promise.all(['steam', 'liquid'].map(layer => load(`${data.warm}/${hero[layer].source}`)))).catch(() => {});
    return;
  }
  try {
    const result = await simulate(data);
    self.postMessage({ id: data.id, layer: data.layer, ...result }, [result.pixels.buffer]);
  } catch (error) {
    self.postMessage({ id: data.id, layer: data.layer, error: String(error?.message ?? error) });
  }
});
self.postMessage({ ready: true });
