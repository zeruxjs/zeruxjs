import { AiProviderError } from './types.js';
/** Parse WHATWG SSE frames incrementally; supports UTF-8 split across network chunks. */
export async function* parseAiSse(source: ReadableStream<Uint8Array>, maxBytes: number, signal?: AbortSignal): AsyncIterable<string> {
  const reader = source.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', received = 0, completed = false;
  let current: string[] = [];
  const event = (lines: string[]): string | undefined => {
    if (!lines.length) return undefined;
    const data = lines.join('\n');
    if (data === '[DONE]') { completed = true; return undefined; }
    let payload: unknown;
    try { payload = JSON.parse(data); } catch { throw new AiProviderError('Malformed AI stream event'); }
    if (payload && typeof payload === 'object' && 'error' in payload) throw new AiProviderError('AI streaming provider reported an error');
    const choices = (payload as { choices?: Array<{ delta?: { content?: unknown }, finish_reason?: unknown }> }).choices;
    const delta = choices?.[0]?.delta?.content;
    if (delta === undefined || delta === null) return undefined;
    if (typeof delta !== 'string') throw new AiProviderError('Invalid streamed AI content');
    return delta;
  };
  try {
    while (!completed) {
      if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new AiProviderError('Provider stream exceeds size limit');
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 256 * 1024) throw new AiProviderError('AI stream frame is too large');
      while (!completed) {
        const newline = buffer.indexOf('\n');
        if (newline === -1) break;
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line) { const text = event(current); current = []; if (text !== undefined) yield text; }
        else if (line.startsWith('data:')) current.push(line.slice(5).replace(/^ /, ''));
        if (current.join('').length > 128 * 1024) throw new AiProviderError('AI stream frame is too large');
      }
    }
    if (!completed) {
      buffer += decoder.decode();
      if (buffer) {
        for (const line of buffer.split(/\r?\n/)) if (line.startsWith('data:')) current.push(line.slice(5).replace(/^ /, ''));
      }
      const text = event(current);
      if (text !== undefined) yield text;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
