# Test runner and assertions

Set up ztrial with explicit lifecycle, typed public APIs and deployment boundaries.


## Installation and integration path

```sh
npm install ztrial@0.0.4
```

This package has its own public API. Installing it does not create an automatic runtime service key in `zerux.config.js`. Use the framework integration described below or initialize it in the tool/application that owns its lifetime.

## Worked TypeScript setup

```ts
import { createRunner } from 'ztrial';
const runner = createRunner();
// Use the runner's declared registration/result APIs for an isolated suite.
type Runner = ReturnType<typeof createRunner>;
```

JavaScript can use the same runtime APIs without type-only statements. Enable JSDoc checking if editor validation is desired; a transpilation step alone does not typecheck the input.

## Usage and configuration

Use an independent runner for isolated tool/workspace ownership, or the exported test/describe registry for a single test process. Configure timeout, retry, filtering and only/skip policy deliberately. The CLI imports runnable JavaScript test files; TypeScript needs a separate transpilation or loader setup.

The package provides assertion/spying helpers and optional environment adapters. A Vitest-shaped adapter is not Vitest's full mocking engine; jsdom and Playwright adapters need their corresponding optional environments installed. Match an adapter to the code under test instead of assuming every API is present in the zero-dependency core.

## Public types

```ts
import { createRunner } from 'ztrial';
type Inputs = Parameters<typeof createRunner>;
type Result = Awaited<ReturnType<typeof createRunner>>;
```

Use installed public declarations and validate untrusted runtime values separately. Avoid deep source imports; the manifest reference below records the actual exported entry points for this version. Generic helpers may preserve a more useful concrete type at the call site than a broad ReturnType alias.

## Failures, ownership and production use

A timeout stops waiting but cannot forcibly cancel an arbitrary promise or roll back external side effects. Tests should close their own servers, timers, watchers and database connections. Retries can repeat those side effects, so use isolated fixtures and idempotent cleanup. Disallow accidentally committed only tests in CI, preserve failing exit status and distinguish skipped coverage from passing assertions.

## Verify the integration

Run the real owning application/tool with a normal input and a failure input. Inspect exit status or typed results, then verify cleanup/restart and the installed production entry point. A successful docs build does not exercise child processes, browser APIs, sockets or filesystem permissions on every supported operating system.

## Option reference

### RunOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `timeoutMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `retries` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `throwOnFailure` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `match` | `string \| RegExp` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `bail` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `forbidOnly` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `onResult` | `(result: TestResult) => void` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |

### ZtrialConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `root` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `files` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `reporter` | `'pretty'\|'json'\|'tap'` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `bail` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowOnly` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |

## Scoped HTTP and provider fixtures

Use public imports from ztrial/http (also exported at the root). No global fetch,
HTTP, clock or entropy interception is installed. Each fixture owns exact routes,
script cursors, metadata-only calls, deadlines, streams and optional loopback server.
Default matching origin is https://fake.test; routes match exact method/path/query.
Responses are consumed in order with no repeat-last behavior. Unexpected/exhausted
requests reject and make assertDone fail, even if the request failure was caught.

```ts
import { withHttpFake } from 'ztrial/http';
const text = await withHttpFake({ routes: [{
  method: 'POST', path: '/v1/events', responses: [{
    headers: { 'content-type': 'text/event-stream' },
    chunks: [{ data: 'data: {"ok":' }, { data: 'true}\n' }, { data: '\n' }]
  }]
}] }, async fake => {
  const response = await fake.fetch('https://fake.test/v1/events', {
    method: 'POST', body: '{"test":true}'
  });
  return response.text();
});
```

withHttpFake asserts exact expectedCalls (default response sequence length) and closes
on success, callback rejection, assertion/expectation failure or fixture deadline.
Direct createHttpFake callers must assertDone and close explicitly in finally, or
pass scope to register close in the runner callback. Calling listen allocates one
127.0.0.1 ephemeral server; separate fixtures can run concurrently. Unhandled local
requests return sanitized 500 and fail expectations; oversized bodies return 413.
Call records omit paths/URLs/headers/bodies and retain route index, method and supplied
time only. Use synthetic payloads; no credentials or live success claims are generated.

Scripts support status/headers, body or chunks, per-response/chunk delayMs, failure
network/timeout, and failAfterChunks. Injected chunks use actual pull-driven streams;
SSE framing is ordinary bytes, including partial frames and stream errors. Consume
or cancel bodies; request abort, reader cancellation and fixture close release owned
operations. Network read boundaries can merge local-server writes, so only injected
producer chunks have exact boundaries. There is no full Fetch, TLS, WebSocket or
provider parity. Relative local redirects only are supported by scripts.

Defaults: 64 KiB request body, 1 MiB response, 32 concurrent operations/connections,
5s fixture lifetime and 1s real request safety deadline. Byte limits cap at 16 MiB;
configured script bytes also total at most 16 MiB. There are at most 128 routes/steps,
1024 chunks per response and 4096 call records. Response headers reject CRLF, unsafe
framing overrides and external redirect targets. Invalid configuration rejects before
resource creation. Expected calls count matched requests after bounded body ingestion,
including scripted failure steps, rather than proving successful consumption.

External access requires a per-fixture exact origins list and explicit injected
transport under network. Delegation sets redirect=error, bounds request/response
bodies and propagates a cooperative signal. Other code's network access is untouched;
this is not a process network/DNS/SSRF sandbox. Trusted custom transports can bypass
their contract, so keep their code/configuration controlled and do not pass real
private provider payloads into an explicitly external test.

createTestClock gives now/sleep/advance/pending/close without patching Date/timers;
pass now/sleep into a fixture and advance only after its sleep is registered.
Real safety deadlines remain active. createSequenceRandom snapshots [0,1) inputs
and rejects exhaustion; defaults are deterministic constants, never cryptographic
entropy. Close clocks and cancel pending requests during cleanup.

## Test-local cleanup context

Test/hook callbacks receive signal and onCleanup. Register mockRestore or other
resource disposal immediately after acquisition. A fixture's scope option registers
close before listen. Cleanup runs once in reverse order on success/failure/timeout,
continues through failures and aggregates errors; each wait has the callback's timeout
bound. Scopes belong to each individual callback, including hooks/retries. Resources
acquired in beforeEach with onCleanup close when that hook returns; acquire test-owned
resources in the body or use explicit existing afterEach lifetime. No global
restoreAllMocks sweep risks restoring another parallel fixture's spies. Arbitrary
code/cleanup ignoring cancellation can still continue after timeout.

See the [Streams model](https://streams.spec.whatwg.org/#rs-model),
[Fetch redirect mode](https://fetch.spec.whatwg.org/#concept-request-redirect-mode)
and [Node server cleanup](https://nodejs.org/api/http.html#serverclosecallback).
Focused checks exercise concurrent servers, rejected outbound requests, bounded
bodies, SSE chunks, timeout/partial streams, expectations, backend rejection,
port/listener cleanup and installed public declarations. This is fake acceptance;
live providers require separate authorized service access and credentials.

## Optional browser sessions

ztrial/playwright keeps visit/click/runE2E for caller-owned pages and adds
createBrowserRunner, runBrowserTests and withBrowser. Optional playwright is imported
only when a non-skipped case executes without a borrowed browser or explicit driver.
The package never installs a browser or starts the application under test.

```ts
import { createBrowserRunner } from 'ztrial/playwright';
const browser = createBrowserRunner({ timeoutMs: 5000, concurrency: 2 });
browser.test('document fixture', async ({ page }) => {
  await page.setContent('<title>Fixture</title><button>Ready</button>');
  if (await page.title() !== 'Fixture') throw new Error('Unexpected title');
});
const summary = await browser.runTests();
process.exitCode = summary.failed ? 1 : summary.unavailable ? 2 : 0;
```

Each case owns a fresh context/page. A supplied browser is borrowed and remains open;
otherwise the chosen chromium/firefox/webkit launcher creates an owned browser per
case. Teardown attempts page/context/owned-browser close despite hooks/test/capture
failure. afterEach runs after partial beforeEach failure once a session exists.
Session onCleanup owns additional acquired resources in reverse order. withBrowser
accepts an existing test context to link cancellation and await session cleanup;
frontend/backend registries remain independent. Existing page helpers never assume
ownership. Default workers=1 (range 1–8), case deadline=5000ms, cleanup action deadline=
1000ms, up to 1000 cases and 128 hooks/callbacks. Result order follows registration.
Promises/custom drivers ignoring cancellation cannot be forcibly killed; late
acquisitions are scheduled for release and cleanup may outlast test reporting.

## Outcomes and artifacts

Results distinguish passed, failed, skipped and environment-unavailable. Missing
Playwright or failed browser launch is unavailable, never an intentional skip.
Timeout/cancellation, assertions, post-launch setup and cleanup errors fail. skipTest
or declared skip remains skipped only if teardown succeeds. Summary.unavailable is
separate from failures/skips; CLI returns 2 for unavailable environments and 1 for
failure, and TAP uses not ok for unavailable rows. normalizeResults produces versioned
node/browser records without stack/cause, preserving coverage state and artifact paths.
User assertion messages can still contain private values; normalization is not redaction.

Capture is disabled unless artifacts explicitly enables screenshot/video/trace in an
existing real directory, for example ./notes/agents/browser. Traversal, controls and
symlink components reject. Per-case private generated directories/fixed filenames
avoid interpolating test names; returned paths are relative to the configured root
and recorded only after successful capture. Opted-in recordings are owner-retained,
not automatically removed. Trace snapshots, DOM screenshots and video may contain
private data, so use synthetic pages and deliberate retention/access policy. Context
close precedes video.saveAs. See [browser ownership](https://playwright.dev/docs/api/class-browser#browser-new-context),
[tracing](https://playwright.dev/docs/api/class-tracing) and
[video lifecycle](https://playwright.dev/docs/api/class-video#video-save-as).

## Coverage boundaries

Browser coverage requires explicit expectedSources and supports Chromium page JS
coverage only. Navigation resets instrumentation. Unsupported engines/pages produce
unsupported records; missing listed URLs or source text produce uninstrumented
records. Unlisted/anonymous code is not silently considered covered. No source text
is emitted in normalized reports. See [Playwright coverage](https://playwright.dev/docs/api/class-coverage).

normalizeV8Coverage accepts actual runtime/version, source text and V8 function/range
records; Node instrumentation is not started automatically. Versioned v8-ranges output
contains source hash, UTF-16 offsets/counters and instrumentation status. mergeCoverage
rejects differing runtimes/hashes/topology/status or other formats instead of merging
incompatible backend/browser instrumentation. summarizeCoverage reports only range and
source-status counts, never fabricated line/branch/statement/project percentages.
No source maps or Istanbul conversion are provided. normalizeResults marks absent
coverage not-collected; no instrumentation is not 100% coverage.

Contract checks use driver doubles to verify ownership, deadlines, isolation, captures
and coverage merging, plus real missing-dependency handling and installed declarations.
They are not live browser acceptance. Real browser checks require installed Playwright
and a functioning browser binary; no user application is implicitly started.

## Versioned result exports

ztrial/reports (also root-exported) provides createResultReport and createReportExporters.
All encoders consume one version-1 ztrial-results document with normalized rows,
derived outcome counts, environment/duration, coverage state/provenance and artifact
references. JSON, JUnit XML and safe CSV are built in; optional adapters are explicit.
No export changes the runner summary or exit status. File delivery failure is separate
from test failure. Registries/plugins are owner-scoped and cannot replace each other's
formats; duplicate IDs/extensions reject.

```ts
import { mkdir } from 'node:fs/promises';
import { createRunner } from 'ztrial';
import { createReportExporters } from 'ztrial/reports';
const runner = createRunner();
runner.test('example', () => {});
const summary = await runner.runTests();
const directory = './notes/agents/reports';
await mkdir(directory, { recursive: true });
const exporters = createReportExporters();
for (const format of ['json', 'junit', 'csv']) {
  await exporters.write(summary, { directory, name: 'example', format });
}
```

Filenames are deterministic: example.results.json, example.junit.xml and
example.results.csv. JUnit maps unavailable environments to errors and intentional
skips to skipped elements. XML markup/attribute whitespace is escaped and invalid
XML code points removed. CSV quotes every field and prefixes common spreadsheet
formula/control prefixes with an apostrophe. There is no HTML/office-vendor parity
claim or automatic formula execution.

Errors are omitted unless includeErrors is explicitly enabled; stacks/causes/source
bodies are never report fields. Names/reasons/runtime labels must be public test
labels; use redact(text, field) when needed. Source/attachment paths become opaque
IDs by default. includeSourceLabels/includeArtifactPaths opt into actual labels
after redaction and safe-relative-path validation. Files referenced by screenshot/
video/trace records are never opened or embedded. Summary PNGs are separate charts,
not synthetic recordings. No credential detector can infer every private test name.

The CLI retains pretty/json/tap, but JSON now emits schema/version and normalized
rows rather than raw stacks; top-level counts/results/duration remain available.
All reporters derive from the same document. Programmatic file exporters add no
implicit output or application startup.

Limits default to 1000 results, 4 MiB input, 8 MiB output, 64 attachment references
and 64 KiB attachment metadata. Maxima are 10000 results, 16 MiB input, 32 MiB output,
1000 references and 1 MiB reference labels. Progressive copying charges the byte
budget. Recordings remain outside these reference-only budgets.

Output directories must already exist without symlink/traversal components. Prefix
names are constrained; format adapters own extensions. Existing files reject unless
overwrite=true, and symlink/non-file targets always reject. A private same-directory
file is written/synced/closed and atomically linked (no-clobber) or renamed (overwrite).
Abort/failure cleans temporary handles/files and preserves the previous target before
commit. Atomic visibility is not crash-proof durability or protection against malicious
concurrent directory replacement; native rendering is not forcibly canceled.

## Optional document/chart adapters

createPdfExporter lazily loads PDFKit and requires an explicit real TTF/OTF font file
(up to 8 MiB), with maxPages=20 by default (1–100). createXlsxExporter lazily loads
ExcelJS, requires a font family, caps rows at 1000 by default (max 10000) and rejects
oversized spreadsheet cells. createPngExporter lazily loads Sharp with explicit font
file/family; default 1000×400 pixels, each dimension bounded to 128–4096, default eight
coverage sources (max 32). No dependency is installed automatically. Missing modules
raise ReportDependencyError and do not change test success. Trusted load callbacks
support controlled dependency injection. Font licensing/glyph coverage and external
viewer substitution remain the owner's responsibility.

PDF is a clipped text summary with provenance, XLSX a string-cell workbook, and PNG
a single-page status chart with environment/duration/coverage provenance. Full coverage
ranges remain in data formats, without fabricated percentages. No browser screenshot,
video or trace is synthesized from chart images. Dependencies verified for these
adapters are PDFKit 0.20.2, ExcelJS 4.4.0 and Sharp 0.35.5; optional environments retain
their own native/Node/transitive requirements. See [PDFKit](https://pdfkit.org/docs/text.html),
[ExcelJS](https://github.com/exceljs/exceljs#writing-xlsx) and
[Sharp](https://sharp.pixelplumbing.com/api-constructor/#new).

Core checks use JSON/XML/CSV parsers and interrupted-write/path/size regressions.
Optional configured checks create actual PDF/XLSX/PNG artifacts and open them with
PDF/workbook/XML/image parsers. They do not imply real browser or live provider
acceptance. See the package README for required test tools and opt-in environment.


## Public entry points

Manifest reference for `ztrial@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./reports": {
      "types": "./dist/reports/index.d.ts",
      "import": "./dist/reports/index.js"
    },
    "./http": {
      "types": "./dist/http/index.d.ts",
      "import": "./dist/http/index.js"
    },
    "./jsdom": "./dist/adapters/jsdom/setup.js",
    "./playwright": {
      "types": "./dist/adapters/playwright/setup.d.ts",
      "import": "./dist/adapters/playwright/setup.js"
    },
    "./vitest": "./dist/adapters/vitest/setup.js",
    "./experiments": {
      "types": "./dist/experiments/index.d.ts",
      "import": "./dist/experiments/index.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {
    "ztrial": "./dist/bin/cli.js"
  }
}
```


## Package README

# Ztrial — test runner and assertion toolkit

Ztrial is a dependency-light test library for ZeruxJS, ZyroJS and ordinary JavaScript/TypeScript packages. It is **not** the ZyroJS UI runtime. The new API is modular, and existing `describe`, `test`, `expect` and `runTests` entry points remain available.

## Writing tests

```ts
import { describe, test, expect, beforeEach, runTests, fn } from 'ztrial';

describe('cart', () => {
  beforeEach(() => { /* reset fixture */ });
  test('adds items', () => expect([1, 2]).toHaveLength(2));
  test.each([1, 2, 3])('supports count %#', value => expect(value).toBeGreaterThan(0));
  test.withOptions('network', { timeoutMs: 3000, retries: 1 }, async () => {
    await expect(Promise.resolve('ok')).toResolve();
  });
});

const summary = await runTests({ throwOnFailure: true });
```

Suite-scoped `beforeAll`, `afterAll`, `beforeEach`, and `afterEach` hooks execute deterministically. Supports `test.only`, `test.skip`, `describe.only`, `describe.skip`, timeout/retry limits, fail-fast `bail`, `forbidOnly`, filtering, and callback result reporting. `createRunner()` creates an independent test registry that avoids cross-project global state.

Assertions include `toBe`, circular-safe `toEqual`, `.not`, `toContain`, `toMatch`, `toHaveLength`, `toHaveProperty`, `toThrow`, `toReject` and `toResolve`. `fn`, `spyOn`, and `restoreAllMocks` supply lightweight spies. `waitFor` polls asynchronous conditions with an optional AbortSignal.

## CLI

Build first, then run `.test.js`, `.spec.js`, `.test.mjs`, or `.spec.mjs` files:

```sh
npm run build
node dist/bin/cli.js --reporter pretty
node dist/bin/cli.js --match "cart" --reporter tap
node dist/bin/cli.js --config ztrial.config.json --reporter json
```

Example JSON configuration:

```json
{
  "root": ".",
  "files": ["tests/**/*.test.mjs"],
  "timeoutMs": 5000,
  "retries": 1,
  "bail": false,
  "allowOnly": false,
  "reporter": "pretty"
}
```

The CLI has zero mandatory browser/test-runner dependencies. It imports runnable JavaScript test files; TypeScript test files must be transpiled or run through a separately configured TypeScript loader. JSON and TAP output are supported. Modules exported by `ztrial/jsdom` and `ztrial/playwright` are **optional adapters**; the environment packages must be separately installed if those features are used. Vitest-shaped helpers do not replace Vitest's full mocking engine.

### Important limitations

Timeouts prevent the runner from waiting forever but cannot forcibly cancel an arbitrary test promise. Browser adapters require an installed browser/DOM environment; no native browser or Playwright automation is bundled. This is a focused foundation rather than a fully compatible replacement for Jest, Vitest, or Playwright.

## Verification

```sh
npm run build
node --test test/*.test.mjs
```

## Test-runner safeguards

- `--config` accepts a size-limited JSON file; a relative `root` in that file
  resolves from the file's directory, not the caller's working directory.
- CLI flags require values and numeric timeouts are bounded to ten minutes.
- Discovery ignores symlink entries, `.git`, `node_modules` and `dist`.
- Zero matching files, zero registered test cases and `--match` selecting no
  runnable test cases now fail with exit code `2` instead of reporting a green run.
- `--bail` executes `afterAll` for suites already started; cleanup hook failures
  remain visible as test failures. Timeouts bound reporting but cannot forcibly
  cancel arbitrary JavaScript async operations.

Verify with `npm run build && node --test test/*.test.mjs`. No browser/runtime
certification is inferred from source-only tests.

## Scoped HTTP/provider fakes

`ztrial/http` (also exported at the root) exposes createHttpFake, withHttpFake,
createTestClock and createSequenceRandom. These Node test utilities do not patch
global fetch, HTTP modules, Date, timers or randomness. Imports open no server or
network connection. Inject fake.fetch into the code under test; only listen()
creates an ephemeral HTTP server on 127.0.0.1 with an OS-assigned port.

```ts
import { withHttpFake } from 'ztrial/http';
const text = await withHttpFake({ routes: [{
  method: 'POST', path: '/v1/events', responses: [{
    headers: { 'content-type': 'text/event-stream' },
    chunks: [{ data: 'data: {"ok":' }, { data: 'true}\n' }, { data: '\n' }]
  }]
}] }, async fake => {
  // Pass fake.fetch as the application's injected transport.
  const response = await fake.fetch('https://fake.test/v1/events', {
    method: 'POST', body: '{"test":true}'
  });
  return response.text();
});
// text === 'data: {"ok":true}\n\n'. Expectations checked; fixture always closed.
```

Routes match exact method (GET by default), pathname and query at origin
https://fake.test by default. Configure a canonical HTTP(S) origin if needed.
Queries are exact serialized strings, not unordered parameter maps. No glob/regex,
JSON-body, header, credential or vendor-specific matching is supplied. Each route
has a nonempty responses sequence, consumed in order; exhaustion rejects rather
than repeating the last response. expectedCalls defaults to the sequence length
and is checked exactly. Matching attempts count once the bounded body is read;
scripted network/stream/timeout failures still consume their step. Calls record only
route index, method and supplied clock time, not paths, queries, headers or bodies.
Repeated/unknown method+path definitions and unsafe configuration reject.

Unhandled requests reject with HttpFakeError code UNHANDLED_REQUEST and increment
an unexpected-request counter. assertDone subsequently fails even if the caller
caught that rejection. Direct createHttpFake users must call assertDone explicitly
and await close in finally; withHttpFake checks expectations and closes after
success, assertion failure, callback rejection or fixture deadline. Primary,
expectation and cleanup failures are retained/aggregated. close is idempotent, aborts
streams/requests, cancels fixture waits, destroys owned sockets and releases the
server port. listen returns the same server for repeated calls on a fixture; two
fixtures have independent routes, scripts, counters, sockets and ports.

### Latency, streaming, limits and network policy

HttpReply supports status (200–599), validated headers, body or chunks, delayMs,
failure ('network' or 'timeout'), and failAfterChunks. Chunk delayMs precedes that
chunk; failAfterChunks=N errors the stream before chunk N+1 (0 fails immediately).
A timeout script waits for request/fixture cancellation; a network script rejects
before producing a response. Scripted streams are actual pull-driven ReadableStreams,
with the exact configured byte chunks and no eager buffering/prefetch. Canceling a
reader or aborting its request releases the owned operation. Read all chunks or cancel
the reader; ignoring a response body keeps its request deadline active. A partial
stream failure errors the next read, not the already-received bytes. SSE is supplied
as ordinary content-type and byte chunks; there is no fabricated provider protocol.

| Limit | Default | Accepted bounds |
| --- | --- | --- |
| maxBodyBytes | 65536 | 1–16777216 |
| maxResponseBytes | 1048576 | 1–16777216 per response; 16 MiB total configured script bytes |
| maxConcurrent | 32 | 1–128 active injected operations / accepted server connections |
| timeoutMs | 5000 | 1–600000ms fixture lifetime, including unused fixtures |
| requestTimeoutMs | 1000 | 1–600000ms real request/body/stream safety deadline |
| Routes / response steps per route | 128 / 128 | Fixed maximums |
| Chunks per response / call records | 1024 / 4096 | Fixed maximums |

Headers are limited to 64 entries (128-character names, 8192-character values),
reject CRLF and prohibit connection/transfer-encoding/content-length/upgrade/set-cookie
response overrides. Bodyless statuses cannot have configured chunks. Only local
relative Location values are allowed, preventing a local mock redirect from silently
sending the client's next request outside the fixture. Injected responses do not
implicitly follow redirects. There is no TLS, HTTP/2, WebSocket, cookie jar or complete
Fetch/provider parity. The local adapter forwards method/path and bounded body to
scripts, not incoming authorization/cookie headers. Unhandled local requests return
sanitized 500 responses and fail expectations; oversized local bodies return 413.
Midstream failures terminate the response socket. TCP/HTTP clients may merge network
chunks; deterministic producer chunks are guaranteed on the injected transport,
not as packet/read boundaries on the local server. Ports require local bind permission.

External delegation is disabled unless that fixture supplies
`network: { origins: ['https://allowed.example'], transport }`. Both an exact canonical
origin list (at most 32) and an explicit transport are required. There is no automatic
global-fetch fallback. Delegation sets redirect='error', bounds outgoing bodies and
returned response streams, and forwards a cooperative AbortSignal. A custom transport
is trusted executable code and must honor cancellation/redirect policy; this is not
a process-wide network firewall, DNS/SSRF sandbox or protection for code that bypasses
the injected transport. Fakes never disable network for unrelated production code.
Use synthetic test data only; explicit allowance can transmit the supplied body/headers.
No credentials are generated, and fake success is never live-provider acceptance.

### Deterministic inputs and cleanup ownership

createTestClock(initial=0) supplies now, sleep, advance, pending and close. Pass
`{now: clock.now, sleep: clock.sleep}` to a fixture, await the operation reaching a
sleep, then advance by an exact nonnegative integer duration. It affects fixture
latency/chunk sleeps only; real safety deadlines stay active. The clock supports
128 pending sleeps, removes canceled waiters/listeners, and close rejects leftovers.
createSequenceRandom(values) snapshots up to 1024 numbers in [0,1), consumes one
for each matched scripted request and rejects on exhaustion. Pass it as random;
fake.inputs() also consumes/checks the supplied now/random functions. Defaults are
constant time 0 and value 0.5, not global clock or entropy. These values are for test
inputs only, never tokens, authorization or cryptographic keys.

```ts
import { createRunner, spyOn } from 'ztrial';
import { createHttpFake } from 'ztrial/http';
const runner = createRunner();
runner.test('provider input', async context => {
  const object = { method: () => 1 };
  const spy = spyOn(object, 'method');
  context.onCleanup(spy.mockRestore); // Scoped restoration, never restore another test's spies.
  const fake = createHttpFake({ scope: context, signal: context.signal,
    routes: [{ path: '/health', responses: [{ body: 'ok' }] }]
  });
  await (await fake.fetch('https://fake.test/health')).text();
  fake.assertDone();
});
const summary = await runner.runTests();
```

Test/hook callbacks now receive TestExecutionContext with signal and onCleanup.
Each individual callback invocation owns a separate scope (including each hook and
retry); a beforeEach-owned resource closes when that hook returns. For a resource
needed during the test, acquire it in the test body, or use the existing explicit
beforeEach/afterEach lifetime instead. Register at most 128 cleanup callbacks,
immediately after acquisition. They run once in reverse order after success, failure
or timeout; every callback is attempted and cleanup failures remain failed results.
Each cleanup wait is bounded by that callback invocation's configured timeout.
A fixture's scope option registers close before opening a server; signal optionally
requests earlier cancellation. Scoped fixtures still require explicit assertDone;
use withHttpFake for automatic expectation assertions. Arbitrary tests, transports,
cleanup callbacks or custom sleep functions that ignore cancellation cannot be
forcibly stopped, and may have later side effects. Closing a fixture does not restore
spies it did not create: register mockRestore as shown, not global restoreAllMocks
in parallel fixtures. No global mock registry is automatically swept on timeout.

Diagnostics expose closed/listening, activeRequests, activeStreams, waiting sleeps,
socket counts, completed/cancelled operations and unexpected requests, without
bodies, headers, URLs or internal causes. Consuming expectations asserts call counts,
not provider authentication, schema correctness or live service availability. The
stream/cancellation model uses standard [ReadableStream](https://streams.spec.whatwg.org/),
[Fetch redirect policy](https://fetch.spec.whatwg.org/#concept-request-redirect-mode)
and [Node HTTP lifecycle](https://nodejs.org/api/http.html#serverclosecallback).
Focused Node checks use only injected responses and ephemeral loopback servers;
no live credentials, vendor endpoints or browser environment are required. Live
provider acceptance needs separately authorized credentials/network/service checks.

## Optional browser execution and normalized outcomes

Existing ztrial/playwright visit, click and runE2E imports still accept caller-owned
pages and never close them. The same subpath now exports createBrowserRunner,
runBrowserTests and withBrowser. They dynamically import optional `playwright` only
when executing a non-skipped case without a supplied browser/driver. Install the
Playwright package and its browser binaries separately in the test environment;
ztrial does not install, download, start an application or connect to a user-managed
application automatically. Root backend imports do not load Playwright.

```ts
import { createBrowserRunner } from 'ztrial/playwright';
const browser = createBrowserRunner({ timeoutMs: 5000, concurrency: 2 });
browser.test('document fixture', async ({ page }) => {
  await page.setContent('<title>Fixture</title><button>Ready</button>');
  if (await page.title() !== 'Fixture') throw new Error('Unexpected title');
});
const summary = await browser.runTests();
process.exitCode = summary.failed ? 1 : summary.unavailable ? 2 : 0;
```

The default is Chromium/headless, one concurrent case, 5000ms per case and 1000ms
per cleanup action. concurrency accepts 1–8 workers per run; at most 1000 cases and
128 hooks/cleanup callbacks per session. Millisecond settings are integers from 1
through 600000. Cases run in parallel only when explicitly configured; result order
always matches registration order. Each case gets a new context/page, including
when borrowing an existing browser. No cookies/cache/session are reused between
contexts. browserName may select chromium/firefox/webkit. Browser availability is
separate from support for every browser feature.

Pass `{browser}` to borrow a browser: only the new page/context are owned and
closed. Otherwise the selected launcher creates an owned browser per case. The
adapter closes page, context and owned browser in order, even after a failed hook,
assertion, callback rejection, timeout or cleanup failure. Remaining cleanup actions
are attempted after errors; failures are aggregated and cannot turn into skips.
Late acquisitions after a deadline are scheduled for release. A custom injected
driver is trusted code, and may ignore deadlines or fail release; timeout means
reporting/cancellation request, not forced process termination. Cleanup can take
additional bounded waits and noncooperative promises may continue afterward.
See [Playwright context ownership](https://playwright.dev/docs/api/class-browser#browser-new-context).

Options beforeEach/afterEach contain session callbacks. afterEach runs after partial
beforeEach failure if the session was established. Session onCleanup registers
reverse-order disposal for resources acquired inside the test; its signal observes
the adapter deadline and optional external signal. Callback resources are not
magically discovered. Keep mock objects per test and register spy.mockRestore;
never sweep another parallel runner's global mocks.

withBrowser(options, callback, context?) integrates with the existing runner:

```ts
import { createRunner } from 'ztrial';
import { withBrowser } from 'ztrial/playwright';
const runner = createRunner();
runner.test('browser fixture', context => withBrowser({ timeoutMs: 2000 }, async ({ page }) => {
  await page.setContent('<title>Scoped</title>');
  return page.title();
}, context));
const summary = await runner.runTests();
```

It returns `{value, coverage, artifacts}` or throws. Passing the runner context links
cancellation and registers awaiting session cleanup; without it, the adapter still
owns its own deadline/cleanup. The independent browser runner records coverage and
artifacts automatically. withBrowser callers explicitly consume/retain its returned
records; the backend runner does not infer instrumentation from a callback value.

### Outcomes and reporters

Backend and browser results use passed, failed, skipped and environment-unavailable.
A missing optional module or failed browser launch is environment-unavailable with
an internal EnvironmentUnavailableError.cause; it is never a green skip. Browser
assertions, post-launch setup errors, timeout/cancellation and cleanup failures are
failed. Intentional declarations (browser.skip, case.skip, test.skip), filtering and
skipTest(reason) are skipped; teardown failure overrides a skip/unavailable outcome.
Bail does not trigger merely because skipTest was called. Summary.unavailable is
added alongside the existing counts. CLI returns 1 for failures, 2 for unavailable
required environments, otherwise 0. TAP unavailable rows are `not ok`, not SKIP;
JSON/pretty output preserve the distinct status. throwOnFailure also rejects unavailable
environments. Browser runners return the summary and leave exit status to the owner.

normalizeResults(summary, environment?) produces versioned records containing status,
environment, duration, optional error name/message, coverage state and artifact paths,
without stacks or causes. Backend results default to environment node; browser-runner
results carry browser. Arbitrary error messages can contain private application data;
normalization does not redact credentials from user assertions. Raw result errors
retain causes for trusted debugging. Existing Error serialization in the CLI remains
an internal test report, not a safe public error response.

### Explicit artifacts

Capture is off by default. To opt in, pass
`artifacts: {directory: './notes/agents/browser', screenshot: true, video: true, trace: true}`.
Create that directory yourself first. It must be an existing real directory without
symlink components or traversal/control characters. Each case uses a private generated
ztrial-* subdirectory and fixed page.png/trace.zip/video.webm filenames. Test names
never become filesystem paths. Result paths are relative to the configured root and
are recorded only after successful capture. No arbitrary output filename is accepted.
These checks assume a trusted filesystem; they do not sandbox concurrent malicious
replacement of directories. There is no automatic retention/deletion of opted-in
artifacts, so the test owner must manage them.

Screenshots are taken during teardown, traces explicitly collect DOM snapshots with
screenshots/sources disabled, and video recording is explicitly enabled at context
creation. Context close precedes video.saveAs so recording can finish. Capture may
include secrets, DOM content, network metadata or personal data: use synthetic pages
and review access/retention before enabling it. No trace/video/screenshot starts from
merely importing or creating the runner. See [Playwright tracing](https://playwright.dev/docs/api/class-tracing)
and [video save lifecycle](https://playwright.dev/docs/api/class-video#video-save-as).
Capture errors remain failures instead of producing misleading artifact records.

### Honest coverage

Browser coverage is opt-in: `coverage: {expectedSources: ['https://test.invalid/app.js']}`.
Only caller-listed sources are retained. Chromium's page JavaScript coverage is
collected with resetOnNavigation=true; it does not certify earlier navigations,
workers, every frame or whole-application instrumentation. Firefox/WebKit or pages
without that API produce unsupported records. Missing expected URLs are uninstrumented
(not-observed), and entries without source text are uninstrumented (source-unavailable).
Anonymous/unlisted sources are not silently counted as covered. No source text is
retained in normalized output. A borrowed browser without browserType metadata requires
an explicit browserName for coverage. See [Playwright's Chromium-only coverage contract](https://playwright.dev/docs/api/class-coverage).

Root exports normalizeV8Coverage(entries, {runtime, expectedSources}), mergeCoverage
and summarizeCoverage. Backend callers can feed actual V8 records with source text;
ztrial does not automatically instrument Node tests or fabricate backend coverage.
Use an exact runtime/version identifier (for example `node:${process.version}`), not
a generic label when compatibility matters. Each version-1 v8-ranges record includes
source label, runtime, instrumented/unsupported/uninstrumented status, SHA-256 source
hash when instrumented, and function/range indices with UTF-16 offsets/counts.
Raw source/ranges are validated and bounded (1000 expected sources, 10000 reports,
100000 ranges per source and 16 MiB source-text code units).

mergeCoverage sums counters only for identical source/runtime/status/hash and exact
range topology. Incompatible runtime versions, transformed source, range layouts,
missing instrumentation and Istanbul/other formats must stay separate; they are
rejected rather than coerced. There is no source-map remapping or V8-to-Istanbul
conversion. summarizeCoverage reports range totals/covered ranges and source-status
counts, **not statement/branch/line percentages or whole-project coverage**. Do not
sum overlapping ranges as covered bytes. normalizeResults labels absent coverage
not-collected; no collection is not 100% coverage.

Focused Node contract checks use a deterministic driver double for browser ownership,
parallel limits, failure/timeout cleanup, artifact paths and coverage compatibility.
They are not real browser acceptance. Missing Playwright is verified as unavailable;
real browser cases require separately installed Playwright and a launchable binary.
No browser was installed or application started by those checks. Real browser/video/
trace behavior needs a functioning browser environment and separate validation.

## Versioned result exporters

`ztrial/reports` (also exported at the root) provides createResultReport and
createReportExporters. Every encoder consumes the same detached version-1 document:
`{schema:'ztrial-results', version:1, passed, failed, skipped, unavailable, durationMs,
results}`. Rows use the exported NormalizedResultRecord contract: version/name,
node/browser environment, status, duration, reason, optional error name/message,
coverageStatus, coverage provenance/ranges and artifact references. Counts derive
from rows, not caller-supplied summary totals. No run timestamp, source body, stack,
cause, request body or recording contents are inferred or added.

```ts
import { mkdir } from 'node:fs/promises';
import { createRunner } from 'ztrial';
import { createReportExporters } from 'ztrial/reports';
const runner = createRunner();
runner.test('example', () => {});
const summary = await runner.runTests();
const directory = './notes/agents/reports';
await mkdir(directory, { recursive: true }); // The owner creates its output directory.
const exporters = createReportExporters();
for (const format of ['json', 'junit', 'csv']) {
  await exporters.write(summary, { directory, name: 'example', format });
}
// example.results.json, example.junit.xml and example.results.csv
```

render(summary, format, options?) returns bytes, extension and kind without writing.
write(summary, options) adds a deterministic filename and byte count. Both reject
unsupported formats and invalid input; neither changes a RunSummary, process.exitCode
or runner success. Handle report delivery failure separately from test outcome.
Each exporter registry is application/test-scoped. Pass explicit custom ReportExporter
objects to createReportExporters([...]); IDs and extensions are validated, duplicate
IDs/extensions reject, and a custom render function receives a recursively frozen
schema plus signal/maxOutputBytes. Custom adapters are trusted executable code,
not sandboxed, and own their internal resource cleanup/encoding safety.

### Core formats and disclosure policy

JSON emits the versioned document. JUnit emits one testsuite: failed assertions are
failure elements, unavailable environments are error elements, intentional skips
are skipped elements, and durations use seconds. Schema/environment/status/duration,
coverage and artifact metadata are escaped testcase properties. This is a documented
JUnit subset, not identical behavior in every CI vendor's importer. CSV uses fixed
columns, CRLF rows and quoted RFC 4180 cells; coverage/artifacts remain JSON-valued
text cells. Cells beginning with =, +, -, @ after whitespace/BOM, or tab/CR/LF, get
an apostrophe prefix to prevent common spreadsheet formula interpretation. XML 1.0
invalid code points are removed, markup/quotes/attribute whitespace are escaped,
and XML entities cannot inject new elements. No core HTML exporter is supplied.

Error text is omitted by default, including from CLI pretty/JSON/TAP reporters.
includeErrors=true explicitly includes normalized name/message; use a redactor when
assertions may include private values. Stacks and causes are never exported. Test
names, reasons and runtime/version labels are public report labels: do not put
credentials in them. A configured redact(text, field) callback can redact these
fields before encoding. No general secret detector can infer every private value.
By default source labels and artifact paths become deterministic opaque SHA-256 IDs;
coverage content hashes, formats, runtime and instrumentation status remain visible.
includeSourceLabels/includeArtifactPaths explicitly retain those labels after
redaction/validation. All options are per export. Artifact references must be safe
relative paths; no attachment file is opened, embedded, copied or uploaded.

The existing CLI still accepts pretty/json/tap. Its JSON reporter now adds schema/
version and emits normalized rows instead of raw Error stacks. Existing top-level
counts/results/duration remain available; consumers needing raw stack traces must
use trusted in-process results. Pretty/TAP derive from the same report document.
File formats junit/csv/pdf/xlsx/png use the programmatic exporters, not new CLI flags.

### Budgets and atomic publication

| Option | Default | Maximum |
| --- | --- | --- |
| maxResults | 1000 | 10000 |
| maxInputBytes | 4 MiB | 16 MiB UTF-8 document budget |
| maxOutputBytes | 8 MiB | 32 MiB |
| maxAttachments | 64 | 1000 references across the report |
| maxAttachmentBytes | 64 KiB | 1 MiB reference-label metadata |

Text/metadata fields are bounded; coverage/ranges retain the earlier validation
limits. Input work is charged while copying ranges/labels, before building an
unbounded output string. Presentation encoders may have stricter limits. Attachment
budgets concern references only: recordings remain separate owner-managed files,
with their own browser-capture/retention budgets. Reports cannot fabricate a browser
recording or classify a summary chart as a screenshot/video.

write requires an existing real directory without symlink components, traversal or
control characters. name is a 1–64-character lowercase alphanumeric/underscore/dash
prefix, beginning with alphanumeric; output extensions come from the adapter. Existing
symlink/non-file destinations reject. Existing files reject unless overwrite=true.
Data is written to a private same-directory temporary file (mode 0600), synced,
closed and published atomically. No-overwrite publication uses a same-filesystem
hard link; overwrite uses rename. A filesystem that cannot support those operations
fails rather than falling back to partial writes. Temporary handles/files are cleaned
on abort/write/publication failure. AbortSignal is checked before rendering, between
64 KiB writes and before commit. Cancellation after the atomic commit cannot undo
publication. Native library work that ignores cancellation may complete in the
background; its result is not committed after an observed abort. This is atomic
visibility, not a claim of crash-proof directory durability or a race-free sandbox
against malicious replacement of a trusted output tree.

### Optional PDF, XLSX and summary PNG adapters

No optional renderer loads until its registered format is rendered. Install renderer
dependencies separately; missing modules throw ReportDependencyError with a dependency
name and internal cause, never a passing fake artifact or a changed test status.
Factories also accept an explicit trusted load callback for controlled dependency
injection. No dependency is downloaded by these APIs.

| Factory / format | Explicit dependency tested | Fonts and limits |
| --- | --- | --- |
| createPdfExporter / pdf | PDFKit 0.20.2 (MIT) | Explicit canonical TTF/OTF file, at most 8 MiB; maxPages default 20, range 1–100; 45 fixed-height lines/page |
| createXlsxExporter / xlsx | ExcelJS 4.4.0 (MIT) | Explicit fontFamily name; workbook references it without embedding a font; maxRows default 1000, range 1–10000; 32767 code units/cell |
| createPngExporter / png | Sharp 0.35.5 (Apache-2.0) | Explicit TTF/OTF fontFile and fontFamily; width/height default 1000×400, each 128–4096; maxSources default 8, range 1–32 |

Consult the chosen dependencies' Node/native/transitive requirements; they are not
mandatory ztrial dependencies or bundled runtime guarantees. Fonts must be real,
non-symlink files with trusted ancestry; the owner supplies appropriate licensing
and glyph coverage. A configured spreadsheet font can be substituted by a viewer.
PDF is a text summary with environment/status/duration/coverage provenance; display
names/runtime labels have fixed-width clipping. XLSX stores formula-guarded strings
and a Summary sheet, never executable formula objects or recording embeds. PNG is a
single-page status chart with environment counts, duration and bounded coverage
provenance; it is returned as kind summary-chart, not screenshot. PNG labels longer
than 256 characters and excessive source sets reject rather than silently losing
provenance. Full counters/ranges remain in JSON/JUnit/CSV/XLSX; summary PDF/PNG are
presentation views of the same document, not substitutes for complete coverage data.
Unsupported formats (HTML, JPEG, browser recordings, arbitrary office/PDF dialects)
are not inferred from a filename.

```ts
import { createReportExporters, createPdfExporter, createXlsxExporter,
  createPngExporter } from 'ztrial/reports';
const exporters = createReportExporters([
  createPdfExporter({ fontFile: '/absolute/trusted/report.ttf', maxPages: 10 }),
  createXlsxExporter({ fontFamily: 'Report Font', maxRows: 500 }),
  createPngExporter({ fontFile: '/absolute/trusted/report.ttf', fontFamily: 'Report Font' })
]);
// Call exporters.write(summary, {directory, name:'example', format:'pdf'}) explicitly.
```

See the primary [PDFKit text/font API](https://pdfkit.org/docs/text.html),
[ExcelJS workbook API](https://github.com/exceljs/exceljs#writing-xlsx)
and [Sharp text input](https://sharp.pixelplumbing.com/api-constructor/#new).
Renderer/library errors propagate; retained causes may contain private local paths
and must not be exported as public report content.

Focused checks open JSON/CSV/JUnit using actual parsers, interrupt staged writes,
reject unsafe paths/formula cells/oversized inputs and verify installed public imports.
Core parser round-trips require Python 3. Optional artifact checks require an explicit
temporary modules directory/font, PDFInfo/PDFToText and Pillow; they generate actual
PDF/XLSX/PNG files and read them with parsers, not signature-only assertions. They
skip when not configured and never install dependencies automatically. These checks
are document-format acceptance, not live browser/vendor integration certification.

## Headless server experiment evaluation

`ztrial/experiments` is a separate Node-only, opt-in API. It imports neither the test runner nor an analytics/HTTP/browser runtime. Evaluating an experiment never registers/runs a test, creates a UI, starts telemetry, installs middleware or opens a connection automatically. Existing test APIs remain unchanged. This is deterministic allocation, not a statistical analysis service or an authorization mechanism.

```ts
import {createExperimentCatalog, createExperimentEvaluator} from 'ztrial/experiments';
const catalog = createExperimentCatalog([{
  id:'checkout', version:1, salt:'checkout_allocation_v1', migration:'initial',
  environments:['production'],
  variants:[
    {name:'control',weight:5000},
    {name:'compact',weight:3000},
    {name:'express',weight:2000}
  ]
}]);
const evaluator = createExperimentEvaluator({
  catalog, tenant:verifiedTenantToken, tenantSalt:hostOwned32ByteSecret,
  resolveContext:(principal,{signal}) => authenticateExperimentContext(principal,signal)
});
const decision = await evaluator.evaluate('checkout', serverPrincipal, {signal:request.signal});
// Host chooses UI behavior from decision.status/variant. It still authorizes every resource.
await evaluator.close(); // application/generation shutdown, not after every request
```

The [public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/examples/experiments.ts) accepts server authentication and key material explicitly. `resolveContext` must authenticate and bind `{tenant,subject,environment,consent}` from trusted server context; no `verified:true` assertion, query parameter, cookie or forwarded header is accepted as identity proof by the library. It is trusted executable host code, not a sandbox. Tenant/subject identifiers must be opaque 16–128-character ASCII letters/digits/underscore/dash tokens; never supply email, IP, fingerprint or arbitrary traits. Tenant must match the fixed evaluator tenant. Consent must explicitly be `granted`; missing identity, denied/unknown consent, tenant mismatch or an unlisted environment returns a sanitized denied decision before assignment-store/recorder effects. Context validation errors reject. Do not turn a denied result into an analytics exposure.

Middleware integration is deliberately host-owned: authenticate first, evaluate with the request signal, choose a safe UI fallback for denied/errors, keep responses private/per-principal as appropriate, and dispose the evaluator with its generation. There is no new ZeruxJS adapter, implicit response-header/cookie assignment or frontend hook. Sharing one evaluator across requests is safe only for its configured tenant; it stores no default request context. No server-verified identity or experiment outcome replaces authorization, tenant filtering or CSRF policy.

### Catalogs and rollout policy

Weights are **integer basis points** in 0–10000 and must total exactly 10000; 5000 means 50%, not 5000 users. Each version declares 2–16 unique named variants, including names beyond A/B, and 1–16 explicit environment names. Zero-weight variants remain named but receive no new hash allocation; a trusted override or preserved historical assignment can still select them. Definition/environment names are bounded safe tokens; duplicate names, fractional/negative weights, getters, sparse lists and unknown definition keys reject. Catalogs are detached, recursively frozen snapshots, limited to 32 experiments, 16 retained versions per experiment and 128 total definitions.

Versions start at 1 with `migration:'initial'` and retain contiguous history. `evolveExperimentCatalog(previous, changes)` requires exactly the next version and an explicit policy:

- `preserve` requires a durable assignment store and retains each previously assigned variant, including a now-zero-weight variant. Existing variant names may not be removed. New subjects use the new version's weights.
- `rebucket` explicitly recomputes allocation for the new version; it may retain/remove names. It does not promise that every subject changes variant. A chain applies migrations in order, preserving intervening sticky assignments.

No evaluator/catalog object has mutable weight setters. Changing weights, variant order, environments or allocation salt changes the definition fingerprint and requires a reviewed version migration. Keep immutable catalog snapshots in deployment configuration/artifacts; reconstruction accepts the retained declarative history through `createExperimentCatalog`. A fresh **stateless** process cannot discover that an operator rewrote its old version-1 configuration: hosts must retain/version that baseline. Durable mode additionally rejects conflicting stored version fingerprints and rollback to an older assignment version. Deleting that history or manually relabeling a fresh catalog is outside the in-process guarantee.

Trusted `overrides:[{experiment,version,subject,variant}]` are explicit private configuration, capped at 1024 unique subject/version entries and validated against declared variants. Subject keys are converted to HMAC references at construction; they never appear in explanations. Requests cannot supply overrides. In durable mode a stored current-version assignment wins; current overrides affect new assignments or an explicit rebucket step, not sticky historical assignments. In stateless mode changing trusted overrides is an intentional allocation change and must follow host rollout governance. Environment is eligibility, not an extra bucket namespace: use distinct experiment IDs if environments need independent allocation.

### Cryptographic stability and salt ownership

The algorithm label is `hmac-sha256-basis-points-v1`, using native [Node HMAC](https://nodejs.org/api/crypto.html#cryptocreatehmacalgorithm-key-options). The tenant secret is exactly 32 bytes, copied on construction; use independent cryptographically generated host secrets, not example/repeated bytes. The public per-version allocation salt is an explicit 16–128-character opaque token, not an authorization credential. Bucket input is UTF-8 JSON `["ztrial.bucket.v1",tenant,subject,experimentId,version,allocationSalt]`. Interpret the full unsigned 256-bit HMAC digest as `n`; bucket is `floor(n * 10000 / 2^256)`, and declaration-order cumulative weight intervals select the variant. No `Math.random`, timestamps, process-dependent hash, raw concatenation or noncryptographic checksum determines allocation.

Known fixture vector: a 32-byte secret filled with `0x07` and `['ztrial.bucket.v1','tenant_0123456789','subject_0123456789','checkout',1,'allocation_salt_v1']` produces digest `520fab711ff04e40bbbaa2417dd4b844777de1246dff9c5558cf8094e792f551` and bucket 3205. These are synthetic test values, not production key recommendations.

Tenant-specific assignment keys and exposure IDs use distinct HMAC domains. Explanations contain only the algorithm, public allocation fingerprint, hashed/override/stored/preserved/rebucketed reason and persistence mode—no subject/tenant token, trait, storage key or secret. Config/catalog labels must themselves be nonpersonal. Opaque/HMAC references are still linkable private data, not anonymization. Changing the tenant secret changes assignment references; durable definition registration intentionally fails closed on unplanned salt changes. There is no transparent key rotation/rekey migration; plan one with the host store rather than silently rebucketing or deleting existing state. Close zeroes the evaluator's owned secret copy after actual work settles; the host still owns its original key and JavaScript cannot certify complete memory erasure.

### Optional durable assignments

Pass a host-owned `ExperimentAssignmentStore` with `contract:'ztrial-experiment-store-v1'` and `durability:'durable'`. Its operations must use a shared, linearizable primary:

1. `register({scope,experiment,version,fingerprint},{signal})` atomically inserts or compares an immutable definition. A conflict fails before allocation lookup. The fingerprint binds the tenant secret and versioned definition, so same-version edits/salt changes cannot be mistaken for the old allocation.
2. `get(key,{signal})` returns a private assignment snapshot containing key/scope/experiment/version/allocationHash/variant/revision.
3. `cas(key,expectedRevision,next,{signal})` performs a unique insert when the revision is null or compares/advances the exact existing revision atomically. Never emulate it with ordinary cache get/set.

The evaluator validates returned scope/version/variant/fingerprint and retries a CAS conflict at most three times. It never falls back to independent stateless assignment on a store outage, unknown version, rollback or malformed record. Registration is idempotent and bounded to the selected experiment's retained history. Store assignment cardinality, capacity, encryption, retention, replication, backups and deadlines are host responsibilities; retain assignments and version definitions for the experiment's lifetime. Eviction/deletion can make a subject newly assigned under current weights and therefore is a rollout policy change, not an invisible cache optimization. No production DB adapter or cross-process durability proof is bundled; test doubles only qualify the contract behavior. Without a store, evaluation is stateless and retains no per-subject map.

### Idempotent, bounded recording and analytics

Recording is off by default. Configure `recording:{recorder,failure:'error'|'ignore',maxRecords?}` explicitly. The recorder declares `contract:'ztrial-experiment-recorder-v1'` and implements `recordOnce(exposure,{signal,scope,limit})`, atomically returning `recorded`, `duplicate` or `capacity`. Exposure is only `{id,experiment,version,variant}`; no personal traits, raw subject, tenant token, consent profile, cookie or request body is supplied. The opaque exposure ID is stable for subject/experiment/version. A duplicate ID with different data must reject. The scope is a tenant/experiment/version HMAC namespace; the recorder must enforce its **atomic per-scope limit**, including duplicates-before-capacity handling, rather than evicting old receipts.

`maxRecords` defaults to 100000 (1–10000000). `maxRecordPending` defaults to 8 (1–16); excess callbacks reject rather than forming an unbounded queue. Recording capacity/overload is explicit; backend failures have an uncertain recording outcome. `failure:'error'` rejects evaluation, while `ignore` returns the assignment with `recording:'failed'`; neither silently claims a successful exposure. Host callbacks own durable receipt/outbox transactions and storage lifecycle. An ordinary nonthrowing `analytics.track()` call, a local Set plus network send, or a queue job ID cannot prove idempotent durable recording. Assignment persistence and exposure persistence are distinct operations; a failure between them can leave a sticky assignment with no recorded exposure until replay. Reuse the stable receipt ID and host reconciliation policy.

`experimentAnalyticsSchema(catalog)` returns finite schema data accepted by `@zeruxjs/analytics.createEventSchemaRegistry`, with dimension fields `experiment`, numeric `version`, and `variant`. It imports no analytics code. Its event name is `experiment.assignment.<full-catalog-fingerprint>` and schema version is 1, so a changed catalog/enum gets a new namespace instead of silently redefining an immutable analytics allowlist. Use the returned name, retain old catalog/schema namespaces, and apply the host's reporting/migration policy. More than 256 distinct variant names across the catalog rejects this helper, while evaluation can still use the catalog. Field enums do not claim to validate every cross-field combination; the trusted evaluator supplies those combinations.

A host recorder can map an authorized exposure to `{name:schema.name,source:'server',site:verifiedSite,consent:'granted',properties:{experiment,version,variant}}`, coordinating its unique receipt with the explicit durable analytics workflow if durability is required. The host owns occurrence timestamps, verified site mapping, current consent/retention, schema registration and any visitor linkage; none is inferred. This subpath collects no arbitrary traits, and no analytics sink begins on import.

### Cancellation, cleanup and statistical limits

`maxConcurrent` defaults to 32 (1–128). `timeoutMs` defaults to 3000 (1–60000 ms); each evaluation also accepts `{signal}`. Resolver, store and recorder receive cooperative cancellation. A timeout stops the caller waiting, but an in-progress native write/receipt may still commit. Its slot remains occupied until actual settlement, and no later stage starts after observed cancellation. Close is idempotent, rejects new work, aborts active scopes and drains actual settlement before releasing owned key/config data. It never closes borrowed stores/recorders. Noncooperative dependencies can delay close; this does not force-cancel arbitrary JavaScript or roll back external writes. Errors expose fixed codes with private, non-enumerable causes; do not publish raw causes.

Allocation percentages describe configured target traffic, not guaranteed realized counts, balance, conversions or causal significance. This API performs no power calculation, confidence interval, sequential testing, multiple-comparison correction, sample-ratio mismatch diagnosis or statistical analysis. Consent/eligibility changes, missing exposures, shared identities, overrides, rollout migrations and selection bias can invalidate simple comparisons. Predefine experiment units, outcomes, stopping/analysis plans and privacy policy separately; named variants are not evidence that an experiment succeeded.

Focused checks cover stable multi-variant allocation, invalid weights, environment/consent/tenant denial, trusted overrides, durable CAS races, preserved/rebucketed rollouts, same-version/salt conflicts, analytics schema validation, recording limits/failure policies, timeout and close cleanup. Packed offline declarations/examples and existing isolated runner checks also run. No framework/DOM/browser adapter changed. Production authentication, a qualified shared assignment/recording store and live multi-instance acceptance remain host prerequisites; no browser, live provider or statistical significance acceptance is claimed.


## Implementation sources

- [packages/ztrial/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/README.md)
- [packages/ztrial/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/package.json)
- [packages/ztrial/src/http/fake.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/src/http/fake.ts)
- [packages/ztrial/src/http/inputs.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/src/http/inputs.ts)
- [packages/ztrial/src/core/runner.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/src/core/runner.ts)
- [packages/ztrial/src/adapters/playwright/session.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/src/adapters/playwright/session.ts)
- [packages/ztrial/src/coverage.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/src/coverage.ts)
- [packages/ztrial/src/results.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/src/results.ts)
- [packages/ztrial/src/reports/schema.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/src/reports/schema.ts)
- [packages/ztrial/src/reports/export.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/src/reports/export.ts)
- [packages/ztrial/src/reports/optional.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/ztrial/src/reports/optional.ts)
