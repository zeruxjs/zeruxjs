# @zeruxjs/validator

Schema validation and transformation utilities with synchronous and asynchronous parsers. The library exports its schema constructors and validation actions from the package root.

## Fetch-compatible HTTP adapter

```ts
import { object, string } from '@zeruxjs/validator/schemas';
import { validatedJsonHandler } from '@zeruxjs/validator/http';
const schema = object({ name: string() });
const handler = validatedJsonHandler(schema, async (body) => ({ hello: body.name }));
try {
  const response = await handler(new Request('https://example.test/api', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Maya' })
  }));
  console.log(await response.json());
} finally {
  await handler.close();
}
```

`readJsonBody` streams up to 1 MiB by default, rejecting invalid media types, malformed JSON and oversized payloads; `parseJsonRequest` and `parseQuery` validate with both synchronous and asynchronous schemas. `HttpValidationError.toResponse()` emits bounded error details and `Cache-Control: no-store`. Do not disclose raw input in external API errors. Use `maxBytes`/`maxQueryFields` to set explicit caps. Body reads also have an absolute deadline and app-owned concurrency limit (below). This adapter works with the Web Fetch `Request` API and can be used by ZeruxJS route handlers or other framework integrations.

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

Use `pipe`/`pipeAsync` for precise input/output inference through transforms,
objects, arrays and unions. Zero-argument constructor action shorthand, such as
`string([transform((value:string) => value.length)])`, also preserves output
inference. Some legacy argument-taking shorthand and `z`/`chain` methods retain
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
schema keys (`__proto__`, `constructor`, `prototype`) are explicitly rejected by
the synchronous object implementations. Async schema dictionaries remain trusted
host configuration; the root input scan separately guards unsafe candidate keys. Collection limits
apply before key stripping, including unknown keys. Non-array class instances can
still be accepted by their own fields; this is not a plain-record guarantee.

`optional` accepts undefined, `nullable` accepts null, and `nullish` accepts both.
A default replaces the wrapper's matching sentinel before the wrapped schema
runs. Missing optional fields without defaults stay absent; explicitly supplied
undefined stays an own property. A missing field's default factory runs once.
Defaults are validated/transformed by the wrapped schema. For async defaults use
the async wrapper and async parse. A default that returns the sentinel again
short-circuits to that sentinel instead of repeatedly invoking the factory.

`undefinedable` accepts an explicit undefined value but does not mark an object key
optional. `exactOptional` marks presence metadata while delegating supplied values
to the wrapped schema; its stored default is currently introspection metadata, not
a replacement branch in its run method. Use the implemented `optional`/`nullish`
default handling when a missing value must be filled rather than relying on that
metadata alone.

Pipelines run left to right: wrapper defaults, wrapped schema, then actions in
listed order. A transform before a refinement changes the value that refinement
sees. A transform after any issue does not execute. Further refinements can collect
issues while the dataset remains typed, unless `abortEarly`/`abortPipeEarly` stop
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
them, including beneath `unknown`/`any`. Strings are scalar; use `maxLength` and
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

`onSuccess`/`onError` are synchronous, per-parse notifications. Events contain only
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

Native grapheme/word actions use the installed runtime’s `Intl.Segmenter` and
ICU data. Word segmenters use a legacy unbounded cache keyed by exact locale value
or locale-array identity; keep locale configuration static and bounded. Byte
actions allocate a UTF-8 encoding and are separate from streaming HTTP limits.

Map/Set schemas produce fresh native collections while child outputs may retain
borrowed identity. Transformed duplicate Map keys use last assignment; Set values
collapse under native equality. Async collection schemas start child work before
ordered result accumulation, so `abortEarly` does not prevent every child from
starting. Record schemas inspect own enumerable string fields; trusted key
transforms must enforce permitted output names because the input-key filter does
not revalidate transformed names. Custom predicates assert host-declared types;
lazy getters select trusted schemas per parse and are not memoized or sandboxed.

Intersection validation merges compatible branch outputs into the first result.
That legacy recursive merge may mutate borrowed objects before a later conflict
and has no standalone cycle/depth budget or rollback; trusted transforms must
produce compatible finite output graphs. Root input budgets do not make arbitrary
host callbacks or their output merge transactional.

Format refinements check retained text patterns/checksums only: URL parsing is
not a scheme/egress allowlist, IP checks do not deny private addresses, JWS shape
does not verify signatures, and hash checks do not compute digests. ISO patterns
are a syntax subset, not complete calendar validation. Native RegExp matching is
synchronous; explicit custom patterns and candidate size remain host policy.

Native array callback actions retain native synchronous behavior; their callbacks
are not awaited. `sortItems` mutates its array in place. `readonly`, `brand` and
`flavor` change TypeScript inference without freezing, cloning or authorizing
runtime values; their declaration-only symbols are not runtime symbol exports.
Function argument/result wrappers keep their captured configuration and call the
borrowed function without preserving a method receiver. Create wrappers through
`parseAsync` when their child schemas are async. Result validation happens after
function side effects and cannot undo them.

The local `ajvSafeParse` checker does not run functional transforms or the AJV
engine. It ignores unsupported keywords, uses legacy inherited-key presence
checks and slash-joined paths without full JSON Pointer escaping, and adds no
independent scan/cycle/deadline budget. `toJsonSchema(schema, {strict:true})` selects the stricter converter policy.
Strict mode
throws for explicitly unsupported branches but still ignores some refinements
and transformations; it does not certify full conversion coverage. Prefer the
functional parse APIs when relying on their own-field and root-budget contracts.

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
checks executable syntax for Node references, including computed/module access.
Comments and unrelated string data may name Node APIs without being executed. Installed archive checks cover the new public subpaths. These are
Node Fetch/stream and DOM-fixture checks, not live-browser or deployed proxy tests.
There are no credentials/live-service prerequisites; a real browser and a host's
actual Fetch bridge/proxy are separate integration checks.
