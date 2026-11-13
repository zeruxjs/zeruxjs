# CLI reference

Application commands, lifecycle modes and the limits of built-in checks.


## Run in the application directory

```sh
npx zerux dev
npx zerux build
npx zerux start
```

The runtime CLI uses zclivo for command registration. Your application can expose npm scripts for the same commands. A monorepo root without an application config is not necessarily an application to build.

| Command | Responsibility                                                            |
| ------- | ------------------------------------------------------------------------- |
| dev     | Work against source modules, watch changes, stage replacement generations |
| build   | Compile application sources and public assets to the production build     |
| start   | Start the compiled production structure                                   |

## Lint commands

The CLI registers lint, lint:watch, lint:fix, lint:watch:fix and JS/CSS/all variants backed by @zeruxjs/lint. Project config and Stylelint plugins are trusted executable code. Read runner results and fail CI on errors.

## Typechecking

The build transpiles; it does not run a complete typecheck. Use a project tsconfig with a separate noEmit check or the TypeScript package's checkTypes API. Keep both checks in CI.

## Scaffolders

The workspace implements [create-zerux-js](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-create-zerux-js.md) for selected SSR templates, [create-zyro-app](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-create-zyro-app.md) for explicit client/static/SSR/hydrated modes, and [create-zenix-js](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-create-zenix-js.md) for a host-configured SQLite CMS scaffold. All use safe staging and dry-run; none installs dependencies, starts applications or supplies default credentials. Verify installed release exports: source changes do not publish unchanged package versions.

## Operational diagnostics

For a development rebuild failure inspect the latest reload status in dev.json and sanitized logs. The last good runtime may still serve requests. Do not publish runtime diagnostic manifests as public assets: they are internal operational state.


## Implementation sources

- [packages/zeruxjs/src/bin/zerux.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bin/zerux.ts)
- [packages/zeruxjs/src/commands/server.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/commands/server.ts)
- [packages/zeruxjs/src/commands/build.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/commands/build.ts)
