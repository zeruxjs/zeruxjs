---
{
  "title": "CLI reference",
  "description": "Application commands, lifecycle modes and the limits of built-in checks.",
  "section": "API reference",
  "order": 50,
  "sources": [
    "packages/zeruxjs/src/bin/zerux.ts",
    "packages/zeruxjs/src/commands/server.ts",
    "packages/zeruxjs/src/commands/build.ts"
  ],
  "related": [
    "installation",
    "deployment",
    "package-lint"
  ]
}
---

## Run in the application directory

```sh
npx zerux dev
npx zerux build
npx zerux start
```

The runtime CLI uses zclivo for command registration. Your application can expose npm scripts for the same commands. A monorepo root without an application config is not necessarily an application to build.

| Command | Responsibility |
| --- | --- |
| dev | Work against source modules, watch changes, stage replacement generations |
| build | Compile application sources and public assets to the production build |
| start | Start the compiled production structure |

## Lint commands

The CLI registers lint, lint:watch, lint:fix, lint:watch:fix and JS/CSS/all variants backed by @zeruxjs/lint. Project config and Stylelint plugins are trusted executable code. Read runner results and fail CI on errors.

## Typechecking

The build transpiles; it does not run a complete typecheck. Use a project tsconfig with a separate noEmit check or the TypeScript package's checkTypes API. Keep both checks in CI.

## Scaffolders

The 0.0.2 create-zerux-js, create-zenix-js and create-zyro-app packages reserve names and provide help/version behavior. They are not working project generators. Follow the manual installation/tutorial until a generator is implemented.

## Operational diagnostics

For a development rebuild failure inspect the latest reload status in dev.json and sanitized logs. The last good runtime may still serve requests. Do not publish runtime diagnostic manifests as public assets: they are internal operational state.
