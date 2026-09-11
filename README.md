# Artem Skulimovskiy — portfolio

Personal portfolio at **https://skulitom.github.io/**.

This repository publishes the website. The GitHub profile README lives separately in [skulitom/skulitom](https://github.com/skulitom/skulitom).

## Editing

- `index.html`: biography, projects, apps, navigation, and metadata.
- `styles.css`: responsive dark theme and short, reduced-motion-aware animations.
- `script.js`: section navigation, reading progress, motion controls, and the artificial-life canvas.
- `life.js`: a small Gray–Scott reaction–diffusion model adapted from Primordia.
- `assets/`: locally hosted project images, app images, toolkit badges, and fonts.
- `ASSETS.md`: image sources and third-party asset licences.

The site uses HTML, CSS, and dependency-free browser JavaScript. No build step is needed. All content and links work without JavaScript; the artificial-life study has a matching WebP fallback. Its initial state is pre-grown so loading never needs a simulation warm-up. The simulation uses a fixed 160 × 160 grid and adapts its work to slower devices. The canvas paints at a maximum of 30 fps, pauses outside the viewport and in background tabs, and starts stationary for reduced-motion preferences. Click or drag to seed growth, or use the keyboard-accessible Seed life button. Seeding while paused changes only the still frame. Touch scrolling remains native. The visible motion control also pauses the site's reveal and hover effects.

For a local preview, serve this directory with any static HTTP server, for example `python -m http.server 8766 --bind 127.0.0.1`. Regenerate the static study with `node scripts/generate_life.mjs` (requires Python + Pillow for WebP encoding).

## Publishing

The `Publish portfolio` GitHub Actions workflow publishes pushes to `main` automatically. It packages only `index.html`, `styles.css`, `script.js`, `life.js`, `.nojekyll`, and `assets/`, then deploys them to GitHub Pages. GitHub Pages is configured to use GitHub Actions as its publishing source.

Keep personal contact details and private CV documents out of this public repository. Update image filenames when replacing screenshots if an old version remains cached.
