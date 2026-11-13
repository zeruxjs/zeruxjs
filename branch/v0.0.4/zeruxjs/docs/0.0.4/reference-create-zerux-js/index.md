# create-zerux-js

Safe SSR project generation for the verified ZeruxJS renderer contracts.


## Implemented generator

`create-zerux-js` now uses zclivo's safe generator engine. The existing `create-zerux`
binary and help/version behavior remain, with a matching `create-zerux-js` alias.
Source version remains 0.0.4; inspect installed registry artifacts before assuming
new checkout contracts were published.

```sh
npm create zerux-js@latest -- my-app --yes
npx create-zerux-js@0.0.4 my-app --renderer react --language typescript --port 4000 --dry-run
```

The default is TypeScript/ZyroJS HTML-only SSR. React and Vue templates emit only
their selected runtime/adapter dependencies; JavaScript is also supported. `ssr` is
the sole mode. Hydration, client-only rendering, static export and automatic browser
navigation are deliberately not generated. Ordinary links work without JavaScript.

## Safety and generated files

Projects include private manifests, build/dev/start scripts, explicit config/entry,
minimal renderer routes, public styles, a secret-free env example and a smoke check.
Names, paths, port and capabilities validate before writing. Existing/dangling targets
and unsafe parents reject; dry-run is read-only. Staging/exclusive promotion, rollback
and cancellation are supplied by zclivo. No install, server start, port takeover or
unreviewed template loading occurs. Use another port on conflict; never stop an
unrelated app to make this sample run.

The package README and public `examples/generate.mjs` document exact flags, runtime
versions and renderer prerequisites. Qualification covers all six language/renderer
combinations with offline local-link installs, actual builds/typechecks and owned
production HTTP fixtures. It is not clean-registry, live-browser, hydration or
production hosting acceptance.

## Headless planning and ownership

```js
import { planZeruxApp } from 'create-zerux-js';

const plan = planZeruxApp({
  name: 'example-app',
  destination: './example-app',
  renderer: 'zyro',
  language: 'typescript',
  mode: 'ssr',
  port: 3000,
});
console.log(Object.keys(plan.files));
```

Planning validates capabilities and produces inert authored source text. Importing
`runCreateZerux` starts no prompts, process listeners or application resources.
Its optional prompt factory transfers cleanup to the shared command engine; the
executable owns only its invocation's terminal signal listeners and removes them
on exit. The example's `generate()` writes only when explicitly called and still
does not install dependencies or execute generated code.

The renderer/function/import selections are fixed reviewed code. User project
options cannot supply arbitrary import paths or shell commands. Native renderer
APIs and matching peer requirements remain owned by their adapter packages.
Consumer verification resolves explicitly named installed tooling, including
hoisted TypeScript, and leaves real applications and their ports untouched.


## Public entry points

Manifest reference for `create-zerux-js@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./templates": {
      "types": "./dist/templates.d.ts",
      "import": "./dist/templates.js"
    }
  },
  "engines": {},
  "dependencies": {
    "zclivo": "0.0.4"
  },
  "peerDependencies": {},
  "bin": {
    "create-zerux": "./dist/index.js",
    "create-zerux-js": "./dist/index.js"
  }
}
```


## Package README

# create-zerux-js

Safe ZeruxJS project generation using the public zclivo engine. The npm name remains
`create-zerux-js`; both the existing `create-zerux` binary and matching
`create-zerux-js` binary invoke the same entry. Version remains 0.0.4. Help/version
continue to return status 0. Imports are inert and expose `runCreateZerux`,
`planZeruxApp`, `zeruxAppGenerator`, `templateVersions` and `version`.

## Invocation

```sh
npm create zerux-js@latest -- my-app --yes
npx create-zerux-js@0.0.4 my-app --renderer react --language typescript --port 4000 --yes
npx create-zerux-js@0.0.4 --name my-app --destination ./projects/demo --js --renderer vue --dry-run
npx create-zerux-js@0.0.4 --interactive
npx create-zerux-js@0.0.4 --help
```

The selected parent directory must exist and be canonical, without symlink components.
A bare interactive-terminal invocation prompts; non-terminal invocation without a
project prints help. Explicit `--interactive` requires a terminal in the binary;
`--yes`/explicit flags never prompt. Both direct `folder` and optional `create folder`
forms work. Shared flags cover name/destination, language (`--js`/branch/v0.0.4/`--ts` aliases),
port, template, renderer, mode, dry-run, interactive and yes. Conflicting spellings,
unknown flags or repeated values reject. The public example is
[examples/generate.mjs](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/create/create-zerux-app/examples/generate.mjs).

This checkout implements new source contracts without a version bump or publication.
Before using a registry artifact, inspect its exports/help: a published 0.0.4 may
predate these source changes. Qualification below uses local workspace artifacts;
no registry release availability or deployment is promised.

## Actual template matrix

One explicit `zerux-app` template offers HTML-only server rendering:

| Renderer         | Required generated renderer dependencies                                              | Mode  |
| ---------------- | ------------------------------------------------------------------------------------- | ----- |
| ZyroJS (default) | `zyrojs@0.0.4`                                                                        | `ssr` |
| React            | `@zeruxjs/react@0.0.4`, matching `react`/branch/v0.0.4/`react-dom@19.3.1`                           | `ssr` |
| Vue              | `@zeruxjs/vue@0.0.4`, matching `vue`/branch/v0.0.4/`@vue/runtime-dom`/branch/v0.0.4/`@vue/server-renderer@3.5.44` | `ssr` |

Every renderer supports TypeScript (default) or JavaScript. `zeruxjs@0.0.4` is common;
only the selected renderer's direct dependencies are emitted. TypeScript is included
as build tooling even for JavaScript because the framework build/parser uses it.
TypeScript templates include Node types; React TS additionally declares matching
React types. Generated applications are private, ESM and declare Node >=24.15.0;
qualification used Node 24.15.0 and TypeScript 5.9.3. This is not all-version/vendor
compatibility. No package-manager switching or dependency installation is performed.

Only `ssr` mode is available. Unknown/unavailable renderer/template/mode selections
fail before writes; there is no silent renderer fallback. Static export, hydration,
client-only mode, RSC, streaming components, JSX/SFC compilation and automatic
browser routing are not generated. Users can install one renderer without the other
two. The generator itself depends only on zclivo, not on optional UI runtimes.

## Generated project

The project contains a private package manifest, dev/build/start/typecheck/test scripts,
explicit root config/entryPoint, server-authored render functions, public/style.css,
secret-free .env.example, .gitignore, README and a minimal source/manifest smoke test.
`src/index` is explicitly configured and registers `/branch/v0.0.4/`, `/about` and `/health` through
public framework APIs; the renderer registry owns dispatch. Complete HTML contains
ordinary links and requires no browser JavaScript. The public stylesheet is served at
its configured path and copied through the build's public asset pipeline. Production
start uses the framework build manifest, not TypeScript source guesses.

Review output, then explicitly run `npm install`, `npm run build`, `npm start`,
`npm run dev`, `npm run typecheck` or `npm test`. The CLI runs none of these, opens no
application port, starts no background service and never kills/restarts an app.
`--install` and `--run` are not supported flags. Tests below explicitly install/build
synthetic projects under temporary directories as authorized verification, not CLI
side effects on user projects.

The configured port is an integer 1–65535 and is not probed/reserved during generation.
If a later listener reports a conflict, choose another port (or edit both server.port
and server.devPort) and review the hosting layer's diagnostics. The generator never
stops the occupying process or assumes it is safe to reuse. No database/cache/auth/
CMS/queue infrastructure is configured. Public sample routes are not an authorization
policy; add tenant/session controls before serving private content.

## SSR and hydration prerequisites

Zyro renders escaped static HTML. React uses the actual adapter's
`renderReactToStaticMarkup`; such output is intentionally not hydratable, as documented
by [React](https://react.dev/reference/react-dom/server/renderToStaticMarkup).
Vue uses a fresh compiler-free SSR app and authored render functions with array
children, respecting the adapter's matching-version and request-scope contract;
see [Vue SSR](https://vuejs.org/guide/scaling-up/ssr.html).

The existing framework browser router and render-document APIs were inspected, but
a compatible client manifest/module loader, hydration-state agreement, public client
entries and browser qualification are separate prerequisites. Do not add guessed
bundle URLs or call hydrateRoot on these static React pages. Ordinary server navigation
is authoritative and works without JavaScript. No full Next.js/Nuxt parity is claimed.

## Safety and lifecycle

Planning uses zclivo's explicit capability validation and frozen bounded file maps.
Reserved/invalid names, existing targets (including dangling symlinks), unsafe parents,
traversal/colliding files and invalid ports reject. Dry-run emits planned paths/digest
without writing. Writing stages under the target parent, exclusively claims the new
target and promotes files without overwrite; failures/observed abort roll back only
owned paths. Async writes yield for cancellation. Trusted template functions are not
a sandbox; same-account hostile filesystem replacement and crash-atomic whole-tree
publication are not promised. Inspect a partial tree after a power loss rather than
using a force-overwrite flag.

Only the CLI entry owns SIGINT/SIGTERM listeners and terminal prompts. Reusable APIs
accept an explicit signal and dispose prompt resources through the shared command
registry. Cancellation returns 130, usage errors 2 and generation/dependency failures 1.
No secret or arbitrary shell input is interpolated into commands. Template names and
public imports are fixed reviewed code, not discovered packages or client strings.

## Verification

```sh
npm run build --workspace=create-zerux-js
node --test packages/create/create-zerux-app/test/*.test.mjs
```

All six renderer/language consumers were generated in temporary directories. Each
used an offline npm install of explicitly selected local package links, then ran its
actual build/typecheck/smoke scripts and production handler over an owned ephemeral
HTTP server. HTML without scripts, ordinary links, public CSS, health JSON and missing
routes were checked. This qualifies workspace-linked source contracts, **not a clean
registry install or independent dependency closure**: linked packages resolve their
existing workspace dependencies. Live browser/hydration, registry publication,
production TLS/proxy/port binding and remote services were not exercised.

A required framework loader integration fix was verified alongside these consumers:
ordinary file/node/data URL imports delegate to Node, while private custom path aliases
keep validation. No standard URL is treated as a path-registry alias. The generator
otherwise does not modify framework implementations or loosen browser boundaries.

## License

MIT OR Apache-2.0.

## Headless planning and ownership

```js
import { planZeruxApp } from 'create-zerux-js';

const plan = planZeruxApp({
  name: 'example-app',
  destination: './example-app',
  renderer: 'zyro',
  language: 'typescript',
  mode: 'ssr',
  port: 3000,
});
console.log(Object.keys(plan.files));
```

Planning validates capabilities and produces inert authored source text. Importing
`runCreateZerux` starts no prompts, process listeners or application resources.
Its optional prompt factory transfers cleanup to the shared command engine; the
executable owns only its invocation's terminal signal listeners and removes them
on exit. The example's `generate()` writes only when explicitly called and still
does not install dependencies or execute generated code.

The renderer/function/import selections are fixed reviewed code. User project
options cannot supply arbitrary import paths or shell commands. Native renderer
APIs and matching peer requirements remain owned by their adapter packages.
Consumer verification resolves explicitly named installed tooling, including
hoisted TypeScript, and leaves real applications and their ports untouched.


## Implementation sources

- [packages/create/create-zerux-app/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/create/create-zerux-app/README.md)
- [packages/create/create-zerux-app/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/create/create-zerux-app/package.json)
