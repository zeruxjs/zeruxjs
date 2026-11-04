import type { ToolContext } from './tools.js';
import { snapshotToolJson } from './tools.js';
import { parseAiSseEvents } from './sse.js';
export interface ZhostToolClientOptions {
    endpoint: string;
    tool: string;
    allowedOrigins: readonly string[];
    approveDestination(url: Readonly<URL>, context: ToolContext): boolean | Promise<boolean>;
    credentials(context: ToolContext): HeadersInit | Promise<HeadersInit>;
    fetch: typeof fetch;
    maxBytes?: number;
    maxFrames?: number;
}
/** Fixed authenticated stateless JSON-RPC/MCP call; not a discovery/session SDK. */
export function createZhostToolHandler(options: ZhostToolClientOptions) {
    if (!options || typeof options.fetch !== 'function' || typeof options.credentials !== 'function' || typeof options.approveDestination !== 'function' || typeof options.tool !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(options.tool) || !Array.isArray(options.allowedOrigins) || !options.allowedOrigins.length || options.allowedOrigins.length > 16)
        throw new TypeError('Invalid zhost tool client');
    const endpoint = new URL(options.endpoint);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)))
        throw new TypeError('Unsafe tool destination');
    const origins = options.allowedOrigins.map(value => { const url = new URL(value); if (url.origin !== value)
        throw new TypeError('Exact tool origins required'); return value; });
    if (!origins.includes(endpoint.origin))
        throw new TypeError('Tool destination denied');
    const url = endpoint.href, tool = options.tool, transport = options.fetch, credentials = options.credentials, approve = options.approveDestination, max = options.maxBytes ?? 65536, frames = options.maxFrames ?? 32;
    if (!Number.isSafeInteger(max) || max < 1 || max > 1048576 || !Number.isSafeInteger(frames) || frames < 1 || frames > 256)
        throw new TypeError('Invalid tool transport budget');
    return async (args: unknown, context: ToolContext): Promise<unknown> => {
        context.signal.throwIfAborted();
        if (await approve(new URL(url), context) !== true)
            throw new Error('Tool destination denied');
        context.signal.throwIfAborted();
        const headers = new Headers(await credentials(context));
        if (!headers.get('authorization')?.trim())
            throw new Error('Authenticated tool credentials required');
        for (const name of ['host', 'content-length', 'connection', 'transfer-encoding', 'cookie', 'x-forwarded-for', 'x-forwarded-host', 'forwarded'])
            if (headers.has(name))
                throw new TypeError('Unsafe tool transport header');
        headers.set('mcp-protocol-version', '2025-11-25');
        headers.set('content-type', 'application/json');
        headers.set('accept', 'application/json, text/event-stream');
        const request = JSON.stringify({ jsonrpc: '2.0', id: context.executionId, method: 'tools/call', params: { name: tool, arguments: snapshotToolJson(args, max) } });
        if (Buffer.byteLength(request) > max)
            throw new Error('Tool request too large');
        context.signal.throwIfAborted();
        const response = await transport(url, { method: 'POST', headers, body: request, redirect: 'error', signal: context.signal });
        try {
            if (!response.ok || response.redirected || !response.body || Number(response.headers.get('content-length')) > max)
                throw new Error('Tool transport unavailable');
            let found = false, result: unknown;
            const accept = (value: unknown) => { if (!value || typeof value !== 'object' || Array.isArray(value))
                throw new Error('Invalid tool response'); const v = value as Record<string, unknown>; if (v.jsonrpc !== '2.0' || v.id !== context.executionId || v.error || !Object.hasOwn(v, 'result') || found)
                throw new Error('Invalid tool response'); found = true; result = snapshotToolJson(v.result, max); if (result && typeof result === 'object' && (result as any).isError === true)
                throw new Error('Remote tool failed'); };
            const mime = response.headers.get('content-type') ?? '';
            if (/^text\/event-stream(?:;|$)/i.test(mime)) {
                let count = 0;
                for await (const frame of parseAiSseEvents(response.body, max, context.signal)) {
                    if (++count > frames)
                        throw new Error('Tool SSE frame budget exceeded');
                    accept(JSON.parse(frame));
                    if (found)
                        break;
                }
            }
            else if (/^application\/json(?:;|$)/i.test(mime)) {
                const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
                let text = '', size = 0;
                const abort = () => { void reader.cancel().catch(() => { }); };
                context.signal.addEventListener('abort', abort, { once: true });
                try {
                    while (true) {
                        context.signal.throwIfAborted();
                        const item = await reader.read();
                        context.signal.throwIfAborted();
                        if (item.done)
                            break;
                        size += item.value.length;
                        if (size > max)
                            throw new Error('Tool response too large');
                        text += decoder.decode(item.value, { stream: true });
                    }
                    text += decoder.decode();
                    accept(JSON.parse(text));
                }
                finally {
                    context.signal.removeEventListener('abort', abort);
                    await reader.cancel().catch(() => { });
                    reader.releaseLock();
                }
            }
            else
                throw new Error('Unsupported tool response');
            if (!found)
                throw new Error('Missing tool response');
            return result;
        }
        finally {
            if (response.body && !response.body.locked)
                await response.body.cancel().catch(() => { });
        }
    };
}
