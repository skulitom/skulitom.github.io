/* The portfolio's pixel art: a live fluid hero and five tool cards, all made with Pixelbolt.
 * Sheets are drawn with Pixelbolt's own canvas player at whole device pixels per art pixel. A click on the hero's
 * flask or steam re-runs that fluid's source with one extra emitter in a worker (Pixelbolt's compiler and renderer),
 * then dissolves the new loop in through a Bayer mask, so every pixel stays a palette colour. Nothing here runs
 * until the page has painted its static stills, and nothing animates offscreen, in background tabs, or with motion off.
 * Frames are 70 ms, so each player paints only when its frame changes: at most about 14 times a second.
 */
import { loadSpriteSheet, drawFrame, frameAt } from '../pixelbolt/src/runtime.js';

const VERSION = 3;                    // bump with the art so caches never pair new data with old
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const players = new Set();
let motion = () => true;
let frameRequest = 0;

function schedule() {
  if (frameRequest) return;
  for (const player of players) if (player.running()) { frameRequest = requestAnimationFrame(tick); return; }
}
function tick(now) {
  frameRequest = 0;
  for (const player of players) if (player.running()) player.advance(now);
  schedule();
}

function makeCanvas(width, height, readable = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return [canvas, canvas.getContext('2d', readable ? { willReadFrequently: true } : undefined)];
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}
const versioned = url => { const u = new URL(url, document.baseURI); u.searchParams.set('v', VERSION); return u.href; };
const whenVisible = (element, callback, rootMargin = '0px') => {
  if (!('IntersectionObserver' in window)) { callback(true); return; }
  new IntersectionObserver(entries => callback(entries.at(-1).isIntersecting), { rootMargin }).observe(element);
};
const ratio = () => window.devicePixelRatio || 1;

// One frame of any drawable layer, read back as RGBA through a scratch canvas.
const [scratch, scratchContext] = makeCanvas(1, 1, true);
function readFrame(draw, width, height) {
  scratch.width = width; scratch.height = height;
  draw(scratchContext);
  return scratchContext.getImageData(0, 0, width, height);
}
// An ordered dissolve between two frames: `level` of the pixels (by the 4x4 Bayer threshold) come from `to`.
function dissolve(from, to, level) {
  const out = new ImageData(from.width, from.height);
  const a = new Uint32Array(from.data.buffer), b = new Uint32Array(to.data.buffer), o = new Uint32Array(out.data.buffer);
  for (let y = 0, i = 0; y < from.height; y++) {
    for (let x = 0; x < from.width; x++, i++) o[i] = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 < level ? b[i] : a[i];
  }
  return out;
}

/* ---------------------------------------------------------------- the hero */

// Two crops of the same workbench: "wide" (the desktop hero from the window to the monitor, 234 x 162) where its
// column has room for 2x, "narrow" (the phone composition without its top wall, 156 x 130) elsewhere. The same query
// picks the <picture> still in index.html and the stage's shape in styles.css.
const WIDE = '(min-width: 1200px), (min-width: 540px) and (max-width: 820px)';

// The extra emitters a click adds. `start` is the frame of the live loop the visitor's event begins on.
// - heat (Add heat, or a click at the neck): the art's own biggest billow again, from the vent
// - swirl (a click on the plume): a vortex at that point that rolls the steam into a curl, sized to the crop
// - stir (Stir the flask, or a click on it): a vortex in the liquid with a rush of bubbles
const EMITTERS = {
  heat: (at, start, steam) => steam.billows.slice(0, 1).map(billow => ({ ...billow, name: 'visitor-heat', at,
    start, end: start + ((billow.end ?? (billow.start ?? 0) + 3) - (billow.start ?? 0)) })),
  swirl: (at, start, steam, spin) => [{ name: 'visitor-swirl', at, radius: Math.max(6, steam.billows[0].radius * 2.2),
    rate: 1, density: 0, start, end: start + 10, vortex: 2.2 * spin, velocity: [0, -0.4] }],
  stir: (at, start, liquid, spin) => [
    { name: 'stir', at, radius: 12, rate: 1, density: 0, start, end: start + 10, vortex: 2.2 * spin },
    { name: 'stir-bubbles', at: [at[0], at[1] + 2], area: [14, 4], rate: 1, density: 0, start: start + 1, end: start + 11,
      sparks: { count: 1.2, life: [14, 24], colors: ['n', 'm'], size: 1, angle: 270, speed: 0.8, gravity: [0, -0.1],
        drag: 0.05, follow: 0.5, pop: true } }
  ]
};
// A live compile skips most of the warm-up the published art used (its loop is already settled after one cycle).
// The steam also uses fewer pressure iterations and a 48-frame loop (the second half of the art's billows: the big
// surge and two calmer ones, played twice per scene loop), so a click stays under a second even on the desktop
// crop's larger canvas. With the published settings, the same sources reproduce the approved loops exactly.
const SETTINGS = { steam: { warmup: 1, iterations: 12, frames: 48, offset: 48 }, liquid: { warmup: 1 } };
const LONGEST = { steam: 10, liquid: 12 };    // frames the visitor's emitters span (windows can't wrap the loop)
const SHOW = { heat: 12, swirl: 10, stir: 19 };   // frames after the start that make the best still
const STILL_STARTS = { steam: [6, 18, 30], liquid: [6, 22, 38, 66] };   // motion off: a different moment each press
const DISSOLVE = 4;

async function mountHero(figure) {
  const stage = figure.querySelector('.hero-stage');
  const status = figure.querySelector('.hero-status');
  const buttons = { liquid: figure.querySelector('.stir-flask'), steam: figure.querySelector('.add-heat') };
  const wide = window.matchMedia(WIDE);
  const crops = new Map();
  const crop = name => {
    if (!crops.has(name)) {
      crops.set(name, fetch(versioned(new URL(`hero/${name}/hero.json`, import.meta.url))).then(response => {
        if (!response.ok) throw new Error(`hero.json: HTTP ${response.status}`);
        return response.json();
      }).catch(error => { crops.delete(name); throw error; }));
    }
    return crops.get(name);
  };
  let variant = wide.matches ? 'wide' : 'narrow';
  let hero = await crop(variant);
  let art = null, artContext = null, canvas = null, context = null, layers = null, loading = null;
  let worker = null, pending = null, fade = null;
  let time = hero.still * hero.duration, last = 0, visible = false, busy = false, request = 0, spin = 1, presses = 0;
  // How long a re-simulation takes here, so the visitor's event can start just after the result arrives.
  const estimate = { steam: 1100, liquid: 550 };
  const touch = window.matchMedia('(hover: none)').matches;
  status.textContent = `${touch ? 'Tap' : 'Click'} the flask or the steam to simulate it live in your browser.`;
  status.setAttribute('role', 'status');

  const file = name => versioned(new URL(`hero/${variant}/${name}`, import.meta.url));
  // Layers loop on their own length: the live steam is 48 frames inside the 96-frame scene.
  const sheetLayer = sheet => {
    const names = sheet.atlas.animations.loop.frames;
    return (target, i, x, y) => drawFrame(target, sheet, names[i % names.length], x, y, { anchor: false });
  };
  const stripLayer = ({ width, height, count, pixels }) => {
    const [strip, stripContext] = makeCanvas(width, height * count);
    stripContext.putImageData(new ImageData(pixels, width, height * count), 0, 0);
    return (target, i, x, y) => target.drawImage(strip, 0, (i % count) * height, width, height, x, y, width, height);
  };
  // A mostly still group is one still plus the small box that moves, drawn over it.
  const splitLayer = (still, moving, box) => (target, i, x, y) => {
    target.drawImage(still, x, y);
    target.drawImage(moving, 0, i * box.height, box.width, box.height, x + box.x, y + box.y, box.width, box.height);
  };

  function load() {
    const forVariant = variant;
    loading ??= (async () => {
      const entries = await Promise.all(hero.order.map(async name => {
        const spec = hero.layers[name];
        if (spec.moving) return [name, splitLayer(await loadImage(file(`${name}-still.png`)), await loadImage(file(`${name}-moving.png`)), spec.moving)];
        return [name, sheetLayer(await loadSpriteSheet(file(`${name}.atlas.json`)))];
      }));
      const bg = await loadImage(file('bg.png'));
      if (forVariant !== variant) throw new Error('the crop changed while loading');
      layers = { bg, ...Object.fromEntries(entries) };
      [art, artContext] = makeCanvas(hero.width, hero.height, true);
      [canvas, context] = makeCanvas(hero.width, hero.height);
      canvas.setAttribute('aria-hidden', 'true');
      stage.append(canvas);
      fit();
      stage.classList.add('is-ready');
    })().catch(error => { loading = null; throw error; });
    return loading;
  }

  // A resize across the breakpoint swaps the crop: everything reloads for the other composition.
  wide.addEventListener('change', async () => {
    const next = wide.matches ? 'wide' : 'narrow';
    if (next === variant) return;
    let data;
    try { data = await crop(next); } catch { return; }
    variant = next; hero = data;
    canvas?.remove();
    canvas = context = art = artContext = layers = loading = pending = fade = null;
    stage.classList.remove('is-ready');
    time = hero.still * hero.duration; last = 0;
    setBusy(false);
    worker?.postMessage({ warm: variant });
    player.sync();
  });

  function fit() {
    if (!canvas) return;
    // CSS sizes the stage in whole device pixels per art pixel; the canvas matches it one to one.
    const scale = Math.max(1, Math.round(stage.getBoundingClientRect().width * ratio() / hero.width));
    if (canvas.width !== hero.width * scale) { canvas.width = hero.width * scale; canvas.height = hero.height * scale; }
    paint();
  }

  const frame = () => Math.floor(time / hero.duration) % hero.frames;
  function compose(target, i, replace = {}) {
    target.clearRect(0, 0, hero.width, hero.height);
    target.drawImage(layers.bg, 0, 0);
    for (const name of hero.order) (replace[name] ?? layers[name])(target, i, hero.layers[name].x, hero.layers[name].y);
  }
  function paint() {
    if (!canvas || !layers) return;
    const i = frame(), { width: W, height: H } = hero;
    compose(artContext, i);
    if (fade && fade.step >= DISSOLVE) fade = null;
    if (fade) {
      const before = fade.frozen ?? readFrame(c => compose(c, i, fade.old), W, H);
      artContext.putImageData(dissolve(before, artContext.getImageData(0, 0, W, H), (fade.step + 1) / (DISSOLVE + 1)), 0, 0);
    }
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(art, 0, 0, canvas.width, canvas.height);
  }

  const player = {
    running: () => Boolean(layers) && motion() && visible && !document.hidden,
    advance(now) {
      const before = frame();
      if (last) time = (time + Math.min(now - last, 250)) % (hero.frames * hero.duration);
      last = now;
      if (frame() === before) return;
      if (fade) fade.step += 1;
      paint();
    },
    sync() {
      if (!player.running()) last = 0;
      // Pausing mid-dissolve settles on the new loop rather than freezing a dithered mix.
      if (!motion() && fade) { fade = null; paint(); }
      if (motion() && visible && !layers) load().then(schedule, failLoad);
      schedule();
    },
    fit
  };
  players.add(player);
  whenVisible(stage, isVisible => { visible = isVisible; player.sync(); });
  document.addEventListener('visibilitychange', player.sync);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(stage);
  else window.addEventListener('resize', fit, { passive: true });

  // Without the sheets the still stays; without the worker the loop keeps playing and only the caption changes.
  function failLoad() { if (!layers) stage.classList.remove('is-ready'); }
  function failSimulation(message = 'The live simulation is not available in this browser.') {
    setBusy(false);
    status.textContent = message;
  }

  // Each simulation gets a fresh worker, started ahead of time: a long-lived one grows slower with every compile.
  // A worker that fails before anyone asked for a simulation is dropped quietly; the next press tries again.
  function startWorker() {
    if (worker || !window.Worker) return worker;
    try {
      const fresh = new Worker(versioned(new URL('fluid-worker.js', import.meta.url)), { type: 'module' });
      fresh.addEventListener('message', ({ data }) => {
        if (data.ready) fresh.postMessage({ warm: variant });
        else if (pending && data.id === request) {
          fresh.terminate();
          if (worker === fresh) { worker = null; startWorker(); }
          finish(data);
        }
      });
      fresh.addEventListener('error', event => {
        event.preventDefault();
        fresh.terminate();
        if (worker !== fresh) return;
        worker = null;
        if (pending) { pending = null; failSimulation(); }
      });
      worker = fresh;
    } catch { worker = null; }
    return worker;
  }

  function setBusy(value) {
    busy = value;
    stage.setAttribute('aria-busy', String(value));
    for (const button of Object.values(buttons)) button.setAttribute('aria-disabled', String(value));
  }

  // Where a visitor's event starts in its live loop: just after the result can arrive while playing; with motion
  // off, a different moment each press.
  const period = layer => SETTINGS[layer].frames ?? hero.frames;
  function startFrame(layer) {
    const starts = STILL_STARTS[layer];
    let start = motion() ? (frame() + Math.ceil(estimate[layer] / hero.duration) + 3) % period(layer) : starts[presses % starts.length];
    if (start > period(layer) - LONGEST[layer]) start = 0;
    return start;
  }

  function simulate(layer, at, kind = layer === 'steam' ? 'heat' : 'stir') {
    if (busy) return;
    if (!startWorker()) { failSimulation(); return; }
    setBusy(true);
    status.textContent = 'Simulating in your browser…';
    const start = startFrame(layer);
    presses += 1;
    // A vortex turns away from the middle of what was clicked; a button alternates.
    const middle = layer === 'steam' ? hero.steam.vent[0] : hero.liquid.bulb.at[0];
    spin = at ? (at[0] < middle ? -1 : 1) : -spin;
    const point = at ?? (layer === 'steam' ? hero.steam.vent : [hero.liquid.bulb.at[0], hero.liquid.bulb.at[1] + 11]);
    request += 1;
    pending = { layer, kind, start, variant };
    worker.postMessage({ id: request, variant, layer, emitters: EMITTERS[kind](point, start, hero[layer], spin), settings: SETTINGS[layer] });
    load().catch(() => {});
  }

  async function finish(result) {
    const { layer, kind, start, variant: asked } = pending;
    pending = null;
    if (asked !== variant) return;
    if (result.error) { failSimulation(); return; }
    // The next event is timed from the simulation itself plus a little messaging, not from a cold first start.
    estimate[layer] = result.ms * 1.15 + 150;
    try { await load(); } catch { failLoad(); failSimulation('The new simulation could not be shown; the still stays.'); return; }
    if (asked !== variant) return;
    const old = { [layer]: layers[layer] };
    layers[layer] = stripLayer(result);
    if (motion()) {
      // The event should begin just after the dissolve. If the result came late, step back to just before its latest
      // start and dissolve from the frame on screen; otherwise dissolve from the old loop as it keeps playing.
      const behind = ((frame() - start) % period(layer) + period(layer)) % period(layer);
      if (behind > 0 && behind < period(layer) / 2) {
        fade = { frozen: artContext.getImageData(0, 0, hero.width, hero.height), step: 0 };
        time = ((frame() - behind - 2 + hero.frames) % hero.frames) * hero.duration;
      } else fade = { old, step: 0 };
    } else {
      fade = null;
      time = ((start + SHOW[kind]) % hero.frames) * hero.duration;
    }
    paint();
    setBusy(false);
    const ms = Math.round(result.ms);
    status.replaceChildren('Simulated in your browser by ', Object.assign(document.createElement('a'),
      { href: 'https://github.com/skulitom/Pixelbolt', textContent: 'Pixelbolt' }), ` in ${ms.toLocaleString('en-GB')} ms.`);
    schedule();
  }

  // The flask's bulb and the air above its neck are the two places a click means something.
  function hit(event) {
    const bounds = stage.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * hero.width, y = (event.clientY - bounds.top) / bounds.height * hero.height;
    const liquid = hero.layers.liquid, bulb = hero.liquid.bulb;
    const bx = liquid.x + bulb.at[0], by = liquid.y + bulb.at[1];
    if (Math.hypot(x - bx, y - by) <= bulb.radius + 3) {
      // Stir inside the liquid: below its surface and inside the glass.
      return { layer: 'liquid', kind: 'stir', at: [Math.round(Math.min(Math.max(x - liquid.x, 10), 34)), Math.round(Math.min(Math.max(y - liquid.y, 38), 42))] };
    }
    const steam = hero.layers.steam, { vent, plume } = hero.steam;
    const sx = x - steam.x, sy = y - steam.y;
    if (sx < 0 || sx >= steam.width || sy < 0 || sy > vent[1] + 2) return null;
    if (Math.hypot(sx - vent[0], sy - vent[1]) < 8) return { layer: 'steam', kind: 'heat', at: vent };
    const inset = 4;
    return { layer: 'steam', kind: 'swirl', at: [Math.round(Math.min(Math.max(sx, plume[0] + inset), plume[2] - inset)), Math.round(Math.min(Math.max(sy, plume[1] + inset), plume[3] - inset))] };
  }
  stage.addEventListener('click', event => {
    const target = hit(event);
    if (target) simulate(target.layer, target.at, target.kind);
  });
  stage.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') stage.classList.toggle('is-target', Boolean(hit(event)));
  }, { passive: true });
  stage.addEventListener('pointerleave', () => stage.classList.remove('is-target'));
  for (const [layer, button] of Object.entries(buttons)) {
    button.hidden = false;
    button.addEventListener('click', () => { if (button.getAttribute('aria-disabled') !== 'true') simulate(layer); });
  }
  // Load Pixelbolt's modules when the visitor shows interest, or once the hero has been on screen for a while with
  // motion on and the page is idle.
  for (const type of ['pointerenter', 'focusin', 'touchstart']) figure.addEventListener(type, () => startWorker(), { once: true, passive: true });
  if (!navigator.connection?.saveData) {
    setTimeout(() => {
      if (!motion() || !visible || document.hidden) return;
      const idle = window.requestIdleCallback ?? (callback => setTimeout(callback, 0));
      idle(() => startWorker(), { timeout: 3000 });
    }, 4000);
  }
  player.sync();
  return player;
}

/* ---------------------------------------------------------------- tool cards */

const CARD_DISSOLVE = 4;

function mountCard(link) {
  const [loopURL, loopName] = link.dataset.pixelLoop.split('#');
  const [burstURL, burstName] = link.dataset.pixelBurst.split('#');
  let main = null, burst = null, burstLoading = null, loading = null;
  let canvas = null, context = null, art = null, artContext = null;
  let visible = false, near = false, last = 0, touchCancelled = false;
  let mode = 'loop', time = 0, fade = null, shown = null;

  function load() {
    loading ??= loadSpriteSheet(versioned(loopURL)).then(sheet => {
      main = sheet;
      // Start on the frame the static still shows, so the swap to the canvas is invisible.
      const names = sheet.atlas.animations[loopName].frames.slice(0, Number(link.dataset.pixelStill) || 0);
      time = names.reduce((sum, name) => sum + sheet.atlas.frames[name].duration, 0);
      const { w, h } = sheet.atlas.frames[sheet.atlas.animations[loopName].frames[0]].sourceSize;
      [art, artContext] = makeCanvas(w, h, true);
      [canvas, context] = makeCanvas(w, h);
      canvas.setAttribute('aria-hidden', 'true');
      link.append(canvas);
      fit();
      link.classList.add('is-ready');
      player.sync();
    }).catch(() => { loading = null; link.classList.remove('is-ready'); });
    return loading;
  }
  // CSS sizes the frame to the art in whole device pixels per art pixel; the canvas matches it one to one.
  function fit() {
    if (!canvas) return;
    const scale = Math.max(1, Math.round(link.getBoundingClientRect().width * ratio() / art.width));
    if (canvas.width !== art.width * scale) { canvas.width = art.width * scale; canvas.height = art.height * scale; }
    paint(true);
  }
  const current = () => mode === 'burst'
    ? [burst, frameAt(burst.atlas, burstName, time)]
    : [main, frameAt(main.atlas, loopName, time)];
  function paint(force = false) {
    if (!canvas) return;
    const [sheet, name] = current();
    const step = fade ? Math.floor(fade.time / 70) : -1;
    if (!force && name === shown && (!fade || step === fade.shown)) return;
    shown = name;
    artContext.clearRect(0, 0, art.width, art.height);
    if (fade && step < CARD_DISSOLVE) {
      fade.shown = step;
      const after = readFrame(c => drawFrame(c, sheet, name, 0, 0, { anchor: false }), art.width, art.height);
      artContext.putImageData(dissolve(fade.from, after, (step + 1) / (CARD_DISSOLVE + 1)), 0, 0);
    } else {
      fade = null;
      drawFrame(artContext, sheet, name, 0, 0, { anchor: false });
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(art, 0, 0, canvas.width, canvas.height);
  }
  // Swap loops through a short dissolve from whatever is on screen now.
  function swap(nextMode) {
    fade = { from: artContext.getImageData(0, 0, art.width, art.height), time: 0, shown: -1 };
    mode = nextMode; time = 0; shown = null;
    paint();
  }
  async function playBurst() {
    if (!motion() || mode === 'burst' || !main) return;
    burstLoading ??= loadSpriteSheet(versioned(burstURL)).then(sheet => { burst = sheet; }, error => { burstLoading = null; throw error; });
    try { await burstLoading; } catch { return; }
    if (!motion() || mode === 'burst') return;
    swap('burst');
    schedule();
  }
  const player = {
    running: () => Boolean(main) && motion() && visible && !document.hidden,
    advance(now) {
      const dt = last ? Math.min(now - last, 250) : 0;
      last = now; time += dt;
      if (fade) fade.time += dt;
      if (mode === 'burst' && time >= burst.atlas.animations[burstName].duration) swap('loop');
      else paint();
    },
    sync() {
      if (!player.running()) last = 0;
      if (!motion() && fade) { fade = null; paint(true); }
      if (motion() && near && !loading) load();
      schedule();
    },
    fit
  };
  players.add(player);
  whenVisible(link, isNear => { near = isNear; player.sync(); }, '200px 0px');
  whenVisible(link, isVisible => { visible = isVisible; player.sync(); });
  document.addEventListener('visibilitychange', player.sync);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(link);
  // Hover and keyboard focus play the burst; on touch screens a tap does (a scroll that starts on the card does not).
  link.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') playBurst(); });
  link.addEventListener('focus', playBurst);
  link.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') touchCancelled = false; }, { passive: true });
  link.addEventListener('pointercancel', () => { touchCancelled = true; }, { passive: true });
  link.addEventListener('pointerup', event => { if (event.pointerType === 'touch' && !touchCancelled) playBurst(); }, { passive: true });
  return player;
}

/* ---------------------------------------------------------------- footer */

// The strip under the same bench: a still background and one small looping sheet, at about 2x on whole device
// pixels. Where the page is narrower than the strip, it keeps its right end (the dish and the drip).
function mountFooter(box) {
  const base = new URL('footer/', import.meta.url);
  let data = null, bg = null, sheet = null, canvas = null, context = null, art = null, artContext = null, loading = null;
  let visible = false, near = false, last = 0, time = 0, shown = null;
  function load() {
    loading ??= (async () => {
      const response = await fetch(versioned(new URL('footer.json', base)));
      if (!response.ok) throw new Error(`footer.json: HTTP ${response.status}`);
      data = await response.json();
      [bg, sheet] = await Promise.all([loadImage(versioned(new URL('bg.png', base))), loadSpriteSheet(versioned(new URL(data.sheet, base)))]);
      // Start on the still's frame, so the swap to the canvas is invisible.
      time = sheet.atlas.animations[data.animation].frames.slice(0, data.still).reduce((sum, name) => sum + sheet.atlas.frames[name].duration, 0);
      [art, artContext] = makeCanvas(data.width, data.height);
      [canvas, context] = makeCanvas(data.width, data.height);
      box.append(canvas);
      fit();
      box.classList.add('is-ready');
      player.sync();
    })().catch(() => { loading = null; box.classList.remove('is-ready'); });
    return loading;
  }
  function fit() {
    if (!canvas) return;
    const bounds = box.getBoundingClientRect(), scale = Math.max(1, Math.round(bounds.height * ratio() / data.height));
    const columns = Math.min(data.width, Math.ceil(bounds.width * ratio() / scale - 1e-6));
    if (canvas.width !== columns * scale || canvas.height !== data.height * scale) { canvas.width = columns * scale; canvas.height = data.height * scale; }
    canvas.style.width = `${columns * scale / ratio()}px`;
    paint(true);
  }
  function paint(force = false) {
    if (!canvas) return;
    const name = frameAt(sheet.atlas, data.animation, time);
    if (!force && name === shown) return;
    shown = name;
    artContext.clearRect(0, 0, data.width, data.height);
    artContext.drawImage(bg, 0, 0);
    drawFrame(artContext, sheet, name, data.x, data.y, { anchor: false });
    const columns = canvas.width * data.height / canvas.height;
    context.imageSmoothingEnabled = false;
    context.drawImage(art, data.width - columns, 0, columns, data.height, 0, 0, canvas.width, canvas.height);
  }
  const player = {
    running: () => Boolean(canvas) && motion() && visible && !document.hidden,
    advance(now) {
      time += last ? Math.min(now - last, 250) : 0;
      last = now;
      paint();
    },
    sync() {
      if (!player.running()) last = 0;
      if (motion() && near && !loading) load();
      schedule();
    },
    fit
  };
  players.add(player);
  whenVisible(box, isNear => { near = isNear; player.sync(); }, '200px 0px');
  whenVisible(box, isVisible => { visible = isVisible; player.sync(); });
  document.addEventListener('visibilitychange', player.sync);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(box);
  return player;
}

/** Mounts the hero, the cards and the footer. `isMotionEnabled` reports the visitor's motion setting; call sync() when it changes. */
export function startPixelArt({ isMotionEnabled }) {
  motion = isMotionEnabled;
  const mounted = [];
  const figure = document.querySelector('.pixel-hero');
  if (figure) mountHero(figure).then(player => mounted.push(player), () => {});
  for (const link of document.querySelectorAll('[data-pixel-loop]')) mounted.push(mountCard(link));
  const footer = document.querySelector('.footer-art');
  if (footer) mounted.push(mountFooter(footer));
  // A new device-pixel ratio (zoom, or a move to another screen) changes every whole-pixel scale.
  window.addEventListener('dprchange', () => { for (const player of mounted) player.fit(); });
  return { sync: () => { for (const player of mounted) player.sync(); schedule(); } };
}
