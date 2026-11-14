/** Inert data encoding only: no file reads, URL retrieval, imports, codecs or tool execution. */
import type {
  AiContentMessage,
  AiContentOptions,
  AiInputKind,
  ModelProviderConfig,
  AiChatResult,
} from './types.js';
import { snapshotAiJson } from './safe-json.js';
import { AiProviderError } from './types.js';
/** Explicit image wire MIME subset; no local decoding or signature verification. */
const images = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
/** Gemini audio MIME subset; declarations do not certify browser/model codecs. */
const audio = [
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
];
/** Gemini video MIME subset; no upload, transcode or filesystem access is inferred. */
const video = [
  'video/mp4',
  'video/mpeg',
  'video/mov',
  'video/avi',
  'video/x-flv',
  'video/mpg',
  'video/webm',
  'video/wmv',
  'video/3gpp',
];
/**
 * Copy a plain record without evaluating accessor fields.
 * @param {unknown} input - Untrusted record to inspect; Proxy behavior is not sandboxed.
 * @param {string[]} fields - Exact allowed own enumerable field names.
 * @returns {Record<string, any>} Detached envelope whose values are validated by the caller.
 * @throws {TypeError} On class/array/nonrecord input, unknown fields or accessors.
 */
function record(input: unknown, fields: string[]): Record<string, any> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  ) {
    throw new TypeError('Plain content record required');
  }
  /** Copy only allowed own data fields into a prototype-free record. */
  const out: Record<string, any> = Object.create(null);
  // Snapshot every allowed own field; no inherited metadata enters the wire envelope.
  for (const key of Object.keys(input)) {
    /** Descriptor lookup rejects accessor-backed fields rather than invoking getters. */
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!fields.includes(key) || !d || !('value' in d)) {
      throw new TypeError('Unsupported content field/accessor');
    }
    out[key] = d.value;
  }
  return out;
}
/**
 * Assert a bounded text value without interpreting markup, code or filenames.
 * @param {unknown} value - Candidate string.
 * @param {number} max - Maximum UTF-8 bytes; NUL characters always reject.
 * @returns {void} Narrows value to string after successful validation.
 * @throws {TypeError} When input is not permitted text.
 */
function text(value: unknown, max: number): asserts value is string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value) > max ||
    value.includes('\0')
  ) {
    throw new TypeError('Invalid text content');
  }
}
/**
 * Build a provider-specific inert content encoder with a fixed policy snapshot.
 * @param {'anthropic' | 'gemini'} kind - Native wire format to encode.
 * @param {ModelProviderConfig['content']} policy - Optional host input/part/media limits.
 * @param {number} maxRequest - Aggregate request byte ceiling, including base64 charges.
 * @returns {object} Declared input kinds and a request-local encoding operation.
 * @throws {TypeError} When policy contains unsupported kinds or invalid budgets.
 */
export function createContentEncoder(
  kind: 'anthropic' | 'gemini',
  policy: ModelProviderConfig['content'],
  maxRequest: number
) {
  /** Provider-specific wire kinds; host policy may narrow but never extend this list. */
  const supported: AiInputKind[] =
    kind === 'anthropic'
      ? ['text', 'file', 'json', 'image', 'pdf']
      : ['text', 'file', 'json', 'image', 'pdf', 'audio', 'video'];
  /** Caller policy can explicitly restrict the adapter's supported input kinds. */
  const allowed = policy?.allowedInputs ?? supported;
  /** Per-part byte ceiling is enforced before copying or base64 expansion. */
  const maxMedia = policy?.maxMediaBytes ?? 4194304;
  /** Aggregate multipart ceiling spans every multipart message in this request. */
  const maxParts = policy?.maxParts ?? 32;
  if (
    !Array.isArray(allowed) ||
    !allowed.length ||
    new Set(allowed).size !== allowed.length ||
    allowed.some((t) => !supported.includes(t)) ||
    !Number.isSafeInteger(maxMedia) ||
    maxMedia < 1 ||
    maxMedia > 12582912 ||
    !Number.isSafeInteger(maxParts) ||
    maxParts < 1 ||
    maxParts > 128
  ) {
    throw new TypeError('Invalid content policy');
  }
  /** Immutable policy snapshot prevents later caller-array mutation changing admission. */
  const inputs = Object.freeze([...allowed]);
  return {
    inputs,
    /**
     * Validate and encode a bounded conversation without resolving paths or URLs.
     * @param {AiContentMessage[]} messages - One through 256 authorized content messages.
     * @returns {object[]} Provider wire envelopes; text/code remains untrusted data.
     * @throws {TypeError | RangeError} On malformed parts, denied roles/kinds or exceeded budgets.
     */
    encode(messages: AiContentMessage[]) {
      let parts = 0,
        bytes = 0;
      /**
       * Charge text/base64 bytes against this request's aggregate content ceiling.
       * @param {number} n - Additional encoded bytes before envelope serialization.
       * @returns {void} Full serialized request size is checked again by the transport.
       */
      const charge = (n: number) => {
        bytes += n;
        if (bytes > maxRequest) {
          throw new RangeError('Content request budget exceeded');
        }
      };
      if (
        !Array.isArray(messages) ||
        !messages.length ||
        messages.length > 256
      ) {
        throw new TypeError('Invalid content messages');
      }
      return messages.map((raw) => {
        /** Validate message shape before interpreting its role or content. */
        const m = record(raw, ['role', 'content']);
        if (!['system', 'user', 'assistant'].includes(m.role)) {
          throw new TypeError('Invalid content role');
        }
        if (typeof m.content === 'string') {
          if (!inputs.includes('text')) {
            throw new TypeError('Text input denied');
          }
          text(m.content, maxRequest);
          charge(Buffer.byteLength(m.content));
          return { role: m.role, content: m.content };
        }
        if (
          !Array.isArray(m.content) ||
          !m.content.length ||
          m.content.length > maxParts
        ) {
          throw new TypeError('Invalid content parts');
        }
        /** Map parts into inert wire objects while sharing aggregate request budgets. */
        const content = m.content.map((item: unknown) => {
          if (++parts > maxParts) {
            throw new RangeError('Content part budget exceeded');
          }
          /** A union field allowlist rejects executable objects and unknown metadata. */
          const part = record(item, [
            'type',
            'text',
            'filename',
            'language',
            'value',
            'mimeType',
            'data',
          ]);
          if (!inputs.includes(part.type)) {
            throw new TypeError('Unsupported or denied content type');
          }
          /**
           * Narrow union fields to this specific part kind before reading payloads.
           * @param {string[]} fields - Fields valid for the selected part discriminator.
           * @returns {void} Throws on any extra field rather than silently discarding it.
           */
          const exact = (fields: string[]) => {
            if (Object.keys(part).some((k) => !fields.includes(k))) {
              throw new TypeError('Unexpected content field');
            }
          };
          let value: string | undefined;
          if (part.type === 'text') {
            exact(['type', 'text']);
            text(part.text, maxRequest);
            value = part.text;
          } else if (part.type === 'file') {
            exact(['type', 'filename', 'text', 'language']);
            if (
              typeof part.filename !== 'string' ||
              !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(part.filename) ||
              part.filename.includes('..') ||
              (part.language !== undefined &&
                (typeof part.language !== 'string' ||
                  !/^[A-Za-z0-9_+#.-]{1,32}$/.test(part.language)))
            ) {
              throw new TypeError('Invalid inert filename/language');
            }
            text(part.text, maxRequest);
            value = JSON.stringify({
              filename: part.filename,
              language: part.language,
              text: part.text,
            });
          } else if (part.type === 'json') {
            exact(['type', 'value']);
            value = JSON.stringify(
              snapshotAiJson(part.value, Math.min(maxRequest, 1048576))
            );
          }
          if (value !== undefined) {
            charge(Buffer.byteLength(value));
            return kind === 'anthropic'
              ? { type: 'text', text: value }
              : { text: value };
          }
          exact(['type', 'mimeType', 'data']);
          if (m.role !== 'user') {
            throw new TypeError('Media belongs in user messages only');
          }
          // Select only the MIME family registered for this explicit part discriminator.
          let types: string[];
          if (part.type === 'image') {
            types = images;
          } else if (part.type === 'pdf') {
            types = ['application/pdf'];
          } else if (part.type === 'audio') {
            types = audio;
          } else if (part.type === 'video') {
            types = video;
          } else {
            types = [];
          }
          if (
            typeof part.mimeType !== 'string' ||
            !types.includes(part.mimeType) ||
            !(part.data instanceof Uint8Array) ||
            ![Uint8Array.prototype, Buffer.prototype].includes(
              Object.getPrototypeOf(part.data)
            )
          ) {
            throw new TypeError('Invalid media MIME/bytes');
          }
          /** Read the native typed-array byte length without trusting an own getter. */
          const length = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(Uint8Array.prototype),
            'byteLength'
          )!.get!.call(part.data) as number;
          if (length < 1 || length > maxMedia) {
            throw new TypeError('Invalid media size');
          }
          charge(Math.ceil(length / 3) * 4);
          /** Own a fresh byte snapshot so source mutation cannot alter encoded content. */
          const copied = new Uint8Array(length);
          Uint8Array.prototype.set.call(copied, part.data);
          /** Base64 is transport data; no bytes are decoded, executed or fetched locally. */
          const data = Buffer.from(copied.buffer).toString('base64');
          return kind === 'anthropic'
            ? {
                type: part.type === 'image' ? 'image' : 'document',
                source: { type: 'base64', media_type: part.mimeType, data },
              }
            : { inlineData: { mimeType: part.mimeType, data } };
        });
        if (m.role === 'system') {
          if (content.some((p: any) => typeof p.text !== 'string')) {
            throw new TypeError('System media denied');
          }
          return {
            role: m.role,
            content: content.map((p: any) => p.text).join('\n\n'),
          };
        }
        return { role: m.role, content };
      });
    },
  };
}
/**
 * Validate explicit buffered JSON configuration without running the host validator.
 * @param {AiContentOptions['output']} output - Optional native schema/validator configuration.
 * @param {boolean} stream - Streaming cannot claim complete validated JSON.
 * @returns {object | undefined} Detached schema plus borrowed validator, or no output request.
 * @throws {TypeError} On streaming/schema-reference/validator configuration mismatch.
 */
export function prepareJsonOutput(
  output: AiContentOptions['output'],
  stream: boolean
) {
  if (output === undefined) {
    return undefined;
  }
  /** Output configuration is a data envelope; validator execution is separately trusted. */
  const value = record(output, ['type', 'schema', 'validator']);
  if (
    stream ||
    value.type !== 'json' ||
    value.validator?.['~standard']?.version !== 1 ||
    typeof value.validator['~standard'].validate !== 'function'
  ) {
    throw new TypeError('Buffered JSON output requires a host validator');
  }
  /** Bounded detached schema excludes reference-based resolution/evaluation. */
  const schema = snapshotAiJson(value.schema, 65536);
  if (
    !schema ||
    typeof schema !== 'object' ||
    Array.isArray(schema) ||
    /"\$(?:ref|dynamicRef|id|schema)"\s*:/.test(JSON.stringify(schema))
  ) {
    throw new TypeError('Unsupported JSON output schema reference');
  }
  return { schema, validator: value.validator };
}
/**
 * Independently validate completed native JSON and expose only inert parsed data.
 * @param {AiChatResult} result - Private buffered provider response and reported usage.
 * @param {ReturnType<typeof prepareJsonOutput>} output - Validated configuration or undefined.
 * @param {number} max - Snapshot byte ceiling for parsed and transformed data.
 * @param {AbortSignal} signal - Rechecked around cooperative host validator settlement.
 * @returns {Promise<AiChatResult>} Original result, or result with independently validated data.
 * @throws {AiProviderError} On incomplete/invalid output; private input/issues are not echoed.
 */
export async function validateJsonOutput(
  result: AiChatResult,
  output: ReturnType<typeof prepareJsonOutput>,
  max: number,
  signal: AbortSignal
): Promise<AiChatResult> {
  if (!output) {
    return result;
  }
  if (result.finishReason !== 'stop') {
    throw new AiProviderError(
      'JSON output did not complete successfully',
      undefined,
      false,
      undefined,
      {
        structuredOutputFailure: true,
        usage: result.usage,
        outputBytes: Buffer.byteLength(result.text),
      }
    );
  }
  try {
    /** Strict JSON parse followed by bounded inert snapshot; no JSON5 or code evaluation. */
    const parsed = snapshotAiJson(JSON.parse(result.text), max);
    signal.throwIfAborted();
    /** The borrowed host validator may be async; cancellation is rechecked after settlement. */
    const validated = await output.validator['~standard'].validate(parsed);
    signal.throwIfAborted();
    if (!validated || validated.issues || !Object.hasOwn(validated, 'value')) {
      throw Error();
    }
    return { ...result, data: snapshotAiJson(validated.value, max) };
  } catch {
    throw new AiProviderError(
      'Invalid structured JSON output',
      undefined,
      false,
      undefined,
      {
        structuredOutputFailure: true,
        usage: result.usage,
        outputBytes: Buffer.byteLength(result.text),
      }
    );
  }
}
