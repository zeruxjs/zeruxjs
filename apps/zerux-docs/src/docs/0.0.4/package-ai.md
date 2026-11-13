---
{
  "title": "AI chat providers",
  "description": "Use bounded server-side chat completion adapters with deliberate retry and stream behavior.",
  "section": "Packages",
  "order": 25,
  "sources": [
    "packages/@zeruxjs/ai/README.md",
    "packages/@zeruxjs/ai/package.json",
    "packages/@zeruxjs/ai/src/model-adapters.ts",
    "packages/@zeruxjs/ai/src/registry.ts",
    "packages/@zeruxjs/ai/src/tools.ts",
    "packages/@zeruxjs/ai/src/tool-transports.ts",
    "packages/@zeruxjs/ai/examples/tools.mjs",
    "packages/@zeruxjs/ai/src/content.ts",
    "packages/@zeruxjs/ai/examples/content.mjs",
    "packages/@zeruxjs/ai/src/structured.ts",
    "packages/@zeruxjs/ai/examples/structured.mts",
    "packages/@zeruxjs/ai/evaluation/cases.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/ai"
}
---

## Construct the provider

```ts
import { createAiClient, createOpenAICompatibleProvider, withConcurrencyLimit } from '@zeruxjs/ai';
const provider = withConcurrencyLimit(createOpenAICompatibleProvider({
  apiKey: process.env.AI_API_KEY!, baseUrl: 'https://api.example.test/v1',
  model: 'my-model', timeoutMs: 30000
}), { maxConcurrent: 4, maxQueued: 20 });
const client = createAiClient(provider);
const answer = await client.complete('Summarize the supplied text.');
```

This is an OpenAI-compatible Chat Completions transport, not a complete provider SDK or Responses API adapter. Credentials stay on the server. HTTPS or loopback HTTP endpoints are accepted; redirects are rejected to avoid forwarding bearer credentials elsewhere.

## Streaming

SSE text is decoded across network and UTF-8 boundaries with total/frame size bounds. Streams emit text only, not complete tool/multimodal event structures. Stop iteration to close the reader, or abort to request cancellation. Admission remains owned until the injected provider/reader actually settles; cancellation alone does not prove a slot is free.

## Retry and fallback

withRetry retries explicit retryable provider failures with bounded delay; arbitrary errors are not automatically retried. It does not replay an already-started stream. Fallback can select another provider only before output has been emitted, and aborts must remain aborts.

## Application responsibilities

Authorize requests, cap input/output budgets, manage cost and redact sensitive prompts/logs. Provider output is untrusted text, not executable HTML or a policy decision. Validate any tool action in trusted application code.

## Install and select the integration

```sh
npm install @zeruxjs/ai@0.0.4
```

There is no automatic `ai` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Configure a server-side provider, then compose concurrency, retry and fallback wrappers before constructing the client. maxConcurrent bounds active requests and maxQueued bounds pending work; a queue bound is essential when a downstream model slows. Keep the API key in the server process and use an approved HTTPS endpoint. The implementation is Chat Completions-compatible text transport, not a complete vendor SDK.

## TypeScript: inputs, results and ownership

```ts
import { createOpenAICompatibleProvider } from '@zeruxjs/ai';

type Inputs = Parameters<typeof createOpenAICompatibleProvider>;
type Result = Awaited<ReturnType<typeof createOpenAICompatibleProvider>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createOpenAICompatibleProvider>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Stop iteration or propagate an AbortSignal when a browser disconnects or a request is cancelled. Retry only explicitly retryable failures; never replay partial stream output. Fallback is safe only before text is emitted. Record provider errors and timing without raw prompts, completions or bearer credentials. Bound input size and output cost outside the provider adapter.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### ProviderConfig

| Field              | Accepted type/value     | Optional |
| ------------------ | ----------------------- | -------- |
| `apiKey`           | `string`                | No       |
| `baseUrl`          | `string`                | No       |
| `model`            | `string`                | No       |
| `fetch`            | `typeof fetch`          | Yes      |
| `timeoutMs`        | `number`                | Yes      |
| `headers`          | `Record<string,string>` | Yes      |
| `maxResponseBytes` | `number`                | Yes      |

### ChatOptions

| Field         | Accepted type/value | Optional |
| ------------- | ------------------- | -------- |
| `signal`      | `AbortSignal`       | Yes      |
| `temperature` | `number`            | Yes      |
| `maxTokens`   | `number`            | Yes      |
| `topP`        | `number`            | Yes      |

### AiConcurrencyOptions

| Field           | Accepted type/value | Optional |
| --------------- | ------------------- | -------- |
| `maxConcurrent` | `number`            | No       |
| `maxQueued`     | `number`            | Yes      |

## Dedicated model adapters

`createAnthropicProvider` and `createGeminiProvider` retain string chat/stream and
optionally expose rich text/usage/finish metadata. Explicitly register borrowed
instances with `createAiProviderRegistry`; tools are unsupported and capability
requirements fail closed. No provider packages are scanned or loaded.

Anthropic requires an explicit API wire version; the newer version rejects removed
sampling parameters. Gemini targets generateContent v1beta, not Interactions or
Vertex. Keys stay server-side. Leading system messages are mapped deliberately;
tools/non-text output reject rather than being interpreted as text.

New factories share bounded FIFO admission, request/response/frame budgets and
cancellable readers. Stream failure after output never triggers replay. Metadata
is private response data, not telemetry; raw error bodies and keys are excluded
from error messages. Host authentication, tenant consent, egress and credential
ownership remain explicit. Retrieval stays in ai-model; Figma is a tool/data
integration rather than a model provider.

See the package README's capability/version matrix, official API references and
`examples/providers.mjs`. Fixture checks use ztrial's scoped HTTP fake, not live
Anthropic/Gemini/DeepSeek/Z.AI acceptance. Live checks need authorized credentials,
enabled account models, quota and network access.

## Controlled tool sessions

The optional server-only `@zeruxjs/ai/tools` entry explicitly registers handlers,
Standard Schema argument validation and mandatory authorization. A host authenticator
binds each session to an immutable initiating tenant/subject; privileged handlers
also require a fresh-proof callback. Model-produced schema-valid data never grants
permission or supplies a trusted destination.

Execution deadlines return typed outcomes with one generated execution ID. Started
side effects that time out/fail are uncertain and are never retried automatically.
Slots remain held until actual settlement, and close drains owned work. A separate
host planner contract bounds steps/calls/reported tokens; the text-only model
adapters do not silently become tool providers. Loop errors retain ID/state receipts
without private values.

Optional fixed zhost calls use authenticated, allowlisted endpoints with rejected
redirects and bounded JSON/SSE readers. Trusted in-memory OpenAPI subset imports
require per-operation approval and return inert descriptors only. No package,
command, URL or remote schema is executed from model input. See the package README
and `examples/tools.mjs` for limits, cancellation and deployment prerequisites.

## Inert media and source data

Optional `chatContent`/`streamContent` accept bounded typed parts. Anthropic maps
images/PDF; Gemini also maps selected inline audio/video. Text files can contain
code, JSON or markup without executing, importing, compiling or writing it. No
file paths, media URLs, archives or automatic remote file acquisition are accepted.
The native adapters still cannot invoke tools from a response.

Buffered structured JSON output requires a host schema validator; incomplete or
invalid JSON rejects. Streams remain untrusted partial text. Host UIs must escape
markup, and hosts must authorize and obtain consent before sharing private files
with a provider. See README capability/MIME/budget details and the content example.
Opaque-byte fixtures verify transport and inertness; live media/model decoding is
not qualified.

## Structured request budgets and local evaluation

The optional structured entry combines provider-native JSON capability checks with
independent host schema validation. Unsupported providers reject unless text-JSON
fallback is explicitly selected. One ledger bounds attempts, output/depth, time,
concurrency, token reservations and optional versioned host-price estimates.
Unknown usage stays unknown; hidden retry/tool execution layers are rejected.

Repairs use a fixed instruction and never execute or replay tool effects. Timeout
receipts retain unknown reservations, and close drains actual native work.
Accounting/estimators are not vendor billing guarantees. See the typed structured
example for inferred validator output and ownership.

The packaged zx100-local-v1 fixture reports schema/citation/retrieval-answerability
metrics separately from truthfulness/quality (unmeasured). It uses deterministic
local providers, no external requests and no private repository evidence. Live
model evaluations need separate explicit data-disclosure authorization and actual
model/configuration reporting.

## Maintaining the transport and execution boundaries

The package README maps each source owner. Native adapters build only their declared wire envelopes; content encoding treats filenames, source code, JSON and opaque media bytes as data. Structured generation owns its separate cumulative attempt/output/token/cost ledger and independent validator. Tool execution remains an explicitly registered, authenticated server boundary with uncertain outcomes after a possible side-effect commit.

Public examples in `packages/@zeruxjs/ai/examples/` document each parameter and cleanup owner. They start no requests on import. Provider registries borrow instances, structured clients drain their native jobs, and tool sessions/executors own their cancellation listeners and unsettled work. A host must qualify credentials, model/version, consent and deployment egress separately; local fixtures do not certify provider behavior.
