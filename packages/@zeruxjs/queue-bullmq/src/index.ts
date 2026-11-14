import { copyJobPayload, QUEUE_JOB_LIMITS } from './payload.js';
export { QUEUE_JOB_LIMITS } from './payload.js';
import { randomUUID } from 'node:crypto';
import {
  createQueueDashboard,
  type QueueDashboardOptions,
} from './dashboard.js';
export { createQueueDashboard } from './dashboard.js';
export type { QueueDashboardOptions } from './dashboard.js';
export * from './delivery.js';
export * from './scheduling.js';
import {
  createQueueTaskScheduler,
  type ScheduledTaskSpec,
  type TaskScheduleOptions,
} from './scheduling.js';
import {
  createBullMQRedisOptions,
  createBullMQRedisClusterConnections,
  type RedisConnectionSettings,
  type BullMQClusterConstructor,
  type BullMQClusterClient,
} from '@zeruxjs/cache-redis';

export type JobData = Record<string, unknown>;
export type JobProcessor = (
  job: QueueJob,
  token?: string
) => Promise<unknown> | unknown;
export interface QueueJob {
  /** Opaque native/durable identifier; not tenant authorization or permanent deduplication. */
  id?: string;
  /** Configured native queue/job label; never executable source. */
  name: string;
  /** Private raw job payload; producer/processor boundaries enforce plain JSON budgets. */
  data: JobData;
  /** Native observed attempts count, not exactly-once evidence. */
  attemptsMade?: number;
  /** Native progress state; host must exclude private payloads. */
  progress?: unknown;
  /** Update native job progress; host must avoid private content in shared progress metadata.
   * @param {number | object} progress - Explicit native progress; host keeps private fields out.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  updateProgress?(progress: number | object): Promise<void>;
  /** Optional native enqueue epoch milliseconds. */
  timestamp?: number;
  /** Optional native processor-start epoch milliseconds. */
  processedOn?: number;
  /** Optional native terminal epoch milliseconds. */
  finishedOn?: number;
  /** Read native job state for a guarded retry/cancel decision.
   * @returns {Promise<string>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  getState?(): Promise<string>;
  /** Ask native BullMQ for an atomic state-aware retry; host authorization is separate.
   * @param {'failed' | 'completed'} state - Required native retry state.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  retry?(state?: 'failed' | 'completed'): Promise<void>;
  /** Ask native BullMQ for guarded job removal; active locks may reject.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  remove?(): Promise<void>;
}
export interface QueueJobOptions {
  /** Retained native identity; cleanup can allow the same ID to be added again. */
  jobId?: string;
  /** Optional native persisted delay; no local timer emulates durable scheduling. */
  delay?: number;
  /** Native priority within its validated bounded range. */
  priority?: number;
  /** Native total attempts; ambiguous external side effects still need durable reconciliation. */
  attempts?: number;
  /** Validated fixed/exponential native retry policy. */
  backoff?:
    | number
    | {
        /** Fixed native backoff/event kind. */
        type: 'fixed' | 'exponential';
        /** Optional native persisted delay; no local timer emulates durable scheduling. */
        delay: number;
      };
  /** Explicit successful-job retention; retained IDs are not permanent business idempotency. */
  removeOnComplete?:
    | boolean
    | number
    | {
        /** Retention seconds, bounded before native allocation. */
        age?: number;
        /** Retention record ceiling, bounded before native allocation. */
        count?: number;
      };
  /** Explicit failed-job retention policy. */
  removeOnFail?:
    | boolean
    | number
    | {
        /** Retention seconds, bounded before native allocation. */
        age?: number;
        /** Retention record ceiling, bounded before native allocation. */
        count?: number;
      };
  /** Validated native repeating-task policy. */
  repeat?: {
    /** Native repeat interval milliseconds. */
    every?: number;
    /** Bounded native cron syntax; parser owns calendar semantics. */
    pattern?: string;
    /** Bounded native occurrence/page limit. */
    limit?: number;
    /** Optional native repeat behavior, not replay permission. */
    immediately?: boolean;
  };
  /** Native retained deduplication policy; not a durable business receipt. */
  deduplication?: {
    /** Opaque native/durable identifier; not tenant authorization or permanent deduplication. */
    id: string;
    /** Optional native deduplication expiry milliseconds. */
    ttl?: number;
  };
}
export interface QueueWorkerOptions {
  /** Explicit local worker concurrency, default one and maximum 1024. */
  concurrency?: number;
  /** Explicit native worker startup policy, default true for configured workers. */
  autorun?: boolean;
  /** Optional native worker lock duration, validated 1000 through 600000 ms. */
  lockDuration?: number;
  /** BullMQ Redis-coordinated limit, shared by all workers for the same queue. */
  limiter?: {
    /** Explicit native limiter count. */
    max: number;
    /** Explicit native limiter window milliseconds. */
    duration: number;
  };
}
export interface QueueDefinition {
  /** Configured native queue/job label; never executable source. */
  name: string;
  /** Native defaults merged with bounded service defaults. */
  defaultJobOptions?: QueueJobOptions;
}
export interface QueueServiceConfig {
  /** Explicit opt-in marker; import alone starts no service. */
  enabled?: boolean;
  /** Use a shared Redis server with @zeruxjs/cache-redis but NOT its prefixed keyspace. */
  redis: RedisConnectionSettings;
  /** Native BullMQ namespace; Cluster requires a hash tag and it never grants tenant permission. */
  prefix?: string;
  /** Explicit named queue definitions; maximum 256, with duplicate names rejected. */
  queues: Array<string | QueueDefinition>;
  /** Worker processors only run when explicitly supplied by the application. */
  workers?: Record<
    string,
    {
      /** Explicit trusted code callback; never discovered from broker data. */
      processor: JobProcessor;
    } & QueueWorkerOptions
  >;
  /** Wait for producer connections before marking queue ready. */
  readyTimeoutMs?: number;
  /** On shutdown allow running jobs to complete within this time, then force close workers. */
  shutdownGraceMs?: number;
  /** Optional logging hook; caller controls what data is logged. */
  onWorkerError?: (queue: string, error: unknown) => void;
  /** Optional cross-process BullMQ QueueEvents; no events connection exists unless enabled. */
  events?: {
    /** Explicit opt-in marker; import alone starts no service. */
    enabled: true;
    /** Optional fixed native event observer; no private job body or failure stack is included. */
    onEvent?: (event: QueueEventNotice) => void;
    /** Optional trusted native error observer; host must redact private causes before logging. */
    onError?: (queue: string, error: unknown) => void;
  };
  /** Required to use privileged controls; no HTTP routes are mounted automatically. */
  administration?: QueueAdministrationPolicy;
  /** Opt-in HTTP dashboard; requires administration.authorize and host session/CSRF callbacks. */
  dashboard?: QueueDashboardOptions;
}
export type QueueAdminAction =
  | 'inspect'
  | 'retry'
  | 'pause-queue'
  | 'resume-queue'
  | 'pause-worker'
  | 'resume-worker'
  | 'schedule-inspect'
  | 'schedule-create'
  | 'schedule-remove';
export interface QueueAdministrationPolicy {
  /** Fail closed on absent callback, denial or callback error. No permission caching. */
  authorize: (
    action: QueueAdminAction,
    queue: string,
    context: unknown
  ) => boolean | Promise<boolean>;
  /** Best effort audit: do not include job data, Redis secrets, or message bodies. */
  onAudit?: (entry: {
    /** Fixed authorized administrative operation label. */
    action: QueueAdminAction;
    /** Exact configured queue scope; not a browser tenant claim. */
    queue: string;
    /** Retained native identity; cleanup can allow the same ID to be added again. */
    jobId?: string;
    /** Whether the guarded operation completed; never a private cause/payload. */
    success: boolean;
    /** UTC observation timestamp without private correlation values. */
    at: string;
  }) => void | Promise<void>;
  /** Maximum authorized inspection page, default 50 and at most 100. */
  maxPageSize?: number;
}
export type QueueJobState =
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'failed'
  | 'completed'
  | 'paused'
  | 'waiting-children'
  | 'prioritized';
export interface QueueJobSummary {
  /** Opaque native/durable identifier; not tenant authorization or permanent deduplication. */
  id: string;
  /** Configured native queue/job label; never executable source. */
  name: string;
  /** Fixed native or managed lifecycle state, not inferred provider delivery. */
  state: string;
  /** Native observed attempts count, not exactly-once evidence. */
  attemptsMade: number;
  /** Optional native enqueue epoch milliseconds. */
  timestamp?: number;
  /** Optional native processor-start epoch milliseconds. */
  processedOn?: number;
  /** Optional native terminal epoch milliseconds. */
  finishedOn?: number;
}
export interface QueueEventNotice {
  /** Exact configured queue scope; not a browser tenant claim. */
  queue: string;
  /** Fixed native backoff/event kind. */
  type: 'completed' | 'failed' | 'waiting' | 'active' | 'stalled' | 'progress';
  /** Retained native identity; cleanup can allow the same ID to be added again. */
  jobId?: string;
  /** UTC observation timestamp without private correlation values. */
  at: string;
}
export interface QueueEventsLike {
  /** Register a trusted native event callback; its owning worker/events service controls removal/close.
   * @param {string} event - Fixed native event label.
   * @param {function} handler - Trusted explicit native callback.
   * @returns {this} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  on(event: string, handler: (...args: any[]) => void): this;
  /** Await native connection readiness; callers apply bounded observation policy.
   * @returns {Promise<unknown>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  waitUntilReady?(): Promise<unknown>;
  /** Stop admission and close owned workers, events, queues and Cluster clients in order. Deadlines limit waiting, not arbitrary processor execution; failed cleanup remains explicit.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  close(): Promise<void>;
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Preserve the public interface as an extension point for declaration merging.
export interface BullJobLike extends QueueJob {}
export interface BullQueueLike {
  /** Validate/snapshot one bounded plain JSON job and delegate once to the native producer; unknown publish outcomes are never automatically replayed.
   * @param {string} name - Explicit configured native queue/job or fixed administrative label.
   * @param {JobData} data - Plain bounded copied JSON reference data; never secrets.
   * @param {QueueJobOptions} options - Explicit bounded native options; owner retains authorization/lifecycle.
   * @returns {Promise<BullJobLike>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  add(
    name: string,
    data: JobData,
    options?: QueueJobOptions
  ): Promise<BullJobLike>;
  /** Prevalidate the complete bounded batch before any native call; this is not a cross-queue transaction or exactly-once guarantee.
   * @param {Array<{ name: string; data: JobData; opts?: QueueJobOptions }>} jobs - Explicit bounded job/reconciliation allowlist or complete enqueue batch.
   * @returns {Promise<BullJobLike[]>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  addBulk(
    jobs: Array<{
      /** Configured native queue/job label; never executable source. */
      name: string;
      /** Private raw job payload; producer/processor boundaries enforce plain JSON budgets. */
      data: JobData;
      /** Validated native options for this explicit operation. */
      opts?: QueueJobOptions;
    }>
  ): Promise<BullJobLike[]>;
  /** Read a raw native job through trusted server access; it may contain private payloads and must not be exposed directly.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @returns {Promise<BullJobLike | undefined | null>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  getJob(id: string): Promise<BullJobLike | undefined | null>;
  /** Read explicit native job-state counters.
   * @param {string[]} states - Known native state names only.
   * @returns {Promise<Record<string, number>>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  getJobCounts(...states: string[]): Promise<Record<string, number>>;
  /** Delegate a validated bounded native scheduler template through the selected service generation.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @param {Record<string, unknown>} repeat - Validated native repeat definition.
   * @param {object} template - Validated native task template; no arbitrary executable callbacks.
   * @param {string} template.name - Configured native queue/job label; never executable source.
   * @param {JobData} template.data - Private raw job payload; producer/processor boundaries enforce plain JSON budgets.
   * @param {QueueJobOptions} template.opts - Validated native options for this explicit operation.
   * @returns {Promise<BullJobLike>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  upsertJobScheduler?(
    id: string,
    repeat: Record<string, unknown>,
    template: {
      /** Configured native queue/job label; never executable source. */
      name: string;
      /** Private raw job payload; producer/processor boundaries enforce plain JSON budgets. */
      data: JobData;
      /** Validated native options for this explicit operation. */
      opts: QueueJobOptions;
    }
  ): Promise<BullJobLike>;
  /** Remove only the explicit native scheduler ID.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @returns {Promise<boolean>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  removeJobScheduler?(id: string): Promise<boolean>;
  /** Read bounded native scheduler facts; redact before exposing them to HTTP callers.
   * @param {number} start - Bounded inclusive native inventory offset.
   * @param {number} end - Bounded inclusive native inventory end.
   * @param {boolean} asc - Optional native ascending order.
   * @returns {Promise<Array<Record<string, unknown>>>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  getJobSchedulers?(
    start: number,
    end: number,
    asc?: boolean
  ): Promise<Array<Record<string, unknown>>>;
  /** Delegate the explicitly selected native queue/worker pause operation.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  pause(): Promise<void>;
  /** Delegate the explicitly selected native queue/worker resume operation.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  resume(): Promise<void>;
  /** Await native connection readiness; callers apply bounded observation policy.
   * @returns {Promise<unknown>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  waitUntilReady(): Promise<unknown>;
  /** Read a bounded native job page; raw payloads remain private until explicitly projected.
   * @param {string[]} states - Known native state names only.
   * @param {number} start - Bounded inclusive native inventory offset.
   * @param {number} end - Bounded inclusive native inventory end.
   * @param {boolean} asc - Optional native ascending order.
   * @returns {Promise<BullJobLike[]>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  getJobs?(
    states: string[],
    start: number,
    end: number,
    asc?: boolean
  ): Promise<BullJobLike[]>;
  /** Stop admission and close owned workers, events, queues and Cluster clients in order. Deadlines limit waiting, not arbitrary processor execution; failed cleanup remains explicit.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  close(): Promise<void>;
}
export interface BullWorkerLike {
  /** Register a trusted native event callback; its owning worker/events service controls removal/close.
   * @param {string} event - Fixed native event label.
   * @param {function} fn - Trusted native event listener callback.
   * @returns {this} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  on(event: string, fn: (...args: any[]) => void): this;
  /** Start native worker processing only under explicit host configuration.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  run?(): Promise<void>;
  /** Stop admission and close owned workers, events, queues and Cluster clients in order. Deadlines limit waiting, not arbitrary processor execution; failed cleanup remains explicit.
   * @param {boolean} force - Explicit native force-close attempt; cannot stop arbitrary JavaScript.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  close(force?: boolean): Promise<void>;
  /** Delegate the explicitly selected native queue/worker pause operation.
   * @param {boolean} doNotWaitActive - Explicit native operation input; its owning contract defines validation and lifecycle.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  pause?(doNotWaitActive?: boolean): Promise<void>;
  /** Delegate the explicitly selected native queue/worker resume operation.
   * @returns {void} Delegates or validates the explicit operation; failures remain visible.
   */
  resume?(): void;
}
export interface BullMQFactory {
  /** Injected trusted producer constructor; owning service tracks close. */
  Queue: new (name: string, opts: Record<string, unknown>) => BullQueueLike;
  /** Injected trusted worker constructor; owning service tracks shutdown. */
  Worker: new (
    name: string,
    processor: JobProcessor,
    opts: Record<string, unknown>
  ) => BullWorkerLike;
  /** Optional injected trusted event-stream constructor. */
  QueueEvents?: new (
    name: string,
    opts: Record<string, unknown>
  ) => QueueEventsLike;
}
export interface ZeruxQueue {
  /** Validate/snapshot one bounded plain JSON job and delegate once to the native producer; unknown publish outcomes are never automatically replayed.
   * @param {string} name - Explicit configured native queue/job or fixed administrative label.
   * @param {JobData} data - Plain bounded copied JSON reference data; never secrets.
   * @param {QueueJobOptions} options - Explicit bounded native options; owner retains authorization/lifecycle.
   * @returns {Promise<BullJobLike>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  add(
    name: string,
    data: JobData,
    options?: QueueJobOptions
  ): Promise<BullJobLike>;
  /** Prevalidate the complete bounded batch before any native call; this is not a cross-queue transaction or exactly-once guarantee.
   * @param {Array<{ name: string; data: JobData; options?: QueueJobOptions }>} jobs - Explicit bounded job/reconciliation allowlist or complete enqueue batch.
   * @returns {Promise<BullJobLike[]>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  addBulk(
    jobs: Array<{
      /** Configured native queue/job label; never executable source. */
      name: string;
      /** Private raw job payload; producer/processor boundaries enforce plain JSON budgets. */
      data: JobData;
      /** Explicit native service options, kept server-side. */
      options?: QueueJobOptions;
    }>
  ): Promise<BullJobLike[]>;
  /** Read a raw native job through trusted server access; it may contain private payloads and must not be exposed directly.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @returns {Promise<BullJobLike | undefined | null>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  getJob(id: string): Promise<BullJobLike | undefined | null>;
  /** Read native queue state counters for explicit trusted use.
   * @param {string[]} states - Known native state names only.
   * @returns {Promise<Record<string, number>>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  counts(...states: string[]): Promise<Record<string, number>>;
  /** Delegate the explicitly selected native queue/worker pause operation.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  pause(): Promise<void>;
  /** Delegate the explicitly selected native queue/worker resume operation.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  resume(): Promise<void>;
}
export interface QueueOperations {
  /** Authorize one exact queue before exposing fixed native counts/local-worker presence.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<{ counts: Record<string, number>; worker: boolean }>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  status(
    queue: string,
    context: unknown
  ): Promise<{
    /** Native fixed job-state counters, without raw payloads. */
    counts: Record<string, number>;
    /** Whether this process owns a configured worker for the queue. */
    worker: boolean;
  }>;
  /** Reauthorize and bound job metadata inspection; never return raw job data, results, stacks or Redis credentials.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {object} options - Explicit bounded native options; owner retains authorization/lifecycle.
   * @param {QueueJobState[]} options.states - Explicit bounded known state vocabulary for inspection.
   * @param {number} options.start - Validated bounded inspection offset.
   * @param {number} options.limit - Bounded native occurrence/page limit.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<{ jobs: QueueJobSummary[]; start: number; limit: number }>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  inspect(
    queue: string,
    options: {
      /** Explicit bounded known state vocabulary for inspection. */
      states?: QueueJobState[];
      /** Validated bounded inspection offset. */
      start?: number;
      /** Bounded native occurrence/page limit. */
      limit?: number;
    },
    context: unknown
  ): Promise<{
    /** Redacted authorized metadata page; raw native records remain private. */
    jobs: QueueJobSummary[];
    /** Validated bounded inspection offset. */
    start: number;
    /** Bounded native occurrence/page limit. */
    limit: number;
  }>;
  /** Authorize and retry only a currently failed native job; native transition guards concurrent state changes.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  retryFailed(queue: string, id: string, context: unknown): Promise<void>;
  /** Authorize global queue pause; it affects workers across processes.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  pauseQueue(queue: string, context: unknown): Promise<void>;
  /** Authorize global queue resume without changing local worker ownership.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  resumeQueue(queue: string, context: unknown): Promise<void>;
  /** Authorize only this process local worker pause, distinct from global queue pause.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  pauseWorker(queue: string, context: unknown): Promise<void>;
  /** Authorize only this process local worker resume, distinct from global queue resume.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<void>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  resumeWorker(queue: string, context: unknown): Promise<void>;
  /** Authorize a bounded scheduler inventory without returning task payloads.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {object} options - Explicit bounded native options; owner retains authorization/lifecycle.
   * @param {number} options.start - Validated bounded inspection offset.
   * @param {number} options.limit - Bounded native occurrence/page limit.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<Array<{ id: string; name?: string; next?: number }>>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  listSchedules(
    queue: string,
    options: {
      /** Validated bounded inspection offset. */
      start?: number;
      /** Bounded native occurrence/page limit. */
      limit?: number;
    },
    context: unknown
  ): Promise<
    Array<{
      /** Opaque native/durable identifier; not tenant authorization or permanent deduplication. */
      id: string;
      /** Configured native queue/job label; never executable source. */
      name?: string;
      /** Optional native next scheduler occurrence timestamp. */
      next?: number;
    }>
  >;
  /** Authorize one native future task registration, with explicit code-owned task dispatch.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @param {ScheduledTaskSpec} spec - Registered task reference and bounded data.
   * @param {Date | string | number} when - Explicit future one-off execution time.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @param {TaskScheduleOptions} options - Explicit bounded native options; owner retains authorization/lifecycle.
   * @returns {Promise<{ id?: string }>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  scheduleOnce(
    queue: string,
    id: string,
    spec: ScheduledTaskSpec,
    when: Date | string | number,
    context: unknown,
    options?: TaskScheduleOptions
  ): Promise<{
    /** Opaque native/durable identifier; not tenant authorization or permanent deduplication. */
    id?: string;
  }>;
  /** Authorize one native interval scheduler registration; repeated side effects still require durable idempotency.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @param {ScheduledTaskSpec} spec - Registered task reference and bounded data.
   * @param {number} intervalMs - Validated native interval milliseconds.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @param {TaskScheduleOptions} options - Explicit bounded native options; owner retains authorization/lifecycle.
   * @returns {Promise<{ id?: string }>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  scheduleEvery(
    queue: string,
    id: string,
    spec: ScheduledTaskSpec,
    intervalMs: number,
    context: unknown,
    options?: TaskScheduleOptions
  ): Promise<{
    /** Opaque native/durable identifier; not tenant authorization or permanent deduplication. */
    id?: string;
  }>;
  /** Authorize bounded native cron registration; calendar and timezone semantics remain native.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @param {ScheduledTaskSpec} spec - Registered task reference and bounded data.
   * @param {string} pattern - Bounded native cron expression.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @param {TaskScheduleOptions} options - Explicit bounded native options; owner retains authorization/lifecycle.
   * @returns {Promise<{ id?: string }>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  scheduleCron(
    queue: string,
    id: string,
    spec: ScheduledTaskSpec,
    pattern: string,
    context: unknown,
    options?: TaskScheduleOptions
  ): Promise<{
    /** Opaque native/durable identifier; not tenant authorization or permanent deduplication. */
    id?: string;
  }>;
  /** Authorize removal of one native recurring scheduler.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<boolean>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  removeSchedule(queue: string, id: string, context: unknown): Promise<boolean>;
  /** Authorize removal of one waiting/delayed task under native concurrency guards.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<boolean>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
   */
  cancelOneOff(queue: string, id: string, context: unknown): Promise<boolean>;
}
/** Finite native inspection state vocabulary; unknown client states reject. */
const allowedStates = new Set<QueueJobState>([
  'waiting',
  'active',
  'delayed',
  'failed',
  'completed',
  'paused',
  'waiting-children',
  'prioritized',
]);
/** Validate bounded opaque retained job identity without granting permission.
 * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
 * @returns {unknown} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
 */
const validJobId = (id: string) =>
  typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id);
/** Validate finite native safe-integer bounds before resource allocation.
 * @param {number} n - Explicit trusted native value validated before use; never executable caller source.
 * @param {number} min - Explicit trusted native value validated before use; never executable caller source.
 * @param {number} max - Explicit trusted native value validated before use; never executable caller source.
 * @param {string} label - Explicit trusted native value validated before use; never executable caller source.
 * @returns {unknown} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
 */
const validPositive = (n: number, min: number, max: number, label: string) => {
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new RangeError(`Invalid ${label}`);
  }
  return n;
};
/** Validate configured common native names; no executable lookup is performed.
 * @param {string} name - Explicit configured native queue/job or fixed administrative label.
 * @param {string} kind - Explicit trusted native value validated before use; never executable caller source.
 * @returns {unknown} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
 */
const validName = (name: string, kind: string) => {
  if (
    typeof name !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)
  ) {
    throw new TypeError(`Invalid ${kind} name`);
  }
  return name;
};
/** Validate declared native job options before enqueue or connection allocation; unknown top-level settings reject.
 * @param {QueueJobOptions | undefined} options - Explicit bounded native options; owner retains authorization/lifecycle.
 * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
 */
function validateJobOptions(options: QueueJobOptions | undefined) {
  if (options === undefined) {
    return;
  }
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) =>
        ![
          'jobId',
          'delay',
          'priority',
          'attempts',
          'backoff',
          'removeOnComplete',
          'removeOnFail',
          'repeat',
          'deduplication',
        ].includes(key)
    )
  ) {
    throw new TypeError('Invalid job options');
  }
  if (options.jobId !== undefined && !validJobId(options.jobId)) {
    throw new TypeError('Invalid jobId');
  }
  if (options.delay !== undefined) {
    validPositive(options.delay, 0, 366 * 86_400_000, 'job delay');
  }
  if (options.priority !== undefined) {
    validPositive(options.priority, 0, 2_097_152, 'job priority');
  }
  if (options.attempts !== undefined) {
    validPositive(options.attempts, 1, 50, 'job attempts');
  }
  if (options.backoff !== undefined) {
    if (typeof options.backoff === 'number') {
      validPositive(options.backoff, 1, 86_400_000, 'job backoff');
    } else if (
      !options.backoff ||
      !['fixed', 'exponential'].includes(options.backoff.type)
    ) {
      throw new TypeError('Invalid job backoff');
    } else {
      validPositive(options.backoff.delay, 1, 86_400_000, 'job backoff');
    }
  }
  // Process only explicit configured handles/options, preserving validation and owned cleanup order.
  for (const key of ['removeOnComplete', 'removeOnFail'] as const) {
    /** One explicit native option value inspected under its declared bounded policy. */
    const value = options[key];
    if (value === undefined || typeof value === 'boolean') {
      continue;
    }
    if (typeof value === 'number') {
      validPositive(value, 0, 1_000_000, key);
    } else if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`Invalid ${key}`);
    } else {
      if (value.age !== undefined) {
        validPositive(value.age, 0, 366 * 86_400, key + ' age');
      }
      if (value.count !== undefined) {
        validPositive(value.count, 0, 1_000_000, key + ' count');
      }
    }
  }
  if (options.deduplication !== undefined) {
    if (!options.deduplication || !validJobId(options.deduplication.id)) {
      throw new TypeError('Invalid deduplication ID');
    }
    if (options.deduplication.ttl !== undefined) {
      validPositive(
        options.deduplication.ttl,
        1,
        366 * 86_400_000,
        'deduplication TTL'
      );
    }
  }
  if (options.repeat !== undefined) {
    /** Validated native repeat policy, independent of user code execution. */
    const r = options.repeat;
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      throw new TypeError('Invalid repeat options');
    }
    if (r.every !== undefined) {
      validPositive(r.every, 1000, 366 * 86_400_000, 'Repeat interval');
    }
    if (r.limit !== undefined) {
      validPositive(r.limit, 1, 1_000_000, 'repeat limit');
    }
    if (
      r.pattern !== undefined &&
      (typeof r.pattern !== 'string' ||
        r.pattern.length > 100 ||
        ![5, 6].includes(r.pattern.trim().split(/\s+/).length))
    ) {
      throw new TypeError('Invalid repeat cron pattern');
    }
  }
}
/** Bound caller waiting while retaining actual native settlement separately.
 * @param {Promise<T>} promise - Explicit trusted native value validated before use; never executable caller source.
 * @param {number} ms - Explicit trusted native value validated before use; never executable caller source.
 * @param {string} message - Explicit trusted native value validated before use; never executable caller source.
 * @param {function} onTimeout - Explicit trusted native value validated before use; never executable caller source.
 * @returns {Promise<T>} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
 */
const deadline = async <T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: () => void
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(message));
        }, ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

/** Own explicit BullMQ producers, workers, event streams and optional Cluster clients. Validate before allocation and roll back acquired resources on startup failure; no worker discovery or automatic HTTP mount.
 * @param {QueueServiceConfig} config - Private validated service configuration with explicit workers/credentials.
 * @param {BullMQFactory} injected - Optional trusted native classes for host injection/tests; not public request input.
 * @param {BullMQClusterConstructor} injectedCluster - Optional trusted native Cluster constructor; acquired clients become service-owned.
 * @returns {Promise<unknown>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
 */
export async function createQueueService(
  config: QueueServiceConfig,
  injected?: BullMQFactory,
  injectedCluster?: BullMQClusterConstructor
) {
  if (
    !config ||
    !config.redis ||
    !Array.isArray(config.queues) ||
    !config.queues.length ||
    config.queues.length > 256
  ) {
    throw new TypeError(
      'Queue requires Redis settings and at least one named queue'
    );
  }
  /** Validated native namespace; Cluster hash tags select a slot, not permissions. */
  const prefix = config.prefix ?? 'zerux';
  if (config.redis.cluster) {
    if (!/^\{[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\}$/.test(prefix)) {
      throw new TypeError(
        'Redis Cluster needs an explicit hash-tagged BullMQ prefix, e.g. {tenant-a}'
      );
    }
  } else {
    validName(prefix, 'queue prefix');
  }
  /** Explicit normalized configured queue definitions, maximum 256. */
  const queueDefs = config.queues.map((item) =>
    typeof item === 'string' ? { name: item } : item
  );
  /** Per-generation unique queue-name allowlist. */
  const defined = new Set<string>();
  // Process only explicit configured handles/options, preserving validation and owned cleanup order.
  for (const def of queueDefs) {
    validName(def.name, 'queue');
    if (defined.has(def.name)) {
      throw new TypeError('Duplicate queue name');
    }
    defined.add(def.name);
    validateJobOptions(def.defaultJobOptions);
  }
  // Process only explicit configured handles/options, preserving validation and owned cleanup order.
  for (const name of Object.keys(config.workers ?? {})) {
    if (!defined.has(name)) {
      throw new TypeError(`Worker targets unknown queue ${name}`);
    }
    /** Explicit registered worker settings validated before native allocation. */
    const w = config.workers![name];
    if (!w) {
      throw new TypeError(`Worker settings missing for queue ${name}`);
    }
    if (typeof w.processor !== 'function') {
      throw new TypeError('Worker processor must be a function');
    }
    if (
      w.concurrency !== undefined &&
      (!Number.isSafeInteger(w.concurrency) ||
        w.concurrency < 1 ||
        w.concurrency > 1024)
    ) {
      throw new TypeError('Worker concurrency must be 1..1024');
    }
    if (w.autorun !== undefined && typeof w.autorun !== 'boolean') {
      throw new TypeError('Worker autorun must be boolean');
    }
    if (w.lockDuration !== undefined) {
      validPositive(w.lockDuration, 1000, 600_000, 'worker lock duration');
    }
    if (
      w.limiter &&
      (!Number.isSafeInteger(w.limiter.max) ||
        w.limiter.max < 1 ||
        w.limiter.max > 1_000_000 ||
        !Number.isSafeInteger(w.limiter.duration) ||
        w.limiter.duration < 1000 ||
        w.limiter.duration > 86_400_000)
    ) {
      throw new RangeError('Invalid Redis worker rate limit');
    }
  }
  // Validate host-controlled operational limits before allocating Cluster sockets.
  if (config.shutdownGraceMs !== undefined) {
    validPositive(config.shutdownGraceMs, 1, 300_000, 'shutdown grace period');
  }
  if (config.readyTimeoutMs !== undefined) {
    validPositive(config.readyTimeoutMs, 1, 120_000, 'queue ready timeout');
  }
  if (config.administration?.maxPageSize !== undefined) {
    validPositive(
      config.administration.maxPageSize,
      1,
      100,
      'administration.maxPageSize'
    );
  }
  /** Validated per-worker graceful-close observation bound. */
  const shutdownGrace = config.shutdownGraceMs ?? 30_000;
  /** Fixed optional native BullMQ module identity, never a caller import. */
  const moduleName = 'bullmq';
  /** Borrowed injected native constructors or the fixed maintained runtime module. */
  const bullmq =
    injected ?? ((await import(moduleName)) as unknown as BullMQFactory);
  let ownedCluster:
    | {
        /** Producer-native options/client distinct from blocking-worker policy. */
        producer: BullMQClusterClient;
        /** Whether this process owns a configured worker for the queue. */
        worker: BullMQClusterClient;
      }
    | undefined;
  let connection: {
    /** Producer-native options/client distinct from blocking-worker policy. */
    producer: Record<string, unknown> | BullMQClusterClient;
    /** Whether this process owns a configured worker for the queue. */
    worker: Record<string, unknown> | BullMQClusterClient;
  };
  if (config.redis.cluster) {
    /** Fixed ioredis dependency identity for explicit Cluster selection. */
    const clusterModule = 'ioredis';
    /** Borrowed injected/native Cluster constructor; acquired clients are service-owned. */
    const Cluster =
      injectedCluster ??
      (
        (await import(clusterModule)) as {
          /** Fixed lazy native module namespace; no arbitrary caller module loading. */
          default: {
            /** Injected trusted Cluster constructor; owned clients close on rollback/shutdown. */
            Cluster: BullMQClusterConstructor;
          };
        }
      ).default.Cluster;
    ownedCluster = createBullMQRedisClusterConnections(config.redis, Cluster);
    connection = ownedCluster;
  } else {
    connection = createBullMQRedisOptions(config.redis);
  }
  /** Bounded native attempts/backoff/retention defaults; no exactly-once guarantee. */
  const defaultJobOptions: QueueJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 86_400, count: 10_000 },
    removeOnFail: { age: 604_800, count: 10_000 },
  };
  /** Owned native producer handles tracked through rollback and shutdown. */
  const queues = new Map<string, BullQueueLike>();
  /** Owned native worker handles registered before listener setup. */
  const workers = new Map<string, BullWorkerLike>();
  /** Owned optional native event consumers with separate close lifetime. */
  const eventStreams = new Map<string, QueueEventsLike>();
  let closed = false,
    closePromise: Promise<void> | undefined;
  /** Reject generation work after managed shutdown begins.
   * @returns {unknown} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
   */
  const ensureOpen = () => {
    if (closed) {
      throw new Error('Queue service is closed');
    }
  };
  let closingState: QueueShutdownStatus['state'] = 'open',
    activeProcessors = 0,
    pendingClosures = 0,
    workerDeadlines = 0,
    forceCloseAttempts = 0,
    cleanupDeadlines = 0,
    cleanupFailures = 0;
  /** Observe a native close deadline while counting its actual promise settlement.
   * @param {function} work - Explicit trusted native value validated before use; never executable caller source.
   * @param {number} ms - Explicit trusted native value validated before use; never executable caller source.
   * @param {string} message - Explicit trusted native value validated before use; never executable caller source.
   * @param {unknown} worker - Explicit trusted native value validated before use; never executable caller source.
   * @returns {Promise<unknown>} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
   */
  const closeResource = async (
    work: () => Promise<unknown>,
    ms: number,
    message: string,
    worker = false
  ) => {
    pendingClosures++;
    /** Actual native close promise retained beyond a caller observation deadline. */
    const pending = Promise.resolve().then(work);
    pending.then(
      () => {
        pendingClosures--;
      },
      () => {
        pendingClosures--;
      }
    );
    return deadline(pending, ms, message, () => {
      cleanupDeadlines++;
      if (worker) {
        workerDeadlines++;
      }
    });
  };
  /** Validate and snapshot a complete plain JSON job before native publication.
   * @param {string} jobName - Validated common task name; not executable source.
   * @param {JobData} data - Plain bounded copied JSON reference data; never secrets.
   * @param {QueueJobOptions} opts - Validated native job options.
   * @returns {unknown} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
   */
  const prepareJob = (
    jobName: string,
    data: JobData,
    opts?: QueueJobOptions
  ) => {
    validName(jobName, 'job');
    validateJobOptions(opts);
    return { name: jobName, data: copyJobPayload(data), opts };
  };
  /** Validate every bounded batch entry/aggregate byte budget before any native enqueue.
   * @param {Array<{name:string; data:JobData; options?:QueueJobOptions}>} jobs - Explicit bounded job/reconciliation allowlist or complete enqueue batch.
   * @returns {unknown} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
   */
  const prepareBulk = (
    jobs: Array<{
      /** Configured native queue/job label; never executable source. */
      name: string;
      /** Private raw job payload; producer/processor boundaries enforce plain JSON budgets. */
      data: JobData;
      /** Explicit native service options, kept server-side. */
      options?: QueueJobOptions;
    }>
  ) => {
    if (
      !Array.isArray(jobs) ||
      jobs.length > QUEUE_JOB_LIMITS.maxBulk ||
      Object.keys(jobs).length !== jobs.length ||
      Object.keys(jobs).some((key, index) => key !== String(index))
    ) {
      throw new RangeError('Queue bulk count limit exceeded');
    }
    let bytes = 0;
    return jobs.map((job) => {
      /** Independent validated job snapshot; later caller mutation cannot change data. */
      const prepared = prepareJob(job.name, job.data, job.options);
      bytes += Buffer.byteLength(JSON.stringify(prepared.data));
      if (bytes > QUEUE_JOB_LIMITS.maxBulkBytes) {
        throw new RangeError('Queue bulk byte limit exceeded');
      }
      return prepared;
    });
  };

  /** Resolve only an open configured native producer; no tenant permission inference.
   * @param {string} name - Explicit configured native queue/job or fixed administrative label.
   * @returns {unknown} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
   */
  const getQueue = (name: string) => {
    ensureOpen();
    /** Borrowed configured producer tracked by the enclosing service. */
    const q = queues.get(name);
    if (!q) {
      throw new Error(`Unknown queue: ${name}`);
    }
    return q;
  };
  /** Borrowed fresh per-operation administrative host policy. */
  const policy = config.administration;
  /** Require current host permission for the exact action/queue before mutation or exposure.
   * @param {QueueAdminAction} action - Explicit trusted native value validated before use; never executable caller source.
   * @param {string} name - Explicit configured native queue/job or fixed administrative label.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @returns {Promise<unknown>} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
   */
  const authorize = async (
    action: QueueAdminAction,
    name: string,
    context: unknown
  ) => {
    getQueue(name);
    if (
      !policy?.authorize ||
      (await policy.authorize(action, name, context)) !== true
    ) {
      throw new Error('Queue administrative operation forbidden');
    }
  };
  /** Emit only bounded operation facts; sink failure never replays a committed transition.
   * @param {QueueAdminAction} action - Explicit trusted native value validated before use; never executable caller source.
   * @param {string} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
   * @param {boolean} success - Explicit trusted native value validated before use; never executable caller source.
   * @param {string} jobId - Opaque native job identity.
   * @returns {Promise<unknown>} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
   */
  const audit = async (
    action: QueueAdminAction,
    queue: string,
    success: boolean,
    jobId?: string
  ) => {
    try {
      await policy?.onAudit?.({
        action,
        queue,
        success,
        at: new Date().toISOString(),
        ...(jobId && validJobId(jobId) ? { jobId } : {}),
      });
    } catch {
      /* Audit hook cannot cause a successful state transition to be retried. */
    }
  };
  /** Authorize one void native operation and emit isolated redacted audit outcome.
   * @param {QueueAdminAction} action - Explicit trusted native value validated before use; never executable caller source.
   * @param {string} name - Explicit configured native queue/job or fixed administrative label.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @param {function} operation - Explicit trusted operation invoked only after fresh authorization.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @returns {Promise<unknown>} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
   */
  const perform = async (
    action: QueueAdminAction,
    name: string,
    context: unknown,
    operation: () => Promise<void>,
    id?: string
  ) => {
    await authorize(action, name, context);
    try {
      await operation();
      await audit(action, name, true, id);
    } catch (error) {
      await audit(action, name, false, id);
      throw error;
    }
  };
  /** Authorize one native result operation and preserve the committed result despite audit failure.
   * @param {QueueAdminAction} action - Explicit trusted native value validated before use; never executable caller source.
   * @param {string} name - Explicit configured native queue/job or fixed administrative label.
   * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
   * @param {function} operation - Explicit trusted operation invoked only after fresh authorization.
   * @param {string} id - Opaque native job/schedule identity; not an authorization credential.
   * @returns {Promise<T>} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
   */
  const performResult = async <T>(
    action: QueueAdminAction,
    name: string,
    context: unknown,
    operation: () => Promise<T>,
    id?: string
  ): Promise<T> => {
    await authorize(action, name, context);
    try {
      /** Observed native operation, counter projection or reconciler result; no private payload logging. */
      const result = await operation();
      await audit(action, name, true, id);
      return result;
    } catch (error) {
      await audit(action, name, false, id);
      throw error;
    }
  };
  /** Authorized bounded operator surface, distinct from trusted raw native access. */
  const operations: QueueOperations = {
    /** Authorize one exact queue before exposing fixed native counts/local-worker presence.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @returns {Promise<unknown>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    async status(name, context) {
      await authorize('inspect', name, context);
      /** Observed native fixed-state counters, not raw jobs or durable audit evidence. */
      const counts = await getQueue(name).getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
        'paused',
        'waiting-children',
        'prioritized'
      );
      await audit('inspect', name, true);
      return { counts, worker: workers.has(name) };
    },
    /** Reauthorize and bound job metadata inspection; never return raw job data, results, stacks or Redis credentials.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} options - Explicit bounded native options; owner retains authorization/lifecycle.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @returns {Promise<unknown>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    async inspect(name, options, context) {
      await authorize('inspect', name, context);
      /** Validated finite inspection state selection. */
      const states = options?.states ?? ['failed'];
      if (
        !Array.isArray(states) ||
        !states.length ||
        states.length > 8 ||
        states.some((s) => !allowedStates.has(s))
      ) {
        throw new TypeError('Invalid job states');
      }
      /** Validated bounded native inspection offset. */
      const start = validPositive(
        options?.start ?? 0,
        0,
        1_000_000,
        'inspection offset'
      );
      /** Validated authorized inspection count capped by host policy. */
      const limit = validPositive(
        options?.limit ?? 20,
        1,
        policy?.maxPageSize ?? 50,
        'inspection limit'
      );
      /** Borrowed configured producer tracked by the enclosing service. */
      const q = getQueue(name);
      if (typeof q.getJobs !== 'function') {
        throw new Error('Queue driver does not support job inspection');
      }
      /** Bounded raw native page retained only long enough for redacted projection. */
      const jobs = await q.getJobs(states, start, start + limit - 1, false);
      await audit('inspect', name, true);
      /** Authorized redacted native metadata projection; bodies/results/stacks are excluded. */
      const summaries = await Promise.all(
        jobs.slice(0, limit).map(async (job) => ({
          id: String(job.id ?? ''),
          name: String(job.name),
          state: job.getState
            ? ((await job.getState()) ?? 'unknown')
            : (() => {
                if (states.length === 1) {
                  return states[0] ?? 'unknown';
                }
                return 'unknown';
              })(),
          attemptsMade: Number.isSafeInteger(job.attemptsMade)
            ? job.attemptsMade!
            : 0,
          ...(Number.isFinite(job.timestamp)
            ? { timestamp: job.timestamp }
            : {}),
          ...(Number.isFinite(job.processedOn)
            ? { processedOn: job.processedOn }
            : {}),
          ...(Number.isFinite(job.finishedOn)
            ? { finishedOn: job.finishedOn }
            : {}),
        }))
      );
      return { start, limit, jobs: summaries };
    },
    /** Authorize and retry only a currently failed native job; native transition guards concurrent state changes.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} id - Opaque native job/schedule identity; not an authorization credential.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    retryFailed(name, id, context) {
      if (!validJobId(id)) {
        return Promise.reject(new TypeError('Invalid job ID'));
      }
      return perform(
        'retry',
        name,
        context,
        async () => {
          /** Validated native task template or private raw job in a trusted operation. */
          const job = await getQueue(name).getJob(id);
          if (
            !job ||
            typeof job.retry !== 'function' ||
            typeof job.getState !== 'function'
          ) {
            throw new Error('Job not found or retry unsupported');
          }
          if ((await job.getState()) !== 'failed') {
            throw new Error('Only failed jobs can be retried');
          }
          await job.retry('failed');
        },
        id
      );
    },
    /** Authorize global queue pause; it affects workers across processes.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    pauseQueue(name, context) {
      return perform('pause-queue', name, context, () =>
        getQueue(name).pause()
      );
    },
    /** Authorize global queue resume without changing local worker ownership.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    resumeQueue(name, context) {
      return perform('resume-queue', name, context, () =>
        getQueue(name).resume()
      );
    },
    /** Authorize only this process local worker pause, distinct from global queue pause.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    pauseWorker(name, context) {
      return perform('pause-worker', name, context, async () => {
        /** Owned native worker handle; shutdown deadlines never prove processor termination. */
        const worker = workers.get(name);
        if (!worker?.pause) {
          throw new Error('No local worker for queue');
        }
        await worker.pause();
      });
    },
    /** Authorize only this process local worker resume, distinct from global queue resume.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    resumeWorker(name, context) {
      return perform('resume-worker', name, context, async () => {
        /** Owned native worker handle; shutdown deadlines never prove processor termination. */
        const worker = workers.get(name);
        if (!worker?.resume) {
          throw new Error('No local worker for queue');
        }
        await worker.resume();
      });
    },
    /** Authorize a bounded scheduler inventory without returning task payloads.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} options - Explicit bounded native options; owner retains authorization/lifecycle.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    listSchedules(name, options, context) {
      return performResult('schedule-inspect', name, context, () => {
        return manager
          .schedules(name)
          .list(options?.start ?? 0, options?.limit ?? 20);
      });
    },
    /** Authorize one native future task registration, with explicit code-owned task dispatch.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} id - Opaque native job/schedule identity; not an authorization credential.
     * @param {unknown} spec - Registered task reference and bounded data.
     * @param {unknown} when - Explicit future one-off execution time.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @param {unknown} options - Explicit bounded native options; owner retains authorization/lifecycle.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    scheduleOnce(name, id, spec, when, context, options) {
      return performResult(
        'schedule-create',
        name,
        context,
        async () => {
          /** Validated native task template or private raw job in a trusted operation. */
          const job = await manager
            .schedules(name)
            .once(id, spec, when, options);
          return { id: job.id };
        },
        id
      );
    },
    /** Authorize one native interval scheduler registration; repeated side effects still require durable idempotency.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} id - Opaque native job/schedule identity; not an authorization credential.
     * @param {unknown} spec - Registered task reference and bounded data.
     * @param {unknown} interval - Validated native interval milliseconds.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @param {unknown} options - Explicit bounded native options; owner retains authorization/lifecycle.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    scheduleEvery(name, id, spec, interval, context, options) {
      return performResult(
        'schedule-create',
        name,
        context,
        async () => {
          /** Validated native task template or private raw job in a trusted operation. */
          const job = await manager
            .schedules(name)
            .every(id, spec, interval, options);
          return { id: job.id };
        },
        id
      );
    },
    /** Authorize bounded native cron registration; calendar and timezone semantics remain native.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} id - Opaque native job/schedule identity; not an authorization credential.
     * @param {unknown} spec - Registered task reference and bounded data.
     * @param {unknown} pattern - Bounded native cron expression.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @param {unknown} options - Explicit bounded native options; owner retains authorization/lifecycle.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    scheduleCron(name, id, spec, pattern, context, options) {
      return performResult(
        'schedule-create',
        name,
        context,
        async () => {
          /** Validated native task template or private raw job in a trusted operation. */
          const job = await manager
            .schedules(name)
            .cron(id, spec, pattern, options);
          return { id: job.id };
        },
        id
      );
    },
    /** Authorize removal of one native recurring scheduler.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} id - Opaque native job/schedule identity; not an authorization credential.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    removeSchedule(name, id, context) {
      return performResult(
        'schedule-remove',
        name,
        context,
        () => manager.schedules(name).remove(id),
        id
      );
    },
    /** Authorize removal of one waiting/delayed task under native concurrency guards.
     * @param {unknown} name - Explicit configured native queue/job or fixed administrative label.
     * @param {unknown} id - Opaque native job/schedule identity; not an authorization credential.
     * @param {unknown} context - Host-verified administrative principal/context; never trust caller role strings.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    cancelOneOff(name, id, context) {
      return performResult(
        'schedule-remove',
        name,
        context,
        () => manager.schedules(name).cancelOnce(id),
        id
      );
    },
  };
  /** Owned generation-scoped native service and explicit close/status operations. */
  const manager = {
    operations,
    /** Snapshot fixed path/payload-free actual processor and native-close counters, preserving incomplete/failed outcomes after deadlines.
     * @returns {QueueShutdownStatus} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    shutdownStatus(): QueueShutdownStatus {
      /** Fixed managed/native state derived only from observed lifecycle facts. */
      const state =
        closingState === 'incomplete' && !pendingClosures && !activeProcessors
          ? 'closed'
          : closingState;
      return {
        state,
        activeProcessors,
        pendingClosures,
        workerDeadlines,
        forceCloseAttempts,
        cleanupDeadlines,
        cleanupFailures,
      };
    },
    routes: () =>
      config.dashboard
        ? createQueueDashboard(
            { names: () => [...queues.keys()], operations },
            config.dashboard
          ).routes()
        : [],
    /** Borrow a generation-fenced native scheduler facade; this trusted API does not authorize HTTP callers.
     * @param {string} name - Explicit configured native queue/job or fixed administrative label.
     * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    schedules(name: string) {
      /** Borrowed configured producer tracked by the enclosing service. */
      const q = getQueue(name);
      // Bind the scheduler to this runtime generation: calls after close are rejected.
      return createQueueTaskScheduler({
        add: (jobName, data, opts) => {
          ensureOpen();
          /** Validated native task template or private raw job in a trusted operation. */
          const job = prepareJob(jobName, data, opts);
          return q.add(job.name, job.data, job.opts);
        },
        addBulk: (jobs) => {
          ensureOpen();
          return q.addBulk(prepareBulk(jobs));
        },
        getJob: (id) => {
          ensureOpen();
          return q.getJob(id);
        },
        counts: (...states) => {
          ensureOpen();
          return q.getJobCounts(...states);
        },
        pause: () => {
          ensureOpen();
          return q.pause();
        },
        resume: () => {
          ensureOpen();
          return q.resume();
        },
        upsertJobScheduler: (id, repeat, template) => {
          ensureOpen();
          if (!q.upsertJobScheduler) {
            throw new Error('BullMQ Job Scheduler unavailable');
          }
          /** Validated native task template or private raw job in a trusted operation. */
          const job = prepareJob(template.name, template.data, template.opts);
          return q.upsertJobScheduler(id, repeat, {
            name: job.name,
            data: job.data,
            opts: job.opts ?? {},
          });
        },
        removeJobScheduler: (id) => {
          ensureOpen();
          if (!q.removeJobScheduler) {
            throw new Error('BullMQ Job Scheduler unavailable');
          }
          return q.removeJobScheduler(id);
        },
        getJobSchedulers: (start, end, asc) => {
          ensureOpen();
          if (!q.getJobSchedulers) {
            throw new Error('BullMQ Job Scheduler unavailable');
          }
          return q.getJobSchedulers(start, end, asc);
        },
      });
    },
    /** Borrow a generation-fenced producer facade for one configured queue; enclosing service owns native cleanup.
     * @param {string} name - Explicit configured native queue/job or fixed administrative label.
     * @returns {ZeruxQueue} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    queue(name: string): ZeruxQueue {
      /** Borrowed configured producer tracked by the enclosing service. */
      const q = getQueue(name);
      return {
        /** Validate/snapshot one bounded plain JSON job and delegate once to the native producer; unknown publish outcomes are never automatically replayed.
         * @param {unknown} jobName - Validated common task name; not executable source.
         * @param {unknown} data - Plain bounded copied JSON reference data; never secrets.
         * @param {unknown} opts - Validated native job options.
         * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
         */
        add(jobName, data, opts) {
          ensureOpen();
          /** Validated native task template or private raw job in a trusted operation. */
          const job = prepareJob(jobName, data, opts);
          return q.add(job.name, job.data, job.opts);
        },
        /** Prevalidate the complete bounded batch before any native call; this is not a cross-queue transaction or exactly-once guarantee.
         * @param {unknown} jobs - Explicit bounded job/reconciliation allowlist or complete enqueue batch.
         * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
         */
        addBulk(jobs) {
          ensureOpen();
          return q.addBulk(prepareBulk(jobs));
        },
        /** Read a raw native job through trusted server access; it may contain private payloads and must not be exposed directly.
         * @param {unknown} id - Opaque native job/schedule identity; not an authorization credential.
         * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
         */
        getJob(id) {
          ensureOpen();
          return q.getJob(id);
        },
        /** Read native queue state counters for explicit trusted use.
         * @param {unknown} states - Known native state names only.
         * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
         */
        counts(...states) {
          ensureOpen();
          return q.getJobCounts(...states);
        },
        /** Delegate the explicitly selected native queue/worker pause operation.
         * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
         */
        pause() {
          ensureOpen();
          return q.pause();
        },
        /** Delegate the explicitly selected native queue/worker resume operation.
         * @returns {unknown} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
         */
        resume() {
          ensureOpen();
          return q.resume();
        },
      };
    },
    names: () => [...queues.keys()],
    worker: (name: string) => workers.get(name),
    /** Read current private per-queue counts and worker/event presence. Trusted server use only, not a public authorized inventory.
     * @returns {Promise<unknown>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    async snapshot() {
      ensureOpen();
      /** Observed native operation, counter projection or reconciler result; no private payload logging. */
      const result: Record<
        string,
        {
          /** Native fixed job-state counters, without raw payloads. */
          counts: Record<string, number>;
          /** Whether this process owns a configured worker for the queue. */
          worker: boolean;
          /** Whether this process owns a configured native QueueEvents stream. */
          events: boolean;
        }
      > = {};
      // Process only explicit configured handles/options, preserving validation and owned cleanup order.
      for (const [name, q] of queues) {
        result[name] = {
          counts: await q.getJobCounts(
            'waiting',
            'active',
            'delayed',
            'failed',
            'completed',
            'paused',
            'waiting-children',
            'prioritized'
          ),
          worker: workers.has(name),
          events: eventStreams.has(name),
        };
      }
      return result;
    },
    /** Probe each native producer under a finite observation deadline; false includes dependency failure and is not persistence certification.
     * @returns {Promise<unknown>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    async health() {
      ensureOpen();
      /** Observed native operation, counter projection or reconciler result; no private payload logging. */
      const result: Record<string, boolean> = {};
      // Process only explicit configured handles/options, preserving validation and owned cleanup order.
      for (const [name, queue] of queues) {
        try {
          await deadline(
            queue.waitUntilReady(),
            config.readyTimeoutMs ?? 3_000,
            'Queue Redis check timed out'
          );
          result[name] = true;
        } catch {
          result[name] = false;
        }
      }
      return result;
    },
    /** Stop admission and close owned workers, events, queues and Cluster clients in order. Deadlines limit waiting, not arbitrary processor execution; failed cleanup remains explicit.
     * @returns {Promise<unknown>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
     */
    async close() {
      if (closePromise) {
        return closePromise;
      }
      closed = true;
      closingState = 'draining';
      closePromise = (async () => {
        /** Private aggregate cleanup failures; never expose native credentials/causes in clients. */
        const errors: unknown[] = [];
        /** Selected per-worker native shutdown observation budget. */
        const grace = shutdownGrace;
        // Process only explicit configured handles/options, preserving validation and owned cleanup order.
        for (const worker of [...workers.values()].reverse()) {
          // Attempt native force-close after grace; this cannot stop user JavaScript.
          try {
            await closeResource(
              () => worker.close(),
              grace,
              'Worker shutdown deadline',
              true
            );
          } catch (error) {
            forceCloseAttempts++;
            try {
              await closeResource(
                () => worker.close(true),
                Math.min(grace, 5_000),
                'Forced worker shutdown deadline',
                true
              );
            } catch (forceError) {
              errors.push(error, forceError);
            }
          }
        }
        // Process only explicit configured handles/options, preserving validation and owned cleanup order.
        for (const stream of [...eventStreams.values()].reverse()) {
          try {
            await closeResource(
              () => stream.close(),
              Math.min(grace, 5_000),
              'Queue events shutdown deadline'
            );
          } catch (error) {
            errors.push(error);
          }
        }
        // Process only explicit configured handles/options, preserving validation and owned cleanup order.
        for (const queue of [...queues.values()].reverse()) {
          try {
            await closeResource(
              () => queue.close(),
              Math.min(grace, 5_000),
              'Queue shutdown deadline'
            );
          } catch (error) {
            errors.push(error);
          }
        }
        workers.clear();
        eventStreams.clear();
        queues.clear();
        if (ownedCluster) {
          // Process only explicit configured handles/options, preserving validation and owned cleanup order.
          for (const cluster of [ownedCluster.worker, ownedCluster.producer]) {
            try {
              await closeResource(
                () => cluster.quit(),
                Math.min(grace, 5_000),
                'Redis Cluster close deadline'
              );
            } catch (error) {
              errors.push(error);
              if (
                'disconnect' in cluster &&
                typeof cluster.disconnect === 'function'
              ) {
                try {
                  cluster.disconnect();
                } catch (disconnectError) {
                  errors.push(disconnectError);
                }
              }
            }
          }
        }
        cleanupFailures = errors.length;
        if (errors.length) {
          closingState = 'failed';
        } else if (pendingClosures || activeProcessors) {
          closingState = 'incomplete';
        } else {
          closingState = 'closed';
        }
        if (errors.length) {
          throw new AggregateError(errors, 'Queue service shutdown failed');
        }
      })();
      return closePromise;
    },
  };
  try {
    if (config.dashboard) {
      if (!policy?.authorize) {
        throw new TypeError(
          'Queue dashboard requires administrative authorization'
        );
      }
      createQueueDashboard(
        { names: () => [...queues.keys()], operations },
        config.dashboard
      );
    }
    // Process only explicit configured handles/options, preserving validation and owned cleanup order.
    for (const def of queueDefs) {
      /** Borrowed configured producer tracked by the enclosing service. */
      const q = new bullmq.Queue(def.name, {
        connection: connection.producer,
        prefix,
        defaultJobOptions: { ...defaultJobOptions, ...def.defaultJobOptions },
      });
      queues.set(def.name, q);
    }
    /** Validated native readiness observation deadline. */
    const timeout = config.readyTimeoutMs ?? 3_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) {
      throw new TypeError('Invalid queue readyTimeoutMs');
    }
    // Process only explicit configured handles/options, preserving validation and owned cleanup order.
    for (const q of queues.values()) {
      await deadline(
        q.waitUntilReady(),
        timeout,
        'Queue Redis connection timed out'
      );
    }
    if (config.events?.enabled) {
      if (!bullmq.QueueEvents) {
        throw new Error(
          'QueueEvents is unavailable in the installed BullMQ driver'
        );
      }
      // Process only explicit configured handles/options, preserving validation and owned cleanup order.
      for (const def of queueDefs) {
        /** Owned native QueueEvents handle registered before readiness/listener work. */
        const stream = new bullmq.QueueEvents(def.name, {
          connection: connection.worker,
          prefix,
        });
        eventStreams.set(def.name, stream);
        // Process only explicit configured handles/options, preserving validation and owned cleanup order.
        for (const type of [
          'completed',
          'failed',
          'waiting',
          'active',
          'stalled',
          'progress',
        ] as const) {
          stream.on(type, (payload: unknown) => {
            /** Narrow native event envelope used only to extract a bounded job ID. */
            const obj =
              payload && typeof payload === 'object'
                ? (payload as {
                    /** Retained native identity; cleanup can allow the same ID to be added again. */
                    jobId?: unknown;
                  })
                : {};

            /** Optional bounded native ID only; payload/failure text never enters event notices. */
            const jobId =
              typeof obj.jobId === 'string' &&
              obj.jobId.length <= 256 &&
              // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
              !/[\x00-\x1f\x7f]/.test(obj.jobId)
                ? obj.jobId
                : undefined;
            try {
              config.events?.onEvent?.({
                queue: def.name,
                type,
                at: new Date().toISOString(),
                ...(jobId ? { jobId } : {}),
              });
            } catch {
              /* No callback may crash the stream */
            }
          });
        }
        stream.on('error', (error: unknown) => {
          try {
            config.events?.onError?.(def.name, error);
          } catch {
            /* log only */
          }
        });
        if (stream.waitUntilReady) {
          await deadline(
            stream.waitUntilReady(),
            timeout,
            'QueueEvents Redis connection timed out'
          );
        }
      }
    }
    // Process only explicit configured handles/options, preserving validation and owned cleanup order.
    for (const [name, options] of Object.entries(config.workers ?? {})) {
      // The Worker uses a dedicated connection configuration for blocking operations.
      /** Explicit application processor, unrelated to the Node process global. */
      const process = options.processor;
      /** Owned worker wrapper counting actual application callback settlement.
       * @param {unknown} job - Explicit trusted native value validated before use; never executable caller source.
       * @param {unknown} token - Native worker lease token, retained only by trusted processor code.
       * @returns {Promise<unknown>} Explicit validated/observed result; underlying ownership and uncertainty remain authoritative.
       */
      const processor: JobProcessor = async (job, token) => {
        ensureOpen();
        copyJobPayload(job.data);
        activeProcessors++;
        try {
          return await process(job, token);
        } finally {
          activeProcessors--;
        }
      };
      /** Owned native worker handle; shutdown deadlines never prove processor termination. */
      const worker = new bullmq.Worker(name, processor, {
        connection: connection.worker,
        prefix,
        concurrency: options.concurrency ?? 1,
        autorun: options.autorun ?? true,
        ...(options.lockDuration ? { lockDuration: options.lockDuration } : {}),
        ...(options.limiter ? { limiter: options.limiter } : {}),
      });
      workers.set(name, worker);
      worker.on('error', (error: unknown) => {
        try {
          config.onWorkerError?.(name, error);
        } catch {
          /* logging must never terminate a worker */
        }
      });
    }
    return manager;
  } catch (error) {
    try {
      await manager.close();
    } catch {
      /* preserve the startup error */
    }
    throw error;
  }
}
export interface QueueShutdownStatus {
  /** Fixed native or managed lifecycle state, not inferred provider delivery. */
  state: 'open' | 'draining' | 'closed' | 'incomplete' | 'failed';
  /** Actually unsettled application processors, retained beyond observation deadlines. */
  activeProcessors: number;
  /** Actually unsettled native close promises, retained beyond deadlines. */
  pendingClosures: number;
  /** Observed worker close deadline count, not forced-stop evidence. */
  workerDeadlines: number;
  /** Number of explicit native force-close attempts. */
  forceCloseAttempts: number;
  /** Observed native resource-close deadline count. */
  cleanupDeadlines: number;
  /** Observed explicit cleanup failure count. */
  cleanupFailures: number;
}
export type QueueService = Awaited<ReturnType<typeof createQueueService>>;

/** Bind an explicit administrative job allowlist and run one durable reconciliation page; never discover jobs or restart completed passes automatically.
 * @param {Record<
    string,
    {
      runOnce(
        owner: string
      ): Promise<{ busy: boolean; state: { status: string } }>;
    }
  >} jobs - Explicit bounded job/reconciliation allowlist or complete enqueue batch.
 * @returns {JobProcessor} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
 */
export function createAnalyticsReconciliationProcessor(
  jobs: Record<
    string,
    {
      /** Run one bounded existing durable reconciliation page under a unique trusted worker owner.
       * @param {string} owner - Unique trusted administrative reconciliation lease owner.
       * @returns {Promise<{ busy: boolean; state: { status: string } }>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
       */
      runOnce(owner: string): Promise<{
        /** Whether the durable reconciliation page is leased elsewhere. */
        busy: boolean;
        /** Fixed native or managed lifecycle state, not inferred provider delivery. */
        state: {
          /** Explicit durable reconciliation/SMTP outcome label. */
          status: string;
        };
      }>;
    }
  >
): JobProcessor {
  return async (job) => {
    if (job.name !== 'analytics.reconcile') {
      throw new Error('Unexpected analytics maintenance job');
    }
    /** Validated explicit administrative reconciliation job reference. */
    const id = job.data.id;
    if (typeof id !== 'string' || !Object.hasOwn(jobs, id)) {
      throw new Error('Unknown analytics reconciliation job');
    }
    /** Exact code-owned allowlisted reconciliation object. */
    const target = jobs[id];
    if (!target) {
      throw new Error('Unknown analytics reconciliation job');
    }
    /** Observed native operation, counter projection or reconciler result; no private payload logging. */
    const result = await target.runOnce(`bullmq-${randomUUID()}`);
    return { busy: result.busy, status: result.state.status };
  };
}

export interface QueuedEmailDescriptor {
  /** Durable message ID only; content, recipients and credentials live outside Redis. */
  id: string;
  /** Saved marketing/transactional classification; never inferred from tracking settings. */
  purpose: 'marketing' | 'transactional';
  /** Recipient of a marketing email; transactional sends may omit it. */
  recipient?: string;
}
export interface QueuedEmailDeliveryAdapter {
  /** Resolve the CURRENT message state from a shared database. */
  load: (messageId: string) => Promise<QueuedEmailDescriptor | null>;
  /** Read fresh, durable marketing consent; any store outage must reject, never assume consent. */
  isSubscribed: (recipient: string) => Promise<boolean>;
  /** Durable suppression update, committed before this worker acknowledges the job. */
  suppress: (messageId: string, reason: 'unsubscribed') => Promise<void>;
  /** Must implement delivery idempotency/fencing in durable storage before SMTP sending. */
  deliver: (
    messageId: string
  ) => Promise<'sent' | 'already-sent' | 'suppressed'>;
}
/** Load current saved message facts and check fresh marketing consent before explicit idempotent delivery. SMTP-boundary permission and uncertain-result handling remain the host sender responsibility.
 * @param {QueuedEmailDeliveryAdapter} adapter - Trusted saved-message/consent/idempotent delivery callbacks.
 * @returns {JobProcessor} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
 */
export function createEmailDeliveryProcessor(
  adapter: QueuedEmailDeliveryAdapter
): JobProcessor {
  // Process only explicit configured handles/options, preserving validation and owned cleanup order.
  for (const key of ['load', 'isSubscribed', 'suppress', 'deliver'] as const) {
    if (typeof adapter?.[key] !== 'function') {
      throw new TypeError(`Email queue adapter requires ${key}`);
    }
  }
  return async (job) => {
    if (job.name !== 'email.deliver') {
      throw new Error('Unexpected email queue job name');
    }
    /** Opaque validated durable mail ID; no content or credentials enter Redis. */
    const messageId = job.data?.messageId;
    if (
      typeof messageId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(messageId)
    ) {
      throw new TypeError('Invalid queued message ID');
    }
    /** Current saved private message descriptor used for fresh purpose/consent checks. */
    const message = await adapter.load(messageId);
    if (!message) {
      throw new Error('Queued email record missing');
    }
    if (
      message.id !== messageId ||
      !['marketing', 'transactional'].includes(message.purpose)
    ) {
      throw new Error('Invalid queued email record');
    }
    if (message.purpose === 'marketing') {
      if (typeof message.recipient !== 'string' || !message.recipient.trim()) {
        throw new Error('Marketing recipient unavailable');
      }
      // No fallback to transactional, no stale cached opt-in, and no dependence on tracking policy.
      if (!(await adapter.isSubscribed(message.recipient))) {
        await adapter.suppress(messageId, 'unsubscribed');
        return { status: 'suppressed' };
      }
    }
    /** Explicit trusted sender outcome validated before worker acknowledgement. */
    const outcome = await adapter.deliver(messageId);
    if (!['sent', 'already-sent', 'suppressed'].includes(outcome)) {
      throw new Error('Invalid email delivery result');
    }
    return { status: outcome };
  };
}

/** Enqueue only a validated durable message ID with finite native delay/attempt policy, never recipients, MIME bodies or credentials.
 * @param {ZeruxQueue} queue - Exact configured queue scope, independently authorized at HTTP boundaries.
 * @param {string} messageId - Opaque existing durable message reference, never a recipient address.
 * @param {object} options - Explicit bounded native options; owner retains authorization/lifecycle.
 * @param {number} options.delay - Optional native persisted delay; no local timer emulates durable scheduling.
 * @param {number} options.attempts - Native total attempts; ambiguous external side effects still need durable reconciliation.
 * @returns {Promise<BullJobLike>} Owning native/managed result; no exactly-once, authorization or forced-cancellation guarantee is inferred.
 */
export async function enqueueEmailById(
  queue: ZeruxQueue,
  messageId: string,
  options: {
    /** Optional native persisted delay; no local timer emulates durable scheduling. */
    delay?: number;
    /** Native total attempts; ambiguous external side effects still need durable reconciliation. */
    attempts?: number;
  } = {}
): Promise<BullJobLike> {
  if (
    typeof messageId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(messageId)
  ) {
    throw new TypeError('Invalid queued message ID');
  }
  if (options.delay !== undefined) {
    validPositive(options.delay, 0, 365 * 24 * 60 * 60 * 1000, 'email delay');
  }
  if (options.attempts !== undefined) {
    validPositive(options.attempts, 1, 20, 'email attempts');
  }
  return queue.add(
    'email.deliver',
    { messageId },
    {
      jobId: `email-${messageId}`,
      ...(options.delay === undefined ? {} : { delay: options.delay }),
      attempts: options.attempts ?? 5,
      backoff: { type: 'exponential', delay: 5000 },
    }
  );
}

export * from './campaigns.js';

export * from './reporting.js';
export * from './performance.js';
export * from './trends.js';
export * from './history.js';
export * from './history-gaps.js';

export * from './outbox.js';
export * from './recovery.js';
