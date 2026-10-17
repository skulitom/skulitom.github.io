/* Re-simulates one of the hero's fluids off the main thread with Pixelbolt's own compiler and renderer (vendored,
 * unmodified, in assets/pixelbolt/). The page sends the extra emitters for a click; the worker compiles the hero's
 * fluid source with them, renders the layer exactly as the art's recipe does, and returns the frames as RGBA. */
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

async function simulate({ layer, emitters, settings }) {
  const hero = await load('hero.json');
  const spec = hero[layer];
  const source = structuredClone(await load(spec.source));
  const effect = source.effects[spec.effect];
  effect.emitters.push(...emitters);
  Object.assign(effect, settings);
  const started = performance.now();
  const { recipe } = compileFluid(source);
  // The steam layer carries the art's own recipe ops on top of the gas (the quiet band and the flask's mint light).
  const extras = layer === 'steam' ? hero.render.steamExtras : [];
  const frames = recipe.frames
    .filter(frame => frame.name.slice(0, frame.name.lastIndexOf('-')) === spec.effect)
    .map(frame => ({ name: frame.name, duration: frame.duration, ops: [...(frame.ops ?? []), ...extras] }));
  const project = renderProject({
    version: 1, name: layer, width: recipe.width, height: recipe.height, palette: hero.render.palette,
    ramps: hero.render.ramps, frames, animations: { loop: { frames: frames.map(frame => frame.name) } }
  });
  const ms = performance.now() - started;
  const size = project.width * project.height * 4;
  const pixels = new Uint8ClampedArray(size * project.frames.length);
  project.frames.forEach((frame, i) => pixels.set(frame.data, i * size));
  return { width: project.width, height: project.height, count: project.frames.length, ms, pixels };
}

self.addEventListener('message', async ({ data }) => {
  if (data.warm) {
    // Fetch the sources ahead of the first click; the modules above are already loaded.
    Promise.all(['hero.json', 'steam.fluid.json', 'flask.fluid.json'].map(load)).catch(() => {});
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
