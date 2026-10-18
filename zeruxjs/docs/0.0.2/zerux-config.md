# zerux.config.js

Configure a JavaScript application, understand file precedence and distinguish runtime settings from the docs exporter.


## Where it belongs

Place one configuration file at the application root, alongside its package.json. The framework checks `zerux.config.ts`, `zerux.config.js`, `zerux.config.mjs`, then `zerux.config.cjs`, and uses the first existing file. It does not merge several files. If none exists, the loader returns an empty object and runtime defaults apply. Removing a configuration file therefore does not disable application discovery.

For an ESM application with `"type": "module"`, use a default export:

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  type: 'fix',
  outDir: '.zerux',
  structure: {
    app: 'app',
    middleware: ['middleware'],
    controllers: ['controllers'],
    composables: ['composables'],
    plugins: ['plugins'],
    public: ['public'],
  },
  server: {
    port: 3000,
    allowedDomains: ['localhost', '127.0.0.1'],
  },
};
```

In a CommonJS application use `zerux.config.cjs` with `module.exports = { ... }`, or use `.mjs` for an unambiguous ESM file. The loader accepts default exports and the legacy named `zeruxConfig` / `zdevConfig` exports; prefer a default export for new applications. Configuration modules execute on the server, so keep imports deliberate and side effects minimal.

## Runtime options

`type` selects the `fix`, `dynamic` or `function` structure mode. Paths such as `structure.app`, `structure.public` and `outDir` resolve relative to the application root. The default route folder is `app`, entry module basename is `index`, and runtime output directory is `.zerux`. Middleware, controller, composable and plugin settings accept discovery directories; check the [configuration reference](/zeruxjs/docs/0.0.2/configuration-reference.md) for exact shapes.

The nested `server` object owns ports and allowed-host settings. An allowed hostname does not authenticate a visitor. Database, cache, files, email and queue configuration belongs to runtime service startup; check their guides before configuring external services. Configuration changes generally require restarting the owning runtime or rebuilding its output.

## Environment values and secrets

Read credentials through `process.env` and keep them out of public asset directories, browser bundles and static Markdown. The runtime resolves standard `.env` variants and additional `structure.env` paths. Configuration code runs before some runtime startup phases; do not assume every environment file has already been loaded while the config module itself is evaluating. Supply deployment environment variables through the hosting process and follow the environment guide for file loading order.

## The documentation application's config

The repository's `apps/zerux-docs/zerux.config.js` is a real configuration input. Its `documentation` object contains `basePath`, `origin`, `latest`, versions, section order and repository metadata. `src/site.config.mjs` imports this object, and the static builder, Markdown exporter, links and preview use those values.

`documentation` is an **app-specific extension**, allowed by the public config type; it is not a built-in static-export API of ZeruxJS. `outDir: '.zerux'` remains the runtime output setting. This app's static exporter writes `dist/`, and the shared site builder mounts it under `/zeruxjs/` before GitHub Pages deployment. Run `npm run build` from the docs application or `pages/` for the complete ecosystem site. `zerux build` compiles Node server applications and does not replace this exporter.

## Styling and site metadata

Zuixs settings remain in `zuix.config.mjs`. Prefer utilities directly in template classes. Optional recipes compose utilities for resets or generated Markdown elements; they are not required for ordinary components. A custom application namespace does not cause the framework to consume another tool's configuration automatically.

Set `documentation.origin` to the public origin to emit canonical URLs and the documentation sitemap. Set `documentation.basePath` to the mounted app path; the combined builder's site mount must agree with it. Archive version references before changing release versions, as described in the documentation application README.


## Implementation sources

- [packages/zeruxjs/src/bootstrap/config.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/config.ts)
- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [apps/zerux-docs/zerux.config.js](https://github.com/zeruxjs/zeruxjs/blob/master/apps/zerux-docs/zerux.config.js)
- [apps/zerux-docs/src/site.config.mjs](https://github.com/zeruxjs/zeruxjs/blob/master/apps/zerux-docs/src/site.config.mjs)
