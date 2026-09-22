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

The site uses HTML, CSS, and dependency-free browser JavaScript. No build step is needed. All content and links work without JavaScript; the artificial-life study has a matching WebP fallback. Its initial state is pre-grown so loading never needs a simulation warm-up. The simulation uses a fixed 160 × 160 grid and adapts its work to slower devices. The canvas paints at a maximum of 30 fps, pauses outside the viewport and in background tabs, and stays stationary for reduced-motion preferences. Click or drag to seed growth, or use the keyboard-accessible Seed life button. Reset replaces a settled field with fresh colonies in a new orientation, then grows them from the beginning. Seeding and resetting with reduced motion change only the still frame. Touch scrolling remains native. The site's reveal and hover effects also respect reduced-motion preferences.

Supporting projects have a shared card frame around the heading, media, description, and links. Their names appear above the media so each image or recording is clearly associated with its project.

For a local preview, serve this directory with any static HTTP server, for example `python -m http.server 8766 --bind 127.0.0.1`. Regenerate the static study with `node scripts/generate_life.mjs` (requires Python + Pillow for WebP encoding).

## Publishing

The `Publish portfolio` GitHub Actions workflow publishes pushes to `main` automatically. It packages only `index.html`, `styles.css`, `script.js`, `life.js`, `.nojekyll`, and `assets/`, then deploys them to GitHub Pages. GitHub Pages is configured to use GitHub Actions as its publishing source.

Keep personal contact details and private CV documents out of this public repository. Update image filenames when replacing screenshots if an old version remains cached.

The Pause motion control stops the artificial-life animation and automatic video playback; Resume motion restores them. The system reduced-motion preference sets the initial state. Supporting projects share responsive rows, and social metadata uses a local screenshot of the introduction. Verify dated project results and repository section links when updating content.

`litharness.html` is the outcome-focused walkthrough and unedited opening-chapter sample. The publishing workflow includes this page explicitly. Its chapter text and provenance are in `assets/litharness/`; preserve the source wording when changing presentation. The six additional experiments are in a native `<details>` disclosure that also works without JavaScript. LinkedIn is linked from Experience and the footer.
