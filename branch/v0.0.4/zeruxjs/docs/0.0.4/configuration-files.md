# File storage configuration

Set up files with exact runtime options, typed JavaScript/TypeScript examples and lifecycle policies.


## Before you configure it

Install the runtime and the packages used by this feature in the application directory. Keep the dependency lockfile committed. Configure only services the application actually uses; a public package name is not automatic service registration.

```sh
npm install zeruxjs @zeruxjs/files
```

## JavaScript application setup

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  files: {
  defaultStorage: 'private',
  stores: [{ name: 'private', type: 'local', root: './private/files',
    allowedBuckets: ['uploads'], allowedTypes: ['text/plain', 'application/pdf'],
    maxBytes: 8 * 1024 * 1024, readonly: false }],
  cache: { maxEntries: 100, ttlMs: 30000 },
},
};
```

This example is a server configuration. Supply the referenced environment values through the server process before starting it. The documentation site's static exporter does not start this service merely because it imports a config file.

## What each setting does

Framework configuration describes stores using `type: 'local'` or `type: 's3'`. The bootstrap creates drivers and passes them to the file manager. Standalone code instead passes an actual `driver` produced by `createLocalStorage` or `createS3Storage`; a `type` string is not a standalone driver.

Local `root` paths resolve relative to the application root. If omitted, the local driver uses `.zerux/files`. Keep private stores outside every configured `structure.public` directory. `maxBytes` is a byte limit; `cache.ttlMs` is milliseconds. Bucket/type allowlists belong to the store policy. A read-only store must not be used as an upload destination.

An S3 store uses `options` for region, endpoint, path-style and credential-provider settings. Use the documented credential chain or protected process environment. Do not place access keys in static output. A public URL formatter does not change a bucket ACL or grant a user permission to access a key.

## TypeScript configuration

For a TypeScript application, use `zerux.config.ts`. Validate the service object separately so errors point to its option rather than a large application object. `NonNullable` removes the optional top-level absence; it does not invent defaults or validate external data at runtime.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';

type Options = NonNullable<ZeruxConfig['files']>;
const options = {
  defaultStorage: 'private',
  stores: [{ name: 'private', type: 'local', root: './private/files',
    allowedBuckets: ['uploads'], allowedTypes: ['text/plain', 'application/pdf'],
    maxBytes: 8 * 1024 * 1024, readonly: false }],
  cache: { maxEntries: 100, ttlMs: 30000 },
} satisfies Options;
export default { files: options } satisfies ZeruxConfig;
```

In JavaScript, the JSDoc annotation provides editor assistance. In TypeScript, `satisfies` checks the shape while preserving inferred literal values. Neither changes the runtime behavior or establishes a network connection during a typecheck. See [TypeScript application development](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for strict settings and validation boundaries.

## Lifecycle and failure policy

The files service initializes before email so email attachments can address named objects. The runtime closes configured stores during generation shutdown. Application routes still authorize each upload, metadata lookup and download; a configured bucket allowlist is not an identity check.

Choose failure behavior deliberately. A storage initialization error is not reported as a successful service. Enforce upload content and byte policy before accepting untrusted files, and stream downloads where possible. For full integrity verification use the relevant driver's complete-read API rather than assuming partial ranges verify an entire object.

## Verify a real integration

1. Start the application with just this feature and its declared dependencies configured.
2. Check service readiness, then perform one operation through the application API.
3. Test a failure path such as unavailable infrastructure or a rejected input.
4. Restart the runtime and verify that owned resources close and state behaves according to the chosen storage model.
5. Repeat with the production build and the real deployment identity; a successful static docs build does not test external services.

## Declared options

The following table is captured from the source contract used by runtime bootstrap. Optional means a property may be omitted; it does not mean every combination is meaningful. Callback and nested adapter shapes must satisfy the full declared type.

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `defaultStorage` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `stores` | `Array<{ name: string; type: 'local' \| 's3'; root?: string; options?: Record<string, unknown>; allowedBuckets?: string[]; allowedTypes?: string[]; readonly?: boolean; maxBytes?: number; keyPrefix?: string }>` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `cache` | `{ maxEntries?: number; maxBytes?: number; ttlMs?: number }` | No | Passed using this declared shape; omission is allowed only when marked optional. |

## Continue with the package

- [files](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-files.md)
- [private file api](/branch/v0.0.4/zeruxjs/docs/0.0.4/private-file-api.md)
- [media](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-media.md)
- [durable email](/branch/v0.0.4/zeruxjs/docs/0.0.4/durable-email.md)


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/services.ts)
