# Artem Skulimovskiy — portfolio

Personal portfolio at **https://skulitom.github.io/**.

This repository publishes the website. The GitHub profile README lives separately in [skulitom/skulitom](https://github.com/skulitom/skulitom).

## Editing

- `index.html`: biography, projects, apps, navigation, and metadata.
- `styles.css`: responsive dark theme and short, reduced-motion-aware animations.
- `script.js`: section navigation, reading progress, motion controls, and loading the pixel art.
- `assets/pixel/art.js`: plays the Pixelbolt hero and tool-card art and runs the live hero simulation.
- `assets/pixel/fluid-worker.js`: re-simulates a hero fluid off the main thread with Pixelbolt's own modules.
- `assets/pixel/`: the art itself (sheets, atlases, stills and the hero's fluid sources); `assets/pixelbolt/`: the vendored Pixelbolt modules.
- `assets/`: locally hosted project images, app images, toolkit badges, and fonts.
- `ASSETS.md`: image sources and third-party asset licences.
- `life.js`: the earlier reaction–diffusion hero. The page no longer loads it; it stays for cached pages and because the publishing workflow copies it.

The site uses HTML, CSS, and dependency-free browser JavaScript. No build step is needed. All content and links work without JavaScript: the hero and each tool card start as a static PNG still of the same art.

### The Pixelbolt art

Every pixel-art illustration on the page is made with [Pixelbolt](https://github.com/skulitom/Pixelbolt). The art is drawn nearest-neighbour at a whole number of device pixels per art pixel: the hero (156 × 180 art pixels) at 3× on wide layouts and 2× on narrow ones at 100% scaling, and the 192 × 100 tool cards at the largest such scale that fits their frame. A small inline script in `index.html` sets `--dpr` (the device-pixel ratio, zoom included) so the CSS can size the stills on that grid before anything paints; the canvases then take over at the same size. Frames are 70 ms, and each player paints only when its frame changes (about 14 fps, under the 30 fps cap). Animation pauses outside the viewport and in background tabs, and stays on the still for reduced-motion preferences or after Pause motion.

The hero is a night workbench where a mint liquid boils in a flask and its steam rolls up in shaded billows. It plays a pre-rendered 96-frame loop: a still background, the steam and the flask's liquid as sprite sheets, and everything in front as one still plus the small box that moves. Clicking or tapping the flask, or the Stir the flask button, re-runs the flask's FLIP liquid source with a stir vortex at that point; clicking the steam, or Add heat, re-runs the steam's gas source with a hot billow. The worker uses Pixelbolt's compiler (`fluid.js`) and renderer (`core.js`), unmodified, then the new loop dissolves in through a Bayer mask so every pixel stays a palette colour. The caption reports the measured simulation time. Live runs use one warm-up cycle instead of the art's three, and 16 pressure iterations for the steam instead of 30, so a click costs about a second; with the published settings the same sources reproduce the approved loop exactly. With motion off, the buttons show a new still. The worker and Pixelbolt's modules load on interaction, or once the hero has been on screen for a few seconds with motion on. Each simulation runs in a fresh worker started ahead of time.

Hovering, focusing or tapping a tool card plays that piece's hover burst once, then returns to its loop.

### Refreshing the art

The pieces are built in the profile-art workspace, one folder per piece, each with its own `build.sh`. After rebuilding them, run `node scripts/import_art.mjs <profile-art folder> [Pixelbolt checkout]`. It vendors Pixelbolt's browser modules with their licence, splits the phone hero's effects recipe into the three layers (and fails unless they recombine to the approved frames exactly), renders the hero still, inlines the shared palette into the hero's fluid sources, and copies each card's loop, hover burst and still. Bump the `?v=` query on `styles.css` and `script.js` in `index.html` when they change, and `VERSION` in `assets/pixel/art.js` (plus the `art.js?v=` import in `script.js`) when the art or the player changes. Sprite-sheet PNGs are fetched without the query, so give a changed sheet a new file name if both versions might meet in a cache.

Supporting projects have a shared card frame around the heading, media, description, and links. Their names appear above the media so each image or recording is clearly associated with its project.

For a local preview, serve this directory with any static HTTP server, for example `python -m http.server 8766 --bind 127.0.0.1`. The hero's worker needs HTTP; it does not run from `file://`.

## Publishing

The `Publish portfolio` GitHub Actions workflow publishes pushes to `main` automatically. It packages only `index.html`, `styles.css`, `script.js`, `life.js`, `.nojekyll`, and `assets/`, then deploys them to GitHub Pages. GitHub Pages is configured to use GitHub Actions as its publishing source.

Keep personal contact details and private CV documents out of this public repository. Update image filenames when replacing screenshots if an old version remains cached.

The Pause motion control stops the pixel-art animation and automatic video playback; Resume motion restores them. The system reduced-motion preference sets the initial state. Supporting projects share responsive rows, and social metadata uses a local screenshot of the introduction. Verify dated project results and repository section links when updating content.

`litharness.html` is the outcome-focused walkthrough and unedited opening-chapter sample. The publishing workflow includes this page explicitly. Its chapter text and provenance are in `assets/litharness/`; preserve the source wording when changing presentation. The six additional experiments are in a native `<details>` disclosure that also works without JavaScript. LinkedIn is linked from Experience and the footer.

## Content review: 8 October 2026

The home page and LitHarness walkthrough describe the rebuilt brief/bible/chapter workflow. The 19 September writing sample and trial metrics remain unchanged and are explicitly attributed to the previous implementation. The supporting rows feature PixelForge, Looking Glass, Cutbolt, and Keepsake. Check both README and release evidence when refreshing Haltere: the 29 September fast-brain-11 recording is a development flight, while the completed race result belongs to fast-brain-08.

## Positioning

Lead with agentic engineering and tools for agents. Anode is featured, followed by Inkbolt, Cutbolt, Pixelbolt, and Nestbolt. Keep AgentUI compact, with LitHarness under agent workflows and research below the tools. Preserve the existing dark palette, typography, motion controls, and project media.
