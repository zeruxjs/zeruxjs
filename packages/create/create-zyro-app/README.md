# create-zyro-app

Safe standalone ZyroJS project generation through the public zclivo staging engine. The package remains `create-zyro-app`; both `create-zyro` and `create-zyro-app` binaries work. Importing the package does not run the CLI.

```sh
node packages/create/create-zyro-app/dist/index.js my-app --yes --language typescript --mode hydrated --port 3000 --base-path /demo --dry-run
```

Remove `--dry-run` to create the project. Then explicitly run `npm install`, `npm run typecheck`, `npm test`, `npm run build` and `npm start` inside it. Generation never installs dependencies or executes generated code. With a published compatible release, the equivalent invocation is `npm create zyro-app -- my-app --yes`; these source changes do not publish that release.

| Mode               | Output and requirements                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client` (default) | Browser component bundle; JavaScript required for content. Node preview server included.                                                                  |
| `static`           | General `zeruxjs/static-export` pipeline; HTML, CSS, canonical and real 404, no JavaScript. Deploy the mounted directory with host-specific 404 handling. |
| `ssr`              | Standalone Node HTML server with disabled demo interaction; no hydration.                                                                                 |
| `hydrated`         | Standalone Node SSR plus ZyroJS V1 whole-root hydration and retained form edits.                                                                          |

All modes support JavaScript or TypeScript. Selective hydration, template compilation, framework routing, React and Vue templates are unavailable. Static exports never embed a server runtime. SSR/hydration use `zyrojs/server`, `/component`, `/hydrate` and `/dom` public APIs, not a claimed complete framework integration.

## Options and output

Use `--help` for shared name/destination/language/port/mode/renderer/interactive/yes/dry-run flags. `--base-path /demo` is creator-owned and defaults to `/`; it is validated and recorded in `zyro.config.json`. Interactive prompts use the same template capabilities as noninteractive flags. Existing targets, dangling symlinks, reserved names and unavailable modes fail without overwriting files. Ctrl-C cancels cooperative generation and removes staging. Only the Zyro renderer is offered.

Generated files include an authored component, public props validation, scoped stylesheet, public asset directory, build/preview scripts, configuration, smoke check, private package manifest, README and secret-free environment example. Node >=24.15.0 and the platform esbuild binary are required. `dev` builds once and starts preview; it is not a watch server. Change the configured origin from localhost before publishing canonicals. A port conflict fails visibly; another application is never stopped.

For `/demo`, content and hashed assets live below `/demo/`; static files are under `dist/demo`. The supplied preview serves a real 404 and supports HEAD. Static hosts need their own redirect/404 configuration; there is no universal SPA fallback. The preview binds loopback and is not a production TLS host.

## Build and security boundaries

The build uses the [esbuild JavaScript API](https://esbuild.github.io/api/#build), with explicit [browser versus Node platforms](https://esbuild.github.io/api/#platform). Browser bundles permit only the generated public source graph and declared ZyroJS/security entry points. Extend that reviewed allowlist deliberately when adding public modules; server files and secrets do not belong there. Builds stage candidates, hash assets and preserve a verified previous output when compilation fails. This is not a hostile-code sandbox or crash-atomic deployment system.

Client/hydrated page scopes dispose on non-bfcache pagehide. Hydration uses validated public props, native script-safe data and external scripts; normal HTML escaping is not reused for script payloads. CSP allows the generated same-origin scripts/styles. Apps must separately implement authentication, authorization, CSRF and secret management for any server functionality they add.

## Public planning API

```js
import { planZyroApp } from 'create-zyro-app';
import { writeProjectPlanAsync } from 'zclivo';
const plan = planZyroApp({name: 'demo', destination: './demo', language: 'javascript', mode: 'static', port: 3000, basePath: '/demo'});
console.log(plan.files); // inspect without writing
// await writeProjectPlanAsync(plan); // explicit write
```

See [the inert example](examples/plan.ts). The generator and `/templates` export share the same plans; no source-internal imports are needed.

## Verification and limits

Run `npm run build --workspace=create-zyro-app` and `node --experimental-strip-types --test packages/create/create-zyro-app/test/consumer.test.ts` from the repository. Fixtures install local workspace packages offline into temporary consumers, build all eight mode/language combinations twice, typecheck, serve `/demo`, exercise DOM/hydration in jsdom and clean owned servers/files. These are not clean-registry installation or real-browser acceptance. Production hosting, TLS, assistive technology and other browser engines remain unqualified.

License: MIT OR Apache-2.0.

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
