---
{
  "title": "Test runner and assertions",
  "description": "Set up ztrial with explicit lifecycle, typed public APIs and deployment boundaries.",
  "section": "Packages",
  "order": 210,
  "package": "ztrial",
  "sources": [
    "packages/ztrial/README.md",
    "packages/ztrial/package.json",
    "packages/ztrial/src/http/fake.ts",
    "packages/ztrial/src/http/inputs.ts",
    "packages/ztrial/src/core/runner.ts",
    "packages/ztrial/src/adapters/playwright/session.ts",
    "packages/ztrial/src/coverage.ts",
    "packages/ztrial/src/results.ts",
    "packages/ztrial/src/reports/schema.ts",
    "packages/ztrial/src/reports/export.ts",
    "packages/ztrial/src/reports/optional.ts"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

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

| Option           | Accepted TypeScript value      | Required | Meaning                                                                           |
| ---------------- | ------------------------------ | -------- | --------------------------------------------------------------------------------- |
| `timeoutMs`      | `number`                       | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `retries`        | `number`                       | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `throwOnFailure` | `boolean`                      | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `match`          | `string \| RegExp`             | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `bail`           | `boolean`                      | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `forbidOnly`     | `boolean`                      | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `onResult`       | `(result: TestResult) => void` | No       | Application-supplied callback or adapter; see the setup and lifecycle discussion. |

### ZtrialConfig

| Option      | Accepted TypeScript value | Required | Meaning                                                                          |
| ----------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `root`      | `string`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `files`     | `string[]`                | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `reporter`  | `'pretty'\|'json'\|'tap'` | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `bail`      | `boolean`                 | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowOnly` | `boolean`                 | No       | Passed using this declared shape; omission is allowed only when marked optional. |

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
