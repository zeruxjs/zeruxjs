# Static export

Explicit public-only HTML export is separate from Node builds and this docs app.


## Choose the output owner

`zeruxjs/static-export` exposes `exportStaticSite` for opted-in request-free public routes, finite validated dynamic parameters, renderer/assets and bounded output. It stages a candidate before promoting, emits real 404 output and explicit redirect hosting metadata, and rejects private pages/actions/scripts. It does not serialize a server runtime into HTML or supply a universal SPA fallback.

The standalone Zyro generator's `static` mode uses this exporter for script-free HTML/CSS. Its client/SSR/hydrated modes are different outputs. The documentation app remains its own app-specific exporter; setting `documentation` on an arbitrary framework config does not enable it.

## Production checks

Set the exact public origin/base path. Inspect canonical and mounted hashed asset URLs, missing-route status, redirect metadata, route/time/byte budgets and last-good-output preservation. Mixed mode needs a real Node host for routes not exported; a static host cannot execute server functions. Callbacks/filesystem writers remain trusted, not sandboxed.


## Implementation sources

- [packages/zeruxjs/src/static-export.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/static-export.ts)
- [packages/create/create-zyro-app/src/templates.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/create/create-zyro-app/src/templates.ts)
