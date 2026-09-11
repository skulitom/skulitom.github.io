import { Life, SIZE } from './life.js';

/* Small, optional enhancements. Every project and navigation link works without JS. */
(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const motionButton = document.querySelector('.motion-toggle');
  const header = document.querySelector('.site-header');
  const navigationLinks = [...document.querySelectorAll('.site-header nav a')];
  const sections = navigationLinks.map(link => document.querySelector(link.hash));
  let motionEnabled = !reducedMotion.matches;
  let syncCanvas = () => {};
  let syncVideo = () => {};

  function applyMotionPreference() {
    document.body.dataset.motion = motionEnabled ? 'on' : 'off';
    motionButton.setAttribute('aria-pressed', String(motionEnabled));
    motionButton.querySelector('.motion-label').textContent = motionEnabled ? 'Pause motion' : 'Resume motion';
    motionButton.querySelector('.motion-icon').textContent = motionEnabled ? 'Ⅱ' : '▷';
    syncCanvas();
    syncVideo();
  }

  motionButton.hidden = false;
  motionButton.addEventListener('click', () => {
    motionEnabled = !motionEnabled;
    applyMotionPreference();
  });
  reducedMotion.addEventListener('change', () => {
    motionEnabled = !reducedMotion.matches;
    applyMotionPreference();
  });
  applyMotionPreference();

  const preview = document.querySelector('.project-video');
  const previewButton = document.querySelector('.video-toggle');
  if (preview && previewButton) {
    let visible = false;
    let userPlayback = null;
    let previousMotion = motionEnabled;
    preview.controls = false;
    previewButton.hidden = false;

    function updatePreviewButton() {
      const playing = !preview.paused;
      previewButton.setAttribute('aria-label', playing ? 'Pause Primordia animation' : 'Play Primordia animation');
      previewButton.textContent = playing ? 'Ⅱ' : '▷';
    }

    syncVideo = () => {
      if (previousMotion !== motionEnabled) userPlayback = null;
      previousMotion = motionEnabled;
      const shouldPlay = (userPlayback ?? motionEnabled) && visible && !document.hidden;
      if (shouldPlay) {
        preview.play().catch(updatePreviewButton);
      } else {
        preview.pause();
      }
      updatePreviewButton();
    };
    previewButton.addEventListener('click', () => {
      userPlayback = preview.paused;
      syncVideo();
    });
    preview.addEventListener('play', updatePreviewButton);
    preview.addEventListener('pause', updatePreviewButton);
    document.addEventListener('visibilitychange', syncVideo);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        syncVideo();
      }, { threshold: 0 }).observe(preview);
    } else {
      visible = true;
      syncVideo();
    }
  }

  // Scroll work is coalesced to one animation frame, with no layout mutations
  // inside the measurement pass. Links announce the current section to AT.
  let scrollFrame = 0;
  function updateNavigation() {
    scrollFrame = 0;
    const scrollTop = window.scrollY;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, scrollTop / scrollable)) : 0;
    const sectionTop = sections.map(section => section.getBoundingClientRect().top);
    let current = -1;
    sectionTop.forEach((top, index) => {
      if (top <= Math.max(150, window.innerHeight * .25)) current = index;
    });
    if (progress > .995) current = sections.length - 1;

    document.documentElement.style.setProperty('--read-progress', progress);
    header.classList.toggle('is-scrolled', scrollTop > 20);
    navigationLinks.forEach((link, index) => {
      if (index === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function queueNavigation() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateNavigation);
  }
  window.addEventListener('scroll', queueNavigation, { passive: true });
  window.addEventListener('resize', queueNavigation, { passive: true });
  window.addEventListener('pageshow', queueNavigation);
  document.fonts?.ready.then(queueNavigation);
  updateNavigation();

  // Reveal only when a section arrives; no hidden-by-default content or loading
  // screen. Reduced motion skips the treatment entirely.
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: .08, rootMargin: '0px 0px -24px 0px' });
    document.querySelectorAll('[data-reveal]').forEach(element => {
      // Only prepare elements below the viewport, after the observer exists.
      if (motionEnabled && element.getBoundingClientRect().top > window.innerHeight) {
        element.classList.add('will-reveal');
      }
      revealObserver.observe(element);
    });
  }

  document.querySelectorAll('[data-spotlight]').forEach(element => {
    element.addEventListener('pointermove', event => {
      if (!finePointer.matches || !motionEnabled) return;
      const bounds = element.getBoundingClientRect();
      element.style.setProperty('--spot-x', `${event.clientX - bounds.left}px`);
      element.style.setProperty('--spot-y', `${event.clientY - bounds.top}px`);
    }, { passive: true });
  });

  const canvas = document.querySelector('#life-canvas');
  const stage = canvas.closest('.study-stage');
  const seedButton = document.querySelector('.seed-life');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;

  async function startLife() {
    // A pre-grown field avoids an empty first frame or a costly warm-up on load.
    const response = await fetch(new URL('./assets/life-seed.bin', import.meta.url));
    if (!response.ok) throw new Error('Life seed unavailable');
    const life = new Life(await response.arrayBuffer());
    const field = document.createElement('canvas');
    field.width = field.height = SIZE;
    const fieldContext = field.getContext('2d');
    const pixels = fieldContext.createImageData(SIZE, SIZE);
    let width = 560, height = 560, ratio = 1;
    let frame = 0, lastPaint = 0, isVisible = false;
    let steps = 12, averageCost = 0;
    let drawing = false;

    function draw() {
      life.paint(pixels.data);
      fieldContext.putImageData(pixels, 0, 0);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(field, 0, 0, width, height);
      stage.classList.add('is-ready');
    }

    function tick(now) {
      frame = 0;
      if (!motionEnabled || !isVisible || document.hidden) return;
      if (!lastPaint || now - lastPaint >= 1000 / 30) {
        const start = performance.now();
        life.step(steps);
        draw();
        const cost = performance.now() - start;
        averageCost = averageCost ? averageCost * .9 + cost * .1 : cost;
        // Slower devices evolve more slowly, instead of blocking input/scroll.
        if (averageCost > 9 && steps > 2) { steps -= 2; averageCost = 0; }
        lastPaint = now;
      }
      frame = requestAnimationFrame(tick);
    }

    syncCanvas = () => {
      const shouldRun = motionEnabled && isVisible && !document.hidden;
      if (!shouldRun && frame) { cancelAnimationFrame(frame); frame = 0; }
      if (shouldRun && !frame) { lastPaint = 0; frame = requestAnimationFrame(tick); }
    };

    function resizeCanvas() {
      const bounds = stage.getBoundingClientRect();
      width = bounds.width; height = bounds.height;
      ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      draw();
      queueNavigation();
    }
    if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe(stage);
    else window.addEventListener('resize', resizeCanvas, { passive: true });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        isVisible = entry.isIntersecting;
        syncCanvas();
      }).observe(stage);
    } else isVisible = true;
    document.addEventListener('visibilitychange', syncCanvas);

    function plantAt(event) {
      const bounds = stage.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      if (Math.hypot(x - .5, y - .5) > .4) return;
      life.plant(x, y);
      draw();
    }
    stage.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drawing = true;
      plantAt(event);
    });
    stage.addEventListener('pointermove', event => {
      if (drawing && event.buttons === 1 && event.pointerType !== 'touch') plantAt(event);
    }, { passive: true });
    for (const event of ['pointerup', 'pointercancel', 'pointerleave']) {
      stage.addEventListener(event, () => { drawing = false; });
    }
    seedButton.hidden = false;
    seedButton.addEventListener('click', () => {
      // Choose a sparse visible region so a keyboard/touch seed is easy to see.
      let x = .5, y = .5;
      for (let attempt = 0; attempt < 30; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = .14 + Math.random() * .19;
        x = .5 + Math.cos(angle) * radius;
        y = .5 + Math.sin(angle) * radius;
        if (life.v[Math.floor(y * SIZE) * SIZE + Math.floor(x * SIZE)] < .03) break;
      }
      life.plant(x, y, 5);
      draw();
    });
    resizeCanvas();
    syncCanvas();
  }
  // Keep the poster and working navigation when canvas/seed loading fails.
  startLife().catch(() => { stage.classList.remove('is-ready'); });
})();
