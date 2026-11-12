---
{
  "title": "Sharing and metadata",
  "description": "Use native share, clipboard fallback and safe public links without surprising cancellation behavior.",
  "section": "Packages",
  "order": 31,
  "sources": [
    "packages/@zeruxjs/share/README.md",
    "packages/@zeruxjs/share/package.json",
    "packages/@zeruxjs/share/src/server.ts",
    "packages/@zeruxjs/share/src/sqlite-store.ts",
    "packages/@zeruxjs/share/examples/short-links.ts"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/share"
}
---

## User-driven sharing

```ts
import { createShareController } from '@zeruxjs/share';
const controller = createShareController({
  share: data => navigator.share(data),
  writeText: text => navigator.clipboard.writeText(text)
});
// Invoke from an explicit user gesture:
const result = await controller.share({ url: 'https://example.com/article', title: 'Article' });
```

Native share/clipboard access needs browser permissions and usually a user gesture. Unavailable/unsupported/denied native sharing can fall back to clipboard. User AbortError cancellation must not unexpectedly copy data.

## Public URLs

URLs must be credential-free HTTP(S). Do not share session tokens or private signed links accidentally. Social links use noopener/noreferrer, and the package never opens a new browser tab automatically.

## Metadata

createShareMetadata creates escaped public metadata, not a complete SEO strategy or publication workflow. Choose the canonical URL and preview image policy in the application; private content requires separate access control.

## Install and select the integration

```sh
npm install @zeruxjs/share@0.0.4
```

There is no automatic `share` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Keep native sharing behind an explicit user gesture and supply validated credential-free HTTP(S) URLs. Inject share/clipboard capabilities into a controller when testing or using a custom environment. Use the outcome to tell whether a share, copy or cancellation occurred instead of assuming every resolved call sent content to another app.

## TypeScript: inputs, results and ownership

```ts
import { createShareController } from '@zeruxjs/share';

type Inputs = Parameters<typeof createShareController>;
type Result = Awaited<ReturnType<typeof createShareController>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createShareController>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Do not copy to clipboard after a user AbortError cancellation. Native share and clipboard APIs can be unavailable or denied; present a usable manual link as fallback. Third-party share links need noopener/noreferrer, and metadata helpers must escape titles/descriptions. No configuration key automatically adds share buttons to the application.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### ShareData

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `url` | `string` | No |
| `title` | `string` | Yes |
| `text` | `string` | Yes |

### ShareEnvironment

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `share` | `(data:ShareData)=>Promise<void>` | Yes |
| `writeText` | `(text:string)=>Promise<void>` | Yes |
| `open` | `(url:string)=>void` | Yes |

### ShareCapabilities

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `native` | `boolean` | No |
| `clipboard` | `boolean` | No |

## Add persistent short links separately

The server-only `@zeruxjs/share/server` entry creates an explicit service over a
host-owned durable create-only/CAS store. It does not change browser sharing or
start a listener. The public-import example accepts host store/session-authorizer
callbacks; the host mounts the resolution handler and closes the service before
its borrowed database. No management HTTP endpoints are mounted automatically.

Default links use 144-bit random slugs, 302/no-store, bounded expiry and owner/tenant
checks. Custom slugs reserve a global public namespace atomically; expired/revoked
slugs must never be recycled. Reserved application/framework paths and destination
origin/path policy prevent local collisions and unapproved redirects. Management
requires fresh verified session permissions, revision CAS and host HTTP CSRF/rate
controls. A short URL does not authorize access at its destination.

Permanent 301/308 is explicit and permitted only for nonexpiring, uneditable,
non-revocable records with an approved cache lifetime. A cached redirect cannot be
recalled by editing storage. Temporary links remain no-store. Unknown write
acknowledgements require authorized reconciliation, not automatic retry.

Optional click collection is consent-gated and pseudonymous, emits no raw recipient
or destination, and cannot replace a valid redirect when analytics fails. Close
aborts/drains actual store/analytics work; callbacks and stores stay host-owned.
Tests exercise duplicate/CAS races through two real SQLite pins on a disposable
file, plus browser fallback and failure fixtures. Production crash recovery,
mobile share-sheet behavior and session/consent/proxy deployment are not inferred
from those checks.

The optional `@zeruxjs/share/sqlite` store borrows a native synchronous connector,
requires explicit host persistent-file qualification and initializes its table only
when requested. Create-only/CAS work uses the existing database transaction pin;
there is no independent transaction engine or implicit connector ownership.

Drain the short-link service before disconnecting its borrowed database or store.
Caller timeout or cancellation stops waiting, but does not prove a storage rollback:
unsettled native operations retain their capacity until actual completion. Optional
analytics has separate bounded work and cannot block a valid redirect on failure.
Browser sharing controllers own no listeners and need no invented teardown method.
