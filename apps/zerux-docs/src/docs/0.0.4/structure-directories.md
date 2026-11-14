---
{
  "title": "Directory reference",
  "description": "Every implemented discovery directory and its exposure/ownership boundary.",
  "navigation": "structure",
  "section": "Fundamentals",
  "order": 5,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/config.ts",
    "packages/zeruxjs/src/bootstrap/runtime.ts",
    "packages/zeruxjs/src/commands/project-builder.ts"
  ],
  "related": [
    "structure",
    "file-conventions",
    "environment",
    "static-assets",
    "plugins"
  ]
}
---

## Root and src layouts

```text
project/
  zerux.config.ts       executable trusted configuration
  src/
    index.ts           optional registration entry
    app/               inferred page/API route modules
    middleware/        request middleware
    controllers/       reusable controller exports
    composables/       reusable application helpers
    plugins/           generation registrations/resources
  public/              deliberately public files
  private/             host-owned secrets/data; never a public root
  .zerux/              compiler-owned output (default)
```

The default folders are at the project root, not under `src`. To use this tree, explicitly configure every `src/…` path. Source layout is not inferred from tsconfig.

## Discovery roles

| Setting                 | Default          | Accepted shape         | Actual responsibility                                                   |
| ----------------------- | ---------------- | ---------------------- | ----------------------------------------------------------------------- |
| `structure.app`         | `app`            | string                 | File route discovery; index/page/route conventions                      |
| `structure.middleware`  | `middleware`     | string or string array | Named/global middleware exports                                         |
| `structure.controllers` | `controllers`    | string or string array | Reusable registered controller references, not automatic HTTP routes    |
| `structure.composables` | `composables`    | string or string array | Application helper registry, not Vue hooks or automatic browser imports |
| `structure.plugins`     | `plugins`        | string or string array | Explicit registration modules; own resources with disposal              |
| `structure.public`      | `public`         | string or string array | Direct public assets; exclude credentials, backups and private uploads  |
| `structure.env`         | empty extra list | string or string array | Additional environment files loaded after config evaluation             |
| `entryPoint`            | `index`          | string                 | Optional default/register/setup/boot application registration           |
| `outDir`                | `.zerux`         | string                 | Build-owned output, disjoint from source and private data               |

Directory lists are resolved and deduplicated. Avoid ambiguous basenames when registries support shorthand names. Public assets have their own serving path; do not rely on ordinary route middleware to protect them.

## Files do not imply integrations

`layout`, `loading`, `template` and `error` are reserved file-route names. They do not magically install component boundaries. Renderer layouts/error handling require their explicit renderer contracts. A JSX/Vue/MDX file is not executable without its actual supported build transform. A `services` directory alone does not register framework services, and saved content never registers plugins.

## Build boundary

Production start consumes the compiled structure and manifests. Inspect asset URLs, copied directories and server-only modules after a layout change. `.zerux` Node output, the docs `dist` exporter and a generic static export are different outputs. Never make one another's source or automatic cleanup target.
