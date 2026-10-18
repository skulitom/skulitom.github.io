/* The portfolio's pixel art: a live fluid hero, five tool cards and a footer strip, all made with Pixelbolt.
 * Sheets are drawn with Pixelbolt's own canvas player at whole device pixels per art pixel. The hero's steam and flask
 * run live in a worker (Pixelbolt's createLiveFluid, a frame at a time), so hovering, clicking, dragging and the two
 * buttons change the simulation on the next frame. Nothing here runs until the page has painted its static stills,
 * and nothing animates offscreen, in background tabs, or with motion off. Frames are 70 ms, so each player paints
 * only when its frame changes: at most about 14 times a second.
 */
import { loadSpriteSheet, drawFrame, frameAt } from '../pixelbolt/src/runtime.js';

const VERSION = 6;                    // bump with the art so caches never pair new data with old
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

// Interactions, in each fluid's own pixels per 70 ms frame. Pointer speeds are measured in art pixels.
const HOVER = { gain: 0.55, radius: 5 };            // the steam follows a moving cursor
const DRAG = { gain: 0.9, radius: 7, liquid: 0.8 };  // a held button stirs the steam, or sloshes the flask
const STIR_FRAMES = 17;                              // "Stir the flask": about 1.2 s
const HEAT_FRAMES = 43;                              // "Add heat": about 3 s
// "Add heat" raises these emitters' strength (unknown names are skipped, so both crops share the list).
const HEAT_BOOSTS = { liquid: [['heat', 2.5], ['boil', 2.5], ['bubbles', 3], ['big-bubbles', 3], ['surge', 2]], steam: [['breath', 2.5]] };
const START_LEAD = 3;                                // frames of slack when catching the live runners up to the loop

async function mountHero(figure) {
  const stage = figure.querySelector('.hero-stage');
  const status = figure.querySelector('.hero-status');
  const buttons = { stir: figure.querySelector('.stir-flask'), heat: figure.querySelector('.add-heat') };
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
  const cycle = () => hero.frames, MS = () => hero.duration;
  let art = null, artContext = null, canvas = null, context = null, layers = null, loading = null;
  let time = hero.still * hero.duration, last = 0, visible = false;
  const touch = window.matchMedia('(hover: none)').matches;
  // Phones and tablets keep the pre-rendered loop until the first tap on the hero or a press of a button: the runners
  // warm up in idle time after the first paint, then stay still (no frames stepped) until that first interaction.
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  // ---- the live runners (live-worker.js): warmed up after the first paint, then stepped once per 70 ms frame
  // `offset` maps the runners' frame to the loop's: 0 after a seamless switch; after a switch at once (an early tap or
  // press), the loop's other layers carry on from where they were.
  const live = { worker: null, ready: false, failed: false, on: false, still: false, frame: 0, offset: 0, rendered: -1, inFlight: false, sent: 0, request: 0, ms: 0, shownMs: 0, pending: null, wanted: null, holdUntil: null, eager: false, interacted: false, scripts: [], paintAt: 0 };
  const liveAt = () => (live.frame + live.offset) % cycle();
  const liveCanvas = {};
  const ink = (layer, pixels) => {
    const { width, height } = hero.layers[layer];
    liveCanvas[layer] ??= makeCanvas(width, height);
    const [target, targetContext] = liveCanvas[layer];
    if (target.width !== width || target.height !== height) { target.width = width; target.height = height; }
    targetContext.putImageData(new ImageData(pixels, width, height), 0, 0);
  };

  // The caption keeps one Pixelbolt link (so keyboard focus on it survives updates) between two runs of text. Press
  // results and the switch to live are also announced once through a visually hidden status region.
  const link = status.querySelector('a') ?? Object.assign(document.createElement('a'), { href: 'https://github.com/skulitom/Pixelbolt', textContent: 'Pixelbolt' });
  const head = document.createTextNode(''), tail = document.createTextNode('');
  status.replaceChildren(head, link, tail);
  const announcer = Object.assign(document.createElement('span'), { className: 'visually-hidden' });
  announcer.setAttribute('role', 'status');
  status.after(announcer);
  function caption(before, after, announce = false) {
    head.data = before; tail.data = after;
    if (announce) announcer.textContent = `${before}Pixelbolt${after}`;
  }
  const idleCaption = () => caption('Pixel art made with ', coarse && motion() ? '. Tap it to run it live.' : '.');
  idleCaption();

  const file = name => versioned(new URL(`hero/${variant}/${name}`, import.meta.url));
  const sheetLayer = sheet => {
    const names = sheet.atlas.animations.loop.frames;
    return (target, i, x, y) => drawFrame(target, sheet, names[i % names.length], x, y, { anchor: false });
  };
  // A mostly still group is one still plus the small box that moves, drawn over it.
  const splitLayer = (still, moving, box) => (target, i, x, y) => {
    target.drawImage(still, x, y);
    target.drawImage(moving, 0, (i % cycle()) * box.height, box.width, box.height, x + box.x, y + box.y, box.width, box.height);
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
      [art, artContext] = makeCanvas(hero.width, hero.height);
      [canvas, context] = makeCanvas(hero.width, hero.height);
      canvas.setAttribute('aria-hidden', 'true');
      stage.append(canvas);
      fit();
      stage.classList.add('is-ready');
    })();
    const attempt = loading;
    loading.catch(() => { if (loading === attempt) loading = null; });
    return loading;
  }

  function fit() {
    if (!canvas) return;
    // CSS sizes the stage in whole device pixels per art pixel; the canvas matches it one to one.
    const scale = Math.max(1, Math.round(stage.getBoundingClientRect().width * ratio() / hero.width));
    if (canvas.width !== hero.width * scale) { canvas.width = hero.width * scale; canvas.height = hero.height * scale; }
    paint();
  }

  // The scene's frame: the loop's clock until the live runners take over, then theirs.
  const frame = () => live.on ? liveAt() : Math.floor(time / MS()) % cycle();
  function paint() {
    if (!canvas || !layers) return;
    const i = frame();
    artContext.clearRect(0, 0, hero.width, hero.height);
    artContext.drawImage(layers.bg, 0, 0);
    for (const name of hero.order) {
      const { x, y } = hero.layers[name];
      if ((live.on || live.still) && liveCanvas[name]) artContext.drawImage(liveCanvas[name][0], x, y);
      else layers[name](artContext, i, x, y);
    }
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(art, 0, 0, canvas.width, canvas.height);
  }

  // ---- worker plumbing
  // A worker that fails (no module workers, a missing source, an engine error) is not restarted for this crop: the
  // pre-rendered loop stays, and the buttons, which need it, are hidden.
  function startLive() {
    if (live.worker || live.failed || !window.Worker) return;
    let worker;
    try { worker = new Worker(versioned(new URL('live-worker.js', import.meta.url)), { type: 'module' }); } catch { failLive(); return; }
    live.worker = worker;
    const forVariant = variant;
    worker.addEventListener('message', ({ data }) => {
      if (live.worker !== worker) return;
      // A tap switches at once (the loop jumps a little anyway), so phones need only one cycle of warm-up.
      if (data.loaded) { worker.postMessage({ init: forVariant, warmup: warmupFrames() }); return; }
      if (data.error) { failLive(); return; }
      if (data.ready) {
        live.ready = true; live.frame = data.frame;
        live.ms = data.warmup / warmupFrames();
        whenReady();
        return;
      }
      received(data);
    });
    worker.addEventListener('error', event => { event.preventDefault(); if (live.worker === worker) failLive(); });
  }
  function stopLive() {
    live.worker?.terminate();
    const wasOn = live.on;
    Object.assign(live, { worker: null, ready: false, on: false, still: false, rendered: -1, inFlight: false, pending: null, wanted: null, holdUntil: null, eager: false, scripts: [] });
    stage.classList.remove('is-live');
    if (wasOn) { time = liveAt() * MS(); paint(); }
    idleCaption();
  }
  function failLive() {
    stopLive();
    live.failed = true;
    for (const button of Object.values(buttons)) button.hidden = true;
  }
  function send(advance, inputs, render) {
    live.inFlight = true;
    live.request += 1;
    live.sent = performance.now();
    live.worker.postMessage({ id: live.request, advance, inputs, render });
  }
  // Once warm, catch the runners up to the loop on screen: on their first pass they hold the approved loop's exact
  // frames (until its seam blend, the last few frames), so the switch happens on a frame both show and nothing visibly
  // changes. Late in the loop they wait at frame 0 for it to come round instead. A press before then switches at once.
  const SEAM = 88;
  const gated = () => coarse && !live.interacted;
  // Desktop warms up the published loop's exact history (for the seamless switch); phones one cycle.
  const warmupFrames = () => coarse ? cycle() + 1 : 3 * cycle() + 1;
  function whenReady() {
    if (live.pending) { const run = live.pending; live.pending = null; run(); return; }
    if (coarse) { if (live.eager) switchNow(); return; }
    if (motion()) catchUp();
  }
  // Coarse pointers: live at once, from the frame the runners are on. Until their first step comes back (with the
  // tap in it), the loop's own fluid frames stay on screen.
  function switchNow() {
    if (live.inFlight || !live.ready || live.on || !motion()) return;
    if (live.rendered !== live.frame) for (const key of Object.keys(liveCanvas)) delete liveCanvas[key];
    goLive();
    schedule();
  }
  function catchUp() {
    if (live.inFlight || !live.ready || live.on || !motion() || gated()) return;
    const at = Math.floor(time / MS()) % cycle(), here = liveAt();
    const behind = (at - here + cycle()) % cycle();
    const lead = START_LEAD + Math.ceil(behind * Math.max(live.ms, 10) / MS());
    const target = live.frame < cycle() && here + behind + lead >= SEAM && !live.eager ? 0 : behind + lead;
    // Waiting where the runners already are: hold their rendered frame until the loop comes round to it.
    if (target === 0 && live.rendered === live.frame) { live.holdUntil = here; return; }
    live.wanted = 'switch';
    send(Math.min(target, cycle() - 1), [], true);
  }
  // Back to live after a pause or a still: straight on from a still (the page shows the runners' own frame), else
  // catch up to the loop.
  function resumeLive() {
    if (live.inFlight || !live.ready || live.on || live.holdUntil !== null || !motion() || gated()) return;
    if (live.still) goLive(); else if (coarse) switchNow(); else catchUp();
  }
  // After each reply: a press that arrived meanwhile runs now, and a resume that arrived meanwhile carries on.
  function afterReply() {
    if (live.inFlight) return;
    if (live.pending && live.ready) { const run = live.pending; live.pending = null; run(); return; }
    resumeLive();
  }
  function received(data) {
    live.inFlight = false;
    live.frame = data.frame;
    if (data.ms) { live.ms = live.ms ? live.ms * 0.8 + data.ms * 0.2 : data.ms; live.counted = (live.counted ?? 0) + 1; }
    if (data.steam) { ink('steam', data.steam); ink('liquid', data.liquid); live.rendered = data.frame; }
    const wanted = live.wanted;
    live.wanted = null;
    if (wanted === 'switch') {
      // Hold this frame until the loop on screen reaches it; if the loop already passed it, catch up again. A visitor
      // who pressed or clicked meanwhile gets the live frame at once. Paused meanwhile: wait for Resume.
      if (motion()) {
        const ahead = (liveAt() - Math.floor(time / MS()) % cycle() + cycle()) % cycle();
        if (live.eager || ahead === 0) goLive();
        else if (ahead > cycle() / 2) catchUp();
        else live.holdUntil = liveAt();
      }
    } else if (wanted === 'still') {
      time = liveAt() * MS();
      showStill(true);
    } else {
      if (wanted === 'interactive' && live.paintAt) { live.latency = performance.now() - live.paintAt; live.paintAt = 0; figure.dataset.liveLatency = Math.round(live.latency); }
      paint();
      if (live.on && motion()) updateCaption();
    }
    afterReply();
  }
  function goLive() {
    // For checks: the frame the switch happened on, and the loop's frame at that moment (equal unless a press forced it).
    figure.dataset.liveSwitch = `${live.frame}:${Math.floor(time / MS()) % cycle()}`;
    live.offset = (Math.floor(time / MS()) - live.frame % cycle() + cycle()) % cycle();
    live.on = true;
    live.still = false;
    live.holdUntil = null;
    live.eager = false;
    pointer.last = null;
    // The frame cost is measured afresh once live (catching up includes the engine's first, slower runs).
    live.ms = 0; live.counted = 0; live.shownMs = 0;
    stage.classList.add('is-live');
    paint();
    updateCaption(true);
  }
  function updateCaption(force = false) {
    // The measured cost of a frame (after 15 live frames), refreshed at most every few seconds so it stays readable.
    const counted = live.counted >= 15, ms = Math.max(1, Math.round(live.ms)), now = performance.now();
    if (!force && (!counted || (live.shownMs && (Math.abs(ms - live.shownMs) < 2 || now - live.shownAt < 4000)))) return;
    if (counted) { live.shownMs = ms; live.shownAt = now; figure.dataset.liveMs = ms; }
    caption('Running live in your browser: ', ` fluid simulation${counted ? `, ${ms} ms a frame` : ''}. ${touch ? 'Tap' : 'Hover, click or drag'} the steam and the flask.`, force);
  }

  // ---- inputs: gathered between frames, sent with the next step
  const pointer = { x: 0, y: 0, down: false, dragging: false, last: null, startX: 0, startY: 0 };
  function toArt(event) {
    const bounds = stage.getBoundingClientRect();
    return [(event.clientX - bounds.left) / bounds.width * hero.width, (event.clientY - bounds.top) / bounds.height * hero.height];
  }
  function inLayer(layer, x, y, margin = 0) {
    const L = hero.layers[layer];
    return x >= L.x - margin && y >= L.y - margin && x < L.x + L.width + margin && y < L.y + L.height + margin;
  }
  function inBulb(x, y) {
    const L = hero.layers.liquid, { at, radius } = hero.liquid.bulb;
    return Math.hypot(x - L.x - at[0], y - L.y - at[1]) <= radius + 2;
  }
  const local = (layer, x, y) => [x - hero.layers[layer].x, y - hero.layers[layer].y];
  const input = (layer, method, args) => ({ layer, method, args });
  // The pointer's motion over the last frame becomes one push along it: a hover swirls the steam, a drag stirs the
  // steam or sloshes the flask.
  function pointerInputs() {
    const out = [];
    if (!pointer.last) return out;
    const [x0, y0] = pointer.last, dx = pointer.x - x0, dy = pointer.y - y0;
    pointer.last = [pointer.x, pointer.y];
    if (Math.abs(dx) + Math.abs(dy) < 0.2) return out;
    const mid = [x0 + dx / 2, y0 + dy / 2];
    if (pointer.dragging && inBulb(...mid)) {
      const [lx, ly] = local('liquid', ...mid);
      out.push(input('liquid', 'push', { x: lx, y: ly, vx: dx * DRAG.liquid, vy: dy * DRAG.liquid, radius: DRAG.radius }));
    } else if (inLayer('steam', ...mid, 4)) {
      const { gain, radius } = pointer.dragging ? DRAG : HOVER, [lx, ly] = local('steam', ...mid);
      out.push(input('steam', 'push', { x: lx, y: ly, vx: dx * gain, vy: dy * gain, radius }));
    }
    return out;
  }
  // A click: a puff of steam where it lands, or a splash and a burst of bubbles in the flask.
  function clickInputs(x, y) {
    if (inBulb(x, y)) {
      const [lx, ly] = local('liquid', x, y);
      return [input('liquid', 'push', { x: lx, y: ly, vx: 0, vy: 3, radius: 5 }), input('liquid', 'push', { x: lx - 4, y: ly + 2, vx: -2, vy: -2.5, radius: 4 }),
        input('liquid', 'push', { x: lx + 4, y: ly + 2, vx: 2, vy: -2.5, radius: 4 }), input('liquid', 'boost', ['bubbles', 4, 10]), input('liquid', 'boost', ['big-bubbles', 4, 10])];
    }
    if (inLayer('steam', x, y)) {
      const [lx, ly] = local('steam', x, y), radius = hero.steam.billows?.[0]?.radius ?? 3;
      return [input('steam', 'puff', { x: lx, y: ly, radius, density: 2.6, temperature: 0.9 }), input('steam', 'push', { x: lx, y: ly + 1, vx: 0, vy: -1.2, radius: radius + 2 })];
    }
    return [];
  }
  // Scripted presses: one input list per frame.
  const SCRIPTS = {
    stir: k => {
      const { at } = hero.liquid.bulb, angle = k / STIR_FRAMES * Math.PI * 2.5, cx = at[0], cy = at[1] + 10;
      return [input('liquid', 'push', { x: cx + Math.cos(angle) * 7, y: cy + Math.sin(angle) * 4, vx: -Math.sin(angle) * 2.6, vy: Math.cos(angle) * 1.5, radius: 7 }),
        ...(k === 0 ? [input('liquid', 'boost', ['bubbles', 2, STIR_FRAMES])] : [])];
    },
    heat: k => {
      const out = [];
      if (k === 0) for (const layer of ['liquid', 'steam']) for (const [name, strength] of HEAT_BOOSTS[layer]) out.push(input(layer, 'boost', [name, strength, HEAT_FRAMES]));
      const { at } = hero.liquid.bulb, vent = hero.steam.vent, radius = hero.steam.billows?.[0]?.radius ?? 3;
      out.push(input('liquid', 'push', { x: at[0], y: at[1] + 15, vx: 0, vy: -1.6, radius: 7 }));
      if (k % 7 === 2) out.push(input('steam', 'puff', { x: vent[0], y: vent[1] - 1, radius, density: 2.8, temperature: 0.9 }), input('steam', 'push', { x: vent[0], y: vent[1] - 2, vx: 0, vy: -1.6, radius: radius + 1 }));
      return out;
    }
  };
  const LENGTH = { stir: STIR_FRAMES, heat: HEAT_FRAMES };

  // Live: inputs and scripts join the next step. With motion off (reduced motion, Pause motion), a press runs the whole
  // interaction at once in the worker and shows the frame it ends on.
  function act(inputsFor, length, settle) {
    live.interacted = true;
    if (!motion()) { runStill(inputsFor, length, settle); return; }
    live.scripts.push({ inputsFor, length, k: 0 });
    if (live.on) return;
    // Not live yet: switch as soon as the runners can show a frame (the loop may jump a little).
    live.eager = true;
    if (live.failed) return;
    if (!live.worker) { caption('Pixel art made with ', '. Starting the live simulation…', true); startLive(); }
    else if (live.holdUntil !== null) goLive();
    else if (live.ready) coarse ? switchNow() : resumeLive();
    else caption('Pixel art made with ', '. Starting the live simulation…', true);
  }
  function runStill(inputsFor, length, settle) {
    const run = () => {
      const inputs = Array.from({ length: length + settle }, (_, k) => k < length ? inputsFor(k) : []);
      live.wanted = 'still';
      send(length + settle, inputs, true);
      load().catch(() => {});
    };
    if (live.failed) return;
    if (!live.worker) { caption('Pixel art made with ', '. Starting the live simulation…', true); live.pending = run; startLive(); return; }
    if (!live.ready || live.inFlight) { live.pending = run; return; }
    run();
  }
  // A still from the live runners: their layers over the loop's other layers at the same frame, until the loop moves.
  function showStill(result) {
    live.on = false;
    live.still = true;
    stage.classList.remove('is-live');
    if (result) caption('Simulated in your browser by ', `, ${Math.max(1, Math.round(live.ms))} ms a frame.`, true);
    paint();
  }

  stage.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    [pointer.x, pointer.y] = toArt(event);
    if (!pointer.last) pointer.last = [pointer.x, pointer.y];
    if (pointer.down && Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 1.5) pointer.dragging = true;
    stage.classList.toggle('is-target', inLayer('steam', pointer.x, pointer.y) || inBulb(pointer.x, pointer.y));
    if (!live.on && motion()) startLive();
  }, { passive: true });
  stage.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    [pointer.x, pointer.y] = toArt(event);
    Object.assign(pointer, { down: true, dragging: false, startX: pointer.x, startY: pointer.y, last: [pointer.x, pointer.y] });
    stage.setPointerCapture?.(event.pointerId);
    stage.classList.add('is-dragging');
  });
  const release = () => { pointer.down = false; stage.classList.remove('is-dragging'); };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('pointerleave', () => { pointer.last = null; stage.classList.remove('is-target'); });
  // A click or a tap (a drag that ends is not a click).
  stage.addEventListener('click', event => {
    if (pointer.dragging) { pointer.dragging = false; return; }
    const [x, y] = toArt(event), inputs = clickInputs(x, y);
    if (!inputs.length) { if (coarse && !live.on && motion()) act(() => [], 1, 0); return; }
    live.paintAt = performance.now();
    act(() => inputs, 1, 9);
  });
  buttons.stir.hidden = buttons.heat.hidden = !window.Worker;
  buttons.stir.addEventListener('click', () => { live.paintAt = performance.now(); act(SCRIPTS.stir, STIR_FRAMES, 6); });
  buttons.heat.addEventListener('click', () => { live.paintAt = performance.now(); act(SCRIPTS.heat, HEAT_FRAMES, 0); });

  // ---- the clock
  const player = {
    running: () => Boolean(layers) && motion() && visible && !document.hidden,
    advance(now) {
      if (!live.on) {
        const before = Math.floor(time / MS());
        if (last) time = (time + Math.min(now - last, 250)) % (cycle() * MS());
        last = now;
        const at = Math.floor(time / MS());
        if (at === before) return;
        live.still = false;
        // Switch on the held frame, even if a slow frame skipped past it.
        if (live.holdUntil !== null) {
          const due = (live.holdUntil - before + cycle()) % cycle(), moved = (at - before + cycle()) % cycle();
          if (due > 0 && due <= moved) { goLive(); return; }
        }
        paint();
        return;
      }
      // Live: one step per 70 ms, with this frame's inputs; the reply paints. A slow device simply steps less often.
      last = now;
      if (live.inFlight || now - live.sent < MS() - 4) return;
      const inputs = pointerInputs();
      for (const script of live.scripts) inputs.push(...script.inputsFor(script.k++));
      live.scripts = live.scripts.filter(script => script.k < script.length);
      if (live.paintAt) live.wanted = 'interactive';
      send(1, [inputs], true);
    },
    sync() {
      if (!player.running()) { last = 0; pointer.last = null; }
      if (motion() && visible && !layers) load().then(() => player.sync(), failLoad);
      if (motion() && visible && layers && !live.worker) idleThen(startLive);
      if (motion() && live.ready && !live.on) resumeLive();
      if (!motion() && live.on) { time = liveAt() * MS(); showStill(false); }
      schedule();
    },
    fit
  };
  players.add(player);
  whenVisible(stage, isVisible => { visible = isVisible; player.sync(); });
  document.addEventListener('visibilitychange', player.sync);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(stage);
  else window.addEventListener('resize', fit, { passive: true });
  function failLoad() { if (!layers) stage.classList.remove('is-ready'); }

  // A resize across the breakpoint swaps the crop: the loop and the live runners restart for the other composition.
  wide.addEventListener('change', async () => {
    const next = wide.matches ? 'wide' : 'narrow';
    if (next === variant) return;
    let data;
    try { data = await crop(next); } catch { return; }
    if ((wide.matches ? 'wide' : 'narrow') !== next || next === variant) return;
    stopLive();
    live.failed = false;
    live.offset = 0;
    live.interacted = false;
    for (const button of Object.values(buttons)) button.hidden = !window.Worker;
    variant = next; hero = data;
    canvas?.remove();
    canvas = context = art = artContext = layers = loading = null;
    for (const key of Object.keys(liveCanvas)) delete liveCanvas[key];
    stage.classList.remove('is-ready', 'is-live');
    time = hero.still * hero.duration; last = 0;
    player.sync();
  });
  player.sync();
  return player;
}

// Runs `callback` once the page is idle (or soon, where idle callbacks are missing), unless Save-Data is on.
function idleThen(callback) {
  if (navigator.connection?.saveData) return;
  const idle = window.requestIdleCallback ?? (run => setTimeout(run, 200));
  idle(() => callback(), { timeout: 2000 });
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
