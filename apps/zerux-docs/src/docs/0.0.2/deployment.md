---
{
  "title": "Build and deployment",
  "description": "Choose a server build or a fully static documentation export.",
  "section": "Operations",
  "order": 140,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/types.ts"
  ],
  "related": [
    "introduction",
    "deployment"
  ]
}
---

## Framework server build

zerux build compiles routes, controllers, plugins and public assets into .zerux/build. A successful build replaces the prior output; failed compilation leaves the last good build. zerux start consumes the build manifest when it exists. The current resolver can fall back to source configuration when no manifest exists, so verify your deployment actually contains a valid build; start alone is not proof of compiled execution. Run typechecking separately.

```sh
npx zerux build
npx zerux start
```

## Static documentation build

In apps/zerux-docs, npm run build renders every documentation route into dist/zeruxjs/<route>/index.html, along with CSS, search data and a 404 page. It uses no browser hydration and needs no runtime server on the deployment host.

```sh
cd apps/zerux-docs
npm run build
# The combined site workflow publishes dist/zeruxjs/ under /zeruxjs/.
# Optional local preview:
npm run preview
```

## Hosting

For documentation, serve directory index.html files and use dist/404.html as the missing-page response. Do not configure an SPA fallback: every page is already rendered. For framework applications, configure TLS, application domains, process restarts and service credentials at the host.
