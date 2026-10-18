/* The hero's two fluids, run live a frame at a time with Pixelbolt's createLiveFluid (vendored, unmodified). Used by
 * live-worker.js; plain module code, so it also runs in Node for tests.
 *
 * Each runner warms up three cycles plus one frame, the same history the published loop compiled, so live frame n
 * shows exactly the approved loop's frame n (up to the loop's seam blend, its last few frames) and the page can switch
 * from the pre-rendered loop to the live one without a visible change. */
// fluid.js gained createLiveFluid in 671690f; the query keeps a cached older copy from being paired with this file.
import { createLiveFluid } from '../pixelbolt/src/fluid.js?v=671690f';
import { renderProject } from '../pixelbolt/src/core.js';

export const LAYERS = ['steam', 'liquid'];
const METHODS = new Set(['push', 'puff', 'boost']);

// `warmup` defaults to that exact history; a page that switches on a tap anyway may ask for less.
export function createLiveHero(hero, sources, { warmup = 3 * hero.frames + 1 } = {}) {
  const fluids = Object.fromEntries(LAYERS.map(layer => [layer, createLiveFluid(sources[layer], { effect: hero[layer].effect, warmup })]));
  let frame = 0;

  // The steam layer adds the art's own recipe ops on top of the gas (its fade, the flask's mint light, on the phone
  // crop the quiet band). They recolour pixel by pixel, so each palette key's result is rendered once, on a canvas of
  // only that key, and looked up afterwards: a frame then costs a table lookup instead of a render.
  const looks = new Map();
  function lookOf(layer, code) {
    const id = `${layer}:${code}`;
    if (!looks.has(id)) {
      const { width, height } = fluids[layer], key = String.fromCharCode(code);
      const ops = [{ op: 'grid', x: 0, y: 0, rows: Array.from({ length: height }, () => key.repeat(width)) }, ...(layer === 'steam' ? hero.render.steamExtras : [])];
      const data = renderProject({ version: 1, name: 'look', width, height, palette: hero.render.palette, ramps: hero.render.ramps, frames: [{ name: 'look', duration: 70, ops }] }).frames[0].data;
      looks.set(id, new Uint32Array(data.buffer));
    }
    return looks.get(id);
  }
  function render(layer) {
    const fluid = fluids[layer], { keys } = fluid.render(), { width } = fluid;
    const out = new Uint32Array(fluid.width * fluid.height);
    keys.forEach((row, y) => {
      for (let x = 0; x < width; x++) {
        const code = row.charCodeAt(x);
        if (code !== 46) out[y * width + x] = lookOf(layer, code)[y * width + x];
      }
    });
    return new Uint8ClampedArray(out.buffer);
  }

  // Inputs are { layer, method: 'push' | 'puff' | 'boost', args } in each fluid's own pixels. They apply at the next
  // step, in order; an unknown emitter or a bad value is skipped rather than stopping the simulation.
  function apply(inputs = []) {
    for (const { layer, method, args } of inputs) {
      if (!fluids[layer] || !METHODS.has(method)) continue;
      try { method === 'boost' ? fluids[layer].boost(...args) : fluids[layer][method](args); } catch { /* skipped */ }
    }
  }
  return {
    get frame() { return frame; },
    size: layer => ({ width: fluids[layer].width, height: fluids[layer].height }),
    // Advance `count` frames; `inputs[k]` applies before frame k. Returns the last frame's pixels for both layers.
    step(count = 1, inputs = []) {
      for (let k = 0; k < count; k++) {
        apply(inputs[k]);
        for (const layer of LAYERS) fluids[layer].step(1);
        frame += 1;
      }
    },
    render: () => Object.fromEntries(LAYERS.map(layer => [layer, render(layer)]))
  };
}
