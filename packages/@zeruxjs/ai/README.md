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
