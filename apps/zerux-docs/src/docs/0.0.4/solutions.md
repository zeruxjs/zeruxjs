---
{
  "title": "Find a solution",
  "description": "Start with the symptom, check the right layer and verify a small fix before changing more code.",
  "section": "Getting started",
  "order": 5,
  "sources": [
    "apps/zerux-docs/src/lib/academy.mjs",
    "packages/zeruxjs/src/bootstrap/types.ts",
    "packages/zlocale/src/index.ts"
  ],
  "related": [
    "learn",
    "troubleshooting",
    "glossary",
    "handbook-help"
  ]
}
---

## Use the symptom, not a guessed package

Choose a card below or search for the error/task. Each case has a first check and a guide with the actual contract. If an error contains credentials or private data, redact it before sharing. Need individual words explained? Open [the glossary](glossary.md).

## npm says Missing script: build

**Check:** the directory you are in and its `package.json` scripts. A command such as `npm run build` invokes that directory's declared script; it does not invent one.

**Action:** in a new application, add `"build": "zerux build"` as shown in [the first-route lesson](learn-first-route.md). In this monorepo, follow the package/application README and run the intended package command. The private monorepo root is not an application package to publish.

**Verify:** `npm run` shows the intended script, the command runs in the intended directory, and the built application starts. Do not add a fake name/version to the monorepo root just to make `npm pack` accept it.

## The server runs but my route returns 404

**Check:** the actual server URL/port, file path/casing, active app directory and exported HTTP method. A file in `public` is an asset, not a file-route handler.

**Action:** reduce the endpoint to the [first route](learn-first-route.md), then compare [file conventions](file-conventions.md) and [routing](routing.md). Check whether a higher-priority config selected another app directory.

**Verify:** the exact GET URL returns the expected JSON, a nonexistent path still fails deliberately, and the compiled production route works after a build. A development response alone does not prove production file discovery.

## zerux.config.js edits have no effect

**Check:** whether `.ts`, `.mjs` or `.cjs` configuration competes, and which startup code consumes the changed key. Config files are not merged; TypeScript has priority.

**Action:** keep one active config and use the [configuration handbook](configuration-handbook.md). A custom `appLanguage` setting needs the explicit host integration in [site language settings](localization-site-settings.md); a type's open index signature does not activate a service.

**Verify:** restart/rebuild as needed and inspect the intended observable behavior without exposing raw config/secrets. Do not infer activation only because the object typechecks.

## Database/cache is undefined, degraded or cannot connect

**Check:** the documented startup key, adapter package, required environment names, network/service reachability and startup failure mode. Do not log the connection URL or credentials.

**Action:** follow [database setup](configuration-database.md) or [cache setup](configuration-cache.md). Verify the manager exists before a handler assumes success. Keep optional/degraded state visible rather than pretending a write succeeded.

**Verify:** a small authorized operation succeeds, a deliberate unavailable-service scenario fails predictably and teardown releases the owning resource. A connection test does not prove transactions or tenant isolation.

## The build passes but TypeScript reports an error

**Check:** the exact public import, installed package version and your NodeNext settings. Compilation and typechecking are separate checks.

**Action:** follow [TypeScript setup](typescript.md). Avoid importing private `src`/`dist` paths just to silence a public contract mismatch. Avoid casting unknown HTTP data to a trusted type.

**Verify:** the standalone typecheck passes and the real request still behaves correctly. If the public declaration is wrong, make a small versioned reproduction instead of deleting checking.

## Language changes leak between users or visible text stays stale

**Check:** whether requests mutate a shared locale, whether catalogs are explicitly loaded, and whether browser translation reads occur inside reactive rendering.

**Action:** use fixed/request-local translators on the server and the browser controller/adapter from [site language settings](localization-site-settings.md). Separate module domains and include required domain catalogs. Set document language/direction deliberately.

**Verify:** concurrent requests retain their own languages, a fast second browser selection wins over a slow first one, and a missing message falls back as documented. Cache keys must include locale and ownership.

## My data disappears after restart

**Check:** whether you used the tutorial's process-local Map or a real durable store.

**Action:** follow [the data lesson](learn-data.md) and choose a documented database adapter. Add authentication/ownership where records are private. A cache is not automatically a durable source of truth.

**Verify:** the authorized record survives the intended restart and is isolated from another user/tenant. Test the actual deployment topology, not only a single in-memory development process.

## My Node application does not run on static Pages hosting

**Check:** whether the build is a Node server application or an explicitly generated static export.

**Action:** use Node-capable hosting for server routes/services. This handbook has an app-specific static exporter; it is not a generic `zerux build` mode. See [deployment](deployment.md) and [the release lesson](learn-release.md).

**Verify:** the compiled server starts in the chosen host and actual routes respond. Uploaded source files are not a running Node process.

## Docs progress is missing, offline text is old, or a shortcut interferes

**Check:** browser storage/private-browsing policy, the documentation version/mount, offline status and the shortcut preference.

**Action:** open [handbook controls](handbook-help.md). Local progress is device/browser-specific, not an account. Disable single-key shortcuts if they interfere. Offline mode is optional; reconnect/update or remove the docs cache if you need fresh content.

**Verify:** a completed question remains answered after reload when storage is available, the live online page loads after an update, and ordinary links still work with JavaScript disabled. No learning points are a certification.

## Still stuck? Make it reproducible

Record versions, the command/working directory, expected and actual behavior, a sanitized error and the smallest relevant files. Use [the issue-report example](learn-release.md) and source links on the relevant guide. Explain which layer failed; never share a full environment file or credentials.
