/* Small, optional enhancements. Every project and navigation link works without JS. */
(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const header = document.querySelector('.site-header');
  const navigationLinks = [...document.querySelectorAll('.site-header nav a')];
  const sections = navigationLinks.map(link => document.querySelector(link.hash));
  const motionButton = document.querySelector('.motion-toggle');
  let motionEnabled = !reducedMotion.matches;
  let syncArt = () => {};
  let syncVideo = () => {};

  function applyMotionPreference() {
    document.body.dataset.motion = motionEnabled ? 'on' : 'off';
    if (motionButton) motionButton.textContent = motionEnabled ? 'Pause motion' : 'Resume motion';
    syncArt();
    syncVideo();
  }

  reducedMotion.addEventListener('change', () => {
    motionEnabled = !reducedMotion.matches;
    applyMotionPreference();
  });
  applyMotionPreference();
  if (motionButton) {
    motionButton.hidden = false;
    motionButton.addEventListener('click', () => {
      motionEnabled = !motionEnabled;
      applyMotionPreference();
    });
  }

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
  document.querySelectorAll('details').forEach(element => element.addEventListener('toggle', queueNavigation));
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

  // Pixelbolt pixel art: the live fluid hero and the tool cards. The static stills in the HTML stay if this fails.
  import('./assets/pixel/art.js?v=2').then(({ startPixelArt }) => {
    syncArt = startPixelArt({ isMotionEnabled: () => motionEnabled }).sync;
    syncArt();
  }).catch(() => {});
})();
