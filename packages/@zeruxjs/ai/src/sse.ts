import { AiProviderError } from './types.js';
/** Shared bounded SSE framing; never evaluates provider data. */
export async function* parseAiSseEvents(source: ReadableStream<Uint8Array>, maxBytes: number, signal?: AbortSignal): AsyncIterable<string> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 67108864)
        throw new RangeError('Invalid stream budget');
    const reader = source.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '', received = 0, current: string[] = [], frame = 0;
    const abort = () => { void reader.cancel().catch(() => { }); };
    signal?.addEventListener('abort', abort, { once: true });
    function line(value: string): string | undefined { if (!value) {
        const data = current.length ? current.join('\n') : undefined;
        current = [];
        frame = 0;
        return data;
    } frame += value.length; if (frame > 131072)
        throw new AiProviderError('AI stream frame is too large'); if (value.startsWith('data:'))
        current.push(value.slice(5).replace(/^ /, '')); }
    try {
        while (true) {
            signal?.throwIfAborted();
            const { done, value } = await reader.read();
            signal?.throwIfAborted();
            if (done)
                break;
            received += value.byteLength;
            if (received > maxBytes)
                throw new AiProviderError('Provider stream exceeds size limit');
            buffer += decoder.decode(value, { stream: true });
            let index;
            while ((index = buffer.indexOf('\n')) !== -1) {
                const data = line(buffer.slice(0, index).replace(/\r$/, ''));
                buffer = buffer.slice(index + 1);
                if (data !== undefined)
                    yield data;
            }
            if (buffer.length + frame > 131072)
                throw new AiProviderError('AI stream frame is too large');
        }
        buffer += decoder.decode();
        if (buffer) {
            const data = line(buffer.replace(/\r$/, ''));
            if (data !== undefined)
                yield data;
        }
        const final = line('');
        if (final !== undefined)
            yield final;
    }
    catch (error) {
        if (error instanceof TypeError && !signal?.aborted)
            throw new AiProviderError('Invalid AI stream encoding');
        throw error;
    }
    finally {
        signal?.removeEventListener('abort', abort);
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
/** Legacy OpenAI text projection remains compatible. */
export async function* parseAiSse(source: ReadableStream<Uint8Array>, maxBytes: number, signal?: AbortSignal): AsyncIterable<string> {
    for await (const data of parseAiSseEvents(source, maxBytes, signal)) {
        if (data === '[DONE]')
            return;
        let payload: any;
        try {
            payload = JSON.parse(data);
        }
        catch {
            throw new AiProviderError('Malformed AI stream event');
        }
        if (payload?.error)
            throw new AiProviderError('AI streaming provider reported an error');
        const delta = payload?.choices?.[0]?.delta?.content;
        if (delta === undefined || delta === null)
            continue;
        if (typeof delta !== 'string')
            throw new AiProviderError('Invalid streamed AI content');
        yield delta;
    }
}
