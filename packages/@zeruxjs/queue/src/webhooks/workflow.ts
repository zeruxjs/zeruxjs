import { randomUUID } from 'node:crypto';
import { hashData } from '@zeruxjs/security/crypto';
import type {
  DatabaseFacade,
  TransactionDatabase,
  TransactionOptions,
} from '@zeruxjs/db';
import {
  bodyJSON,
  fail,
  fields,
  id,
  number,
  WebhookError,
  type WebhookAttempt,
  type WebhookDestination,
  type WebhookInput,
  type WebhookPolicy,
  type WebhookQueuePublisher,
  type WebhookRecord,
  type WebhookReference,
  type WebhookState,
  type WebhookStore,
  type WebhookTransport,
} from './contracts.js';
import { signWebhook } from './signing.js';
export interface WebhookWorkflowOptions {
  /** Borrowed host-owned linearizable webhook-cas-v1 durable store. */
  store: WebhookStore;
  /** Borrowed explicit HTTPS transport; close workflow before transport. */
  transport: WebhookTransport;
  /** Required fresh action/reference/principal policy; only literal true permits execution. */
  authorize: (
    action: 'enqueue' | 'deliver' | 'dispatch' | 'inspect' | 'redrive',
    reference: WebhookReference,
    principal: unknown
  ) => boolean | Promise<boolean>;
  /** Required private tenant-bound registry with current URL/credentials/approval. */
  destination: (
    tenant: string,
    reference: string
  ) => WebhookDestination | Promise<WebhookDestination>;
  /** Explicit bounded total-age/attempt/transient-status policy; no hidden retries. */
  policy: WebhookPolicy;
  /** HTTP deadline, default 10000 ms and valid 1 through 30000. */
  timeoutMs?: number;
  /** Sending lease, default 60000 ms; at least timeout+1000 and at most 300000. */
  leaseMs?: number;
  /** Actual admitted workflow ceiling, default 16 and maximum 128. */
  maxPending?: number;
  /** Optional trusted epoch-millisecond clock; production clocks must be coordinated. */
  now?: () => number;
  /** Optional trusted finite zero-to-one jitter source; default Math.random. */
  random?: () => number;
}
/** Own bounded durable webhook operations over borrowed host CAS storage, signing policy and HTTPS transport. Starts no worker, scheduler or persistence adapter.
 * @param {WebhookWorkflowOptions} options - Explicit private durable store, transport, authorization, destination registry and retry budgets.
 * @returns {object} Workflow with awaited close; application owns store, credentials, queue and transport lifetimes.
 */
export function createWebhookWorkflow(options: WebhookWorkflowOptions) {
  fields(options, [
    'store',
    'transport',
    'authorize',
    'destination',
    'policy',
    'timeoutMs',
    'leaseMs',
    'maxPending',
    'now',
    'random',
  ]);
  if (
    options.store?.contract !== 'webhook-cas-v1' ||
    ['get', 'cas', 'due'].some(
      (key) => typeof (options.store as any)[key] !== 'function'
    ) ||
    options.transport?.contract !== 'webhook-https-v1' ||
    typeof options.transport.send !== 'function' ||
    typeof options.transport.validate !== 'function' ||
    typeof options.authorize !== 'function' ||
    typeof options.destination !== 'function' ||
    (options.now !== undefined && typeof options.now !== 'function') ||
    (options.random !== undefined && typeof options.random !== 'function')
  ) {
    throw fail('INVALID_WORKFLOW');
  }
  fields(options.policy, [
    'maxAttempts',
    'maxAgeMs',
    'baseDelayMs',
    'maxDelayMs',
    'retryAfterMaxMs',
    'transientStatuses',
    'retryNotSent',
  ]);
  /** Host retry policy before independent validation/copying. */
  const raw = options.policy;
  if (!Array.isArray(raw.transientStatuses)) {
    throw fail('INVALID_POLICY');
  }
  /** Validated copied retry/age/attempt/transient-status policy. */
  const policy: WebhookPolicy = {
    maxAttempts: number(raw.maxAttempts, 1, 20),
    maxAgeMs: number(raw.maxAgeMs, 1000, 30 * 86400000),
    baseDelayMs: number(raw.baseDelayMs, 1, 86400000),
    maxDelayMs: number(raw.maxDelayMs, 1, 86400000),
    retryAfterMaxMs: number(raw.retryAfterMaxMs, 0, 86400000),
    transientStatuses: [...raw.transientStatuses],
    retryNotSent: raw.retryNotSent,
  };
  if (
    policy.baseDelayMs > policy.maxDelayMs ||
    typeof policy.retryNotSent !== 'boolean' ||
    !Array.isArray(raw.transientStatuses) ||
    raw.transientStatuses.length > 16 ||
    raw.transientStatuses.some(
      (code) =>
        !Number.isSafeInteger(code) ||
        (![408, 425, 429].includes(code) && (code < 500 || code > 599))
    )
  ) {
    throw fail('INVALID_POLICY');
  }
  /** Validated HTTP observation deadline; native settlement can outlive cancellation. */
  const timeout = number(options.timeoutMs ?? 10000, 1, 30000);
  /** Validated sending lease longer than the HTTP deadline. */
  const leaseMs = number(options.leaseMs ?? 60000, timeout + 1000, 300000);
  /** Validated process-local admitted operation ceiling. */
  const max = number(options.maxPending ?? 16, 1, 128);
  /** Borrowed host durable CAS store; no memory fallback or implicit close. */
  const store = options.store;
  /** Borrowed host HTTPS transport; workflow owns only individual attempt signals. */
  const transport = options.transport;
  /** Borrowed required fresh host authorization policy. */
  const authorize = options.authorize;
  /** Borrowed tenant/destination registry resolver, rechecked for operations. */
  const resolve = options.destination;
  /** Borrowed configured jitter source; values are validated before computing a delay. */
  const random = options.random ?? Math.random;
  /** Validate each trusted epoch clock reading before durable time decisions.
   * @returns {number} Current validated trusted epoch milliseconds.
   */
  const now = () => number((options.now ?? Date.now)(), 0, 8640000000000000);
  let closed = false;
  /** Actually unsettled admitted operations; capacity survives caller cancellation. */
  const pending = new Set<Promise<unknown>>();
  /** Owned active HTTP attempt controllers signalled on workflow close. */
  const controllers = new Set<AbortController>();
  /** Copy only a validated tenant/delivery compound reference; syntax alone never grants access.
   * @param {WebhookReference} input - Unknown-at-runtime explicit reference.
   * @returns {WebhookReference} Independent compound key used by every authorized durable operation.
   */
  function reference(input: WebhookReference) {
    fields(input, ['tenant', 'deliveryId']);
    id(input.tenant);
    id(input.deliveryId);
    return { tenant: input.tenant, deliveryId: input.deliveryId };
  }
  /** Reauthorize each operation against the authenticated initiating host principal; require literal true.
   * @param {Parameters<typeof authorize>[0]} action - Fixed privileged operation.
   * @param {WebhookReference} ref - Verified tenant/delivery scope.
   * @param {unknown} principal - Host-authenticated initiating identity, not a browser role claim.
   * @returns {Promise<void>} Rejects before dependent work on denial or policy failure.
   */
  async function allowed(
    action: Parameters<typeof authorize>[0],
    ref: WebhookReference,
    principal: unknown
  ) {
    if ((await authorize(action, ref, principal)) !== true) {
      throw fail('FORBIDDEN');
    }
  }
  /** Resolve current private destination and active signing policy for this exact tenant/reference, validating URL policy before use.
   * @param {Pick<WebhookRecord, 'tenant' | 'destination'>} record - Stored tenant and private destination reference.
   * @returns {Promise<WebhookDestination>} Currently approved registry entry; declaration of consumer idempotency still needs receiver qualification.
   */
  async function destination(
    record: Pick<WebhookRecord, 'tenant' | 'destination'>
  ) {
    /** Validated stored/registry record or bounded random draw within its operation. */
    const value = await resolve(record.tenant, record.destination);
    if (
      !value ||
      value.tenant !== record.tenant ||
      value.ref !== record.destination ||
      value.enabled !== true ||
      value.consumerIdempotency !== true ||
      !value.keys
    ) {
      throw fail('DESTINATION_DENIED');
    }
    transport.validate(value.url);
    return value;
  }
  /** Validate stored immutable facts, hash, state, lease and bounded redacted history before trusting a durable record.
   * @param {WebhookRecord} value - Private host-store record.
   * @param {WebhookReference} ref - Expected compound key; cross-tenant records reject.
   * @returns {WebhookRecord} Independent validated record; corrupt storage is never treated as a missing success.
   */
  function validate(
    value: WebhookRecord,
    ref: WebhookReference
  ): WebhookRecord {
    if (
      !value ||
      value.contract !== 1 ||
      value.tenant !== ref.tenant ||
      value.deliveryId !== ref.deliveryId
    ) {
      throw fail('INVALID_STORED_RECORD');
    }
    id(value.eventId);
    id(value.destination);
    number(value.schemaVersion, 1, 1000000);
    number(value.revision, 1, Number.MAX_SAFE_INTEGER);
    number(value.attempts, 0, 20);
    // Validate bounded stored facts or process only this tenant's ordered references/owned controllers.
    for (const time of [value.createdAt, value.updatedAt, value.nextAt]) {
      number(time, 0, 8640000000000000);
    }
    if (
      typeof value.body !== 'string' ||
      Buffer.byteLength(value.body) > 65536 ||
      hashData(value.body) !== value.bodyHash ||
      !['pending', 'sending', 'delivered', 'uncertain', 'dead'].includes(
        value.state
      ) ||
      !Array.isArray(value.history) ||
      value.history.length > 20 ||
      (value.state === 'sending') !== (value.lease !== null)
    ) {
      throw fail('INVALID_STORED_RECORD');
    }
    // Validate bounded stored facts or process only this tenant's ordered references/owned controllers.
    for (const attempt of value.history) {
      fields(attempt, ['at', 'durationMs', 'outcome', 'code', 'httpStatus']);
      number(attempt.at, 0, 8640000000000000);
      number(attempt.durationMs, 0, 8640000000000000);
      if (
        !['pending', 'sending', 'delivered', 'uncertain', 'dead'].includes(
          attempt.outcome
        ) ||
        typeof attempt.code !== 'string' ||
        !/^[A-Z_]{1,48}$/.test(attempt.code)
      ) {
        throw fail('INVALID_STORED_RECORD');
      }
      if (attempt.httpStatus !== undefined) {
        number(attempt.httpStatus, 100, 599);
      }
    }
    if (value.lease) {
      if (
        typeof value.lease.token !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(value.lease.token)
      ) {
        throw fail('INVALID_STORED_RECORD');
      }
      number(value.lease.until, 0, 8640000000000000);
    }
    return structuredClone(value);
  }
  /** Read one exact compound key and validate any returned private durable record.
   * @param {WebhookReference} ref - Verified tenant/delivery reference.
   * @returns {Promise<WebhookRecord | null>} Validated private record or null; dependency/corruption failures remain explicit.
   */
  async function read(ref: WebhookReference) {
    /** Validated stored/registry record or bounded random draw within its operation. */
    const value = await store.get(ref);
    return value === null ? null : validate(value, ref);
  }
  /** Build a bounded immutable signed-body envelope without writing or publishing anything.
   * @param {WebhookInput} input - Explicit event/schema/destination/payload facts; not executable source.
   * @returns {WebhookRecord} Initial pending revision with original age clock and empty redacted history.
   */
  function newRecord(input: WebhookInput): WebhookRecord {
    fields(input, [
      'tenant',
      'deliveryId',
      'eventId',
      'destination',
      'schemaVersion',
      'payload',
    ]);
    // Validate bounded stored facts or process only this tenant's ordered references/owned controllers.
    for (const value of [
      input.tenant,
      input.deliveryId,
      input.eventId,
      input.destination,
    ]) {
      id(value);
    }
    number(input.schemaVersion, 1, 1000000);
    /** Exact bounded private signed event envelope, never included in inspection. */
    const body = bodyJSON({
      eventId: input.eventId,
      schemaVersion: input.schemaVersion,
      data: input.payload,
    });
    /** Validated attempt/admission timestamp, distinct from ingestion/business event ordering. */
    const time = now();
    return {
      contract: 1,
      tenant: input.tenant,
      deliveryId: input.deliveryId,
      eventId: input.eventId,
      destination: input.destination,
      schemaVersion: input.schemaVersion,
      body,
      bodyHash: hashData(body),
      revision: 1,
      state: 'pending',
      attempts: 0,
      createdAt: time,
      updatedAt: time,
      nextAt: time,
      lease: null,
      history: [],
    };
  }
  /** CAS one exact durable revision and update its clock; never emulate a linearizable store with get/set.
   * @param {WebhookRecord} old - Previously validated complete record.
   * @param {Partial<WebhookRecord>} patch - Explicit state/lease/history transition preserving immutable facts.
   * @returns {Promise<WebhookRecord>} Winning next revision; contention rejects without silently overwriting another worker.
   */
  async function change(old: WebhookRecord, patch: Partial<WebhookRecord>) {
    /** Complete next durable revision compared against the exact prior revision. */
    const next = {
      ...old,
      ...patch,
      revision: old.revision + 1,
      updatedAt: now(),
    };
    if (
      (await store.cas(
        { tenant: old.tenant, deliveryId: old.deliveryId },
        old.revision,
        next
      )) !== true
    ) {
      throw fail('REVISION_CONFLICT');
    }
    return next;
  }
  /** Project authorized state and redacted attempt facts without bodies, URLs, signing keys or lease secrets.
   * @param {WebhookRecord} value - Validated private durable record.
   * @returns {object} Safe inspect/delivery receipt; public HTTP authorization remains the host responsibility.
   */
  function summary(value: WebhookRecord) {
    return {
      tenant: value.tenant,
      deliveryId: value.deliveryId,
      eventId: value.eventId,
      destination: value.destination,
      schemaVersion: value.schemaVersion,
      state: value.state,
      attempts: value.attempts,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      nextAt: value.nextAt,
      history: structuredClone(value.history),
    };
  }
  /** Compute bounded half-to-full jitter plus an explicitly capped Retry-After hint; no process timer schedules a retry.
   * @param {number} attempt - Current claimed total attempt number.
   * @param {string} retryAfter - Optional bounded response hint as seconds or HTTP date.
   * @returns {number} Positive persisted delay, still constrained by total age and attempt caps.
   */
  function retryDelay(attempt: number, retryAfter?: string) {
    /** Validated stored/registry record or bounded random draw within its operation. */
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw fail('INVALID_RANDOM');
    }
    /** Exponentially scaled retry base clamped before applying bounded jitter. */
    const base = Math.min(
      policy.maxDelayMs,
      policy.baseDelayMs * 2 ** Math.min(attempt - 1, 20)
    );
    let delay = Math.floor(base * (0.5 + value * 0.5));
    if (retryAfter && retryAfter.length <= 128) {
      /** Parsed Retry-After hint clamped by explicit host policy. */
      const suggested = /^\d{1,9}$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Date.parse(retryAfter) - now();
      if (Number.isFinite(suggested) && suggested >= 0) {
        delay = Math.max(delay, Math.min(suggested, policy.retryAfterMaxMs));
      }
    }
    return Math.min(
      Math.max(delay, 1),
      Math.max(policy.maxDelayMs, policy.retryAfterMaxMs)
    );
  }
  /** Authorize, claim one pending revision and record the explicit delivery outcome. Expired sending leases and lost acknowledgements become uncertain, never automatic resend.
   * @param {WebhookReference} ref - Verified durable compound reference.
   * @param {unknown} principal - Authenticated worker identity reauthorized before dispatch.
   * @returns {Promise<object>} Durable redacted outcome; CAS/store failures after remote effects can leave sending until reconciliation.
   */
  async function process(ref: WebhookReference, principal: unknown) {
    await allowed('deliver', ref, principal);
    let value = await read(ref);
    if (!value) {
      throw fail('NOT_FOUND');
    }
    /** Validated attempt/admission timestamp, distinct from ingestion/business event ordering. */
    const time = now();
    if (time < value.createdAt) {
      throw fail('INVALID_CLOCK');
    }
    if (value.state === 'sending') {
      if (value.lease!.until > time) {
        throw fail('BUSY');
      }
      return summary(await change(value, { state: 'uncertain', lease: null }));
    }
    if (value.state !== 'pending' || value.nextAt > time) {
      return summary(value);
    }
    if (
      value.attempts >= policy.maxAttempts ||
      time - value.createdAt >= policy.maxAgeMs
    ) {
      return summary(await change(value, { state: 'dead' }));
    }
    /** Current approved private destination and active signing configuration. */
    const target = await destination(value);
    // Signing configuration is checked before claim; each attempt resolves the active ring again.
    /** Fixed authenticated protocol headers over exact immutable body bytes. */
    const headers = signWebhook(
      {
        tenant: value.tenant,
        destination: value.destination,
        deliveryId: value.deliveryId,
        timestamp: Math.floor(time / 1000),
        body: value.body,
      },
      target.keys
    );
    if (closed) {
      throw fail('CLOSED');
    }
    value = await change(value, {
      state: 'sending',
      attempts: value.attempts + 1,
      lease: { token: randomUUID(), until: time + leaseMs },
    });
    /** Owned single-attempt cancellation controller; not proof of remote rollback. */
    const controller = new AbortController();
    controllers.add(controller);
    if (closed) {
      controller.abort();
    }
    /** Owned HTTP attempt deadline timer cleared in finally. */
    const timer = setTimeout(() => controller.abort(), timeout);
    let state: WebhookState,
      code = 'OUTCOME_UNKNOWN',
      status: number | undefined,
      delay = 0;
    try {
      if (controller.signal.aborted) {
        throw fail('NOT_SENT');
      }
      /** Complete bounded transport response; redirects/permanent/transient states stay explicit. */
      const response = await transport.send({
        url: target.url,
        body: value.body,
        headers: {
          ...headers,
          'x-zerux-webhook-schema': String(value.schemaVersion),
        },
        signal: controller.signal,
        timeoutMs: timeout,
      });
      status = number(response.status, 100, 599);
      if (controller.signal.aborted) {
        state = 'uncertain';
      } else if (status >= 200 && status < 300) {
        state = 'delivered';
        code = 'HTTP_SUCCESS';
      } else if (status >= 300 && status < 400) {
        state = 'dead';
        code = 'REDIRECT_DENIED';
      } else if (policy.transientStatuses.includes(status)) {
        state = 'pending';
        code = 'HTTP_TRANSIENT';
        delay = retryDelay(value.attempts, response.retryAfter);
      } else {
        state = 'dead';
        code = 'HTTP_PERMANENT';
      }
    } catch (error) {
      state = 'uncertain';
      code = 'OUTCOME_UNKNOWN';
      if (
        error instanceof WebhookError &&
        ['NOT_SENT', 'TRANSPORT_OVERLOAD', 'TRANSPORT_CLOSED'].includes(
          error.code
        )
      ) {
        state = policy.retryNotSent ? 'pending' : 'dead';
        code = 'NOT_SENT';
        if (state === 'pending') {
          delay = retryDelay(value.attempts);
        }
      } else if (
        error instanceof WebhookError &&
        ['DESTINATION_DENIED', 'ADDRESS_DENIED'].includes(error.code)
      ) {
        state = 'dead';
        code = 'DESTINATION_DENIED';
      }
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
    /** Validated post-attempt epoch time; backwards clock movement rejects. */
    const ended = now();
    if (ended < time) {
      throw fail('INVALID_CLOCK');
    }
    if (
      state === 'pending' &&
      (value.attempts >= policy.maxAttempts ||
        ended + delay - value.createdAt >= policy.maxAgeMs)
    ) {
      state = 'dead';
      code = 'RETRY_LIMIT';
    }
    /** Bounded redacted attempt facts without bodies, keys, URLs or raw causes. */
    const attempt: WebhookAttempt = {
      at: time,
      durationMs: Math.max(0, ended - time),
      outcome: state,
      code,
      ...(status !== undefined ? { httpStatus: status } : {}),
    };
    return summary(
      await change(value, {
        state,
        lease: null,
        nextAt: ended + delay,
        history: [...value.history, attempt],
      })
    );
  }
  /** Bound process-local admitted work through actual settlement and redact private dependency causes.
   * @param {function} work - One explicit authorized operation; no automatic mutation replay.
   * @returns {Promise<T>} Original successful result or fixed public workflow error; close drains actual promises.
   */
  function run<T>(work: () => Promise<T>): Promise<T> {
    if (closed) {
      return Promise.reject(fail('CLOSED'));
    }
    if (pending.size >= max) {
      return Promise.reject(fail('OVERLOAD'));
    }
    /** One admitted operation promise retained until actual settlement. */
    const job = Promise.resolve()
      .then(() => {
        if (closed) {
          throw fail('CLOSED');
        }
        return work();
      })
      .catch((error) => {
        if (error instanceof WebhookError) {
          throw error;
        }
        throw fail('DEPENDENCY_FAILED', error);
      });
    pending.add(job);
    void job.finally(() => pending.delete(job)).catch(() => {});
    return job;
  }
  return {
    /** Run business mutation and outbox insertion atomically only through a real negotiated shared pin and a writer using that exact pin. Never publish/send inside this callback.
     * @param {Pick<DatabaseFacade, 'transaction' | 'transactionCapabilities'>} database - Borrowed transaction-capable database facade; unsupported pins reject.
     * @param {object} writer - Host journal writer using the supplied transaction pin.
     * @param {function} writer.insert - Journal insertion using that exact business pin.
     * @param {WebhookInput} input - Explicit event facts prepared and authorized before transaction invocation.
     * @param {function} business - Trusted callback for the one pinned business mutation; no automatic callback replay.
     * @param {unknown} principal - Authenticated initiating identity.
     * @param {TransactionOptions} settings - Database-owned transaction isolation/deadline/cancellation policy.
     * @returns {Promise<unknown>} Business result after real transaction completion; ambiguous native commits require journal-key reconciliation.
     */
    commit<T>(
      database: Pick<DatabaseFacade, 'transaction' | 'transactionCapabilities'>,
      writer: {
        /** Insert the complete outbox record on the exact supplied business transaction pin.
         * @param {TransactionDatabase} pin - Already-owned pinned transaction; never open another connection.
         * @param {WebhookRecord} record - Prepared private immutable outbox record.
         * @returns {void | Promise<void>} Journal insertion settlement; failure must propagate to rollback.
         */
        insert(
          pin: TransactionDatabase,
          record: WebhookRecord
        ): Promise<void> | void;
      },
      input: WebhookInput,
      business: (pin: TransactionDatabase) => T | Promise<T>,
      principal: unknown,
      settings: TransactionOptions = {}
    ) {
      /** Prepared/validated private record; host store owns persistence and unique keys. */
      const record = newRecord(input);
      /** Independent verified tenant/delivery key used for each authorization/CAS. */
      const ref = { tenant: record.tenant, deliveryId: record.deliveryId };
      /** Existing shared database pin capabilities; no transaction facade is invented. */
      const caps = database?.transactionCapabilities?.();
      if (
        typeof database?.transaction !== 'function' ||
        !caps ||
        !Array.isArray(caps.isolationLevels) ||
        !caps.isolationLevels.length ||
        caps.isolationLevels.length > 5 ||
        caps.savepoints !== false ||
        !['cooperative', 'unsupported'].includes(caps.timeout) ||
        typeof caps.transactionalDdl !== 'boolean' ||
        typeof writer?.insert !== 'function' ||
        typeof business !== 'function'
      ) {
        return Promise.reject(fail('PINNED_TRANSACTION_REQUIRED'));
      }
      return run(async () => {
        await allowed('enqueue', ref, principal);
        /** Current approved private destination and active signing configuration. */
        const target = await destination(record);
        signWebhook(
          {
            tenant: record.tenant,
            destination: record.destination,
            deliveryId: record.deliveryId,
            timestamp: Math.floor(now() / 1000),
            body: record.body,
          },
          target.keys
        );
        return database.transaction!(async (pin) => {
          /** Business callback result retained until journal insertion and transaction completion. */
          const result = await business(pin);
          await writer.insert(pin, structuredClone(record));
          return result;
        }, settings);
      });
    },
    /** Await authorization/destination/signing preparation BEFORE entering a synchronous transaction. Insert the returned record on that exact SQLite synchronous pin with no await; preparation itself writes nothing.
     * @param {WebhookInput} input - Explicit event and tenant/destination facts.
     * @param {unknown} principal - Authenticated initiating identity, freshly authorized for enqueue.
     * @returns {Promise<WebhookRecord>} Prepared private record; host owns unique insertion and business/outbox atomicity.
     */
    prepare(input: WebhookInput, principal: unknown) {
      /** Prepared/validated private record; host store owns persistence and unique keys. */
      const record = newRecord(input);
      return run(async () => {
        await allowed(
          'enqueue',
          { tenant: record.tenant, deliveryId: record.deliveryId },
          principal
        );
        /** Current approved private destination and active signing configuration. */
        const target = await destination(record);
        signWebhook(
          {
            tenant: record.tenant,
            destination: record.destination,
            deliveryId: record.deliveryId,
            timestamp: Math.floor(now() / 1000),
            body: record.body,
          },
          target.keys
        );
        return record;
      });
    },
    /** Execute one explicit delivery reference under current policy; repeated completed/uncertain records never imply a new remote send.
     * @param {WebhookReference} input - Verified compound reference.
     * @param {unknown} principal - Authenticated worker identity.
     * @returns {Promise<object>} Durable redacted outcome, preserving uncertainty.
     */
    deliver(input: WebhookReference, principal: unknown) {
      /** Independent verified tenant/delivery key used for each authorization/CAS. */
      const ref = reference(input);
      return run(() => process(ref, principal));
    },
    /** Reauthorize and recheck current destination/credentials before projecting redacted durable state.
     * @param {WebhookReference} input - Verified compound reference.
     * @param {unknown} principal - Authenticated operator identity.
     * @returns {Promise<object | null>} Private authorized metadata/history only, or null; no stored body/token URL.
     */
    inspect(input: WebhookReference, principal: unknown) {
      /** Independent verified tenant/delivery key used for each authorization/CAS. */
      const ref = reference(input);
      return run(async () => {
        await allowed('inspect', ref, principal);
        /** Validated stored/registry record or bounded random draw within its operation. */
        const value = await read(ref);
        if (value) {
          /** Current approved private destination and active signing configuration. */
          const target = await destination(value);
          signWebhook(
            {
              tenant: value.tenant,
              destination: value.destination,
              deliveryId: value.deliveryId,
              timestamp: Math.floor(now() / 1000),
              body: value.body,
            },
            target.keys
          );
        }
        return value ? summary(value) : null;
      });
    },
    /** Explicitly reopen only authorized dead/externally-reconciled uncertain records without resetting original age or total attempts.
     * @param {WebhookReference} input - Verified compound reference.
     * @param {unknown} principal - Authenticated privileged operator.
     * @param {object} settings - Explicit evidence assertion for uncertain outcomes; not inferred automatically.
     * @param {boolean} [settings.confirmedUncertain] - Host assertion of external reconciliation evidence.
     * @returns {Promise<object>} Winning pending revision after current policy/signing rechecks; capped/denied/conflicting work rejects.
     */
    redrive(
      input: WebhookReference,
      principal: unknown,
      settings: {
        /** Required true for uncertain redrive after external reconciliation evidence. */
        confirmedUncertain?: boolean;
      } = {}
    ) {
      /** Independent verified tenant/delivery key used for each authorization/CAS. */
      const ref = reference(input);
      fields(settings, ['confirmedUncertain']);
      if (
        settings.confirmedUncertain !== undefined &&
        typeof settings.confirmedUncertain !== 'boolean'
      ) {
        throw fail('INVALID_INPUT');
      }
      return run(async () => {
        await allowed('redrive', ref, principal);
        /** Validated stored/registry record or bounded random draw within its operation. */
        const value = await read(ref);
        if (
          !value ||
          !['dead', 'uncertain'].includes(value.state) ||
          (value.state === 'uncertain' && settings.confirmedUncertain !== true)
        ) {
          throw fail('REDRIVE_DENIED');
        }
        if (
          value.attempts >= policy.maxAttempts ||
          now() - value.createdAt >= policy.maxAgeMs
        ) {
          throw fail('RETRY_LIMIT');
        }
        /** Current approved private destination and active signing configuration. */
        const target = await destination(value);
        signWebhook(
          {
            tenant: value.tenant,
            destination: value.destination,
            deliveryId: value.deliveryId,
            timestamp: Math.floor(now() / 1000),
            body: value.body,
          },
          target.keys
        );
        return summary(
          await change(value, { state: 'pending', lease: null, nextAt: now() })
        );
      });
    },
    /** Page bounded sorted due references and publish opaque IDs only to an acknowledged non-destructive backend. Earlier page publications may precede a later failure; CAS remains authoritative.
     * @param {string} tenant - Verified tenant scope.
     * @param {unknown} principal - Authenticated dispatcher identity reauthorized for each reference.
     * @param {WebhookQueuePublisher} queue - Borrowed explicit acknowledged publisher, never destructive MemcacheQ.
     * @param {object} settings - Exclusive opaque cursor and finite page limit.
     * @param {string | null} [settings.cursor] - Exclusive ascending tenant-bound continuation.
     * @param {number} [settings.limit] - Bounded due page size, default 20.
     * @returns {Promise<object>} Published count and stable next cursor; queue publication is not atomic with database commit.
     */
    dispatch(
      tenant: string,
      principal: unknown,
      queue: WebhookQueuePublisher,
      settings: {
        /** Exclusive ascending delivery-ID continuation or null. */
        cursor?: string | null;
        /** Due-reference page limit, default 20 and maximum 50. */
        limit?: number;
      } = {}
    ) {
      id(tenant);
      fields(settings, ['cursor', 'limit']);
      if (
        queue?.acknowledged !== true ||
        queue.destructiveRead !== false ||
        typeof queue.publish !== 'function'
      ) {
        return Promise.reject(fail('ACKNOWLEDGED_QUEUE_REQUIRED'));
      }
      /** Validated finite due-reference page size, default 20. */
      const limit = number(settings.limit ?? 20, 1, 50);
      /** Validated exclusive delivery continuation scoped to the current tenant. */
      const cursor = settings.cursor ?? null;
      if (cursor !== null) {
        id(cursor);
      }
      return run(async () => {
        await allowed(
          'dispatch',
          { tenant, deliveryId: cursor ?? 'page' },
          principal
        );
        /** Host-store due page validated for finite count and strict ascending continuation. */
        const page = await store.due(tenant, now(), cursor, limit);
        if (
          !page ||
          !Array.isArray(page.ids) ||
          page.ids.length > limit ||
          (page.next !== null && typeof page.next !== 'string')
        ) {
          throw fail('INVALID_PAGE');
        }
        let previous = cursor;
        // Validate bounded stored facts or process only this tenant's ordered references/owned controllers.
        for (const deliveryId of page.ids) {
          id(deliveryId);
          if (previous !== null && deliveryId <= previous) {
            throw fail('INVALID_PAGE');
          }
          previous = deliveryId;
        }
        if (
          page.next !== null &&
          (page.next !== previous || !page.ids.length)
        ) {
          throw fail('INVALID_PAGE');
        }
        // Validate bounded stored facts or process only this tenant's ordered references/owned controllers.
        for (const deliveryId of page.ids) {
          /** Independent verified tenant/delivery key used for each authorization/CAS. */
          const ref = { tenant, deliveryId };
          await allowed('deliver', ref, principal);
          /** Prepared/validated private record; host store owns persistence and unique keys. */
          const record = await read(ref);
          if (!record) {
            throw fail('INVALID_PAGE');
          }
          await destination(record);
          await queue.publish(ref);
        }
        return { published: page.ids.length, next: page.next };
      });
    },
    /** Stop admission, signal active HTTP attempts and await actual admitted settlement without closing borrowed stores, credentials or transport.
     * @returns {Promise<void>} Drains native/host callback settlement; abort never proves remote rollback.
     */
    async close() {
      closed = true;
      // Validate bounded stored facts or process only this tenant's ordered references/owned controllers.
      for (const controller of controllers) {
        controller.abort();
      }
      await Promise.allSettled([...pending]);
    },
    /** Project fixed closed/pending counters without private tenant/payload/URL labels.
     * @returns {object} Process-local admission status, not broker or distributed durability proof.
     */
    status() {
      return { closed, pending: pending.size };
    },
  };
}
