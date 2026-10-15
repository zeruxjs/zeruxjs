import { AiProviderError } from './types.js';
import type { AiProvider, ChatMessage, ChatOptions, ProviderConfig } from './types.js';
import { parseAiSse } from './sse.js';

function validateMessages(messages: ChatMessage[]): void {
  if (!Array.isArray(messages) || !messages.length || messages.some(m => !m || !['system','user','assistant','tool'].includes(m.role) || typeof m.content !== 'string')) throw new TypeError('Invalid messages');
}
function validateChatOptions(options: ChatOptions): void {
  if (options.temperature !== undefined && (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2)) throw new RangeError('Invalid temperature');
  if (options.topP !== undefined && (!Number.isFinite(options.topP) || options.topP < 0 || options.topP > 1)) throw new RangeError('Invalid topP');
  if (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1)) throw new RangeError('Invalid maxTokens');
}
function retryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 60000) : undefined;
}

export function createOpenAICompatibleProvider(config: ProviderConfig): AiProvider {
 const endpoint = new URL(config.baseUrl);
 if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search) throw new TypeError('Invalid endpoint URL');
 if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))) throw new TypeError('AI endpoint must use HTTPS');
 if (!config.model?.trim() || !config.apiKey?.trim()) throw new TypeError('Model and API key required');
 const timeout = config.timeoutMs ?? 30000;
 if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('Invalid timeout');
 const maxBytes = config.maxResponseBytes ?? 4 * 1024 * 1024;
 if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid maximum response size');
 const request = config.fetch ?? fetch;
 const url = new URL(`${endpoint.pathname.replace(/\/$/, '')}/chat/completions`, endpoint.origin);
 async function send(messages: ChatMessage[], options: ChatOptions, stream: boolean): Promise<{ response: Response; release: () => void; signal: AbortSignal }> {
   validateMessages(messages); validateChatOptions(options);
   const controller = new AbortController();
   const cancel = () => controller.abort(options.signal?.reason);
   if (options.signal?.aborted) cancel();
   else options.signal?.addEventListener('abort', cancel, { once: true });
   const timer = setTimeout(() => controller.abort(new Error('AI request timed out')), timeout);
   const release = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); };
   try {
     const headers = new Headers(config.headers);
     // Never allow caller-supplied headers to replace the configured credential.
     headers.set('Authorization', `Bearer ${config.apiKey}`);
     headers.set('Content-Type', 'application/json');
     if (stream) headers.set('Accept', 'text/event-stream');
     const response = await request(url, {
       method: 'POST', headers, redirect: 'error',
       body: JSON.stringify({ model: config.model, messages, temperature: options.temperature, max_tokens: options.maxTokens, top_p: options.topP, stream }),
       signal: controller.signal,
     });
     if (!response.ok) throw new AiProviderError(`AI provider returned HTTP ${response.status}`, response.status, [408,409,425,429,500,502,503,504].includes(response.status), retryAfter(response.headers));
     if (Number(response.headers.get('content-length')) > maxBytes) throw new AiProviderError('Provider response is too large');
     if (!response.body) throw new AiProviderError('Empty AI response');
     return { response, release, signal: controller.signal };
   } catch (error) { release(); throw error; }
 }
 return {
   async chat(messages, options = {}) {
     const { response, release } = await send(messages, options, false);
     try {
       const reader = response.body!.getReader(); const parts: Uint8Array[] = []; let length = 0;
       try {
         while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maxBytes) throw new AiProviderError('Provider response is too large'); parts.push(value); }
       } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
       const raw = new Uint8Array(length); let cursor = 0;
       for (const part of parts) { raw.set(part, cursor); cursor += part.byteLength; }
       let data: { choices?: Array<{ message?: { content?: unknown } }> };
       try { data = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new AiProviderError('Invalid JSON from AI provider'); }
       const content = data.choices?.[0]?.message?.content;
       if (typeof content !== 'string') throw new AiProviderError('Invalid AI response shape');
       return content;
     } finally { release(); }
   },
   async *stream(messages, options = {}) {
     const { response, release, signal } = await send(messages, options, true);
     try {
       const contentType = response.headers.get('content-type') ?? '';
       if (!/^text\/event-stream(?:;|$)/i.test(contentType)) throw new AiProviderError('Expected text/event-stream');
       yield* parseAiSse(response.body!, maxBytes, signal);
     } finally { release(); }
   },
 };
}
