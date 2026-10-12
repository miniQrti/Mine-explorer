# Hosting Mine Explorer

The game is entirely static and is live at **https://miniqrti.github.io/Mine-explorer/**. GitHub Actions deployment and published desktop/mobile gameplay checks passed. A public repository does not automatically enable Pages; this repository is configured as described below.

## GitHub Actions deployment

1. Open this repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. In **Actions**, run **Validate and deploy game** (or push a change to `main`).

The workflow runs the engine tests, Chromium desktop/touch browser tests, and build before publishing `dist/`.

Expected address after a successful deployment:

https://miniQrti.github.io/Mine-explorer/

GitHub Pages is configured to use Actions. The earlier integration-permission blocker has been resolved; the game becomes available after the validation and deployment workflow succeeds.

## Simple branch deployment

As an alternative, the repository's `index.html` and `src/` are already a complete static app. Choose **Deploy from a branch**, **main**, **/(root)** in Pages settings. The root `.nojekyll` file allows GitHub Pages to serve it directly. Local validation should pass before source is pushed.

## Other static hosts

Run `npm ci` and `npm run build`, then serve `dist/` over HTTP(S). Opening `index.html` as a `file://` URL is unsupported because the game uses ES modules and a web worker.

No runtime environment variables, secrets, database, or backend are needed. Browser-local progress belongs to the origin where the game is played; changing host or clearing site data starts a new local record.
