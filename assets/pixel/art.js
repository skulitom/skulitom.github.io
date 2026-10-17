/* The portfolio's pixel art: a live fluid hero and five tool cards, all made with Pixelbolt.
 * Sheets are drawn with Pixelbolt's own canvas player at whole-number device-pixel scales. A click on the hero's
 * flask or steam re-runs that fluid's source with one extra emitter in a worker (Pixelbolt's compiler and renderer),
 * then dissolves the new loop in through a Bayer mask, so every pixel stays a palette colour. Nothing here runs
 * until the page has painted its static stills, and nothing animates offscreen, in background tabs, or with motion off.
 */
import { loadSpriteSheet, drawFrame, frameAt } from '../pixelbolt/src/runtime.js';

const PAINT_INTERVAL = 1000 / 30;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const players = new Set();
let motion = () => true;
let frameRequest = 0, lastPaint = 0;

function schedule() {
  if (frameRequest) return;
  for (const player of players) if (player.running()) { frameRequest = requestAnimationFrame(tick); return; }
}
function tick(now) {
  frameRequest = 0;
  if (now - lastPaint >= PAINT_INTERVAL - 2) {
    lastPaint = now;
    for (const player of players) if (player.running()) player.advance(now);
  }
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
const whenVisible = (element, callback, rootMargin = '0px') => {
  if (!('IntersectionObserver' in window)) { callback(true); return; }
  new IntersectionObserver(([entry]) => callback(entry.isIntersecting), { rootMargin }).observe(element);
};

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

// The extra emitters a click adds. Steam: a hot billow rolling out sideways, then a smaller one; the flask: a stir
// vortex in the liquid with a rush of bubbles. `start` is the loop frame the visitor's event begins on.
const EMITTERS = {
  steam: (at, start) => [
    { name: 'visitor', at, radius: 2.6, rate: 1, start, end: start + 3, density: 3.8, temperature: 0.9, falloff: 0.95,
      velocity: [0.7, -0.9], expand: 3, noise: 0.12, flicker: 0.15, vortex: 0.9 },
    { name: 'visitor-2', at: [at[0], at[1] + 1], radius: 2, rate: 1, start: start + 6, end: start + 8, density: 2.4,
      temperature: 0.9, falloff: 0.95, velocity: [-0.4, -1.1], expand: 2.2, noise: 0.1, flicker: 0.15, vortex: -0.6 }
  ],
  liquid: (at, start, spin) => [
    { name: 'stir', at, radius: 12, rate: 1, density: 0, start, end: start + 10, vortex: 2.2 * spin },
    { name: 'stir-bubbles', at: [at[0], at[1] + 2], area: [14, 4], rate: 1, density: 0, start: start + 1, end: start + 11,
      sparks: { count: 1.2, life: [14, 24], colors: ['n', 'm'], size: 1, angle: 270, speed: 0.8, gravity: [0, -0.1],
        drag: 0.05, follow: 0.5, pop: true } }
  ]
};
// A live compile skips most of the warm-up the published art used (its loop is already settled after one cycle),
// and the steam uses fewer pressure iterations. Unchanged, both stay within 2-10% of a frame's fluid pixels of the
// approved loop (the published sources at their own settings reproduce it exactly).
const SETTINGS = { steam: { warmup: 1, iterations: 16 }, liquid: { warmup: 1 } };
const LONGEST = { steam: 9, liquid: 12 };     // frames the visitor's emitters span (windows can't wrap the loop)
const SHOW = { steam: 12, liquid: 19 };       // frames after the start that make the best still
const DISSOLVE = 4;

async function mountHero(figure) {
  const stage = figure.querySelector('.hero-stage');
  const status = figure.querySelector('.hero-status');
  const buttons = { liquid: figure.querySelector('.stir-flask'), steam: figure.querySelector('.add-heat') };
  const base = new URL('hero/', import.meta.url);
  const hero = await (await fetch(new URL('hero.json', base))).json();
  const { width: W, height: H, frames: COUNT, duration: MS } = hero;
  const [art, artContext] = makeCanvas(W, H, true);
  const touch = window.matchMedia('(hover: none)').matches;
  const hint = `${touch ? 'Tap' : 'Click'} the flask or the steam to simulate it live in your browser.`;
  let canvas = null, context = null, layers = null, loading = null, worker = null, pending = null;
  let time = hero.still * MS, last = 0, visible = false, busy = false, request = 0, spin = 1;
  // How long a re-simulation takes here, so the visitor's event can start just after the result arrives.
  const estimate = { steam: 1100, liquid: 550 };
  // A dissolve into a new loop: from the old layer (still animating) or, after a jump, a frozen frame.
  let fade = null;

  status.textContent = hint;
  status.setAttribute('role', 'status');

  const sheetLayer = sheet => {
    const names = sheet.atlas.animations.loop.frames;
    return (target, i, x, y) => drawFrame(target, sheet, names[i], x, y, { anchor: false });
  };
  const stripLayer = ({ width, height, count, pixels }) => {
    const [strip, stripContext] = makeCanvas(width, height * count);
    stripContext.putImageData(new ImageData(pixels, width, height * count), 0, 0);
    return (target, i, x, y) => target.drawImage(strip, 0, i * height, width, height, x, y, width, height);
  };

  function load() {
    loading ??= (async () => {
      const [bg, steam, liquid, top] = await Promise.all([
        loadImage(new URL('bg.png', base).href),
        ...['steam', 'liquid', 'top'].map(name => loadSpriteSheet(new URL(`${name}.atlas.json`, base).href))
      ]);
      layers = { bg, steam: sheetLayer(steam), liquid: sheetLayer(liquid), top: sheetLayer(top) };
      [canvas, context] = makeCanvas(W, H);
      canvas.setAttribute('aria-hidden', 'true');
      stage.append(canvas);
      fit();
      stage.classList.add('is-ready');
    })();
    return loading;
  }

  function fit() {
    if (!canvas) return;
    // The stage is a whole multiple of the art in CSS pixels; the canvas matches it in device pixels.
    const scale = Math.max(1, Math.round(stage.clientWidth / W * (window.devicePixelRatio || 1)));
    if (canvas.width !== W * scale) { canvas.width = W * scale; canvas.height = H * scale; }
    paint();
  }

  const frame = () => Math.floor(time / MS) % COUNT;
  function compose(target, i, replace = {}) {
    target.clearRect(0, 0, W, H);
    target.drawImage(layers.bg, 0, 0);
    for (const name of ['steam', 'liquid', 'top']) (replace[name] ?? layers[name])(target, i, hero.layers[name].x, hero.layers[name].y);
  }
  function paint() {
    if (!canvas || !layers) return;
    const i = frame();
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
      if (last) time = (time + Math.min(now - last, 250)) % (COUNT * MS);
      last = now;
      if (frame() === before) return;
      if (fade) fade.step += 1;
      paint();
    },
    sync() {
      if (!player.running()) last = 0;
      if (motion() && visible && !layers) load().then(schedule, failLoad);
      schedule();
    }
  };
  players.add(player);
  whenVisible(stage, isVisible => { visible = isVisible; player.sync(); });
  document.addEventListener('visibilitychange', player.sync);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(stage);
  else window.addEventListener('resize', fit, { passive: true });

  // Without the sheets the still stays; without the worker the loop keeps playing and only the caption changes.
  function failLoad() { stage.classList.remove('is-ready'); }
  function failSimulation() {
    setBusy(false);
    status.textContent = 'The live simulation is not available in this browser.';
  }

  // Each simulation gets a fresh worker, started ahead of time: a long-lived one grows slower with every compile.
  function startWorker() {
    if (worker || !window.Worker) return worker;
    try {
      const fresh = new Worker(new URL('fluid-worker.js', import.meta.url), { type: 'module' });
      fresh.addEventListener('message', ({ data }) => {
        if (data.ready) fresh.postMessage({ warm: true });
        else if (pending && data.id === request) {
          fresh.terminate();
          if (worker === fresh) { worker = null; startWorker(); }
          finish(data);
        }
      });
      fresh.addEventListener('error', event => {
        event.preventDefault();
        fresh.terminate();
        if (worker === fresh) { worker = null; pending = null; failSimulation(); }
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

  // Where a visitor's event starts: just after the result can arrive while playing; a quiet stretch for a still.
  function startFrame(layer) {
    let start = motion() ? (frame() + Math.ceil(estimate[layer] / MS) + 3) % COUNT : 6;
    if (start > COUNT - LONGEST[layer]) start = 0;
    return start;
  }

  function simulate(layer, at) {
    if (busy) return;
    if (!startWorker()) { failSimulation(); return; }
    setBusy(true);
    status.textContent = 'Simulating in your browser…';
    const start = startFrame(layer);
    if (layer === 'liquid') spin = at ? (at[0] < hero.liquid.bulb.at[0] ? -1 : 1) : -spin;
    const point = at ?? (layer === 'steam' ? hero.steam.vent : [hero.liquid.bulb.at[0], hero.liquid.bulb.at[1] + 11]);
    request += 1;
    pending = { layer, start, sent: performance.now() };
    worker.postMessage({ id: request, layer, emitters: EMITTERS[layer](point, start, spin), settings: SETTINGS[layer] });
    load().catch(failLoad);
  }

  async function finish(result) {
    const { layer, start, sent } = pending;
    pending = null;
    if (result.error) { failSimulation(); return; }
    estimate[layer] = (performance.now() - sent) * 1.1;
    try { await load(); } catch { failLoad(); setBusy(false); return; }
    const old = { [layer]: layers[layer] };
    layers[layer] = stripLayer(result);
    if (motion()) {
      // The event should begin just after the dissolve. If the result came late, step back to just before it and
      // dissolve from the frame on screen; otherwise dissolve from the old loop as it keeps playing.
      const behind = (frame() - start + COUNT) % COUNT;
      if (behind > 0 && behind < COUNT / 2) {
        fade = { frozen: artContext.getImageData(0, 0, W, H), step: 0 };
        time = ((start - 2 + COUNT) % COUNT) * MS;
      } else fade = { old, step: 0 };
    } else {
      fade = null;
      time = ((start + SHOW[layer]) % COUNT) * MS;
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
    const x = (event.clientX - bounds.left) / bounds.width * W, y = (event.clientY - bounds.top) / bounds.height * H;
    const liquid = hero.layers.liquid, bulb = hero.liquid.bulb;
    const bx = liquid.x + bulb.at[0], by = liquid.y + bulb.at[1];
    if (Math.hypot(x - bx, y - by) <= bulb.radius + 3) {
      // Stir inside the liquid: below its surface and inside the glass.
      return { layer: 'liquid', at: [Math.round(Math.min(Math.max(x - liquid.x, 10), 34)), Math.round(Math.min(Math.max(y - liquid.y, 35), 42))] };
    }
    const steam = hero.layers.steam, vent = hero.steam.vent;
    const sx = x - steam.x, sy = y - steam.y;
    if (sx >= 0 && sx < steam.width && sy >= 10 && sy <= vent[1] + 2) {
      const near = Math.hypot(sx - vent[0], sy - vent[1]) < 7;
      return { layer: 'steam', at: near ? vent : [Math.round(Math.min(Math.max(sx, 8), steam.width - 14)), Math.round(Math.min(Math.max(sy, 18), vent[1]))] };
    }
    return null;
  }
  stage.addEventListener('click', event => {
    const target = hit(event);
    if (target) simulate(target.layer, target.at);
  });
  stage.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') stage.classList.toggle('is-target', Boolean(hit(event)));
  }, { passive: true });
  stage.addEventListener('pointerleave', () => stage.classList.remove('is-target'));
  for (const [layer, button] of Object.entries(buttons)) {
    button.hidden = false;
    button.addEventListener('click', () => { if (button.getAttribute('aria-disabled') !== 'true') simulate(layer); });
  }
  // Load Pixelbolt's modules when the visitor shows interest, or once the page is idle (with motion on).
  for (const type of ['pointerenter', 'focusin', 'touchstart']) figure.addEventListener(type, startWorker, { once: true, passive: true });
  if (motion() && !navigator.connection?.saveData) {
    const idle = window.requestIdleCallback ?? (callback => setTimeout(callback, 2500));
    idle(() => startWorker(), { timeout: 5000 });
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
  let visible = false, near = false, last = 0;
  let mode = 'loop', time = 0, fade = null, shown = null;

  function load() {
    loading ??= loadSpriteSheet(new URL(loopURL, document.baseURI).href).then(sheet => {
      main = sheet;
      // Start on the frame the static still shows, so the swap to the canvas is invisible.
      const names = sheet.atlas.animations[loopName].frames.slice(0, Number(link.dataset.pixelStill) || 0);
      time = names.reduce((sum, name) => sum + sheet.atlas.frames[name].duration, 0);
      const { w, h } = Object.values(sheet.atlas.frames)[0].sourceSize;
      [art, artContext] = makeCanvas(w, h, true);
      [canvas, context] = makeCanvas(w, h);
      canvas.setAttribute('aria-hidden', 'true');
      link.append(canvas);
      fit();
      link.classList.add('is-ready');
      player.sync();
    });
    return loading;
  }
  function fit() {
    if (!canvas) return;
    const style = getComputedStyle(link), pad = parseFloat(style.getPropertyValue('--pixel-pad')) || 0;
    const ratio = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.floor(Math.min((link.clientWidth - pad * 2) * ratio / art.width, (link.clientHeight - pad * 2) * ratio / art.height) + 1e-6));
    if (canvas.width !== art.width * scale) { canvas.width = art.width * scale; canvas.height = art.height * scale; }
    canvas.style.width = `${art.width * scale / ratio}px`;
    canvas.style.height = `${art.height * scale / ratio}px`;
    paint(true);
  }
  const current = () => mode === 'burst'
    ? [burst, frameAt(burst.atlas, burstName, time)]
    : [main, frameAt(main.atlas, loopName, time)];
  function paint(force = false) {
    if (!canvas) return;
    const [sheet, name] = current();
    const step = fade ? Math.floor(fade.time / 70) : -1;
    if (!force && name === shown && !fade) return;
    shown = name;
    artContext.clearRect(0, 0, art.width, art.height);
    if (fade && step < CARD_DISSOLVE) {
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
    fade = { from: artContext.getImageData(0, 0, art.width, art.height), time: 0 };
    mode = nextMode; time = 0; shown = null;
    paint();
  }
  async function playBurst(event) {
    if (event.type === 'pointerenter' && event.pointerType === 'touch') return;
    if (!motion() || mode === 'burst' || !main) return;
    burstLoading ??= loadSpriteSheet(new URL(burstURL, document.baseURI).href).then(sheet => { burst = sheet; });
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
      if (motion() && near && !loading) load().catch(() => link.classList.remove('is-ready'));
      schedule();
    }
  };
  players.add(player);
  whenVisible(link, isNear => { near = isNear; player.sync(); }, '200px 0px');
  whenVisible(link, isVisible => { visible = isVisible; player.sync(); });
  document.addEventListener('visibilitychange', player.sync);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(link);
  link.addEventListener('pointerenter', playBurst);
  link.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') playBurst(event); }, { passive: true });
  link.addEventListener('focus', playBurst);
  return player;
}

/** Mounts the hero and the cards. `isMotionEnabled` reports the visitor's motion setting; call sync() when it changes. */
export function startPixelArt({ isMotionEnabled }) {
  motion = isMotionEnabled;
  const mounted = [];
  const figure = document.querySelector('.pixel-hero');
  if (figure) mountHero(figure).then(player => mounted.push(player), () => {});
  for (const link of document.querySelectorAll('[data-pixel-loop]')) mounted.push(mountCard(link));
  return { sync: () => { for (const player of mounted) player.sync(); schedule(); } };
}
