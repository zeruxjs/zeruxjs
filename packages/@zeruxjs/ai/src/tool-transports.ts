import type { ToolContext } from './tools.js';
import { snapshotToolJson } from './tools.js';
import { parseAiSseEvents } from './sse.js';
/** Fixed server-owned MCP call configuration; never derive it from generated arguments. */
export interface ZhostToolClientOptions {
  /** Fixed HTTPS URL, or loopback HTTP for fixtures; credentials/query/fragments reject. */
  endpoint: string;
  /** Fixed registered remote tool name, at most 128 safe characters. */
  tool: string;
  /** One through sixteen exact origins, including the selected endpoint origin. */
  allowedOrigins: readonly string[];
  /**
   * Recheck destination policy against the verified initiating tenant before every dispatch.
   * @param {Readonly<URL>} url - Fresh URL object for the fixed configured endpoint.
   * @param {ToolContext} context - Executor-supplied principal, execution identity and cancellation.
   * @returns {boolean | Promise<boolean>} Only literal true permits dispatch.
   */
  approveDestination(
    url: Readonly<URL>,
    context: ToolContext
  ): boolean | Promise<boolean>;
  /**
   * Supply server-only authentication without forwarding browser cookies or headers.
   * @param {ToolContext} context - Verified execution identity and principal.
   * @returns {HeadersInit | Promise<HeadersInit>} Headers including nonempty Authorization.
   */
  credentials(context: ToolContext): HeadersInit | Promise<HeadersInit>;
  /** Borrowed transport; host enforces connection-time destination and DNS policy. */
  fetch: typeof fetch;
  /** Maximum UTF-8 request/response bytes, default 65536, from 1 through 1048576. */
  maxBytes?: number;
  /** Maximum SSE data frames, default 32, from 1 through 256. */
  maxFrames?: number;
}
/**
 * Bind a fixed authenticated stateless MCP tools/call handler without starting work.
 * @param {ZhostToolClientOptions} options - Trusted endpoint/policy/credential callbacks and limits.
 * @returns {(args: unknown, context: ToolContext) => Promise<unknown>} Handler for explicit executor registration.
 * @throws {TypeError} On unsafe configuration; handler failures propagate without automatic replay.
 */
export function createZhostToolHandler(options: ZhostToolClientOptions) {
  if (
    !options ||
    typeof options.fetch !== 'function' ||
    typeof options.credentials !== 'function' ||
    typeof options.approveDestination !== 'function' ||
    typeof options.tool !== 'string' ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(options.tool) ||
    !Array.isArray(options.allowedOrigins) ||
    !options.allowedOrigins.length ||
    options.allowedOrigins.length > 16
  ) {
    throw new TypeError('Invalid zhost tool client');
  }
  /** Fixed host endpoint validated before capturing credentials or dispatching requests. */
  const endpoint = new URL(options.endpoint);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== 'https:' &&
      !(
        endpoint.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
      ))
  ) {
    throw new TypeError('Unsafe tool destination');
  }
  /** Exact allowed origins; path-bearing or normalized lookalikes reject. */
  const origins = options.allowedOrigins.map((value) => {
    /** Validated origin candidate, never a model-supplied destination. */
    const url = new URL(value);
    if (url.origin !== value) {
      throw new TypeError('Exact tool origins required');
    }
    return value;
  });
  if (!origins.includes(endpoint.origin)) {
    throw new TypeError('Tool destination denied');
  }
  /** Validated origin candidate, never a model-supplied destination. */
  const url = endpoint.href;
  /** Fixed remote tool name; arguments cannot substitute a different operation. */
  const tool = options.tool;
  /** Borrowed Fetch implementation; the host owns its pools and connection-time egress checks. */
  const transport = options.fetch;
  /** Borrowed server credential callback, called with verified execution context. */
  const credentials = options.credentials;
  /** Host policy is rechecked per request rather than inferred from registration. */
  const approve = options.approveDestination;
  /** Shared UTF-8 request/response ceiling, default 64 KiB and maximum 1 MiB. */
  const max = options.maxBytes ?? 65536;
  /** SSE data-frame ceiling, default 32 and maximum 256. */
  const frames = options.maxFrames ?? 32;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 1048576 ||
    !Number.isSafeInteger(frames) ||
    frames < 1 ||
    frames > 256
  ) {
    throw new TypeError('Invalid tool transport budget');
  }
  /**
   * Dispatch one authorized fixed-endpoint call and release all response readers.
   * @param {unknown} args - Bounded inert arguments; never URLs, credentials or commands to evaluate.
   * @param {ToolContext} context - Verified executor context; its signal bounds cooperative transport.
   * @returns {Promise<unknown>} Detached matching remote result, never executable code.
   */
  return async (args: unknown, context: ToolContext): Promise<unknown> => {
    context.signal.throwIfAborted();
    if ((await approve(new URL(url), context)) !== true) {
      throw new Error('Tool destination denied');
    }
    context.signal.throwIfAborted();
    /** Fresh host credential headers; cookies and forwarding/connection headers are denied. */
    const headers = new Headers(await credentials(context));
    if (!headers.get('authorization')?.trim()) {
      throw new Error('Authenticated tool credentials required');
    }
    // Deny connection, cookie and forwarding headers even when a credential callback returns them.
    for (const name of [
      'host',
      'content-length',
      'connection',
      'transfer-encoding',
      'cookie',
      'x-forwarded-for',
      'x-forwarded-host',
      'forwarded',
    ]) {
      if (headers.has(name)) {
        throw new TypeError('Unsafe tool transport header');
      }
    }
    headers.set('mcp-protocol-version', '2025-11-25');
    headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json, text/event-stream');
    /** Bounded JSON-RPC envelope; execution identity is supplied by the executor, not the model. */
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: context.executionId,
      method: 'tools/call',
      params: { name: tool, arguments: snapshotToolJson(args, max) },
    });
    if (Buffer.byteLength(request) > max) {
      throw new Error('Tool request too large');
    }
    context.signal.throwIfAborted();
    /** One dispatch with redirect rejection and no automatic replay after unknown outcomes. */
    const response = await transport(url, {
      method: 'POST',
      headers,
      body: request,
      redirect: 'error',
      signal: context.signal,
    });
    try {
      if (
        !response.ok ||
        response.redirected ||
        !response.body ||
        Number(response.headers.get('content-length')) > max
      ) {
        throw new Error('Tool transport unavailable');
      }
      let found = false,
        result: unknown;
      /**
       * Accept a single matching result and reject error/duplicate envelopes.
       * @param {unknown} value - Parsed JSON-RPC response data, not trusted instructions.
       * @returns {void} Captures only a bounded inert result; mismatches throw.
       */
      const accept = (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Invalid tool response');
        }
        /** Parsed response envelope; only matching JSON-RPC results enter the returned snapshot. */
        const v = value as Record<string, unknown>;
        if (
          v.jsonrpc !== '2.0' ||
          v.id !== context.executionId ||
          v.error ||
          !Object.hasOwn(v, 'result') ||
          found
        ) {
          throw new Error('Invalid tool response');
        }
        found = true;
        result = snapshotToolJson(v.result, max);
        if (
          result &&
          typeof result === 'object' &&
          (result as any).isError === true
        ) {
          throw new Error('Remote tool failed');
        }
      };
      /** Representation discriminator; only JSON or bounded SSE is supported. */
      const mime = response.headers.get('content-type') ?? '';
      if (/^text\/event-stream(?:;|$)/i.test(mime)) {
        let count = 0;
        // The shared framing owner cancels its reader when the first accepted result ends iteration.
        for await (const frame of parseAiSseEvents(
          response.body,
          max,
          context.signal
        )) {
          if (++count > frames) {
            throw new Error('Tool SSE frame budget exceeded');
          }
          accept(JSON.parse(frame));
          if (found) {
            break;
          }
        }
      } else if (/^application\/json(?:;|$)/i.test(mime)) {
        /** Exclusive JSON-body reader; cleanup cancels and unlocks even on parse failure. */
        const reader = response.body.getReader();
        /** Fatal incremental UTF-8 decoder preserves split code points and rejects corruption. */
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let text = '',
          size = 0;
        /**
         * Request cancellation of the currently owned reader.
         * @returns {void} Final cleanup awaits cancellation and releases the lock.
         */
        const abort = () => {
          void reader.cancel().catch(() => {});
        };
        context.signal.addEventListener('abort', abort, { once: true });
        try {
          while (true) {
            context.signal.throwIfAborted();
            /** One native read; byte accounting precedes text retention and JSON parsing. */
            const item = await reader.read();
            context.signal.throwIfAborted();
            if (item.done) {
              break;
            }
            size += item.value.length;
            if (size > max) {
              throw new Error('Tool response too large');
            }
            text += decoder.decode(item.value, { stream: true });
          }
          text += decoder.decode();
          accept(JSON.parse(text));
        } finally {
          context.signal.removeEventListener('abort', abort);
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } else {
        throw new Error('Unsupported tool response');
      }
      if (!found) {
        throw new Error('Missing tool response');
      }
      return result;
    } finally {
      if (response.body && !response.body.locked) {
        await response.body.cancel().catch(() => {});
      }
    }
  };
}
