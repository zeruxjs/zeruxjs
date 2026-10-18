---
{
  "title": "AI chat providers",
  "description": "Use bounded server-side chat completion adapters with deliberate retry and stream behavior.",
  "section": "Packages",
  "order": 25,
  "sources": [
    "packages/@zeruxjs/ai/README.md",
    "packages/@zeruxjs/ai/package.json"
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

SSE text is decoded across network and UTF-8 boundaries with total/frame size bounds. Streams emit text only, not complete tool/multimodal event structures. Stop iteration or abort to cancel and release concurrency slots.

## Retry and fallback

withRetry retries explicit retryable provider failures with bounded delay; arbitrary errors are not automatically retried. It does not replay an already-started stream. Fallback can select another provider only before output has been emitted, and aborts must remain aborts.

## Application responsibilities

Authorize requests, cap input/output budgets, manage cost and redact sensitive prompts/logs. Provider output is untrusted text, not executable HTML or a policy decision. Validate any tool action in trusted application code.

## Install and select the integration

```sh
npm install @zeruxjs/ai@0.0.2
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

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `apiKey` | `string` | No |
| `baseUrl` | `string` | No |
| `model` | `string` | No |
| `fetch` | `typeof fetch` | Yes |
| `timeoutMs` | `number` | Yes |
| `headers` | `Record<string,string>` | Yes |
| `maxResponseBytes` | `number` | Yes |

### ChatOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `signal` | `AbortSignal` | Yes |
| `temperature` | `number` | Yes |
| `maxTokens` | `number` | Yes |
| `topP` | `number` | Yes |

### AiConcurrencyOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `maxConcurrent` | `number` | No |
| `maxQueued` | `number` | Yes |
