---
{
  "title": "Validation and HTTP input",
  "description": "Validate request bodies and queries with bounded Fetch-compatible adapters.",
  "section": "Packages",
  "order": 11,
  "sources": [
    "packages/@zeruxjs/validator/README.md",
    "packages/@zeruxjs/validator/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/validator"
}
---

## Define the schema once

```ts
import { object, string, validatedJsonHandler } from '@zeruxjs/validator';
const schema = object({ name: string() });
const handler = validatedJsonHandler(schema, async body => ({ hello: body.name }));
```

Schema constructors and synchronous/asynchronous parsing actions are exported from the root. Choose a schema that represents the operation's allowed input, not an entire database object with private fields.

## Framework registration

Pass the handler to registerFetchRoutes from zeruxjs/fetch-route. The bridge preserves its HTTP response contract and avoids reading a body twice. Normal Zerux route context.body is already parsed; do not pass an already-consumed Node stream to a second request parser.

## Input bounds

`readJsonBody` defaults to a 1 MiB cap and checks media type, malformed JSON and length. `parseJsonRequest` and `parseQuery` apply schemas. Configure maxBytes/maxQueryFields for the endpoint's budget. A large schema or asynchronous validation can still perform expensive work, so avoid unbounded external lookups per field.

## Errors and authorization

`HttpValidationError.toResponse()` gives bounded details and no-store headers. Do not disclose rejected secrets or complete raw inputs. Validation is not authorization: verify identity, tenant ownership and write permission before committing data.

## Install and select the integration

```sh
npm install @zeruxjs/validator@0.0.3
```

There is no automatic `validator` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Define a schema at the HTTP boundary and parse unknown input before application work. Use the Fetch adapters for streamed JSON/query limits; keep Node IncomingMessage and Web Request shapes separate. Prefer validated output inference over an as cast, and use safe-parse when validation failure is an expected branch rather than a process error.

## TypeScript: inputs, results and ownership

```ts
import { parseJsonRequest } from '@zeruxjs/validator';

type Inputs = Parameters<typeof parseJsonRequest>;
type Result = Awaited<ReturnType<typeof parseJsonRequest>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof parseJsonRequest>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

The default JSON reader is bounded to 1 MiB; use explicit byte/query-field caps for application endpoints. Invalid media type, malformed JSON, oversized content and schema issues are different failures. Avoid returning raw secrets or complete submitted values in public error details. An inferred output type does not establish authentication, authorization or database constraints.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### HttpValidationOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `maxBytes` | `number` | Yes |
| `maxQueryFields` | `number` | Yes |
| `maxQueryLength` | `number` | Yes |

### ToJsonSchemaOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `strict` | `boolean \| undefined` | Yes |

### ParseBooleanConfig

Parse boolean config interface.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `truthy` | `MaybeReadonly<unknown[]> \| undefined` | Yes |
| `falsy` | `MaybeReadonly<unknown[]> \| undefined` | Yes |

### ParseJsonConfig

Parse JSON config interface.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `reviver` | `(this: any, key: string, value: any) => any` | Yes |

### StringifyJsonConfig

Stringify JSON config interface.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `replacer` | `((this: any, key: string, value: any) => any) \| (number \| string)[]` | Yes |
| `space` | `string \| number` | Yes |

### CacheConfig

Cache config type.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `maxSize` | `number` | Yes |
| `maxAge` | `number` | Yes |

### Config

Config interface.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `lang` | `string \| undefined` | Yes |
| `message` | `ErrorMessage<TIssue> \| undefined` | Yes |
| `abortEarly` | `boolean \| undefined` | Yes |
| `abortPipeEarly` | `boolean \| undefined` | Yes |
