import {
  createTransportRegistry,
  createHttpTransportAdapter,
  createWebSocketTransportAdapter,
  ProtocolGateway,
  type TransportBind,
  type TransportLimits,
  type TransportAuthorization,
  type WebSocketTransportOptions,
} from 'zhost/protocols';
import type { ZeruxPluginApi } from './bootstrap/types.js';
import type { ModuleInputSchema } from './modules.js';
import type {
  DatabaseFacade,
  TransactionDatabase,
  TransactionOptions,
} from '@zeruxjs/db';

interface EndpointBase {
  /** Stable authored endpoint registration name. */
  name: string;
  /** Explicit host bind address, delegated to the zhost adapter policy. */
  bind: TransportBind;
  /** Required message/concurrency/time ceilings enforced by transport owners. */
  limits: TransportLimits;
  /** Fresh host authorization callback; loopback alone does not authorize. */
  authorize: TransportAuthorization;
}
export type ServiceEndpointDefinition = EndpointBase &
  (
    | {
        /** Explicit supported HTTP or WebSocket adapter kind. */
        transport: 'http'; /** Explicit uniquely owned HTTP protocol gateway. */
        gateway: ProtocolGateway;
      }
    | {
        /** Explicit supported HTTP or WebSocket adapter kind. */
        transport: 'ws';
        /** Authored WebSocket endpoint path. */
        path: string;
        /** Explicit browser origin allowlist for the WebSocket adapter. */
        allowedOrigins?: readonly string[];
        /** Trusted bounded WebSocket message callback. */
        onMessage: WebSocketTransportOptions['onMessage'];
        /** Private transport failure observer. */
        onError?: WebSocketTransportOptions['onError'];
      }
  );
/** Preserve an explicit typed transport definition without binding listeners or discovering packages.
 * @param {T} definition - Trusted HTTP/WebSocket endpoint with host policy.
 * @returns {T} Inert authored endpoint descriptor.
 */
export function defineServiceEndpoint<T extends ServiceEndpointDefinition>(
  definition: T
): T {
  return definition;
}
/** Classified endpoint/client failure retaining private transport causes internally. */
export class ServiceEndpointError extends Error {
  /** Classify endpoint/client failures without exposing private transport causes by default.
   * @param {string} code - Fixed endpoint/client diagnostic classification.
   * @param {ErrorOptions} options - Optional private transport cause.
   */
  constructor(
    readonly code: string,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = 'ServiceEndpointError';
  }
}
/** Register inert explicit endpoints and attach transport startup/teardown to generation workers and cleanup.
 * @param {ZeruxPluginApi} api - Trusted generation plugin authority.
 * @param {readonly ServiceEndpointDefinition[]} definitions - Explicit supported endpoint descriptors and security policy.
 * @param {object} options - Optional startup-worker namespace.
 * @param {string} options.name - Optional exact startup worker name.
 * @returns {object} Owned endpoint registration handle; start is explicit and close drains zhost adapters.
 */
export function registerServiceEndpoints(
  api: ZeruxPluginApi,
  definitions: readonly ServiceEndpointDefinition[],
  options: {
    /** Stable authored endpoint registration name. */
    name?: string;
  } = {}
) {
  /** Stable startup-worker registration name, checked before acquiring transport ownership. */
  const name = options?.name ?? 'service-endpoints';
  if (
    !api ||
    typeof api.onDispose !== 'function' ||
    !Array.isArray(definitions) ||
    !definitions.length ||
    definitions.length > 32 ||
    !options ||
    typeof options !== 'object' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
    api.getWorker(name)
  ) {
    throw new ServiceEndpointError('ENDPOINT_REGISTRATION_INVALID');
  }
  /** Owned explicit zhost transport registry; registration does not start listeners. */
  const registry = createTransportRegistry();
  /** Captured explicit HTTP/WebSocket adapters used for address lookup after startup. */
  const adapters = new Map<
    string,
    | ReturnType<typeof createHttpTransportAdapter>
    | ReturnType<typeof createWebSocketTransportAdapter>
  >();
  registry.registerAdapter(
    'http',
    (value) => value as ReturnType<typeof createHttpTransportAdapter>
  );
  registry.registerAdapter(
    'ws',
    (value) => value as ReturnType<typeof createWebSocketTransportAdapter>
  );
  /** HTTP gateway identities, preventing duplicate ownership within this endpoint registration. */
  const gateways = new Set<ProtocolGateway>();
  for (const definition of definitions) {
    if (
      !definition ||
      typeof definition.authorize !== 'function' ||
      !definition.limits ||
      ['maxMessageBytes', 'maxConcurrent', 'timeoutMs'].some(
        (key) => !Object.hasOwn(definition.limits, key)
      ) ||
      !['http', 'ws'].includes(definition.transport)
    ) {
      throw new ServiceEndpointError('ENDPOINT_POLICY_REQUIRED');
    }
    let adapter;
    if (definition.transport === 'http') {
      if (
        !(definition.gateway instanceof ProtocolGateway) ||
        gateways.has(definition.gateway)
      ) {
        throw new ServiceEndpointError('ENDPOINT_GATEWAY_OWNERSHIP');
      }
      gateways.add(definition.gateway);
      definition.gateway.validateBindings();
      adapter = createHttpTransportAdapter({
        gateway: definition.gateway,
        authorize: definition.authorize,
      });
    } else {
      adapter = createWebSocketTransportAdapter(definition);
    }
    registry.register({
      id: definition.name,
      type: definition.transport,
      bind: definition.bind,
      limits: definition.limits,
      options: adapter,
    });
    adapters.set(definition.name, adapter);
  }
  /** Stop owned transport registrations through their actual zhost lifecycle.
   * @returns {Promise<void>} Transport registry shutdown settlement.
   */
  const close = () => registry.stop();
  api.onDispose(close);
  api.addWorker(name, async () => {
    await registry.start();
    return close;
  });
  return Object.freeze({
    start: () => registry.start(),
    close,
    health: () => registry.health(),
    /** Read the bound address of an explicitly registered endpoint.
     * @param {string} endpoint - Exact authored endpoint name.
     * @returns {unknown} Adapter-native address metadata; unknown names reject.
     */
    address(endpoint: string) {
      /** Explicitly registered transport adapter; unknown endpoint names reject. */
      const adapter = adapters.get(endpoint);
      if (!adapter) {
        throw new ServiceEndpointError('ENDPOINT_UNKNOWN');
      }
      return adapter.address();
    },
  });
}

/** Validate and encode bounded inert JSON before transport or transaction work begins, rejecting accessors and toJSON hooks.
 * @param {unknown} value - Untrusted candidate data value.
 * @param {number} maxBytes - Maximum encoded UTF-8 payload bytes.
 * @returns {string} Bounded JSON text with no executable serialization hooks.
 */
function encode(value: unknown, maxBytes: number): string {
  /** Bounded iterative JSON validation stack; no getters or toJSON hooks execute. */
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0,
    bytes = 0;
  while (pending.length) {
    /** Next own-value/depth pair inspected before serialization. */
    const item = pending.pop()!;
    if (++nodes > 10000 || item.depth > 16) {
      throw new ServiceEndpointError('PAYLOAD_LIMIT');
    }
    /** Candidate JSON value checked for primitive/plain-object constraints. */
    const v = item.value;
    if (
      v === null ||
      typeof v === 'boolean' ||
      typeof v === 'string' ||
      (typeof v === 'number' && Number.isFinite(v))
    ) {
      if (typeof v === 'string' && Buffer.byteLength(v) > maxBytes) {
        throw new ServiceEndpointError('PAYLOAD_LIMIT');
      }
      bytes += Buffer.byteLength(JSON.stringify(v));
      if (bytes > maxBytes) {
        throw new ServiceEndpointError('PAYLOAD_LIMIT');
      }
      continue;
    }
    if (
      typeof v !== 'object' ||
      (!Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null)
    ) {
      throw new ServiceEndpointError('PAYLOAD_INVALID');
    }
    if (Array.isArray(v) && v.length > 10000) {
      throw new ServiceEndpointError('PAYLOAD_LIMIT');
    }
    /** Own descriptors inspected without invoking accessors. */
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Object.hasOwn(descriptors, 'toJSON')) {
      throw new ServiceEndpointError('PAYLOAD_INVALID');
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key === 'length') {
        continue;
      }
      if (!Object.hasOwn(descriptor, 'value')) {
        throw new ServiceEndpointError('PAYLOAD_INVALID');
      }
      if (!descriptor.enumerable) {
        continue;
      }
      bytes += Buffer.byteLength(key) + 3;
      if (bytes > maxBytes) {
        throw new ServiceEndpointError('PAYLOAD_LIMIT');
      }
      pending.push({ value: descriptor.value, depth: item.depth + 1 });
      if (pending.length > 10000) {
        throw new ServiceEndpointError('PAYLOAD_LIMIT');
      }
    }
  }
  /** Validated bounded JSON request/event text, never executable source. */
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > maxBytes) {
    throw new ServiceEndpointError('PAYLOAD_LIMIT');
  }
  return body;
}
export interface ServiceCallOptions {
  /** Optional caller/pin cancellation signal. */
  signal?: AbortSignal;
  /** Optional absolute call/transaction deadline in Unix milliseconds. */
  deadline?: number;
}
export interface ServiceClientOptions<I, O> {
  /** Fixed host-approved destination; never taken from per-call input. */
  endpoint: string;
  /** Whole-call cooperative deadline in milliseconds. */
  timeoutMs: number;
  /** Maximum inert request and response UTF-8 JSON bytes. */
  maxPayloadBytes: number;
  /** Maximum actual unsettled client work. */
  maxConcurrent: number;
  /** Perform the explicit trusted request under host-owned destination, DNS and TLS enforcement.
   * @param {Request} request - Fixed-destination JSON request with cancellation and redirect-error policy.
   * @returns {Promise<Response>} Actual transport response; callers retain ownership until body cleanup.
   */
  transport(request: Request): Promise<Response>;
  /** Approve the configured fixed destination using explicit host policy.
   * @param {URL} url - Detached configured URL candidate.
   * @returns {boolean} Only true authorizes client creation; this is not connection-time DNS enforcement.
   */
  allowDestination(url: URL): boolean;
  /** Supply private host credentials only at server request time under the whole-call deadline.
   * @returns {Record<string, string> | Promise<Record<string, string>>} Header values validated for count, size and forbidden authority fields.
   */
  headers?(): Record<string, string> | Promise<Record<string, string>>;
  /** Package-owned Standard Schema V1 output validator. */
  schema: ModuleInputSchema<O>;
  /** Explicit bounded retry policy; no exactly-once side-effect guarantee. */
  retry: {
    /** One through three declared attempts. */
    maxAttempts: number; /** Host assertion required for multiple transport attempts. */
    idempotent: boolean;
  };
}
/** Create a bounded fixed-destination JSON client with explicit idempotent retry policy and schema validation.
 * @param {ServiceClientOptions<I, O>} options - Private host transport/destination/schema and call budgets.
 * @returns {object} Owned client; close aborts and drains actual calls while leaving transport ownership with the host.
 */
export function createServiceClient<I, O>(options: ServiceClientOptions<I, O>) {
  if (
    !options ||
    typeof options.transport !== 'function' ||
    typeof options.allowDestination !== 'function' ||
    (options.headers !== undefined && typeof options.headers !== 'function') ||
    options.schema?.['~standard']?.version !== 1 ||
    typeof options.schema['~standard'].validate !== 'function' ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 120000 ||
    !Number.isSafeInteger(options.maxPayloadBytes) ||
    options.maxPayloadBytes < 1 ||
    options.maxPayloadBytes > 16 * 1024 * 1024 ||
    !Number.isSafeInteger(options.maxConcurrent) ||
    options.maxConcurrent < 1 ||
    options.maxConcurrent > 1024 ||
    !options.retry ||
    !Number.isSafeInteger(options.retry.maxAttempts) ||
    options.retry.maxAttempts < 1 ||
    options.retry.maxAttempts > 3 ||
    typeof options.retry.idempotent !== 'boolean' ||
    (options.retry.maxAttempts > 1 && !options.retry.idempotent)
  ) {
    throw new ServiceEndpointError('CLIENT_POLICY_INVALID');
  }
  /** Fixed validated destination captured at client creation; no per-call URL override exists. */
  const endpoint = new URL(options.endpoint);
  if (
    !['https:', 'http:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    options.allowDestination(new URL(endpoint)) !== true
  ) {
    throw new ServiceEndpointError('CLIENT_DESTINATION_DENIED');
  }
  /** Explicit trusted transport; host retains DNS/TLS/egress enforcement responsibility. */
  const transport = options.transport;
  /** Trusted optional private credential-header supplier, never browser configuration. */
  const headers = options.headers;
  /** Borrowed Standard Schema V1 response validator owned by its package. */
  const schema = options.schema;
  /** Captured explicit retry policy; multiple attempts require declared idempotence. */
  const retry = { ...options.retry };
  /** Whole-call time ceiling covering headers, attempts, response reading and validation. */
  const timeout = options.timeoutMs;
  /** Request/response JSON byte ceiling. */
  const max = options.maxPayloadBytes;
  /** Maximum actual unsettled client calls, not just caller-visible waits. */
  const concurrency = options.maxConcurrent;
  /** Actual accepted calls retained until transport, validation and reader cleanup settle. */
  const active = new Set<{
    controller: AbortController;
    done: Promise<unknown>;
  }>();
  let closed = false;
  return {
    /** Validate and send bounded inert input under one deadline across all explicitly allowed attempts.
     * @param {I} input - Inert JSON input; executable/non-JSON values reject before transport.
     * @param {ServiceCallOptions} request - Optional caller cancellation and absolute deadline.
     * @returns {Promise<O>} Independently validated response or classified private-cause failure.
     */
    call(input: I, request: ServiceCallOptions = {}): Promise<O> {
      if (closed) {
        return Promise.reject(new ServiceEndpointError('CLIENT_CLOSED'));
      }
      if (
        !request ||
        typeof request !== 'object' ||
        (request.signal !== undefined &&
          !(request.signal instanceof AbortSignal)) ||
        (request.deadline !== undefined &&
          (!Number.isSafeInteger(request.deadline) || request.deadline < 0))
      ) {
        return Promise.reject(new ServiceEndpointError('CALL_OPTIONS_INVALID'));
      }
      if (active.size >= concurrency) {
        return Promise.reject(new ServiceEndpointError('CLIENT_OVERLOAD'));
      }
      let body: string;
      try {
        body = encode(input, max);
      } catch (error) {
        return Promise.reject(error);
      }
      /** Per-call cooperative cancellation owner shared by all attempts and body reads. */
      const controller = new AbortController();
      /** Minimum of the configured call timeout and explicit caller deadline. */
      const deadline = Math.min(
        Date.now() + timeout,
        request.deadline ?? Infinity
      );
      /** Propagate call cancellation without replaying or force-stopping trusted transport code.
       * @returns {void} Abort notification completion.
       */
      const abort = () => controller.abort();
      request.signal?.addEventListener('abort', abort, { once: true });
      if (request.signal?.aborted || deadline <= Date.now()) {
        abort();
      }
      /** Owned whole-call deadline timer removed after actual settlement. */
      const timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
      /** Actual call cancellation/settlement receipt retained by close. */
      const entry = { controller, done: Promise.resolve() as Promise<unknown> };
      active.add(entry);
      /** Actual call promise; capacity is released only in its terminal cleanup. */
      const work = Promise.resolve().then(async () => {
        try {
          controller.signal.throwIfAborted();
          /** Host-supplied private headers validated before request creation. */
          const configured = await headers?.();
          controller.signal.throwIfAborted();
          /** Bounded header projection rejecting transport/proxy authority overrides. */
          const fields = new Headers(configured);
          if (
            [...fields].length > 32 ||
            [...fields].reduce((sum, [k, v]) => sum + k.length + v.length, 0) >
              8192 ||
            [...fields.keys()].some((key) =>
              /^(?:host|connection|content-length|transfer-encoding|forwarded|x-forwarded-.*)$/i.test(
                key
              )
            )
          ) {
            throw new ServiceEndpointError('CLIENT_HEADERS_INVALID');
          }
          fields.set('content-type', 'application/json');
          fields.set('accept', 'application/json');
          fields.set('x-zerux-deadline', String(deadline));
          for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
            controller.signal.throwIfAborted();
            let response: Response;
            try {
              response = await transport(
                new Request(endpoint, {
                  method: 'POST',
                  headers: fields,
                  body,
                  redirect: 'error',
                  signal: controller.signal,
                })
              );
            } catch (cause) {
              if (controller.signal.aborted || attempt === retry.maxAttempts) {
                throw new ServiceEndpointError(
                  controller.signal.aborted
                    ? 'CALL_CANCELLED'
                    : 'CALL_TRANSPORT_FAILED',
                  { cause }
                );
              }
              continue;
            }
            if (controller.signal.aborted) {
              await response.body?.cancel();
              throw new ServiceEndpointError('CALL_CANCELLED');
            }
            if (
              response.redirected ||
              (response.url && response.url !== endpoint.href)
            ) {
              await response.body?.cancel();
              throw new ServiceEndpointError('CALL_REDIRECT_DENIED');
            }
            if (!response.ok) {
              await response.body?.cancel();
              if (
                [502, 503, 504].includes(response.status) &&
                attempt < retry.maxAttempts
              ) {
                continue;
              }
              throw new ServiceEndpointError('CALL_HTTP_FAILED');
            }
            if (
              !/^application\/(?:json|[^;]+\+json)(?:;|$)/i.test(
                response.headers.get('content-type') ?? ''
              )
            ) {
              await response.body?.cancel();
              throw new ServiceEndpointError('CALL_CONTENT_TYPE');
            }
            /** Owned response reader cancelled and unlocked on every terminal path. */
            const reader = response.body?.getReader();
            if (!reader) {
              throw new ServiceEndpointError('CALL_BODY_INVALID');
            }
            /** Cancel the current response reader when the whole-call signal aborts.
             * @returns {void} Reader cancellation scheduling completion.
             */
            const cancel = () => {
              void reader.cancel().catch(() => {});
            };
            controller.signal.addEventListener('abort', cancel, { once: true });
            /** Bounded response chunks retained only until JSON decoding and validation. */
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
              while (true) {
                controller.signal.throwIfAborted();
                /** One response chunk checked against cancellation and the aggregate byte limit. */
                const part = await reader.read();
                controller.signal.throwIfAborted();
                if (part.done) {
                  break;
                }
                size += part.value.byteLength;
                if (size > max) {
                  throw new ServiceEndpointError('CALL_BODY_LIMIT');
                }
                chunks.push(part.value);
              }
              /** UTF-8/JSON response data revalidated for inert plain-value budgets. */
              const data = JSON.parse(
                new TextDecoder('utf-8', { fatal: true }).decode(
                  Buffer.concat(chunks, size)
                )
              );
              encode(data, max);
              /** Package-owned response schema result; invalid data never becomes a successful typed receipt. */
              const result = await schema['~standard'].validate(data);
              controller.signal.throwIfAborted();
              if (result.issues) {
                throw new ServiceEndpointError('CALL_RESPONSE_INVALID');
              }
              return result.value;
            } finally {
              controller.signal.removeEventListener('abort', cancel);
              await reader.cancel().catch(() => {});
              reader.releaseLock();
            }
          }
          throw new ServiceEndpointError('CALL_FAILED');
        } catch (cause) {
          if (cause instanceof ServiceEndpointError) {
            throw cause;
          }
          throw new ServiceEndpointError(
            controller.signal.aborted ? 'CALL_CANCELLED' : 'CALL_FAILED',
            { cause }
          );
        } finally {
          clearTimeout(timer);
          request.signal?.removeEventListener('abort', abort);
          active.delete(entry);
        }
      });
      entry.done = work;
      return work;
    },
    /** Reject new calls, abort active observations and await actual transport/validation/body cleanup settlement.
     * @returns {Promise<void>} Client work drain; no borrowed transport pool is closed.
     */
    async close() {
      closed = true;
      for (const entry of active) {
        entry.controller.abort();
      }
      await Promise.allSettled([...active].map((entry) => entry.done));
    },
    /** Count retained actual calls without destination/credential labels.
     * @returns {number} Current unsettled client call count.
     */
    get activeCalls() {
      return active.size;
    },
  };
}

export interface TransactionalOutboxWriter<E> {
  /** Write a journal record on the exact pin used by the business mutation; never publish or start an independent transaction.
   * @param {TransactionDatabase} transaction - Borrowed real pinned database transaction.
   * @param {E} event - Bounded inert journal event.
   * @param {{ signal: AbortSignal; deadline?: number }} context - Pin cancellation and optional caller deadline.
   * @returns {void | Promise<void>} Actual journal write settlement inside the supplied transaction.
   */
  enqueue(
    transaction: TransactionDatabase,
    event: E,
    context: {
      /** Optional caller/pin cancellation signal. */
      signal: AbortSignal; /** Optional absolute call/transaction deadline in Unix milliseconds. */
      deadline?: number;
    }
  ): void | Promise<void>;
}
/** Bind business work and bounded journal inserts to one real facade-owned pinned transaction, without queue publishing or retry loops.
 * @param {Pick<DatabaseFacade, 'transaction' | 'transactionCapabilities'>} database - Borrowed facade exposing real pinned transactions and capability metadata.
 * @param {TransactionalOutboxWriter<E>} writer - Trusted journal writer that uses only the supplied pin.
 * @returns {object} Stateless transactional helper; database/writer ownership remains with the host.
 */
export function createTransactionalOutbox<E>(
  database: Pick<DatabaseFacade, 'transaction' | 'transactionCapabilities'>,
  writer: TransactionalOutboxWriter<E>
) {
  if (
    typeof database?.transaction !== 'function' ||
    typeof database?.transactionCapabilities !== 'function' ||
    typeof writer?.enqueue !== 'function'
  ) {
    throw new ServiceEndpointError('OUTBOX_PINNED_TRANSACTION_REQUIRED');
  }
  /** Facade-owned pinned transaction capability declaration checked before exposing the helper. */
  const capabilities = database.transactionCapabilities();
  if (
    !capabilities ||
    typeof capabilities !== 'object' ||
    !Array.isArray(capabilities.isolationLevels)
  ) {
    throw new ServiceEndpointError('OUTBOX_PINNED_TRANSACTION_REQUIRED');
  }
  /** Borrowed bound pinned-transaction function; this helper does not own the database. */
  const transaction = database.transaction.bind(database);
  /** Trusted journal writer bound to its owner and always supplied the same transaction pin. */
  const write = writer.enqueue.bind(writer);
  return {
    /** Execute business work and await every accepted serial journal insert before the same transaction completes.
     * @param {( transaction: TransactionDatabase, enqueue: (event: E) => Promise<void> ) => T | Promise<T>} work - Trusted business callback receiving the real pin and bounded enqueue function.
     * @param {TransactionOptions} options - Database-owned isolation/deadline options.
     * @returns {Promise<T>} Committed transaction result, or callback/journal failure under the database contract.
     */
    run<T>(
      work: (
        transaction: TransactionDatabase,
        enqueue: (event: E) => Promise<void>
      ) => T | Promise<T>,
      options: TransactionOptions = {}
    ): Promise<T> {
      if (typeof work !== 'function') {
        return Promise.reject(new ServiceEndpointError('OUTBOX_WORK_INVALID'));
      }
      return transaction(async (pin) => {
        let count = 0,
          open = true;
        /** Bounded journal enqueue settlements retained even when the business callback ignores returned promises. */
        const jobs: Promise<void>[] = [];
        let tail = Promise.resolve();
        /** Serialize a bounded event into the same pinned transaction without publishing a queue job.
         * @param {E} event - Validated inert event data.
         * @returns {Promise<void>} Journal write settlement within this pin.
         */
        const enqueue = (event: E): Promise<void> => {
          if (!open) {
            return Promise.reject(
              new ServiceEndpointError('OUTBOX_SCOPE_CLOSED')
            );
          }
          if (++count > 64) {
            /** Retained validation/limit/journal failure forcing transaction failure. */
            const rejected = Promise.reject<void>(
              new ServiceEndpointError('OUTBOX_EVENT_LIMIT')
            );
            if (count === 65) {
              jobs.push(rejected);
            }
            void rejected.catch(() => {});
            return rejected;
          }
          let body: string;
          try {
            body = encode(event, 65536);
          } catch (error) {
            /** Retained validation/limit/journal failure forcing transaction failure. */
            const rejected = tail.then(() => {
              throw error;
            });
            tail = rejected;
            jobs.push(rejected);
            void rejected.catch(() => {});
            return rejected;
          }
          /** Serial journal write using the transaction pin and its cancellation signal. */
          const job = tail.then(async () => {
            pin.signal.throwIfAborted();
            await write(pin, JSON.parse(body) as E, {
              signal: pin.signal,
              deadline: options.deadline,
            });
            pin.signal.throwIfAborted();
          });
          tail = job;
          jobs.push(job);
          void job.catch(() => {});
          return job;
        };
        let value: T | undefined,
          failure: unknown,
          failed = false;
        try {
          value = await work(pin, enqueue);
        } catch (error) {
          failure = error;
          failed = true;
        } finally {
          open = false;
        }
        /** Actual journal settlements awaited before allowing the transaction callback to complete. */
        const settled = await Promise.allSettled(jobs);
        /** Retained validation/limit/journal failure forcing transaction failure. */
        const rejected = settled.find(
          (item): item is PromiseRejectedResult => item.status === 'rejected'
        );
        if (failed) {
          throw failure;
        }
        if (rejected) {
          throw rejected.reason;
        }
        pin.signal.throwIfAborted();
        return value as T;
      }, options);
    },
  };
}
