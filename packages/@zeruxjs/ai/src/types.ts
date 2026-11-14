/** Legacy text conversation; each adapter validates its supported role subset. */
export interface ChatMessage {
  /** Conversation role; native text adapters reject unsupported tool messages. */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Untrusted text to transport, never source code to execute. */
  content: string;
  /** Optional legacy speaker name; adapters may reject named messages. */
  name?: string;
}
/** Per-call generation settings; provider validation and configured bounds apply. */
export interface ChatOptions {
  /** Caller cancellation; cooperative providers may settle after abort. */
  signal?: AbortSignal;
  /** Sampling temperature, only where the selected wire version supports it. */
  temperature?: number;
  /** Requested output token ceiling; model/account limits remain authoritative. */
  maxTokens?: number;
  /** Nucleus sampling probability, only where supported by the adapter. */
  topP?: number;
  /** May narrow, never increase, the configured provider response bound. */
  maxResponseBytes?: number;
}
/** Structural provider contract; optional capabilities are unknown when absent. */
export interface AiProvider {
  /** Declared support, not proof of model availability or authorization. */
  readonly capabilities?: Readonly<AiCapabilities>;
  /**
   * Generate buffered text with private provider metadata.
   * @param {ChatMessage[]} messages - Authorized conversation data; provider validation applies.
   * @param {ChatOptions | undefined} options - Optional generation limits and cooperative cancellation.
   * @returns {Promise<AiChatResult>} Provider result; transport, validation and abort failures propagate.
   */
  chatResult?(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<AiChatResult>;
  /**
   * Stream text and cumulative metadata; close the iterator on early exit.
   * @param {ChatMessage[]} messages - Authorized conversation data; provider validation applies.
   * @param {ChatOptions | undefined} options - Optional generation limits and cooperative cancellation.
   * @returns {AsyncIterable<AiStreamEvent>} Provider result; transport, validation and abort failures propagate.
   */
  streamEvents?(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<AiStreamEvent>;
  /**
   * Transport validated inert content and optionally validate buffered JSON.
   * @param {AiContentMessage[]} messages - Authorized conversation data; provider validation applies.
   * @param {AiContentOptions | undefined} options - Optional generation limits and cooperative cancellation.
   * @returns {Promise<AiChatResult>} Provider result; transport, validation and abort failures propagate.
   */
  chatContent?(
    messages: AiContentMessage[],
    options?: AiContentOptions
  ): Promise<AiChatResult>;
  /**
   * Stream content results without claiming partial JSON validation.
   * @param {AiContentMessage[]} messages - Authorized conversation data; provider validation applies.
   * @param {ChatOptions | undefined} options - Optional generation limits and cooperative cancellation.
   * @returns {AsyncIterable<AiStreamEvent>} Provider result; transport, validation and abort failures propagate.
   */
  streamContent?(
    messages: AiContentMessage[],
    options?: ChatOptions
  ): AsyncIterable<AiStreamEvent>;
  /**
   * Generate a buffered legacy text response.
   * @param {ChatMessage[]} messages - Authorized conversation data; provider validation applies.
   * @param {ChatOptions | undefined} options - Optional generation limits and cooperative cancellation.
   * @returns {Promise<string>} Provider result; transport, validation and abort failures propagate.
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  /**
   * Stream legacy text and release resources when iteration stops.
   * @param {ChatMessage[]} messages - Authorized conversation data; provider validation applies.
   * @param {ChatOptions | undefined} options - Optional generation limits and cooperative cancellation.
   * @returns {AsyncIterable<string>} Provider result; transport, validation and abort failures propagate.
   */
  stream?(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<string>;
}
/** Private host configuration; never construct credentials/endpoints from model input. */
export interface ProviderConfig {
  /** Server-owned credential; never include in public config or logs. */
  apiKey: string;
  /** Host-approved API base URL; HTTPS or explicit loopback HTTP only. */
  baseUrl: string;
  /** Explicit model identifier; no discovery or automatic migration occurs. */
  model: string;
  /** Borrowed transport; the host owns connection pools and egress enforcement. */
  fetch?: typeof fetch;
  /** Per-request deadline in milliseconds; abort does not prove remote cancellation. */
  timeoutMs?: number;
  /** Host-supplied headers, subject to adapter credential-override validation. */
  headers?: Record<string, string>;
  /** Maximum UTF-8 response bytes, including wire envelopes/metadata. */
  maxResponseBytes?: number;
  /** Maximum serialized UTF-8 request bytes, including inline media encoding. */
  maxRequestBytes?: number;
}
/** Fixed public failure information with separately retained private metadata. */
export class AiProviderError extends Error {
  /** Private response details: non-enumerable; never log without host redaction. */
  readonly providerMetadata?: unknown;
  /**
   * Construct a transport failure without automatically retrying or logging it.
   * @param {string} message - Public error description; adapters use fixed text.
   * @param {number | undefined} status - HTTP status when a response exists.
   * @param {boolean} retryable - Whether an explicit retry wrapper may retry buffered work.
   * @param {number | undefined} retryAfterMs - Bounded server-requested delay in milliseconds.
   * @param {unknown} metadata - Private diagnostic data, stored non-enumerably when present.
   */
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
    metadata?: unknown
  ) {
    super(message);
    this.name = 'AiProviderError';
    if (metadata !== undefined) {
      Object.defineProperty(this, 'providerMetadata', {
        value: metadata,
        enumerable: false,
      });
    }
  }
}

/** Negotiated optional extensions; declarations do not imply vendor SDK parity. */
export interface AiCapabilities {
  /** Supports the required buffered text method. */
  readonly chat: boolean;
  /** Supports incremental text streaming. */
  readonly stream: boolean;
  /** Declares tool protocol support; never grants execution permission. */
  readonly tools: boolean;
  /** Rich results can expose provider-reported usage. */
  readonly usage: boolean;
  /** Implemented input wire formats, not verified decoder/model support. */
  readonly inputs?: readonly AiInputKind[];
  /** Native constrained JSON request support; host validation is still required. */
  readonly jsonOutput?: boolean;
  /** True only when one call cannot internally retry or fall back. */
  readonly singleAttempt?: boolean;
}
/** Provider-reported counters; absent values stay unknown rather than zero. */
export interface AiUsage {
  /** Reported input tokens, without inferred cache/thinking accounting. */
  inputTokens?: number;
  /** Reported generated tokens; billing semantics remain provider-specific. */
  outputTokens?: number;
  /** Reported total; never inferred from incomparable vendor counters. */
  totalTokens?: number;
}
/** Normalized completion category; unmapped provider reasons remain unknown. */
export type AiFinishReason = 'stop' | 'length' | 'blocked' | 'tool' | 'unknown';
/** Provider metadata is bounded response data, private to the caller, never a telemetry record. */
export interface AiChatResult {
  /** Untrusted generated text; escape or sanitize at the rendering boundary. */
  text: string;
  /** Reported cumulative usage, possibly incomplete. */
  usage: AiUsage;
  /** Normalized stopping category, not a schema-validity claim. */
  finishReason: AiFinishReason;
  /** Bounded private provider payload; excluded from default telemetry. */
  providerMetadata: unknown;
  /** Present only after requested JSON parsing and host schema validation. */
  data?: unknown;
}
/** Text deltas or cumulative metadata snapshots; partial text is not validated JSON. */
export type AiStreamEvent =
  | {
      /** Discriminator selects the declared inert data/event format; it never activates execution. */
      type: 'text'; /** Untrusted text payload; caller rendering must escape or sanitize it. */
      text: string;
    }
  | {
      /** Discriminator selects the declared inert data/event format; it never activates execution. */
      type: 'metadata';
      /** Reported cumulative usage, possibly incomplete. */
      usage: AiUsage;
      /** Normalized stopping category, not a schema-validity claim. */
      finishReason: AiFinishReason;
      /** Bounded private provider payload; excluded from default telemetry. */
      providerMetadata: unknown;
    };
/** Native adapter configuration; all rich methods share the same admission budget. */
export interface ModelProviderConfig extends Omit<ProviderConfig, 'baseUrl'> {
  /** Optional host-approved endpoint override; otherwise the adapter selects its fixed API. */
  baseUrl?: string;
  /** Maximum serialized UTF-8 request bytes, including inline media encoding. */
  maxRequestBytes?: number;
  /** Maximum unsettled native calls; defaults to four. */
  maxConcurrent?: number;
  /** Maximum FIFO waiters; native adapters default to sixteen. */
  maxQueued?: number;
  /** Optional narrowing policy for inert multimodal parts. */
  content?: {
    /** Subset of adapter-supported kinds; cannot add a new wire format. */
    allowedInputs?: readonly AiInputKind[];
    /** Per-binary-part byte ceiling, before base64/request-envelope overhead. */
    maxMediaBytes?: number;
    /** Aggregate multipart count ceiling across the request. */
    maxParts?: number;
  };
}

/** Inert input classifications; none activates local execution or fetching. */
export type AiInputKind =
  | 'text'
  | 'file'
  | 'json'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video';
/** Caller-owned text/bytes; filenames and MIME labels grant no filesystem access. */
export type AiContentPart =
  | {
      /** Discriminator selects the declared inert data/event format; it never activates execution. */
      type: 'text'; /** Untrusted text payload; caller rendering must escape or sanitize it. */
      text: string;
    }
  | {
      /** Discriminator selects the declared inert data/event format; it never activates execution. */
      type: 'file'; /** Safe basename metadata only; never opened, imported or executed locally. */
      filename: string; /** Untrusted text payload; caller rendering must escape or sanitize it. */
      text: string; /** Optional inert source-language label; no compiler/runtime is selected from it. */
      language?: string;
    }
  | {
      /** Discriminator selects the declared inert data/event format; it never activates execution. */
      type: 'json'; /** Inert JSON data, bounded and detached before transport or exposure. */
      value: unknown;
    }
  | {
      /** Discriminator selects the declared inert data/event format; it never activates execution. */
      type: 'image' | 'pdf' | 'audio' | 'video';
      /** Allowlisted declared binary MIME; not malware or codec-signature verification. */
      mimeType: string;
      /** Binary input bytes or independently validated output data; never executable content. */
      data: Uint8Array;
    };
/** Native content message; media is restricted to user messages by validation. */
export interface AiContentMessage {
  /** Wire conversation role, validated before encoding. */
  role: 'system' | 'user' | 'assistant';
  /** Inert text or bounded parts; no automatic file/URL resolution. */
  content: string | readonly AiContentPart[];
}
/** Injected trusted Standard Schema V1 validator; it must be pure and bounded. */
export interface AiValueSchema {
  /** Standard Schema protocol entry; the host retains validator ownership. */
  readonly '~standard': {
    /** Supported Standard Schema protocol version. */
    readonly version: 1;
    /**
     * Validate a parsed value without executing instructions contained in it.
     * @param {unknown} value - Untrusted parsed JSON.
     * @returns {object | PromiseLike<object>} Parsed value or private validation issues.
     */
    validate(value: unknown):
      | {
          /** Inert JSON data, bounded and detached before transport or exposure. */
          value?: unknown; /** Private validation issues; never copied into public telemetry. */
          issues?: readonly unknown[];
        }
      | PromiseLike<{
          /** Inert JSON data, bounded and detached before transport or exposure. */
          value?: unknown; /** Private validation issues; never copied into public telemetry. */
          issues?: readonly unknown[];
        }>;
  };
}
/** Buffered native content options; structured output is independently validated. */
export interface AiContentOptions extends ChatOptions {
  /** Explicit native JSON request; unsupported capabilities reject. */
  output?: {
    /** Only strict JSON generation is supported here. */
    type: 'json';
    /** Bounded inert provider-facing JSON schema, with remote references denied. */
    schema: Record<string, unknown>;
    /** Host-owned validator required before exposing result.data. */
    validator: AiValueSchema;
  };
}
