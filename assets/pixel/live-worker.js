/* Runs the hero's steam and flask live, off the main thread (see live-scene.js). The page sends:
 *   { init: variant, warmup? }                warm up both fluids for that crop, then reply { ready, frame: 0 }
 *   { id, advance, inputs, render }           step `advance` frames (inputs[k] applies before frame k) and reply with
 *                                             the frame number, the time per frame and, if asked, both layers' pixels
 */
import { createLiveHero, LAYERS } from './live-scene.js';

const version = new URL(import.meta.url).searchParams.get('v');
async function load(name) {
  const url = new URL(`hero/${name}`, import.meta.url);
  if (version) url.searchParams.set('v', version);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${name}: HTTP ${response.status}`);
  return response.json();
}

let scene = null;
self.addEventListener('message', async ({ data }) => {
  try {
    if (data.init) {
      const hero = await load(`${data.init}/hero.json`);
      const [steam, liquid] = await Promise.all([load(`${data.init}/${hero.steam.source}`), load(`${data.init}/${hero.liquid.source}`)]);
      const started = performance.now();
      scene = createLiveHero(hero, { steam, liquid }, data.warmup ? { warmup: data.warmup } : {});
      self.postMessage({ ready: true, variant: data.init, frame: scene.frame, warmup: performance.now() - started });
      return;
    }
    if (!scene) throw new Error('not warmed up');
    const started = performance.now();
    scene.step(data.advance, data.inputs);
    const stepped = performance.now() - started;
    const reply = { id: data.id, frame: scene.frame, ms: data.advance ? stepped / data.advance : 0 };
    const transfer = [];
    if (data.render) {
      const frame = scene.render();
      for (const layer of LAYERS) { reply[layer] = frame[layer]; transfer.push(frame[layer].buffer); }
      reply.ms += performance.now() - started - stepped;
    }
    self.postMessage(reply, transfer);
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error?.message ?? error) });
  }
});
self.postMessage({ loaded: true });
