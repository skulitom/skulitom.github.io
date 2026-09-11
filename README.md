# Artem Skulimovskiy — portfolio

Personal portfolio at **https://skulitom.github.io/**.

This repository publishes the website. The GitHub profile README lives separately in [skulitom/skulitom](https://github.com/skulitom/skulitom).

## Editing

- `index.html`: biography, projects, apps, navigation, and metadata.
- `styles.css`: responsive dark theme and short, reduced-motion-aware animations.
- `assets/`: locally hosted project images, app images, toolkit badges, and fonts.
- `ASSETS.md`: image sources and third-party asset licences.

The site uses plain HTML and CSS and needs no build step or JavaScript runtime. For a local preview, serve this directory with any static HTTP server, for example `python -m http.server 8766 --bind 127.0.0.1`.

## Publishing

GitHub Pages publishes the `main` branch from the repository root. A push to `main` updates the site automatically. `.nojekyll` preserves the static files without Jekyll processing.

Keep personal contact details and private CV documents out of this public repository. Update image filenames when replacing screenshots if an old version remains cached.

