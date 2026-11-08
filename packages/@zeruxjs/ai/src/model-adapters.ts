import {createContentEncoder,prepareJsonOutput,validateJsonOutput} from './content.js';
import type {AiContentMessage,AiContentOptions} from './types.js';
import { AiProviderError, type AiProvider, type AiChatResult, type AiStreamEvent, type AiUsage, type ChatMessage, type ChatOptions, type ModelProviderConfig } from './types.js';
import { parseAiSseEvents } from './sse.js';
import { withConcurrencyLimit } from './concurrency.js';
export interface AnthropicProviderConfig extends ModelProviderConfig {
    apiVersion: '2023-06-01' | '2026-10-21';
}

function number(value: unknown): number | undefined { if (value === undefined)
    return undefined; if (((typeof value !== 'number') || !Number.isSafeInteger(value)) || (value < 0))
    throw new AiProviderError('Invalid provider usage'); return value; }
function usage(raw: any, kind: 'anthropic' | 'gemini'): AiUsage { return (kind === 'anthropic') ? { inputTokens: number(raw?.input_tokens), outputTokens: number(raw?.output_tokens) } : { inputTokens: number(raw?.promptTokenCount), outputTokens: number(raw?.candidatesTokenCount), totalTokens: number(raw?.totalTokenCount) }; }
function finish(value: unknown): AiChatResult['finishReason'] { return ['end_turn', 'stop_sequence', 'STOP'].includes(value as string) ? 'stop' : ['max_tokens', 'MAX_TOKENS'].includes(value as string) ? 'length' : ['refusal', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(value as string) ? 'blocked' : (value === 'tool_use') ? 'tool' : 'unknown'; }
function json(text: string): any { try {
    return JSON.parse(text);
}
catch {
    throw new AiProviderError('Invalid provider JSON');
} }
function normalize(raw: any, kind: 'anthropic' | 'gemini'): AiChatResult {
    if (((!raw || (typeof raw !== 'object')) || Array.isArray(raw)) || raw.error)
        throw new AiProviderError('Invalid provider response');
    const blocks = (kind === 'anthropic') ? raw.content : raw.candidates?.[0]?.content?.parts;
    let text = '';
    if (blocks !== undefined) {
        if (!Array.isArray(blocks))
            throw new AiProviderError('Invalid provider content');
        for (const block of blocks) {
            if (!block || (typeof block !== 'object'))
                throw new AiProviderError('Invalid provider content');
            if (((kind === 'anthropic') && (block.type !== 'text')) || ((kind === 'gemini') && Object.keys(block).some(key => !['text', 'thought', 'thoughtSignature'].includes(key))))
                throw new AiProviderError('Unsupported non-text provider content');
            if ((block.text !== undefined) && (typeof block.text !== 'string'))
                throw new AiProviderError('Invalid provider text');
            if (block.thought !== true)
                text += (block.text ?? '');
        }
    }
    const reason = (kind === 'anthropic') ? raw.stop_reason : (raw.candidates?.[0]?.finishReason ?? raw.promptFeedback?.blockReason);
    if (((blocks === undefined) && (reason === undefined)) && !raw.usageMetadata)
        throw new AiProviderError('Invalid provider response shape');
    return { text, usage: usage((kind === 'anthropic') ? raw.usage : raw.usageMetadata, kind), finishReason: ((kind === 'gemini') && raw.promptFeedback?.blockReason) ? 'blocked' : finish(reason), providerMetadata: raw };
}
function adapter(kind: 'anthropic' | 'gemini', config: ModelProviderConfig, version?: string): AiProvider {
    if (typeof window !== 'undefined')
        throw new Error('Model credentials require a server runtime');
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    if ((((((!config || (typeof config.apiKey !== 'string')) || !config.apiKey.trim()) || (config.apiKey.length > 8192)) || /[\x00-\x20\x7f]/.test(config.apiKey)) || (typeof config.model !== 'string')) || !/^[A-Za-z0-9_.-]{1,128}$/.test(config.model))
        throw new TypeError('Invalid model credentials/configuration');
    const endpoint = new URL(config.baseUrl ?? ((kind === 'anthropic') ? 'https://api.anthropic.com/v1' : 'https://generativelanguage.googleapis.com/v1beta'));
    if ((((endpoint.username || endpoint.password) || endpoint.hash) || endpoint.search) || ((endpoint.protocol !== 'https:') && !((endpoint.protocol === 'http:') && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))))
        throw new TypeError('Invalid provider endpoint');
    const timeout = config.timeoutMs ?? 30000, maxResponse = config.maxResponseBytes ?? 4194304, maxRequest = config.maxRequestBytes ?? 1048576;
    for (const [value, max] of [[timeout, 300000], [maxResponse, 67108864], [maxRequest, 16777216]])
        if ((!Number.isSafeInteger(value) || (value < 1)) || (value > max))
            throw new RangeError('Invalid provider budget');
    const encoder=createContentEncoder(kind,config.content,maxRequest);
    const capabilities=Object.freeze({chat:true,stream:true,tools:false,usage:true,inputs:encoder.inputs,jsonOutput:true,singleAttempt:true});
    const key = config.apiKey, model = config.model, transport = config.fetch ?? fetch, extra = new Headers(config.headers);
    if ((((extra.has('authorization') || extra.has('x-api-key')) || extra.has('x-goog-api-key')) || extra.has('host')) || extra.has('content-length'))
        throw new TypeError('Reserved provider header');
    const base = endpoint.href.replace(/\/$/, '');
    function body(messages: (ChatMessage|AiContentMessage)[], options: AiContentOptions, stream: boolean,contentMode=false,output?:ReturnType<typeof prepareJsonOutput>): string {
        if ((!options || (typeof options !== 'object')) || Object.keys(options).some(k => !(contentMode?['signal','temperature','maxTokens','topP','maxResponseBytes','output']:['signal','temperature','maxTokens','topP','maxResponseBytes']).includes(k)))
            throw new TypeError('Unsupported chat options');
        if ((!Array.isArray(messages) || !messages.length) || (messages.length > 256))
            throw new TypeError('Invalid messages');
        const copied = contentMode?encoder.encode(messages as AiContentMessage[]):messages.map(m => { if (((!m || !['system', 'user', 'assistant'].includes(m.role)) || (typeof m.content !== 'string')) || (('name' in m)&&(m.name !== undefined)))
            throw new TypeError('Unsupported message role/name'); return { role: m.role, content: m.content }; });
        let seen = false;
        for (const m of copied) {
            if (m.role !== 'system')
                seen = true;
            else if (seen)
                throw new TypeError('System messages must lead conversation');
        }
        if (!seen)
            throw new TypeError('Conversation required');
        if ((options.signal !== undefined) && !(options.signal instanceof AbortSignal))
            throw new TypeError('Invalid cancellation signal');
        if ((options.maxTokens !== undefined) && ((!Number.isSafeInteger(options.maxTokens) || (options.maxTokens < 1)) || (options.maxTokens > 1000000)))
            throw new TypeError('Invalid maxTokens');
        if (((options.temperature !== undefined) && ((!Number.isFinite(options.temperature) || (options.temperature < 0)) || (options.temperature > ((kind === 'anthropic') ? 1 : 2)))) || ((options.topP !== undefined) && ((!Number.isFinite(options.topP) || (options.topP < 0)) || (options.topP > 1))))
            throw new TypeError('Invalid sampling');
        if (((kind === 'anthropic') && (version === '2026-10-21')) && ((options.temperature !== undefined) || (options.topP !== undefined)))
            throw new TypeError('Sampling options unavailable in Anthropic API 2026-10-21');
        const systems = copied.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const turns = copied.filter(m => m.role !== 'system');
        const payload:any = (kind === 'anthropic') ? { model, messages: (version === '2026-10-21') ? copied : turns, system: ((version === '2023-06-01') && systems) ? systems : undefined, max_tokens: options.maxTokens ?? 1024, temperature: options.temperature, top_p: options.topP, stream } : { contents: turns.map(m => ({ role: (m.role === 'assistant') ? 'model' : 'user', parts: (typeof m.content==='string')?[{ text: m.content }]:m.content })), systemInstruction: systems ? { parts: [{ text: systems }] } : undefined, generationConfig: { maxOutputTokens: options.maxTokens, temperature: options.temperature, topP: options.topP, candidateCount: 1 } };
        if(output){if(kind==='anthropic')payload.output_config={format:{type:'json_schema',schema:output.schema}};else {payload.generationConfig.responseMimeType='application/json';payload.generationConfig.responseJsonSchema=output.schema;}}
        const encoded = JSON.stringify(payload);
        if (new TextEncoder().encode(encoded).length > maxRequest)
            throw new RangeError('Provider request exceeds size limit');
        return encoded;
    }
    async function send(messages: (ChatMessage|AiContentMessage)[], options: AiContentOptions, stream: boolean,contentMode=false) {
        if((options.maxResponseBytes!==undefined)&&((!Number.isSafeInteger(options.maxResponseBytes)||(options.maxResponseBytes<1))||(options.maxResponseBytes>67108864)))throw new TypeError('Invalid response budget');const responseLimit=Math.min(maxResponse,options.maxResponseBytes??maxResponse);
        const output=contentMode?prepareJsonOutput(options.output,stream):undefined;
        const encoded = body(messages, options, stream,contentMode,output), controller = new AbortController();
        const abort = () => controller.abort();
        options.signal?.throwIfAborted();
        options.signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, timeout);
        let response: Response | undefined;
        const release = async () => { controller.abort(); clearTimeout(timer); options.signal?.removeEventListener('abort', abort); if (response?.body && !response.body.locked)
            await response.body.cancel().catch(() => { }); };
        try {
            const headers = new Headers(extra);
            headers.set('content-type', 'application/json');
            headers.set('accept', stream ? 'text/event-stream' : 'application/json');
            headers.set((kind === 'anthropic') ? 'x-api-key' : 'x-goog-api-key', key);
            if (kind === 'anthropic')
                headers.set('anthropic-version', version!);
            const url = (kind === 'anthropic') ? `${base}/messages` : `${base}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
            response = await transport(url, { method: 'POST', headers, body: encoded, signal: controller.signal, redirect: 'error' });
            controller.signal.throwIfAborted();
            if (!response.ok) {
                const retry = response.headers.get('retry-after'), delay = (retry === null) ? undefined : Number.isFinite(Number(retry)) ? (Number(retry) * 1000) : (Date.parse(retry) - Date.now());
                throw new AiProviderError(`${kind} provider returned HTTP ${response.status}`, response.status, [408, 429, 500, 502, 503, 504, 529].includes(response.status), ((delay !== undefined) && (delay > 0)) ? Math.min(delay, 60000) : undefined, { provider: kind, apiVersion: version, requestId: ((response.headers.get('request-id') ?? response.headers.get('x-request-id')) ?? '').slice(0, 128) });
            }
            if (!response.body || (Number(response.headers.get('content-length')) > responseLimit))
                throw new AiProviderError('Invalid or oversized provider response');
            if (stream && !/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type') ?? ''))
                throw new AiProviderError('Expected text/event-stream');
            return { response, signal: controller.signal, release,output,responseLimit };
        }
        catch (error) {
            const cancelled = controller.signal.aborted;
            await release();
            if (error instanceof AiProviderError)
                throw error;
            throw new AiProviderError(cancelled ? 'AI request cancelled or timed out' : 'AI transport failed');
        }
    }
    async function chatResult(messages: (ChatMessage|AiContentMessage)[], options: AiContentOptions = {},contentMode=false): Promise<AiChatResult> { const req = await send(messages, options, false,contentMode); try {
        const reader = req.response.body!.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, text = '';
        const abort = () => { void reader.cancel().catch(() => { }); };
        req.signal.addEventListener('abort', abort, { once: true });
        try {
            while (true) {
                req.signal.throwIfAborted();
                const item = await reader.read();
                req.signal.throwIfAborted();
                if (item.done)
                    break;
                bytes += item.value.length;
                if (bytes > req.responseLimit)
                    throw new AiProviderError('Provider response exceeds size limit');
                text += decoder.decode(item.value, { stream: true });
            }
            text += decoder.decode();
            return await validateJsonOutput(normalize(json(text), kind),req.output,maxResponse,req.signal);
        }
        finally {
            req.signal.removeEventListener('abort', abort);
            await reader.cancel().catch(() => { });
            reader.releaseLock();
        }
    }
    catch (error) {
        if (error instanceof AiProviderError)
            throw error;
        throw new AiProviderError('AI response failed');
    }
    finally {
        await req.release();
    } }
    async function* streamEvents(messages: (ChatMessage|AiContentMessage)[], options: ChatOptions = {},contentMode=false): AsyncIterable<AiStreamEvent> {
        const req = await send(messages, options, true,contentMode);
        const accumulated: AiUsage = {};
        let complete = false, started = false, finalReason:AiChatResult['finishReason']='unknown';
        try {
            for await (const frame of parseAiSseEvents(req.response.body!, req.responseLimit, req.signal)) {
                const raw = json(frame);
                if (raw?.error || (raw?.type === 'error'))
                    throw new AiProviderError(`${kind} stream failed`, undefined, false, undefined, { provider: kind, code: (typeof raw?.error?.type === 'string') ? raw.error.type.slice(0, 64) : undefined });
                let text = '', normalized: AiChatResult;
                if (kind === 'anthropic') {
                    if (raw?.type === 'message_start') {
                        if(started)throw new AiProviderError('Duplicate Anthropic stream start');
                        started = true;
                        normalized = { text: '', usage: usage(raw.message?.usage, kind), finishReason: 'unknown', providerMetadata: raw };
                    }
                    else {
                        if (!started && ['content_block_start', 'content_block_delta', 'message_delta', 'message_stop'].includes(raw?.type))
                            throw new AiProviderError('Invalid Anthropic stream ordering');
                        if (raw?.type === 'message_stop') {
                            complete = true;
                            yield { type: 'metadata', usage: { ...accumulated }, finishReason: finalReason, providerMetadata: raw };
                            break;
                        }
                        if ((raw?.content_block?.type && (raw.content_block.type !== 'text')) || (raw?.delta?.type === 'input_json_delta'))
                            throw new AiProviderError('Unsupported non-text provider content');
                        if ((raw?.type === 'content_block_start') && (raw.content_block?.type === 'text')) {
                            if (typeof raw.content_block.text !== 'string')
                                throw new AiProviderError('Invalid streamed text');
                            text = raw.content_block.text;
                        }
                        if ((raw?.type === 'content_block_delta') && (raw.delta?.type === 'text_delta')) {
                            if (typeof raw.delta.text !== 'string')
                                throw new AiProviderError('Invalid streamed text');
                            text = raw.delta.text;
                        }
                        normalized = { text, usage: usage(raw.usage, kind), finishReason: finish(raw.delta?.stop_reason), providerMetadata: raw };
                    }
                }
                else {
                    normalized = normalize(raw, kind);
                    text = normalized.text;
                    if (raw.candidates?.[0]?.finishReason || raw.promptFeedback?.blockReason)
                        complete = true;
                }
                for (const field of ['inputTokens', 'outputTokens', 'totalTokens'] as const)
                    if (normalized.usage[field] !== undefined)
                        accumulated[field] = normalized.usage[field];
                if(normalized.finishReason!=='unknown')finalReason=normalized.finishReason;
                if (text)
                    yield { type: 'text', text };
                yield { type: 'metadata', usage: { ...accumulated }, finishReason: finalReason, providerMetadata: raw };
            }
            if (!complete)
                throw new AiProviderError('Incomplete provider stream');
        }
        catch (error) {
            if (error instanceof AiProviderError)
                throw error;
            throw new AiProviderError('AI stream failed');
        }
        finally {
            await req.release();
        }
    }
    return withConcurrencyLimit({ capabilities, chatResult, streamEvents,chatContent:(messages,options)=>chatResult(messages,options,true),streamContent:(messages,options)=>streamEvents(messages,options,true), async chat(m, o) { return (await chatResult(m, o)).text; }, async *stream(m, o) { for await (const e of streamEvents(m, o))
            if (e.type === 'text')
                yield e.text; } }, { maxConcurrent: config.maxConcurrent ?? 4, maxQueued: config.maxQueued ?? 16 });
}
export function createAnthropicProvider(config: AnthropicProviderConfig): AiProvider { if (!config || !['2023-06-01', '2026-10-21'].includes(config.apiVersion))
    throw new TypeError('Explicit Anthropic API version required'); return adapter('anthropic', config, config.apiVersion); }
export function createGeminiProvider(config: ModelProviderConfig): AiProvider { return adapter('gemini', config); }
