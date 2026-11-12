---
{
  "title": "Validation and HTTP input",
  "description": "Validate request bodies and queries with bounded Fetch-compatible adapters.",
  "section": "Packages",
  "order": 11,
  "sources": [
    "packages/@zeruxjs/validator/README.md",
    "packages/@zeruxjs/validator/package.json",
    "packages/@zeruxjs/validator/src/utils/_run.ts",
    "packages/@zeruxjs/validator/src/types/runtime.ts",
    "packages/@zeruxjs/validator/src/browser.ts",
    "packages/@zeruxjs/validator/src/integrations/http.ts",
    "packages/@zeruxjs/validator/src/integrations/body.ts",
    "packages/@zeruxjs/validator/src/integrations/feedback.ts"
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
import { object, string } from '@zeruxjs/validator/schemas';
import { validatedJsonHandler } from '@zeruxjs/validator/http';
const schema = object({ name: string() });
const handler = validatedJsonHandler(schema, async body => ({ hello: body.name }));
// The host mounts this handler explicitly and awaits handler.close() on teardown.
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

There is no automatic `validator` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Define a schema at the HTTP boundary and parse unknown input before application work. Use the Fetch adapters for streamed JSON/query limits; keep Node IncomingMessage and Web Request shapes separate. Prefer validated output inference over an as cast, and use safe-parse when validation failure is an expected branch rather than a process error.

## TypeScript: inputs, results and ownership

```ts
import { parseJsonRequest } from '@zeruxjs/validator/http';

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
also preserves output inference; other legacy shorthand and `z`/`chain` methods
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

`undefinedable` permits an explicit undefined value without declaring the object
key optional. `exactOptional` delegates supplied values to the wrapped schema and
retains default metadata; its run method does not apply a default replacement.
Do not treat that metadata as evidence that an absent field will be filled.

Parsed structural containers are new, but leaves, loose extras, dates/instances,
custom/unknown values and cache outputs may share identity. Parsing is not a deep
clone and transforms can mutate their inputs.

### Collections, callbacks and measurement units

Map/Set schemas allocate new native collections but can retain borrowed child
outputs. Transformed duplicate Map keys keep the last assignment; Set values
collapse under native equality. Async collection work starts before ordered
result accumulation, so abortEarly does not prevent every child from starting.
Record input-key filtering does not revalidate trusted transformed output names.

Custom predicates assert the host-declared generic type; they do not prove that
type independently. Lazy getters select trusted child schemas per parse without
memoization or source-text evaluation. Intersection merging can mutate its first
branch result before a later conflict and has no independent cycle/depth budget or
rollback; host transforms must produce compatible finite output graphs.

Length actions measure UTF-16 code units or array-like positions. Size actions
measure Blob bytes or Map/Set element counts. These refinements are separate from
streaming HTTP admission, grapheme counts and root execution budgets. Their legacy
numeric threshold constructors do not independently validate host configuration.
Native remainder checks preserve distinct number/bigint arithmetic; bigint zero
divisors and mixed numeric kinds throw, and floating-point values are not rounded.

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


### Message and metadata ownership

Message registries use exact language keys, including a distinct `undefined` key;
they provide no locale fallback, expiry, cardinality cap or tenant isolation.
Configure trusted static messages at bootstrap. Getters return borrowed messages
without invoking them; validation may invoke message callbacks with private issue
data. Deleting a specific message leaves its constructor bucket allocated.

`getDefaults`/`getFallbacks` recursively read declared object entries and tuple
positions, not dynamic rest values. They may invoke trusted leaf factories without
an input dataset or root parse budget. Async variants start sibling factories
concurrently; rejection does not cancel independent factory work. These helpers
do not validate replacements or deep-clone their results.

`getTitle`/`getDescription` prefer the last matching metadata at the highest
pipeline level. `getMetadata` instead shallowly merges in depth-first source
order, with later keys winning. Metadata is host-owned, unvalidated and unescaped;
reading record getters may execute host code. Escape text for its eventual output
context and keep untrusted records outside this API.


### Local compatibility boundaries

Format/checksum matches do not establish mailbox/card/device ownership, JWS
signatures, digest integrity, calendar existence or destination authorization.
Native URL parsing accepts schemes the host may need to deny. Custom RegExp and
input-size policy remain explicit because native matching cannot be force-stopped
by a cooperative deadline.

Native array callback conveniences do not await callbacks; sortItems mutates its
array. Readonly/brand/flavor are type-level markers, not runtime freezing or
permissions. Function wrappers retain configuration and do not preserve a method
receiver; create them with parseAsync when their child schemas are async. Return
validation cannot roll back effects of a function that already executed.

The local JSON Schema checker is not AJV and does not run original transforms. It
ignores unsupported keywords, retains inherited-key presence/slash-path behavior
and has no independent cycle/work/deadline budget. Converter strict mode rejects
only explicitly unsupported branches; it does not certify full coverage. Use the
functional APIs for their documented own-field and root-budget behavior.

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
| duplicates:'first'/'last' | Choose literal first/last before empty handling |
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
Installed archive consumers verify public subpaths and declarations. Browser
checks trace actual imports and parse emitted executable identifiers/module
references; documentation text is not mistaken for an executed Node API. No live
browser/proxy/provider behavior is implied. No credentials are required; a real
browser and deployment-specific Fetch bridge/proxy remain integration checks.
