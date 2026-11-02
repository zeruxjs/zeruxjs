# Validation and HTTP input

Validate request bodies and queries with bounded Fetch-compatible adapters.


## Define the schema once

```ts
import { object, string } from '@zeruxjs/validator/schemas';
import { validatedJsonHandler } from '@zeruxjs/validator/http';
const schema = object({ name: string() });
const handler = validatedJsonHandler(schema, async body => ({ hello: body.name }));
```

Schema constructors and synchronous/asynchronous parsing actions are exported from `/schemas` and `/browser`; the root remains compatible. `/browser` also provides explicit DOM feedback and excludes request parsing. Choose a schema that represents the operation's allowed input, not an entire database object with private fields.

## Framework registration

Pass the handler to registerFetchRoutes from zeruxjs/fetch-route. The bridge preserves its HTTP response contract and avoids reading a body twice. Normal Zerux route context.body is already parsed; do not pass an already-consumed Node stream to a second request parser.

## Input bounds

`readJsonBody` defaults to a 1 MiB cap and a 3000 ms absolute body deadline. It checks media type, UTF-8, malformed JSON and actual/declarative length. Shared adapters default to 32 reader slots. `parseJsonRequest` and `parseQuery` apply schemas. Configure maxBytes/maxQueryFields for the endpoint's budget. Schema execution has per-parse depth, work, collection, issue and async-refinement limits. Trusted callbacks still own deadlines and any tasks they start internally.

## Errors and authorization

`HttpValidationError.toResponse()` gives bounded details and no-store headers. Do not disclose rejected secrets or complete raw inputs. Validation is not authorization: verify identity, tenant ownership and write permission before committing data.

## Install and select the integration

```sh
npm install @zeruxjs/validator@0.0.4
```

There is no automatic `validator` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Define a schema at the HTTP boundary and parse unknown input before application work. Use the Fetch adapters for streamed JSON/query limits; keep Node IncomingMessage and Web Request shapes separate. Prefer validated output inference over an as cast, and use safe-parse when validation failure is an expected branch rather than a process error.

## TypeScript: inputs, results and ownership

```ts
import { parseJsonRequest } from '@zeruxjs/validator/http';

type Inputs = Parameters<typeof parseJsonRequest>;
type Result = Awaited<ReturnType<typeof parseJsonRequest>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof parseJsonRequest>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

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
| `maxFields` | `number` | Yes |
| `maxFieldBytes` | `number` | Yes |
| `bodyTimeoutMs` | `number` | Yes |
| `maxConcurrentReads` | `number` | Yes |
| `signal` | `AbortSignal` | Yes |
| `validation` | `Omit<Config<BaseIssue<unknown>>, "signal">` | Yes |

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


## Functional inference and explicit compatibility

```ts
import { object, string, number, optional, pipe, trim, transform, safeParse,
  type InferInput, type InferOutput } from '@zeruxjs/validator';
const schema = object({
  length: pipe(string(), trim(), transform(value => value.length)),
  count: optional(number(), 1)
});
type Input = InferInput<typeof schema>;
type Output = InferOutput<typeof schema>;
const result = safeParse(schema, { length: ' Ada ' }, { maxIssues: 20 });
if (result.success) console.log(result.output); // {length:3,count:1}
```

Functional pipes preserve separate input/output types through objects, arrays and
unions. Public types live in validator. Zero-argument constructor action shorthand
also preserves output inference; other legacy shorthand and `z`/branch/v0.0.4/`chain` methods
can retain broad types. Use functional composition for precise inference.

| Surface | Implemented contract |
| --- | --- |
| Functional schemas/actions/parsers | Existing named schema subset, typed pipelines and sync/async parses |
| Object keys | object strips; looseObject preserves safe extra keys; strictObject rejects; objectWithRest validates extras |
| `z` / `chain` | Limited convenience API, not full Zod compatibility |
| Valibot-style names / Standard Schema | Existing subset/adapter, not full Valibot conformance |
| JSON Schema / ajvSafeParse | Limited local conversion/checking; not the AJV engine or full JSON Schema |

Object schemas reject arrays, read declared fields only from own properties and
reject unsafe schema keys. Class instances remain eligible by their own fields.
Missing optional fields stay absent unless defaulted; explicit undefined remains
present. optional accepts undefined, nullable accepts null, nullish accepts both.
A default factory runs once for a missing field, before wrapped validation and
transforms. Defaults are validated; a sentinel returned again short-circuits.
Pipelines execute left to right. Refinements see earlier transforms; transforms
stop after issues, while further typed refinements can collect errors unless
abort flags stop them. Callback exceptions propagate. Unions try branches in order
and return the first successful output, or structured branch issues on failure.
Keep callbacks side-effect-free because failed union branches may run first.

Parsed structural containers are new, but leaves, loose extras, dates/instances,
custom/unknown values and cache outputs may share identity. Parsing is not a deep
clone and transforms can mutate their inputs.

## Parse budgets, cancellation and private notifications

| Root parse option | Default | Maximum |
| --- | --- | --- |
| maxDepth | 64 | 128 |
| maxNodes | 10000 | 100000 |
| maxCollectionSize | 1000 | 10000 |
| maxIssues | 100 | 1000 |
| maxConcurrency | 8 | 32 |

Limits are positive integers. Depth covers input nesting and schema/action
nesting (wrappers count); work bounds input scan nodes and schema/callback steps
separately. Collection limits cover arrays, maps, sets, object own keys and object
schema fields before unknown-key removal. Strings use maxLength/HTTP byte limits.
An iterative scan rejects cycles and enumerable accessors, even below unknown/any.
Issue counts include speculative union branches. Exhaustion throws
ValidationLimitError with code/limit even for safeParse; partial success is never
returned. These bounds do not sandbox trusted callbacks, returned functions or
schema-conversion tools. Async default/lazy factories own their resource budgets.

abortEarly collects the first container failure and abortPipeEarly controls pipe
collection. Async siblings can already be running; fail-fast output does not undo
started callbacks. Built-in issues add code (`kind.type`) and retain full paths
and nested union issues. Raw issue input/messages are private application data.
HTTP adapters return generic messages/codes/bounded paths, map budget exhaustion
to 413 and propagate operational errors. JSON validation observes Request.signal.
Validation remains separate from authentication, tenant ownership and consent.

```ts
import { string, pipeAsync, checkAsync, safeParseAsync } from '@zeruxjs/validator';
const schema = pipeAsync(string(), checkAsync(async (value, {signal}) => {
  signal?.throwIfAborted();
  return value.length > 0;
}));
await safeParseAsync(schema, 'Ada', {
  maxConcurrency: 2,
  onError: event => console.log(event.failure, event.issues)
});
```

checkAsync, partialCheckAsync, customAsync and transformAsync receive context.signal
as their second callback argument; checkItemsAsync receives context fourth. Raw
async actions have config.signal. Nested async schemas/actions reject during sync
parse before invocation. Native async functions misused as sync checks/transforms,
defaults or raw callbacks also reject; thenables returned by other sync callbacks
are rejected/observed after the callback returns.

Concurrency bounds built-in async refinement/transform callbacks per parse,
including checkItemsAsync's inner callbacks. Cancellation rejects with AbortError
and preserves the external reason in cause. Failure/cancellation stops queued
work, drains started work and removes its root listener. Validators must cooperate
and settle: no wall-clock timeout can force arbitrary JavaScript to stop. No
background task or external service starts on import.

Hooks are synchronous and parse-local. They receive only success/failure class,
codes and redacted paths (only array indexes are retained), never submitted values,
output, custom messages or exception text. Hook exceptions/thenables produce
ValidationHookError after cleanup; failed success hooks do not invoke error hooks.
Invalid configuration rejects before hook notification. Legacy global language,
abort flags and message registries remain; hooks/signals are never retained in
global config. Root execution controls reject in config(schema,...). Explicit
signal/limit overrides bypass caches; default cache behavior is preserved.

The package-local checks compile the public-import example/inference against a
real offline npm-installed archive and exercise nested paths, unions, defaults,
limits, async misuse, concurrency, dependency failures, hook exceptions and cleanup.
Installed shared tooling/TypeScript are required. There are no live-service
prerequisites, and no live-provider/browser behavior is claimed.


## Browser schemas and app-owned HTTP adapters

The `/schemas` entry exposes the pure API without HTTP request parsing. `/browser`
adds createFormFeedback and DOM types. `/http` exposes Fetch adapters; the root
retains compatibility exports. Browser imports start no validation, listeners or
server processes and do not depend on Node globals. Use the browser DOM library
for `/browser` declarations; these APIs do not consume Node IncomingMessage.

```ts
import { strictObject, string } from '@zeruxjs/validator/schemas';
import { createHttpInputAdapter } from '@zeruxjs/validator/http';
const input = createHttpInputAdapter({
  maxBytes: 65536, bodyTimeoutMs: 3000, maxConcurrentReads: 8,
  duplicates: 'reject'
});
try {
  const value = await input.parseQuery(
    strictObject({ name: string() }), 'https://example.test/?name=Ada'
  );
  console.log(value.name);
} finally { await input.close(); }
```

Reuse one adapter per deliberate application owner to share body reader slots.
Standalone helper calls each own a scope and cannot share concurrency limits.
validatedJsonHandler owns a shared adapter and adds handler.close() for shutdown.
close is idempotent, prevents new operations, aborts owned work and awaits cleanup.
Schema/provider exceptions propagate; cancellation of noncooperative validation
can still delay close. Do not share tenant/user-specific mutable callback state.

| HTTP budget | Default | Allowed range |
| --- | --- | --- |
| maxBytes | 1 MiB | 1 byte–16 MiB |
| bodyTimeoutMs | 3000 ms | 10–60000 ms |
| maxConcurrentReads | 32 | 1–1024 |
| maxFields | 200 | 1–1000 |
| maxQueryFields | maxFields | 1–1000 |
| maxQueryLength | 16384 characters | 1–1048576 |
| maxFieldBytes | 16384 UTF-8 bytes | 1–1048576 |

All budgets are positive safe integers. JSON key inspection additionally caps
10000 nodes. validation supplies existing parse controls/hooks, excluding signal;
Request.signal and adapter signal both propagate. Body deadlines do not reset
with trickled bytes. They cover the read and asynchronous decoding, not arbitrary
schema/application work. Synchronous parsers cannot be preempted; byte caps bound
their input. Bytes are counted before decoding, and Content-Length must match.
On owned failures the reader is cancelled and its lock, slot, timer and listener
released. Cancellation rejection remains in the internal cause; an uncooperative
stream cancel promise does not hold a slot indefinitely. A body locked by another
consumer is rejected without stealing that lock.

JSON accepts application/json and application/*+json. Forms accept URL-encoded or
multipart/form-data with a valid boundary; UTF-8 is required and compressed input
is rejected. Multipart uses the runtime's Fetch parser after the bounded read;
field caps apply after native decoding, not as a streaming multipart parser.
File fields reject unless files:'preserve' is explicit, then bounded File objects
are passed to schemas without reading contents for callbacks or storing uploads.
Host upload policies remain separate. See the [Fetch Standard](https://fetch.spec.whatwg.org/)
and [Streams Standard](https://streams.spec.whatwg.org/) for platform contracts.

## Query, header and form field policies

parseQuery, parseHeaders, parseFormData and parseFormRequest collect fields into
null-prototype dictionaries before schema validation. Missing fields stay absent.
object strips unknown keys, strictObject rejects them, looseObject preserves safe
keys and objectWithRest validates them. Reserved prototype names, including
reserved dot/bracket segments, reject before stripping. Keys are literal and no
nested expansion occurs. Names are nonempty, control-free, at most 256 characters;
headers also require token syntax and names are lowercased.

| Field option | Contract |
| --- | --- |
| duplicates:'array' (default) | Singletons scalar, repeated names arrays |
| duplicates:'reject' | Reject any repeat, including empty values |
| duplicates:'first'/branch/v0.0.4/'last' | Choose literal first/last before empty handling |
| empty:'preserve' (default) | Keep empty strings |
| empty:'omit' | Remove selected empties; all removed means absent/default-eligible |
| coerce:{name:'number'} | Strict finite JSON-number spelling; no blanks, hex, Infinity or NaN |
| coerce:{name:'boolean'} | Exact lowercase true/false |
| coerce:{name:'string'} | Keep strings; do not stringify files |
| files:'reject' (default)/'preserve' | Explicit bounded File acceptance |

Selected repeated values coerce individually. Arrays stay arrays after empty
filtering. Coercion does not create absent fields and no schema-based coercion or
singleton-to-array guessing occurs. JSON keeps its native types. URL percent
decoding follows URLSearchParams. Total name/value UTF-8 bytes plus preserved File
sizes must fit maxBytes, including already-decoded inputs. Header coercion rules
use lowercase names. Native Headers may have already merged duplicate wire values;
commas are not split, and lost duplicates cannot be reconstructed. Supply original
pairs when exact duplicate detection is required.

## Safe errors and explicit accessible feedback

Client statuses are 400 for malformed/disconnected input, 408 deadline, 413 budgets,
415 media type, 422 schema rejection and 429 reader capacity. HttpValidationError
retains internal message/cause, but toResponse emits fixed generic messages,
no-store headers and at most 20 sanitized issues. Only declared schema field names
and numeric indexes remain in paths; dynamic record/map keys are redacted. Custom
messages, passwords, file contents and error causes are never serialized. Never
serialize the Error object yourself. Operational provider/schema errors remain
exceptions rather than false validation success.

```ts
import { createFormFeedback } from '@zeruxjs/validator/browser';
const fields = new Map([['name', {control: nameInput, description: nameError}]]);
const feedback = createFormFeedback({ resolveField: path => fields.get(path) });
feedback.update([{path:'name',code:'schema.string',message:'Invalid input'}]);
// Clear on success; destroy on host component/page teardown:
feedback.destroy();
```

nameInput/nameError are host-supplied elements; the description must have a stable
whitespace-free ID. Feedback sets aria-invalid, merges aria-describedby and writes
generic textContent. It never reads input values or files. Optional synchronous
onIssue receives only a sanitized code. Thrown errors/thenables roll back changes
and propagate. clear/destroy restore prior attributes/text; destroy is idempotent.
The host owns summaries, focus, announcements, submission and unresolved/root
errors. No user-controlled selector interpolation or frontend framework is added.

Focused checks cover Node Fetch streams, reader cleanup, slow/trickled/oversized/
disconnected bodies, duplicate/coercion/prototype policies, sanitized causes,
multipart/file handling, a DOM feedback fixture and browser bundle dependencies.
Installed archive consumers verify public subpaths and declarations. No live
browser/proxy/provider behavior is implied. No credentials are required; a real
browser and deployment-specific Fetch bridge/proxy remain integration checks.


## Public entry points

Manifest reference for `@zeruxjs/validator@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./http": {
      "types": "./dist/integrations/http.d.ts",
      "import": "./dist/integrations/http.js"
    },
    "./browser": {
      "types": "./dist/browser.d.ts",
      "import": "./dist/browser.js"
    },
    "./schemas": {
      "types": "./dist/core.d.ts",
      "import": "./dist/core.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/validator

Schema validation and transformation utilities with synchronous and asynchronous parsers. The library exports its schema constructors and validation actions from the package root.

## Fetch-compatible HTTP adapter

```ts
import { object, string } from '@zeruxjs/validator/schemas';
import { validatedJsonHandler } from '@zeruxjs/validator/http';
const schema = object({ name: string() });
const handler = validatedJsonHandler(schema, async (body) => ({ hello: body.name }));
const response = await handler(new Request('https://example.test/api', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({name:'Maya'}) }));
```

`readJsonBody` streams up to 1 MiB by default, rejecting invalid media types, malformed JSON and oversized payloads; `parseJsonRequest` and `parseQuery` validate with both synchronous and asynchronous schemas. `HttpValidationError.toResponse()` emits bounded error details and `Cache-Control: no-store`. Do not disclose raw input in external API errors. Use `maxBytes`/branch/v0.0.4/`maxQueryFields` to set explicit caps. Body reads also have an absolute deadline and app-owned concurrency limit (below). This adapter works with the Web Fetch `Request` API and can be used by ZeruxJS route handlers or other framework integrations.

## Functional schemas and inference

```ts
import { object, optional, string, number, pipe, trim, transform, safeParse,
  type InferInput, type InferOutput } from '@zeruxjs/validator';

const schema = object({
  length: pipe(string(), trim(), transform(value => value.length)),
  count: optional(number(), 1)
});
type Input = InferInput<typeof schema>;   // length: string; count?: number
type Output = InferOutput<typeof schema>; // length: number; count: number
const result = safeParse(schema, { length: ' Ada ' }, { maxIssues: 20 });
if (result.success) console.log(result.output); // {length:3, count:1}
```

Use `pipe`/branch/v0.0.4/`pipeAsync` for precise input/output inference through transforms,
objects, arrays and unions. Zero-argument constructor action shorthand, such as
`string([transform((value:string) => value.length)])`, also preserves output
inference. Some legacy argument-taking shorthand and `z`/branch/v0.0.4/`chain` methods retain
broad types; use functional composition when correctness depends on inference.
Public types remain owned by this package, not by `@zeruxjs/typescript`.

## Object, union and default contracts

| Schema | Unknown own keys |
| --- | --- |
| `object` / `objectAsync` | Removed |
| `looseObject` / async equivalent | Preserved, except unsafe prototype keys |
| `strictObject` / async equivalent | Rejected |
| `objectWithRest` / async equivalent | Validated with the rest schema |

Object schemas require a non-null object that is not an array. Declared fields
read only own properties; inherited values cannot satisfy required fields. Unsafe
schema keys (`__proto__`, `constructor`, `prototype`) reject. Collection limits
apply before key stripping, including unknown keys. Non-array class instances can
still be accepted by their own fields; this is not a plain-record guarantee.

`optional` accepts undefined, `nullable` accepts null, and `nullish` accepts both.
A default replaces the wrapper's matching sentinel before the wrapped schema
runs. Missing optional fields without defaults stay absent; explicitly supplied
undefined stays an own property. A missing field's default factory runs once.
Defaults are validated/transformed by the wrapped schema. For async defaults use
the async wrapper and async parse. A default that returns the sentinel again
short-circuits to that sentinel instead of repeatedly invoking the factory.

Pipelines run left to right: wrapper defaults, wrapped schema, then actions in
listed order. A transform before a refinement changes the value that refinement
sees. A transform after any issue does not execute. Further refinements can collect
issues while the dataset remains typed, unless `abortEarly`/branch/v0.0.4/`abortPipeEarly` stop
them. Callback exceptions are operational failures and propagate, rather than
becoming an ordinary validation rejection or being replaced by fallback values.

Unions try branches in order and return the first issue-free output. If only one
branch has a typed-but-invalid result, its issues are returned; otherwise the
union issue contains nested branch issues. Failed branches may execute callbacks
before a later branch succeeds; keep refinements side-effect-free.

Objects/arrays/tuples and mapped collections create new structural containers.
This is **not a deep clone**: unknown/custom leaves, loose extra values, dates,
instances and cached outputs may preserve identity. Transforms can return/mutate
application-owned values. Do not rely on parsing to isolate mutable private data.

## Bounded execution and issues

`parse`, `safeParse`, their async/parser variants, `is`, `assert` and Standard
Schema validation use per-call execution state. Internal `~run` methods are not a
public safety boundary. Limits are positive integers within these hard ceilings:

| Parse option | Default | Maximum | Bound |
| --- | --- | --- | --- |
| `maxDepth` | 64 | 128 | Input nesting and nested schema/action dispatch (wrappers also count) |
| `maxNodes` | 10000 | 100000 | Input scan nodes and, separately, schema/action/callback steps |
| `maxCollectionSize` | 1000 | 10000 | Array length, map/set size, own object keys and object schema fields |
| `maxIssues` | 100 | 1000 | Issues generated/reused across actions and attempted union branches |
| `maxConcurrency` | 8 | 32 | Active built-in async refinement/transform callbacks per parse |

The iterative input scan rejects cycles and enumerable accessors without invoking
them, including beneath `unknown`/branch/v0.0.4/`any`. Strings are scalar; use `maxLength` and
HTTP byte caps for their size. Bounds do not sandbox trusted callback code,
computed getters in custom schemas, returned functions or schema-conversion tools.
Async default/lazy factories must manage their own work; the refinement limiter
does not serialize container schemas or application-created inner tasks.

Exhaustion throws `ValidationLimitError` with a safe `code` and `limit`, even from
safe-parse APIs; it never returns a successful partial result. `maxIssues` counts
speculative union work, so an expensive union may exhaust it before a later
branch could pass. `abortEarly:true` collects the first encountered failure within
containers; `abortPipeEarly` controls pipelines. Async siblings may already be
running when issues are collected; fail-fast output cannot undo started work.
Use the execution limits to bound that work.

Built-in issues retain `kind`, `type`, `path`, nested `issues`, and add the stable
`code: '<kind>.<type>'`. The code is optional on custom issue producers for
compatibility. Raw issues still contain rejected values and custom messages:
keep them server-side. `formatIssues` builds a prototype-safe tree; `_errors` is
reserved. HTTP adapters emit generic messages, codes and bounded paths, map budget
exhaustion to 413, and propagate operational exceptions/validation cancellation. Body disconnects return 400. JSON request
validation observes the Request signal. Validation never grants authorization.

## Async validation, hooks and cleanup

```ts
import { string, pipeAsync, checkAsync, safeParseAsync } from '@zeruxjs/validator';

const schema = pipeAsync(string(), checkAsync(async (value, {signal}) => {
  signal?.throwIfAborted();
  return value.length > 0; // cooperative external validators receive the same signal
}));
const result = await safeParseAsync(schema, 'Ada', {
  maxConcurrency: 2,
  onError: event => console.log(event.failure, event.issues)
});
```

`checkAsync`, `partialCheckAsync`, `customAsync` and `transformAsync` receive a
second context argument with `signal`. `checkItemsAsync` receives it as its fourth
argument. Raw async actions receive it through `context.config.signal`. Async
schemas/actions are rejected by sync parsers with `AsyncValidationError` before
invocation, even when nested inside a sync container. Native async functions
misused as sync checks/transforms/defaults/raw callbacks also reject before
invocation. Thenables returned by an otherwise synchronous callback are rejected
and observed to prevent unhandled rejections; code that ran before returning a
thenable cannot be undone.

Cancellation rejects with `name:'AbortError'`; external cancellation reasons remain
in `cause`. On cancellation or operational failure, queued work is prevented from
starting and the parse drains already-started callbacks, then removes its root
abort listener. Cooperative callbacks must observe their signal and settle; a
callback that never settles can delay cleanup indefinitely. No timer/deadline,
network retry or background validator starts automatically. Limits/concurrency
are per parse, not process-wide or distributed quotas.

`onSuccess`/branch/v0.0.4/`onError` are synchronous, per-parse notifications. Events contain only
success/failure class, issue codes and redacted paths (array indexes remain;
field/key segments become `<field>`). They never include submitted values,
custom messages, output, or exception text. Hook exceptions and returned thenables
throw `ValidationHookError`; cleanup has completed before notification. A success
hook failure does not invoke the error hook. Do not send raw exception causes to
clients. Invalid configuration rejects before execution and is not a hook event.

New execution controls belong on the root parse call. `config(schema, ...)`
continues to configure legacy language/message/abort flags and rejects execution
controls. Legacy process-wide message registries remain for compatibility; do not
use them for request/tenant-specific handlers. Global config never retains hooks
or signals. Explicit signals or limit overrides bypass schema caches so controlled
work cannot reuse a computation owned by another parse. Cached issues consume the receiving parse's issue budget. Default cache semantics
(including output identity and stale mutable inputs) remain unchanged.

## Compatibility and verification

| Surface | Compatibility goal |
| --- | --- |
| Functional schemas/actions/parsers | Preserve existing named contracts; precise functional inference |
| Constructor action shorthand | Runtime convenience; typed zero-argument shorthand, broader legacy argument-taking forms |
| `z` / `chain` | Limited convenience API with broad types; not Zod parity |
| JSON Schema / `ajvSafeParse` helpers | Existing limited local conversion/checking subset; not the AJV engine or full JSON Schema |
| Valibot-style names / Standard Schema adapter | Existing named subset; no full Valibot conformance claim |

After changing source, run `npm run build`, then `node --test test/*.test.mjs` in
this package. The foundation suite checks normal/denied inputs, inference against
an offline npm-installed archive using the shared TypeScript tooling, unions,
default order, limits, async misuse, dependency failures, hook exceptions and
cancellation cleanup. It does not exercise a live provider or browser. Installed
TypeScript/shared tooling are required; there are no live-service prerequisites.

## Browser and HTTP entry points

| Public import | Contents |
| --- | --- |
| `@zeruxjs/validator/schemas` | Schemas, actions, parsers and existing utilities; no request-parsing dependency |
| `@zeruxjs/validator/browser` | Same pure API plus explicit DOM feedback; no HTTP reader, Node imports or Node globals |
| `@zeruxjs/validator/http` | Fetch JSON/query/header/form adapters and client-safe error types |
| `@zeruxjs/validator` | Compatibility barrel retaining previous root exports |

The browser entry can be imported before a DOM exists. Browser-only functions
access supplied elements only when called. HTTP adapters use Fetch/Web Streams,
not Node IncomingMessage; selecting `/http` does not start a server. Schemas and
client types remain validator-owned. Browser declarations require DOM libraries.

```ts
import { strictObject, string } from '@zeruxjs/validator/schemas';
import { createHttpInputAdapter } from '@zeruxjs/validator/http';

const schema = strictObject({ name: string() });
const input = createHttpInputAdapter({
  maxBytes: 64 * 1024, bodyTimeoutMs: 3000, maxConcurrentReads: 8,
  duplicates: 'reject'
});
try {
  const value = await input.parseQuery(schema, 'https://example.test/?name=Ada');
  console.log(value.name);
} finally { await input.close(); }
```

Create one adapter per application or other deliberate owner to share reader slots.
Methods are `readJsonBody`, `parseJsonRequest`, `parseQuery`, `parseHeaders`,
`parseFormData` and `parseFormRequest`. Standalone exports create a scope per call;
they cannot cap concurrency across separate calls. `validatedJsonHandler` owns a
shared adapter and exposes `handler.close()` for shutdown. Closing is idempotent,
rejects new calls, aborts owned operations and waits for cleanup. It does not
publish/register routes or perform authorization/CSRF checks.

### HTTP budgets and failures

| Option | Default | Allowed range |
| --- | --- | --- |
| `maxBytes` | 1 MiB | 1 byte–16 MiB |
| `bodyTimeoutMs` | 3000 ms | 10–60000 ms |
| `maxConcurrentReads` | 32 | 1–1024 |
| `maxFields` | 200 | 1–1000 |
| `maxQueryFields` | maxFields | 1–1000 |
| `maxQueryLength` | 16384 characters | 1–1048576 |
| `maxFieldBytes` | 16384 UTF-8 bytes | 1–1048576 |

Budgets are positive safe integers. Byte limits count actual streamed bytes before
JSON/form decoding and compare Content-Length to the final length. Field budgets
also bound already-created FormData/header/query input: total name/value UTF-8
bytes plus preserved File sizes must fit maxBytes. JSON key inspection has a 10000
node cap before schema validation. `validation` supplies the existing schema parse
options/limits/hooks, excluding signal. `signal` on the adapter and Request.signal
both cancel that operation; neither overrides the other.

JSON requires application/json or application/*+json. Form requests require
application/x-www-form-urlencoded or multipart/form-data with a valid boundary.
UTF-8 is required; content encoding other than identity rejects with 415. FormData
objects and Headers/pair iterables are already decoded and have no content-type
header to validate. Multipart decoding uses the runtime's Fetch parser after the
bounded read; field limits are checked after native decoding, not by a streaming
multipart parser. File fields default to rejected. `{files:'preserve'}` permits
bounded File objects for schemas to validate; no file bytes or filenames are sent
to issue callbacks or automatically written to storage. Upload authorization,
media inspection and storage remain application responsibilities.

The body deadline is absolute, includes async decoding, and is not extended by
trickled chunks. It covers body consumption, not arbitrary schema refinements or
the application handler. Synchronous JSON/native parser work cannot be preempted
by a timer; the byte cap bounds its input. Reader-capacity exhaustion returns 429
without consuming the rejected body. Every owned failure path initiates reader
cancellation and releases its lock, timer, listener and slot. Cancellation callback
rejections remain in the internal cause; an uncooperative cancellation promise
cannot keep a reader slot occupied. A reader already locked by someone else is
rejected without stealing its lock. Underlying stream producers still must honor
the Streams cancellation contract.

Body disconnect/read failures return 400; deadline 408; size/work budgets 413;
media type 415; schema issues 422; reader capacity 429. Operational schema/provider
exceptions still propagate; validation cancellation remains AbortError. Error
responses use fixed generic messages and at most 20 client issues, with no-store
headers. `HttpValidationError.message` and `.cause` retain internal diagnostics,
including raw schema issues; `toResponse()` never serializes them. Client paths
retain only schema-declared fields and numeric array indexes; dynamic record/map
keys are redacted. Custom messages and raw passwords/file contents are excluded.
Never serialize the Error/cause object yourself.

### Field duplicates, absence and coercion

Query, header and form adapters share the same policies. They collect a
null-prototype dictionary and then apply the schema's strip/strict/loose/rest
unknown-key policy. Keys are literal, with no dot/bracket expansion. Reserved
prototype names, including reserved dot/bracket segments, reject with 400 before
schema stripping. Names must be nonempty, at most 256 characters, and contain no
controls; headers additionally require token syntax and are lowercased.

| Policy | Behavior |
| --- | --- |
| `duplicates:'array'` (default) | One occurrence is scalar; repeated occurrences are arrays |
| `duplicates:'reject'` | Any repeated name rejects, including repeats containing empty values |
| `duplicates:'first'` / `'last'` | Select the literal first/last occurrence before empty handling |
| `empty:'preserve'` (default) | Empty strings stay empty; absent fields stay absent |
| `empty:'omit'` | Remove selected empty strings; if all disappear, the field is absent and schema defaults may run |
| `coerce:{field:'number'}` | Strict finite JSON-number syntax only; no whitespace, hex, NaN, Infinity or empty conversion |
| `coerce:{field:'boolean'}` | Exact lowercase true/false only |
| `coerce:{field:'string'}` | Preserve strings; do not stringify files |

Only named fields coerce, and repeated selected values coerce individually. No
field is created just because it has a coercion rule. Repeated arrays remain
arrays after empty filtering; one surviving occurrence is not silently scalarized.
There is no schema-driven guesswork or automatic singleton-to-array conversion.
JSON retains native JSON types and does not use these string-field coercions.
URL percent decoding follows URLSearchParams. Use lower-case coercion names for
headers. Native Headers has already merged some wire duplicates into comma-joined
strings; adapters neither split commas nor promise recovery of lost wire fields.
Use raw header pairs when duplicate detection requires original occurrences.

### Form feedback without a frontend framework

```ts
import { createFormFeedback } from '@zeruxjs/validator/browser';
const fields = new Map([
  ['name', { control: nameInput, description: nameError }]
]); // application-supplied DOM elements; nameError must have a stable id
const feedback = createFormFeedback({
  resolveField: path => fields.get(path),
  onIssue: ({code}) => console.log(code)
});
feedback.update([{path:'name',code:'schema.string',message:'Invalid input'}]);
// On successful validation: feedback.clear(). On teardown:
feedback.destroy();
```

The host explicitly resolves known paths, renders any summary/root errors and owns
submission, focus and announcements. No selectors are interpolated from inputs.
Feedback sets aria-invalid, merges a stable description ID into aria-describedby
and writes generic text with textContent. It never reads an input value or file.
Notifications contain only a sanitized code; custom message text is ignored.
Callbacks are synchronous; thrown errors/thenables roll back owned changes and
propagate. clear/destroy restore prior ARIA attributes and description text;
destroy is idempotent. Do not assign another owner to these same attributes while
feedback is active. No framework, DOM listener or background validation starts on
import.

The HTTP-input suite additionally checks slow/trickled/disconnected streams,
reader overload/cleanup, duplicate/coercion/prototype policies, multipart/file
handling, sanitized responses and feedback rollback using a DOM fixture. Its
browser bundle check confirms the dependency graph excludes request parsers and
Node globals. Installed archive checks cover the new public subpaths. These are
Node Fetch/stream and DOM-fixture checks, not live-browser or deployed proxy tests.
There are no credentials/live-service prerequisites; a real browser and a host's
actual Fetch bridge/proxy are separate integration checks.


## Implementation sources

- [packages/@zeruxjs/validator/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/validator/README.md)
- [packages/@zeruxjs/validator/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/validator/package.json)
- [packages/@zeruxjs/validator/src/utils/_run.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/validator/src/utils/_run.ts)
- [packages/@zeruxjs/validator/src/types/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/validator/src/types/runtime.ts)
- [packages/@zeruxjs/validator/src/browser.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/validator/src/browser.ts)
- [packages/@zeruxjs/validator/src/integrations/http.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/validator/src/integrations/http.ts)
- [packages/@zeruxjs/validator/src/integrations/body.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/validator/src/integrations/body.ts)
- [packages/@zeruxjs/validator/src/integrations/feedback.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/validator/src/integrations/feedback.ts)
