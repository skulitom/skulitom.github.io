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

Every pixel-art illustration on the page is made with [Pixelbolt](https://github.com/skulitom/Pixelbolt): the hero, the five tool cards and the footer strip. The art is drawn nearest-neighbour at a whole number of device pixels per art pixel. A small inline script in `index.html` sets `--dpr` (the device-pixel ratio, zoom included) so the CSS can size every still on that grid before anything paints; the canvases then take over at the same size. Frames are 70 ms, and each player paints only when its frame changes (about 14 fps, under the 30 fps cap). Animation pauses outside the viewport and in background tabs, and stays on the still for reduced-motion preferences or after Pause motion.

The hero is a night workbench where a mint liquid boils in a flask and its steam rolls up in shaded billows. Where its column has room for 2×, it shows the desktop hero from the window to the monitor (234 × 162 art pixels); elsewhere it shows the phone composition without its quiet top wall (156 × 130). The same media query picks the `<picture>` still, the stage's shape in `styles.css` and `WIDE` in `assets/pixel/art.js`; keep them in step. Each crop plays a pre-rendered 96-frame loop: a still background, the steam and the flask's liquid as sprite sheets, and the mostly still groups (the window's clouds; everything in front) as a still plus the small box that moves.

A visitor can re-simulate either fluid. Clicking or tapping the flask, or Stir the flask, re-runs its FLIP liquid source with a stir vortex. Clicking the plume swirls the steam at that point, and clicking the neck or Add heat adds one more of the art's own biggest billows. A module worker runs Pixelbolt's compiler (`fluid.js`) and renderer (`core.js`), unmodified, then the new loop dissolves in through a Bayer mask so every pixel stays a palette colour. The caption reports the measured simulation time. Live runs use one warm-up cycle instead of the art's three. The steam also uses 12 pressure iterations instead of 30, on a 48-frame loop holding the second half of the art's billows (the big surge and two calmer ones), played twice per scene loop. A click costs under a second on a recent desktop PC. With the published settings, the same sources reproduce the approved loops exactly. With motion off, the buttons show a new still. The worker and Pixelbolt's modules load on interaction, or once the hero has been on screen for a few seconds with motion on. Each simulation runs in a fresh worker started ahead of time.

Each tool card's frame hugs its 192 × 100 piece at the largest whole scale that fits the card (3× at 1440 px wide). Hovering, focusing or tapping it plays the piece's hover burst once, then returns to its loop; each loop starts on the piece's chosen still frame. The footer strip (416 × 42) runs at about 2× and, on narrow screens, keeps its right end.

`assets/portfolio-social-pixel-20261017.png` is the link preview: the profile README's header still (`assets/v4/hero-still.svg` in skulitom/skulitom) rendered at 3× and centred on 1280 × 640 of `#0e1423`.

### Refreshing the art

The pieces are built in the profile-art workspace, one folder per piece, each with its own `build.sh`. After rebuilding them, run `node scripts/import_art.mjs <profile-art folder> [Pixelbolt checkout]`. It vendors Pixelbolt's browser modules with their licence, cuts both hero crops and the footer from the pieces' recipes (and fails unless every cut recombines to the approved frames exactly), inlines the shared palette into the hero's fluid sources, and copies each card's loop, hover burst and still (failing if a still frame no longer matches `data-pixel-still` in `index.html`). Bump the `?v=` query on `styles.css` and `script.js` in `index.html` when they change, and `VERSION` in `assets/pixel/art.js` (plus the `art.js?v=` import in `script.js`) when the art or the player changes. Sprite-sheet PNGs are fetched without the query, so give a changed sheet a new file name if both versions might meet in a cache.

Supporting projects have a shared card frame around the heading, media, description, and links. Their names appear above the media so each image or recording is clearly associated with its project.

For a local preview, serve this directory with any static HTTP server, for example `python -m http.server 8766 --bind 127.0.0.1`. The hero's worker needs HTTP; it does not run from `file://`.

## Publishing

The `Publish portfolio` GitHub Actions workflow publishes pushes to `main` automatically. It packages only `index.html`, `styles.css`, `script.js`, `life.js`, `.nojekyll`, and `assets/`, then deploys them to GitHub Pages. GitHub Pages is configured to use GitHub Actions as its publishing source.

Keep personal contact details and private CV documents out of this public repository. Update image filenames when replacing screenshots if an old version remains cached.

The Pause motion control stops the pixel-art animation and automatic video playback; Resume motion restores them. The system reduced-motion preference sets the initial state. Supporting projects share responsive rows, and social metadata uses the Pixelbolt link preview described above. Verify dated project results and repository section links when updating content.

`litharness.html` is the outcome-focused walkthrough and unedited opening-chapter sample. The publishing workflow includes this page explicitly. Its chapter text and provenance are in `assets/litharness/`; preserve the source wording when changing presentation. The six additional experiments are in a native `<details>` disclosure that also works without JavaScript. LinkedIn is linked from Experience and the footer.

## Content review: 8 October 2026

The home page and LitHarness walkthrough describe the rebuilt brief/bible/chapter workflow. The 19 September writing sample and trial metrics remain unchanged and are explicitly attributed to the previous implementation. The supporting rows feature PixelForge, Looking Glass, Cutbolt, and Keepsake. Check both README and release evidence when refreshing Haltere: the 29 September fast-brain-11 recording is a development flight, while the completed race result belongs to fast-brain-08.

## Positioning

Lead with agentic engineering and tools for agents. Anode is featured, followed by Inkbolt, Cutbolt, Pixelbolt, and Nestbolt. Keep AgentUI compact, with LitHarness under agent workflows and research below the tools. Preserve the existing dark palette, typography, motion controls, and project media.
