# AI chat providers

Use bounded server-side chat completion adapters with deliberate retry and stream behavior.


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


## Public entry points

Manifest reference for `@zeruxjs/ai@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/ai

Provider-agnostic chat with OpenAI-compatible *Chat Completions*, bounded buffered responses, incremental SSE text streaming, retries for explicit transient errors, fallbacks and concurrency limiting.

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

Section 80: `withFallback().stream()` now falls back for **pre-output** failures even if the primary has no native stream, without retrying aborted requests. It cannot safely switch a model once output has been yielded. Provider endpoints, pricing and credentials are owned by the application.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/ai/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/ai/README.md)
- [packages/@zeruxjs/ai/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/ai/package.json)
