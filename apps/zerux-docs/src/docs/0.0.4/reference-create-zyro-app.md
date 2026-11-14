---
{"title":"create-zyro-app","description":"Safe standalone ZyroJS generators with explicit rendering modes.","section":"Packages","order":210,"package":"create-zyro-app","sources":["packages/create/create-zyro-app/README.md","packages/create/create-zyro-app/src/templates.ts"],"related":["packages","typescript","configuration-reference"]}
---

## Generate deliberately

The source implementation provides `client`, `static`, `ssr` and `hydrated` modes in JavaScript and TypeScript. Package versions are unchanged; inspect the installed release before assuming these source changes are published.

```sh
create-zyro-app demo --yes --language typescript --mode static --base-path /demo --dry-run
```

Remove dry-run to write through zclivo's exclusive staging engine. Installation and execution remain explicit: `npm install`, `npm run typecheck`, `npm test`, `npm run build`, `npm start`. Node >=24.15.0 is required. A conflicting port fails without stopping another process.

## Rendering boundaries

Client mode requires JavaScript. Static mode uses the general exporter for script-free HTML/CSS, mounted assets, canonical and real 404 output; configure production origin and host-specific missing-page handling. SSR supplies HTML only. Hydrated mode adds ZyroJS V1 whole-root hydration with validated public props; selective hydration is unavailable. The preview server is loopback-only, not a production TLS host. Dev builds once; it does not watch.

No React/Vue dependencies, server secrets or server entry points are included in the public browser graph. CSS and scripts use hashed mounted URLs. Saved configuration is public, and generated server routes do not imply authentication or authorization services.

## Headless planning

`planZyroApp` from `create-zyro-app` returns an inspectable plan without writes. `writeProjectPlanAsync` from `zclivo` performs the explicit write. Unsupported modes, invalid names/base paths and occupied targets reject. Consult the package README for the feature matrix, example and precise build/test limitations. Workspace-linked fixtures qualify generated builds and jsdom interactions, not all browser engines or clean published installation.

## Planning, build and preview ownership

```js
import { planZyroApp } from 'create-zyro-app';

const plan = planZyroApp({
  name: 'demo',
  destination: './demo',
  mode: 'static',
  language: 'javascript',
  basePath: '/demo',
  port: 3000,
});
console.log(Object.keys(plan.files));
```

Planning reads fixed authored assets as inert text. Only explicit generation writes
them, and only subsequent operator commands execute a build or start preview.
The reusable CLI creates no process listeners on import; its executable owns its
invocation's SIGINT/SIGTERM handlers. Public mount parsing delegates general
argument validation to zclivo, rejects repeated base-path options and leaves
arguments after `--` uninterpreted as creator switches.

The generated build owns an exclusive private lock, temporary candidate files and
previous-output verification. It checks manifests/hashes before replacing output;
a failed compilation does not authorize deleting an edited or unowned output tree.
The preview reads only manifest-listed bounded regular files, closes file
descriptors on failure and binds loopback. Its shutdown handlers own that preview
alone. These checks do not sandbox edited build scripts or qualify production
hosting, hostile same-account filesystem races or crash recovery.

Fixture tooling resolves the explicitly installed TypeScript package rather than
assuming npm kept a nested dependency directory. The generated browser graph and
all existing public source/fixture literals remain unchanged by that test-path fix.
