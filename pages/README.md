# Shared ecosystem homepage

This is the source for the domain homepage at `/`. It introduces ZeruxJS, ZyroJS, ZenixJS and the shared public package catalog. Dedicated site builds are mounted below independent paths such as `/zeruxjs/`.

`index.html` is a static template. `scripts/build-sites.mjs` inserts the public package catalog and places styles/browser code under `/site-assets/`. Do not deploy this source directory directly.

Develop the homepage and all configured sites from this directory:

```sh
npm run dev
```

Open `http://127.0.0.1:3010/` for the shared homepage and `/zeruxjs/` for docs. Source edits rebuild and reload the browser automatically. `HOST` and `PORT` override the listener.

Build and preview all sites from this directory:

```sh
npm run build
npm run preview
```

The combined static output is `../.site-build/`. Site mounts and root-owned files are declared in `../sites.config.mjs`. GitHub Actions commits owned output to `master-site` while preserving other paths, then deploys the branch's complete static tree to GitHub Pages. See `../SITE_DEPLOYMENT.md` for hosting and extension instructions.
