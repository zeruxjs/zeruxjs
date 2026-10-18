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
