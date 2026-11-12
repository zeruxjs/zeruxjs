---
{
  "title": "create-zerux-js",
  "description": "Safe SSR project generation for the verified ZeruxJS renderer contracts.",
  "section": "Packages",
  "order": 210,
  "package": "create-zerux-js",
  "sources": [
    "packages/create/create-zerux-app/README.md",
    "packages/create/create-zerux-app/package.json"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

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
