/** Inert data encoding only: no file reads, URL retrieval, imports, codecs or tool execution. */
import type { AiContentMessage, AiContentOptions, AiInputKind, ModelProviderConfig, AiChatResult } from './types.js';
import { snapshotAiJson } from './safe-json.js';
import { AiProviderError } from './types.js';
const images = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const audio = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac'];
const video = ['video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp'];
function record(input: unknown, fields: string[]): Record<string, any> { if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    throw new TypeError('Plain content record required'); const out: Record<string, any> = Object.create(null); for (const key of Object.keys(input)) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!fields.includes(key) || !d || !('value' in d))
        throw new TypeError('Unsupported content field/accessor');
    out[key] = d.value;
} return out; }
function text(value: unknown, max: number): asserts value is string { if (typeof value !== 'string' || Buffer.byteLength(value) > max || value.includes('\0'))
    throw new TypeError('Invalid text content'); }
export function createContentEncoder(kind: 'anthropic' | 'gemini', policy: ModelProviderConfig['content'], maxRequest: number) {
    const supported: AiInputKind[] = kind === 'anthropic' ? ['text', 'file', 'json', 'image', 'pdf'] : ['text', 'file', 'json', 'image', 'pdf', 'audio', 'video'];
    const allowed = policy?.allowedInputs ?? supported, maxMedia = policy?.maxMediaBytes ?? 4194304, maxParts = policy?.maxParts ?? 32;
    if (!Array.isArray(allowed) || !allowed.length || new Set(allowed).size !== allowed.length || allowed.some(t => !supported.includes(t)) || !Number.isSafeInteger(maxMedia) || maxMedia < 1 || maxMedia > 12582912 || !Number.isSafeInteger(maxParts) || maxParts < 1 || maxParts > 128)
        throw new TypeError('Invalid content policy');
    const inputs = Object.freeze([...allowed]);
    return { inputs,
        encode(messages: AiContentMessage[]) {
            let parts = 0, bytes = 0;
            const charge = (n: number) => { bytes += n; if (bytes > maxRequest)
                throw new RangeError('Content request budget exceeded'); };
            if (!Array.isArray(messages) || !messages.length || messages.length > 256)
                throw new TypeError('Invalid content messages');
            return messages.map(raw => {
                const m = record(raw, ['role', 'content']);
                if (!['system', 'user', 'assistant'].includes(m.role))
                    throw new TypeError('Invalid content role');
                if (typeof m.content === 'string') {
                    if (!inputs.includes('text'))
                        throw new TypeError('Text input denied');
                    text(m.content, maxRequest);
                    charge(Buffer.byteLength(m.content));
                    return { role: m.role, content: m.content };
                }
                if (!Array.isArray(m.content) || !m.content.length || m.content.length > maxParts)
                    throw new TypeError('Invalid content parts');
                const content = m.content.map((item: unknown) => {
                    if (++parts > maxParts)
                        throw new RangeError('Content part budget exceeded');
                    const part = record(item, ['type', 'text', 'filename', 'language', 'value', 'mimeType', 'data']);
                    if (!inputs.includes(part.type))
                        throw new TypeError('Unsupported or denied content type');
                    const exact = (fields: string[]) => { if (Object.keys(part).some(k => !fields.includes(k)))
                        throw new TypeError('Unexpected content field'); };
                    let value: string | undefined;
                    if (part.type === 'text') {
                        exact(['type', 'text']);
                        text(part.text, maxRequest);
                        value = part.text;
                    }
                    else if (part.type === 'file') {
                        exact(['type', 'filename', 'text', 'language']);
                        if (typeof part.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(part.filename) || part.filename.includes('..') || part.language !== undefined && (typeof part.language !== 'string' || !/^[A-Za-z0-9_+#.-]{1,32}$/.test(part.language)))
                            throw new TypeError('Invalid inert filename/language');
                        text(part.text, maxRequest);
                        value = JSON.stringify({ filename: part.filename, language: part.language, text: part.text });
                    }
                    else if (part.type === 'json') {
                        exact(['type', 'value']);
                        value = JSON.stringify(snapshotAiJson(part.value, Math.min(maxRequest, 1048576)));
                    }
                    if (value !== undefined) {
                        charge(Buffer.byteLength(value));
                        return kind === 'anthropic' ? { type: 'text', text: value } : { text: value };
                    }
                    exact(['type', 'mimeType', 'data']);
                    if (m.role !== 'user')
                        throw new TypeError('Media belongs in user messages only');
                    const types = part.type === 'image' ? images : part.type === 'pdf' ? ['application/pdf'] : part.type === 'audio' ? audio : part.type === 'video' ? video : [];
                    if (typeof part.mimeType !== 'string' || !types.includes(part.mimeType) || !(part.data instanceof Uint8Array) || ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(part.data)))
                        throw new TypeError('Invalid media MIME/bytes');
                    const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(part.data) as number;
                    if (length < 1 || length > maxMedia)
                        throw new TypeError('Invalid media size');
                    charge(Math.ceil(length / 3) * 4);
                    const copied = new Uint8Array(length);
                    Uint8Array.prototype.set.call(copied, part.data);
                    const data = Buffer.from(copied.buffer).toString('base64');
                    return kind === 'anthropic' ? { type: part.type === 'image' ? 'image' : 'document', source: { type: 'base64', media_type: part.mimeType, data } } : { inlineData: { mimeType: part.mimeType, data } };
                });
                if (m.role === 'system') {
                    if (content.some((p: any) => typeof p.text !== 'string'))
                        throw new TypeError('System media denied');
                    return { role: m.role, content: content.map((p: any) => p.text).join('\n\n') };
                }
                return { role: m.role, content };
            });
        } };
}
export function prepareJsonOutput(output: AiContentOptions['output'], stream: boolean) { if (output === undefined)
    return undefined; const value = record(output, ['type', 'schema', 'validator']); if (stream || value.type !== 'json' || value.validator?.['~standard']?.version !== 1 || typeof value.validator['~standard'].validate !== 'function')
    throw new TypeError('Buffered JSON output requires a host validator'); const schema = snapshotAiJson(value.schema, 65536); if (!schema || typeof schema !== 'object' || Array.isArray(schema) || /"\$(?:ref|dynamicRef|id|schema)"\s*:/.test(JSON.stringify(schema)))
    throw new TypeError('Unsupported JSON output schema reference'); return { schema, validator: value.validator }; }
export async function validateJsonOutput(result: AiChatResult, output: ReturnType<typeof prepareJsonOutput>, max: number, signal: AbortSignal): Promise<AiChatResult> { if (!output)
    return result; if (result.finishReason !== 'stop')
    throw new AiProviderError('JSON output did not complete successfully',undefined,false,undefined,{structuredOutputFailure:true,usage:result.usage,outputBytes:Buffer.byteLength(result.text)}); try {
    const parsed = snapshotAiJson(JSON.parse(result.text), max);
    signal.throwIfAborted();
    const validated = await output.validator['~standard'].validate(parsed);
    signal.throwIfAborted();
    if (!validated || validated.issues || !Object.hasOwn(validated, 'value'))
        throw Error();
    return { ...result, data: snapshotAiJson(validated.value, max) };
}
catch {
    throw new AiProviderError('Invalid structured JSON output',undefined,false,undefined,{structuredOutputFailure:true,usage:result.usage,outputBytes:Buffer.byteLength(result.text)});
} }
