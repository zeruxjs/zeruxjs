# @zeruxjs/ai

Provider-agnostic chat with OpenAI-compatible _Chat Completions_, bounded buffered responses, incremental SSE text streaming, retries for explicit transient errors, fallbacks and concurrency limiting.

```ts
import { createAiClient, createOpenAICompatibleProvider, withRetry, withConcurrencyLimit } from '@zeruxjs/ai';
const provider = withConcurrencyLimit(withRetry(createOpenAICompatibleProvider({
  apiKey: process.env.AI_API_KEY!, baseUrl:'https://api.example.test/v1', model:'my-model', timeoutMs:30000,
})), {maxConcurrent:4,maxQueued:20});
const client = createAiClient(provider);
const answer = await client.complete('Summarize this');
for await (const delta of client.streamComplete('Stream a summary')) process.stdout.write(delta);
const usage = provider.status(); // {active,queued}
```

- SSE events are decoded across UTF-8 and network chunk boundaries; the current stream parser emits text content only, not multimodal data or tool-call fragments.
- Total streamed response size and individual frame size are bounded. Provider responses must have `Content-Type: text/event-stream`.
- Abort signals and timeouts cancel requests. Stop iterating to cancel an SSE connection and free a concurrency slot.
- Explicit `AiProviderError.retryable === true` responses can be retried with bounded exponential delay and parsed Retry-After. Arbitrary errors are **not** retried. Streaming connections are not replayed by `withRetry` because replaying a partial answer is unsafe.
- `withFallback()` can switch providers before any streaming output, but never after chunks were emitted.
- Only HTTPS or loopback HTTP base URLs are accepted. Redirects are rejected so bearer credentials are not forwarded to another host. Credentials must remain server-side.

The package does not provide OpenAI Responses API, gRPC, image/audio generation or a complete provider-specific SDK; that requires dedicated adapters.

`withFallback().stream()` now falls back for **pre-output** failures even if the primary has no native stream, without retrying aborted requests. It cannot safely switch a model once output has been yielded. Provider endpoints, pricing and credentials are owned by the application.

## Explicit model adapters and registry

`createAnthropicProvider` implements Messages text chat/stream; `createGeminiProvider`
implements Gemini Developer API `generateContent`/`streamGenerateContent` SSE.
Both retain `chat():Promise<string>` and `stream():AsyncIterable<string>` and add
optional `chatResult()` / `streamEvents()` methods. Existing structural providers
and ai-model retrieval consumers need no changes. Retrieval belongs to ai-model;
model transport belongs here. Figma is a tool/data source, not a model adapter.

[Public-import example](examples/providers.ts) constructs an application-owned
`createAiProviderRegistry`. Explicit names register borrowed instances, not package
names or discovered code. Registration tokens remove only their own entry;
duplicate names/capacity reject. Default registry capacity is 16 (maximum 128).
`get(name,['usage'])` negotiates declared capabilities, rejecting unknown/missing
ones. Closing the registry clears references; already returned providers remain
usable, and the host cancels their calls with request/generation signals.

| Adapter                            | Chat | Text stream | Tools | Usage                 |
| ---------------------------------- | ---- | ----------- | ----- | --------------------- |
| OpenAI-compatible Chat Completions | yes  | yes         | no    | not exposed           |
| Anthropic Messages                 | yes  | yes         | no    | reported token counts |
| Gemini Developer generateContent   | yes  | yes         | no    | reported token counts |

Capabilities are optional on legacy providers; absence is unknown, not support.
New adapters have four active calls and 16 queued by default, configurable through
`maxConcurrent`/`maxQueued` using existing FIFO admission. All text/rich methods
share the same slots. `withConcurrencyLimit` and `withRetry` preserve optional rich
methods/capabilities. `withFallback` remains the legacy text-only projection and
advertises singleAttempt:false and no rich JSON/usage support across potentially different models.
There is no automatic fallback, tool execution, tenant session or prompt history.
Hosts authorize every invocation and keep provider instances/configuration private.

### Wire versions and supported subset

Anthropic requires an explicit `apiVersion:'2023-06-01'|'2026-10-21'`.
The older version maps leading system messages to top-level `system`; the newer
version sends inline system messages and rejects temperature/topP because those
parameters were removed. No automatic version migration or model discovery occurs.
The provider defaults max_tokens to 1024 unless maxTokens is supplied; individual
models/accounts may reject unsupported limits/options. Gemini uses v1beta, leading
systemInstruction, user/model contents and one candidate. It sends its API key in
`x-goog-api-key`, never a query parameter. These adapters cover direct first-party
REST endpoints, not Vertex/Bedrock/Foundry/OAuth or the newer Gemini Interactions API.

Legacy chat/stream messages are text system/user/assistant only, leading system messages only; tool
roles, names and non-text/function-call output reject. Unknown request options
reject rather than silently accepting tools. Gemini thought text is excluded from
the text projection but remains private response metadata; Anthropic non-text
blocks reject. No multimodal, thinking, continuation, citation or tool protocol is
promised. Unknown response fields/reasons remain available in providerMetadata;
the normalized reason is stop/length/blocked/tool/unknown without inventing parity.

Rich chat results contain text, optional reported input/output/total tokens,
finishReason and the bounded original response. Streaming emits text and metadata
events; usage fields are cumulative reported snapshots, merged when provided, not
summed across chunks. Anthropic cache-token details and Gemini thought/cached-token
details remain in providerMetadata; normalized totals are never invented by adding
incomparable provider counters. Unknown reasons remain unknown. Metadata may
contain private generated content, thinking, safety details and response IDs:
**do not log or send it to analytics automatically**. Errors expose fixed messages,
HTTP status, retryability and capped Retry-After. Non-enumerable providerMetadata
retains limited provider/version/request-ID context (or stream error type), not
raw error bodies/prompts/keys. Treat even this metadata as private diagnostic data.

### Bounds and ownership

New adapters default to 1 MiB request and 4 MiB total response budgets (maximum
16/64 MiB), 256 messages, 128 KiB SSE frame code units and 30-second deadline
(maximum five minutes). Chat bodies and SSE share UTF-8 fatal decoding and bounded
readers; streams require text/event-stream and a terminal provider marker/reason.
Incomplete streams fail, including after partial output. LF/CRLF SSE framing is
supported. Unknown Anthropic events survive as rich metadata without being
interpreted as text. Request credentials and configured endpoints are server-owned;
new adapters reject browser window runtimes, non-HTTPS except loopback fixtures,
URL credentials/query/fragments and credential header overrides. Redirects reject.
The host owns endpoint/egress allowlists for custom transports and must never build
an endpoint or credential configuration from client input.

New adapters make one transport attempt. Explicit withRetry retries only typed
transient **buffered** failures, with a finite attempt budget; it never replays
streams. withFallback switches only before text emission and is an explicit
cross-provider data-disclosure decision. Partial output is never replayed. Abort,
timeout, parse/HTTP failures and early iterator return cancel readers, remove
listeners and release admission after settlement. Injected fetch remains borrowed;
a noncooperative transport can retain a slot despite signal cancellation. No
background credential refresh, pool or remote call starts on import/construction.
OpenAI-compatible requests now also enforce request/message budgets and cancel
unconsumed error/MIME-failure bodies; their existing return values stay unchanged.

### Official references and qualification

Reviewed first-party references: [Anthropic Messages](https://platform.claude.com/docs/en/api/messages),
[stream events](https://platform.claude.com/docs/en/build-with-claude/streaming),
[version changes](https://platform.claude.com/docs/en/api/versioning),
[Gemini content API](https://ai.google.dev/api/generate-content?hl=en) and
[API-key handling](https://ai.google.dev/gemini-api/docs/api-key).
The existing OpenAI-compatible adapter remains usable for the documented basic
Chat Completions subset at [DeepSeek](https://api-docs.deepseek.com/) and
[Z.AI](https://docs.z.ai/guides/overview/quick-start): configure the host-approved
base URL/model explicitly. No dedicated brand factory, reasoning/tool extension,
SDK equivalence or live vendor compatibility is claimed.

Tests use ztrial's scoped injected HTTP fake plus targeted reader/abort fixtures,
not global fetch interception or live providers. Credentials, enabled model IDs,
account quotas and authorized network access are required for live acceptance;
no live Anthropic/Gemini/DeepSeek/Z.AI calls were made.

## Controlled server tools

The optional Node-only `@zeruxjs/ai/tools` entry exports `createToolExecutor`,
`createZhostToolHandler` and `approvedOpenApiToolOperations`. Core/root imports do
not load this entry or Node crypto. Existing root and legacy deep imports remain
available. Importing tools starts no handlers, listeners, fetches or timers.
See [the public-import example](examples/tools.ts); its validator is supplied by
the host and no validator runtime dependency is added to AI.

Register trusted handler functions explicitly; names, descriptions and declarative
object inputSchema are bounded. InputSchema describes the model-facing contract;
a required Standard Schema V1 `schema` performs actual input validation (including
host-selected validator schemas). Validation/transforms and authorization must be
pure checks, not side-effect operations. Both raw and parsed inputs pass bounded
plain JSON snapshots; classes/functions/accessors/cycles and nonfinite values
reject. Schema issues/private values are never returned in tool outcomes.
Schema descriptions/results are untrusted model data, never executable code or
permission. Keep descriptions/public schemas free of secrets.

`executor.session(hostContext, signal)` calls the mandatory host authenticator,
snapshots its verified opaque tenant/subject and binds every invocation to that
identity. It does not trust model-supplied tenant, subject or forwarded headers.
Integrate existing shared-auth validation/fresh-proof policy in host callbacks;
no automatic auth-store lookup or session creation occurs. Every registered tool
requires `authorize(context,args)`. `privileged:true` additionally requires
`reauthorize(context,args)` immediately before execution; it must check current
permissions and recent proof according to the action, not merely schema validity.
Host handlers must use context.principal for tenant-bound database/service access.
Application code/remote servers remain trusted to enforce their own boundaries;
registration is not a sandbox for arbitrary JavaScript.

### Execution outcomes and ownership

Each attempt receives one host-generated UUID executionId, shared by context,
audit and outcome. No model-chosen execution ID, shell/package/URL evaluation or
automatic retry exists. Outcomes are succeeded, denied, invalid, unknown-tool,
overloaded, cancelled, failed or uncertain. No raw exception, arguments, identity,
result, token or destination appears in audit events. Audit contains only bounded
registered tool name, executionId, started/terminal/settled phase and state.
It is isolated best-effort observation; required durable audit/journaling must be
implemented by the host, not inferred from a callback.

A side-effect handler that has started is **uncertain** on error, timeout, lost
acknowledgement, result-budget failure or cancellation: it may have committed.
Never automatically retry it or infer rollback. Reconcile the same executionId
through host durable idempotency/journals and fresh authorization. A new execute
call creates a new attempt ID; this package does not persist/replay claims or
provide exactly-once effects. Even a read-only handler must truthfully declare
sideEffect:false. Cancellation before handler entry is cancelled, not uncertain.
Uncertain is the terminal caller outcome even when native work settles later;
late settlement only emits a redacted audit phase.

Defaults: 64 registered tools, 32 sessions, eight unsettled jobs, no queue,
5-second execution deadline, 64 KiB arguments/results/schema and 32 JSON levels /
10000 nodes. Configurable maxima are 256 tools/sessions, 128 jobs, 60 seconds and
1 MiB argument/results. Descriptions cap at 1024 characters. Timeout aborts the
handler signal and returns a bounded outcome; slots remain occupied until actual
validation/authorization/handler settlement. A noncooperative handler may continue
and can delay close. Session close stops new calls, aborts owned work and drains
it; executor close stops admission, closes sessions and drains authentication/work.
The host owns authentication/transport cancellation; a noncooperative authenticator
can likewise hold its slot until actual settlement. Disposing a registration
prevents future selection; already admitted handlers retain their captured entry.

`session.run(planner,{maxSteps,maxCalls,maxTokens})` is a separate explicit
ToolPlanner contract. Defaults are 4 steps, 8 calls and 4096 reported tokens;
maxima are 16/64/1000000. Calls execute sequentially within the shared job ceiling;
any denied/failed/uncertain outcome stops the loop. The planner receives remaining
budget and cancellation, and **must** enforce the provider's output token cap and
truthfully report total prompt/output usage. Reported overruns reject, but this
cannot undo already billed inference or verify a lying planner. Step/call/result
budgets still apply. No model adapter currently advertises tools:true or silently
parses generated prose as calls. The host must implement/qualify its planner;
withRetry/withFallback must not wrap side-effect execution.

### Fixed zhost calls and trusted OpenAPI definitions

`createZhostToolHandler` binds one host-configured HTTPS endpoint, exact allowed
origin and tool name. Loopback HTTP is allowed for fixtures. Arguments cannot
supply a URL/method/tool/credential. The required approveDestination callback
rechecks current tenant/destination policy before each request; the required
credentials callback supplies server-owned Authorization. Incoming cookies or
forwarded headers are never copied. Fetch is explicitly injected and borrowed,
redirect:'error' is mandatory, redirect responses reject, and there is no replay.
The host must qualify its transport and deployment DNS/connection egress policy;
an origin allowlist alone is not an SSRF sandbox or DNS-rebinding defense.

The helper targets zhost's **stateless MCP JSON-RPC tools/call subset**, using
protocol header 2025-11-25, fixed execution ID, JSON or one response carried in
SSE data. It does not discover/start servers, run stdio processes, negotiate
sessions, resume streams or implement notifications/elicitation/sampling. Empty
priming/notification SSE events are outside this narrow subset and reject. Zhost
still requires endpoint authorization; client credentials do not grant tenant
permission by themselves. Defaults are 64 KiB request/response and 32 frames,
maxima 1 MiB/256. Reader cancellation and early-result cleanup reuse AI's bounded
SSE parser. Network failures after side-effect dispatch remain uncertain. Credentials,
results and URLs never enter tool audit fields.

`approvedOpenApiToolOperations(document,{trusted:true,approve})` consumes only a
host-loaded in-memory OpenAPI 3.0.3/3.1.0 JSON subset. The trusted flag is a caller
assertion, not authentication of an uploaded document. At most 128 operations are
inspected; each operation requires an explicit synchronous approval decision.
It returns inert operationId/method/path/description/object inputSchema descriptors;
it neither registers handlers nor chooses servers/credentials or executes requests.
Hosts separately bind each approved descriptor to a Standard Schema validator,
authorization and an allowlisted handler. References, parameterized operations and
non-JSON/object request schemas reject; no remote reference, callback or source
module is evaluated/fetched. Import validation completes before descriptors return,
so a later invalid operation cannot partly mutate a published registry.

Protocol references: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [OpenAPI 3.1.0](https://spec.openapis.org/oas/v3.1.0.html). This deliberately
limited adapter is not full MCP/OpenAPI parity. Checks use the existing zhost MCP
implementation and injected Fetch/SSE fixtures; deployed OAuth/MCP servers, durable
side-effect recovery and real model-driven tool loops remain live prerequisites.

Loop failures throw `ToolLoopError` with a redacted budget/cancelled/failed code and
execution ID/state receipts for prior calls, without their private result values.
These receipts preserve reconciliation context when a loop exhausts its budget;
they do not make repeating a whole loop safe.

## Multimodal inputs and inert source files

Native Anthropic/Gemini adapters now optionally expose `chatContent(messages,
options)` and `streamContent(messages,options)`. The existing string chat/stream
API is unchanged. `chatContent` returns the rich text/usage result;
`streamContent` emits the existing text/metadata events. Concurrency and retry
wrappers preserve these methods, share their existing admission slots and never
retry streams. `capabilities.inputs` describes the implemented input wire formats;
`jsonOutput` can be required in the registry. Capabilities do not certify the
chosen model/account supports every modality—configure an enabled appropriate
model and handle provider rejection.

| Input part | Anthropic         | Gemini                                             | Local behavior                                            |
| ---------- | ----------------- | -------------------------------------------------- | --------------------------------------------------------- |
| text       | yes               | yes                                                | plain text, including Markdown/HTML/CSV/XML/YAML/code     |
| file       | yes               | yes                                                | caller-supplied text plus safe basename/language metadata |
| json       | yes               | yes                                                | bounded plain JSON serialized into a text part            |
| image      | JPEG/PNG/GIF/WebP | JPEG/PNG/GIF/WebP                                  | inline byte copy/base64 only                              |
| pdf        | PDF               | PDF                                                | inline bytes; no local document engine                    |
| audio      | rejects           | WAV/MP3/MPEG/AIFF/AAC/OGG/FLAC MIME subset         | inline bytes only                                         |
| video      | rejects           | MP4/MPEG/MOV/AVI/FLV/MPG/WebM/WMV/3GPP MIME subset | inline bytes only                                         |

See [the public example](examples/content.ts). Source file parts work with
JavaScript/TypeScript, Python, Go, Rust, Java, C/C++, shell, SQL, JSON and other
text languages; they are **not compiled, imported, evaluated, written or run**.
No extension activates a runtime. Only explicit JSON parts/outputs are parsed,
using JSON.parse plus bounded snapshots; JSON never becomes functions, imports,
commands or tool calls. Markup, Markdown and code in results remain untrusted
strings—host UIs must escape/sanitize before rendering, and must never pass them
to eval, shell execution or executable dynamic imports. The independent tools API
still requires explicit registration and authorization; content responses cannot
register or invoke tools. Provider code-execution/function tools are not requested.

Binary parts require a Uint8Array/Buffer, a supported MIME and user role. Media
is not permitted in system/assistant messages. URL/file/data-URL strings, local
paths, remote file IDs, executable binary MIME, SVG-as-image, archives and unknown
part fields reject. The adapter never opens a supplied filename, follows a media
URL, fetches remote content, unpacks an archive or loads a local media decoder.
A `file` filename is a 1–128 character alphanumeric-led basename containing only
letters/digits/underscore/dot/hyphen, without `..`; it grants no filesystem access.
SVG/HTML/source can be supplied as inert text when authorized. MIME declarations
are not malware scanning or verified codec/file signatures; original bytes go to
the explicitly configured provider. Hosts own file authorization, consent, secret
redaction and any independently qualified inspection/quarantine pipeline.

`content.allowedInputs` can narrow the advertised kinds. Default limits are 32
parts across multipart messages and 4 MiB per media part; maxima 128 parts and
12 MiB per media part. Base64 bytes count toward the **existing aggregate request
budget** (1 MiB by default, maximum 16 MiB), including JSON overhead at final
serialization. A small request budget can therefore reject a much smaller raw
file; increase it explicitly for small inline video. Larger media/upload APIs,
transcoding, video/image/audio generation and automatic provider file acquisition
are not implemented. Only validated caller bytes are sent. These are bounded
transport subsets, not universal format/model support.

### Structured JSON output

Buffered `chatContent` accepts `output:{type:'json',schema,validator}`. Schema is
bounded plain JSON (64 KiB) with remote/meta references disabled; `validator` is a
trusted host Standard Schema V1 validator, compatible with `@zeruxjs/validator`.
Anthropic uses output_config.format; Gemini v1beta uses the documented
responseMimeType/responseJsonSchema fields (provider schema/version support still
applies). Provider schema constraints are not a security or authorization boundary:
the returned text must have a successful stop, parse as strict JSON and pass the
host validator before `result.data` is present. Invalid/incomplete/refused JSON
rejects with a fixed error without echoing its values. Schema defaults/transforms
must return inert JSON too. Validators are host code and should be pure/bounded;
a noncooperative async validator retains its admission slot until settlement.

Structured validation is buffered only. Streaming output is untrusted partial
text, never a claim that a complete JSON document/schema has been validated;
passing output validation to streamContent rejects. No automatic Markdown fence
removal, JSON5/YAML evaluation, HTML rendering or code execution is performed.

Reviewed references: [Anthropic vision](https://platform.claude.com/docs/en/build-with-claude/vision),
[PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support),
[structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
[Gemini content wire formats](https://ai.google.dev/api/generate-content?hl=en),
[video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
and [documents](https://ai.google.dev/gemini-api/docs/document-processing).
Current guides also cover newer Interactions APIs; this adapter deliberately stays
on the documented generateContent v1beta contract. Tests use opaque byte fixtures,
injected transports and validators: they prove request mapping, bounds, inertness,
JSON handling and cleanup, not that a live model decoded those files correctly.
Live media/model acceptance requires authorized real files, credentials and quota.

## Budgeted structured responses

`@zeruxjs/ai/structured` exports `createStructuredClient`,
`StructuredResponseError` and host-owned pricing/budget types. The
[typed public-import example](examples/structured.mts) infers result.data from the
validator's Standard Schema output. It requires no AI-model, validator runtime,
pricing lookup or model dependency in this entry: the host injects the provider
and validator. Imports/construction start no requests, timers or logs.

`client.generate(messages,{jsonSchema,validator},{signal})` uses native JSON
output only when capabilities.jsonOutput is true and chatContent exists. Returned
text is parsed again, bounded and independently validated; provider data/claims
are never trusted as schema validation. Missing capability rejects by default.
Explicit fallback:'text-json' permits text generation plus the same independent
validation; a schema in a prompt is **not** a native constraint or generation
guarantee. No fallback is inferred, and refusal/incomplete native output is not
silently called a successful structured result. Schemas are bounded inert JSON,
with remote/meta references disabled; validators are trusted pure host code.

The provider must declare singleAttempt:true or have explicit host qualification
through qualifiedProvider:{singleAttempt:true,sideEffects:'none'}. Known retry/
fallback wrappers reject even with that assertion: withRetry marks singleAttempt
false when attempts exceed one, and withFallback marks it false. Host qualification
is not a sandbox or proof that arbitrary injected code respects budgets. Use one
attempt-owning layer. Tool-capable providers and tool-role messages reject; this
API never runs an executor/planner, registers tools or replays side effects.

### Request ledger and admission

Defaults: one attempt (maximum four), 5-second whole-request deadline (maximum
60 seconds), four concurrent unsettled requests (maximum 32), no queue, 256 KiB
accumulated output (maximum 1 MiB), 16 JSON nesting levels (maximum 32), 1 MiB
serialized input (maximum 4 MiB), 4096 input tokens/1024 output tokens reserved per
attempt and 16384 total accounted tokens (maximum 10 million). Configure budgets
explicitly for the model/task. Native/OpenAI-compatible calls now accept a
maxResponseBytes override that can only narrow the provider's configured reader
bound; the structured client passes its remaining output budget. Native wire
bounds include metadata/envelopes and may therefore reject before the text-only
ledger limit. Custom qualified transports must honor that bound themselves.

The deadline covers admission through validation/repair. Cancellation stops the
caller waiting, removes queued native waits where supported and signals active
work. The pending slot remains held until actual provider/validator settlement;
close aborts and drains requests without closing the borrowed provider. A timeout
may still have incurred provider charges. Its error ledger marks usage unknown
and retains the in-flight token/cost reservation. No remote work is force-cancelled
by stopping arbitrary JavaScript, and noncooperative host callbacks can delay close.

Repair is explicit maxAttempts>1, only for malformed/schema-invalid output under
the remaining ledger. It sends a fixed repair instruction, never evaluates or
feeds back the invalid private output as code/instructions. Provider/network
failures are not automatically retried. Each attempt is admitted **before**
dispatch against full configured per-attempt token and optional cost reservations;
reported usage replaces reservations where complete/consistent. Attempt/output/
time/token/cost exhaustion prevents further work. Invalid output cannot reset the
ledger. Unknown usage stops repair by default; unknownUsage:'reserve' is an
explicit host choice to continue under retained upper reservations.

Input admission uses a declared estimatorId/estimateInputTokens callback or
UTF-8-byte fallback over serialized messages/schema. That fallback and the host's
maxInputTokensPerAttempt are conservative application accounting, not proof of a
vendor's exact tokenizer/role overhead or billing cap. maxOutputTokensPerAttempt is
forwarded as the native maxTokens limit. Provider-reported overruns stop subsequent
work but cannot undo charges already incurred. Reserve output/system overhead and
qualify caps/estimators for the selected model before using economic limits in
production. Requests have independent ledgers; no cross-tenant monthly quota,
durable billing journal or shared account limit is inferred.

### Versioned pricing and unknown usage

Optional VersionedAiPricing contains a public id/version/currency and integer
inputMicrosPerMillionTokens/outputMicrosPerMillionTokens rates. The host supplies
and pins prices for the actual selected provider/model; no rates are fetched or
assumed. Integer micro-currency estimates round up using exact integer arithmetic.
maxCostMicros requires pricing and rejects a knowingly unaffordable next attempt
before dispatch. No pricing means cost unknown, not free.

Ledgers expose attempt/output counters, provider-reported input/output/total counts,
reported/unknown usage, accounted reservations and estimated/unknown cost with the
pricing version. Missing or inconsistent token breakdowns remain unknown; totals
alone do not identify input/output prices. Unallocated reported tokens use the
higher supplied rate for conservative admission. Cache/thinking/tool/server-side
fees, discounts and provider billing semantics may require a richer host pricing
system: this is a normalized estimate, never an invoice or financial guarantee.
Timeout/errors carry only fixed codes and ledger metadata. Prompts, document
bodies, schema issues, API keys and raw provider errors are not logged or included
in budget receipts. Result data remains untrusted JSON; no code/import/command or
tool call is executed from it.

### Fixed local evaluation

`evaluation/cases.json` is the versioned zx100-local-v1 public fixture; its model is
**deterministic-fixture-v1**, not a live model. Run package-local build/tests,
including `test/structured-evaluation.test.ts`, to produce a fixture-hash-tagged
report. It separately counts four schema accept/reject checks, three citation-ID
checks and three retrieval-answerability checks, plus expected-source/quoted
prompt-boundary checks. Malformed/type-invalid outputs, inert code strings,
missing/out-of-evidence citations and prompt-injected documents are included.
The test uses actual validator and ai-model evidence contracts with disposable
local Git/filesystem data, never repository/private documents or external APIs.

The current local fixture passes 4/4 schema, 3/3 citation and 3/3 answerability
checks. These measure contract handling, **not** truthfulness, semantic answer
quality, model prompt-injection resistance or production grounding. Those fields
are explicitly not-measured. No live provider evaluation is authorized or run by
this fixture. Any separate live run requires host authorization of data disclosure,
credentials, model/version, generation configuration, budgets and pricing; record
those actual exercised settings separately rather than relabeling local checks.

## Source ownership map

- `types.ts` defines the legacy text contract and optional rich capabilities; missing capability declarations remain unknown.
- `registry.ts` owns application-local name selection and registration leases. Providers are borrowed: registry close clears references without closing providers or cancelling already selected calls.
- `client.ts` owns prompt conveniences and explicit retry/fallback decisions. Buffered retries require typed retryable errors; streams never retry, and fallback stops after the first emitted text.
- `concurrency.ts` owns FIFO admission shared across supported methods. Iterator return and actual call settlement release slots; merely signalling cancellation does not force an injected provider to settle.
- `provider.ts` owns fixed-endpoint Chat Completions request timers/listeners and response cleanup. Injected Fetch pools remain host-owned.
- `sse.ts` owns reader locks, fatal streaming UTF-8 decoding, frame/response bounds and early-return cancellation. `safe-json.ts` snapshots inert data with descriptor, traversal and byte checks; it is not a sandbox for trusted callbacks or JavaScript Proxy traps.
- `model-adapters.ts` and `content.ts` own native wire mapping and inert content encoding. `structured.ts` independently owns validation and per-request accounting. `tools.ts`, `tool-transports.ts` and `tool-openapi.ts` remain a separate explicitly authorized execution boundary.

Retain and close the owners returned by `createAiProviderRegistry`, `createStructuredClient` and `createToolExecutor`. `createAiClient` itself only borrows a provider and adds no close operation. Host callbacks and transports must cooperate with cancellation; no wrapper can force-stop arbitrary JavaScript or undo a committed side effect. Source maintenance and local fixtures do not qualify live providers, pricing, codecs or deployed egress controls.

### Readability checks and fixed fixtures

The strict repository readability gate covers authored code, tests and public examples. Parameters, result fields, constant provenance and cleanup are documented at their owning declarations. Complexity/depth advisories remain visible for the native wire validation, structured ledger and tool lifecycle paths; these checks are not proof of sandboxing or live provider correctness.

`src/design/` contains inert static reference previews, not executable model tools or installed runtime assets. Their local HTML configuration inherits semantic validation and enforces Prettier-compatible lowercase doctypes, self-closing void elements and quoted attributes (double quotes unless embedded quotes require the alternate delimiter). It does not disable semantic/security rules. Formatting checks compare normalized parsed HTML/CSS structure; browser rendering was not qualified by this maintenance pass.

The fixed `evaluation/cases.json` retains its exact bytes and schema/version hash identity. It is the sole AI fixture excluded from whitespace rewriting; local evaluation still parses and exercises its schema/citation/retrieval cases. No private prompts or live requests enter this fixture.
