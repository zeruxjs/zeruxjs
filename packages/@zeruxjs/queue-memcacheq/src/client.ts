import {
  MemcacheTextClient,
  validateKey,
  type TextConnectionOptions,
  type TextRequestOptions,
} from '@zeruxjs/cache-memcache/protocol';
import { copyData, invalid, integer, optionKeys } from './envelope.js';
export { MemcacheQError } from './envelope.js';
export interface MemcacheQOptions extends TextConnectionOptions {
  /** Printable queue namespace, default zerux; not tenant authorization. */
  prefix?: string;
  /** Host-declared fixed-record/body ceiling; no protocol size discovery is assumed. */
  serverMaxBytes?: number;
  /** Accept old unversioned records; new writes always use V1. Default true for compatibility. */
  acceptLegacy?: boolean;
}
export interface MemcacheQMessage {
  /** Validated native job name; never executable code. */
  name: string;
  /** Inert copied JSON payload; host validates business/tenant semantics separately. */
  data: Record<string, unknown>;
}
/** Create a lazy destructive FIFO client over the shared text transport. No worker/timer starts; host owns close and actual socket-settlement observation.
 * @param {MemcacheQOptions} options - Optional explicit text transport/prefix/size policy; never reads credentials or environment.
 * @returns {MemcacheQ} Validated inert value or explicit lifecycle/transport result; failures never expose raw payloads.
 */
export function createMemcacheQ(options: MemcacheQOptions = {}) {
  optionKeys(options, [
    'host',
    'port',
    'tls',
    'timeoutMs',
    'maxBytes',
    'maxConcurrent',
    'prefix',
    'serverMaxBytes',
    'acceptLegacy',
  ]);
  /** Validated explicit queue namespace, default zerux; not a security boundary. */
  const prefix = validateKey(options.prefix ?? 'zerux');
  /** Host-declared fixed-record ceiling, default65500; no remote discovery. */
  const serverMax = integer(options.serverMaxBytes ?? 65500, 1, 65500);
  /** Validated request/response byte budget, default min(32768,serverMax). */
  const maxBytes = integer(
    options.maxBytes ?? Math.min(32768, serverMax),
    1,
    serverMax
  );
  /** Explicit old-envelope migration policy, defaulttrue for the basic client. */
  const acceptLegacy = options.acceptLegacy ?? true;
  if (typeof acceptLegacy !== 'boolean') {
    throw invalid('MEMCACHEQ_INVALID_OPTIONS');
  }
  /** Owned shared text protocol client; connects lazily and owns active socket cleanup. */
  const client = new MemcacheTextClient({
    host: options.host,
    port: options.port ?? 22201,
    tls: options.tls,
    timeoutMs: options.timeoutMs,
    maxBytes,
    maxConcurrent: options.maxConcurrent,
  });
  let closed = false;
  /** Validate both component and full prefixed key, and deny calls after close.
   * @param {string} queue - Trusted configured queue name validated with its prefix; not a tenant permission grant.
   * @returns {string} Validated fixed-code/request result; native unknown outcomes remain explicit.
   */
  const key = (queue: string) => {
    if (closed) {
      throw invalid('MEMCACHEQ_CLOSED');
    }
    return validateKey(`${prefix}:${validateKey(queue)}`);
  };
  /** Validate per-call cancellation/deadline before touching native sockets.
   * @param {TextRequestOptions} settings - Optional per-request AbortSignal/deadline; unknown options reject before sockets.
   * @returns {TextRequestOptions} Validated fixed-code/request result; native unknown outcomes remain explicit.
   */
  const requestOptions = (settings: TextRequestOptions) => {
    optionKeys(settings, ['signal', 'deadline']);
    if (
      (settings.signal !== undefined &&
        !(settings.signal instanceof AbortSignal)) ||
      (settings.deadline !== undefined &&
        (!Number.isSafeInteger(settings.deadline) || settings.deadline < 0))
    ) {
      throw invalid('MEMCACHEQ_INVALID_OPTIONS');
    }
    if (settings.signal?.aborted) {
      throw invalid('MEMCACHEQ_CANCELLED');
    }
    if (settings.deadline !== undefined && settings.deadline <= Date.now()) {
      throw invalid('MEMCACHEQ_DEADLINE');
    }
    return settings;
  };
  return {
    capabilities: Object.freeze({
      acknowledgement: false,
      delay: false,
      retry: false,
      destructiveRead: true,
    }),
    /** Append a bounded V1 envelope after validation. Transport failure can mean the append committed; never replay automatically.
     * @param {string} queue - Trusted configured queue name validated with its prefix; not a tenant permission grant.
     * @param {string} name - Printable ASCII native job name; no executable handler source.
     * @param {Record<string, unknown>} data - Plain inert JSON object copied before dispatch; no accessors/classes/cycles.
     * @param {TextRequestOptions} settings - Optional per-request AbortSignal/deadline; unknown options reject before sockets.
     * @returns {Promise<void>} Validated inert value or explicit lifecycle/transport result; failures never expose raw payloads.
     */
    async add(
      queue: string,
      name: string,
      data: Record<string, unknown>,
      settings: TextRequestOptions = {}
    ): Promise<void> {
      /** Validated full queue key; never shell/SQL/URL input. */
      const destination = key(queue);
      validateKey(name);
      requestOptions(settings);
      /** Finite UTF-8 V1 JSON snapshot whose full envelope fits the configured byte ceiling. */
      const body = Buffer.from(
        JSON.stringify({ version: 1, name, data: copyData(data, maxBytes) })
      );
      if (body.length > maxBytes) {
        throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');
      }
      let reply;
      try {
        reply = await client.request(
          Buffer.concat([
            Buffer.from(`set ${destination} 0 0 ${body.length}\r\n`),
            body,
            Buffer.from('\r\n'),
          ]),
          settings
        );
      } catch (cause) {
        throw invalid('MEMCACHEQ_WRITE_UNKNOWN', cause);
      }
      if (reply.line !== 'STORED') {
        throw invalid('MEMCACHEQ_APPEND_REJECTED');
      }
    },
    /** Destructively pop and validate one envelope. Malformed/cancelled replies can lose the already-popped message; there is no acknowledgement or reinsertion.
     * @param {string} queue - Trusted configured queue name validated with its prefix; not a tenant permission grant.
     * @param {TextRequestOptions} settings - Optional per-request AbortSignal/deadline; unknown options reject before sockets.
     * @returns {Promise<MemcacheQMessage|undefined>} Validated inert value or explicit lifecycle/transport result; failures never expose raw payloads.
     */
    async take(
      queue: string,
      settings: TextRequestOptions = {}
    ): Promise<MemcacheQMessage | undefined> {
      /** Validated full queue key; never shell/SQL/URL input. */
      const destination = key(queue);
      requestOptions(settings);
      let reply;
      try {
        reply = await client.request(`get ${destination}\r\n`, settings);
      } catch (cause) {
        throw invalid('MEMCACHEQ_POP_UNKNOWN', cause);
      }
      if (
        reply.line !== 'END' ||
        reply.values.length > 1 ||
        (reply.values.length === 1 &&
          (!reply.values[0] || reply.values[0].key !== destination))
      ) {
        throw invalid('MEMCACHEQ_INVALID_POPPED_MESSAGE');
      }
      if (!reply.values.length) {
        return;
      }
      /** Single queue item returned by the destructive pop operation. */
      const value = reply.values[0];
      if (!value) {
        throw invalid('MEMCACHEQ_INVALID_POPPED_MESSAGE');
      }
      try {
        if (value.value.length > maxBytes) {
          throw 0;
        }
        /** Strict UTF-8 parsed popped record; validation failure cannot restore it. */
        const envelope = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            value.value
          )
        );
        optionKeys(envelope, ['version', 'name', 'data']);
        if (
          envelope.version !== 1 &&
          !(acceptLegacy && !Object.hasOwn(envelope, 'version'))
        ) {
          throw 0;
        }
        validateKey(envelope.name);
        return { name: envelope.name, data: copyData(envelope.data, maxBytes) };
      } catch (cause) {
        throw invalid('MEMCACHEQ_INVALID_POPPED_MESSAGE', cause);
      }
    },
    /** Idempotently reject new work and cancel owned sockets. This synchronous call is not actual socket settlement; await whenClosed separately.
     * @returns {void} Validated inert value or explicit lifecycle/transport result; failures never expose raw payloads.
     */
    close() {
      if (closed) {
        return;
      }
      closed = true;
      client.close();
    },
    /** Observe actual owned socket release after close; this does not imply a popped job was processed or restored.
     * @returns {Promise<void>} Validated inert value or explicit lifecycle/transport result; failures never expose raw payloads.
     */
    whenClosed() {
      return client.whenClosed();
    },
    get activeSocketCount() {
      return client.activeSocketCount;
    },
  };
}
export type MemcacheQ = ReturnType<typeof createMemcacheQ>;
