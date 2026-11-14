import { copyJobPayload } from './payload.js';
import type {
  BullJobLike,
  JobProcessor,
  JobData,
  QueueJobOptions,
  ZeruxQueue,
} from './index.js';

/** Conservative common schedule/task identifier grammar. */
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Validate opaque schedule/task references without authorizing a tenant.
 * @param {string} value - Explicit opaque identifier.
 * @param {string} kind - Fixed diagnostic field kind.
 * @returns {string} Validated identifier.
 */
const validId = (value: string, kind: string) => {
  if (typeof value !== 'string' || !identifier.test(value)) {
    throw new TypeError(`Invalid ${kind}`);
  }
  return value;
};
/** Snapshot task data under the stricter 8 KiB/32-level plain JSON budget.
 * @param {JobData} data - Explicit plain task payload.
 * @returns {JobData} Independent bounded task data.
 */
const clonePayload = (data: JobData): JobData => copyJobPayload(data, 8192, 32);
/** Normalize a future native schedule timestamp within the bounded horizon.
 * @param {Date | string | number} date - Explicit future native schedule time.
 * @returns {number} Validated future epoch milliseconds.
 */
const validTime = (date: Date | string | number): number => {
  /** Normalized explicit future epoch milliseconds. */
  const value = (() => {
    if (date instanceof Date) {
      return date.getTime();
    } else {
      if (typeof date === 'string') {
        return Date.parse(date);
      } else {
        return date;
      }
    }
  })();
  if (
    !Number.isSafeInteger(value) ||
    value <= Date.now() ||
    value > Date.now() + 366 * 86_400_000
  ) {
    throw new RangeError(
      'Scheduled execution must be within the next 366 days'
    );
  }
  return value;
};
export interface TaskScheduleOptions {
  /** Native total attempts, default three, valid 1 through 30. */
  attempts?: number;
  /** Exponential retry base, default 1000 ms, valid 100 through 3600000. */
  backoffMs?: number;
  /** Optional future start within 366 days; no process timer. */
  startDate?: string | number | Date;
  /** Optional future exclusive scheduling end after start. */
  endDate?: string | number | Date;
  /** Optional total occurrence ceiling, 1 through one million. */
  limit?: number;
  /** Cron IANA timezone, default UTC; native calendar policy applies. */
  timezone?: string;
}
export interface ScheduledTaskSpec {
  /** Explicit registered handler reference, never executable source. */
  task: string;
  /** Plain copied task payload, at most 8 KiB and 32 levels. */
  data?: JobData;
}
export interface BullSchedulerQueueLike extends ZeruxQueue {
  /** Persist a native scheduler definition using the supplied already validated template.
   * @param {string} id - Conservative opaque schedule ID; never authorization.
   * @param {Record<string, unknown>} repeat - Validated native repeat/date policy.
   * @param {object} template - Explicit native task name/data/options.
   * @param {string} template.name - Fixed native task name.
   * @param {JobData} template.data - Bounded copied task data.
   * @param {QueueJobOptions} template.opts - Validated native options.
   * @returns {Promise<BullJobLike>} Native acceptance; no cross-queue transaction implied.
   */
  upsertJobScheduler?(
    id: string,
    repeat: Record<string, unknown>,
    template: {
      /** Fixed native task name. */
      name: string;
      /** Plain copied task payload, at most 8 KiB and 32 levels. */
      data: JobData;
      /** Validated native retry/job policy. */
      opts: QueueJobOptions;
    }
  ): Promise<BullJobLike>;
  /** Remove one native scheduler by explicit ID.
   * @param {string} id - Conservative opaque schedule ID; never authorization.
   * @returns {Promise<boolean>} Native removal outcome.
   */
  removeJobScheduler?(id: string): Promise<boolean>;
  /** Page native scheduler inventory under host authorization.
   * @param {number} start - Inclusive inventory offset, default zero and at most 100000.
   * @param {number} end - Inclusive native page end.
   * @param {boolean} asc - Optional native ascending ordering.
   * @returns {Promise<Array<Record<string,unknown>>>} Native facts require redaction before HTTP exposure.
   */
  getJobSchedulers?(
    start: number,
    end: number,
    asc?: boolean
  ): Promise<Array<Record<string, unknown>>>;
}
/** Validate bounded native task retries without creating local retry timers.
 * @param {TaskScheduleOptions} options - Explicit native retry policy.
 * @returns {object} Validated native attempts/backoff.
 */
const defaultOptions = (options: TaskScheduleOptions) => {
  /** Validated total native attempts, default three. */
  const attempts = options.attempts ?? 3;
  /** Validated native exponential retry base, default one second. */
  const backoffMs = options.backoffMs ?? 1000;
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > 30 ||
    !Number.isSafeInteger(backoffMs) ||
    backoffMs < 100 ||
    backoffMs > 3_600_000
  ) {
    throw new RangeError('Invalid scheduled task retry policy');
  }
  return {
    attempts,
    backoff: { type: 'exponential' as const, delay: backoffMs },
  };
};
/** Validate future start/end/occurrence limits before native scheduler registration.
 * @param {TaskScheduleOptions} options - Explicit native retry/date/timezone settings; host owns permission.
 * @returns {Record<string,unknown>} Normalized native repeat dates/limits; no local timer is started.
 */
function repeatDates(options: TaskScheduleOptions) {
  /** Operation-local repeat date/limit definition. */
  const repeat: Record<string, unknown> = {};
  if (options.startDate !== undefined) {
    repeat.startDate = new Date(validTime(options.startDate));
  }
  if (options.endDate !== undefined) {
    /** Normalized future schedule end checked against explicit start. */
    const end = (() => {
      if (options.endDate instanceof Date) {
        return options.endDate.getTime();
      } else {
        if (typeof options.endDate === 'string') {
          return Date.parse(options.endDate);
        } else {
          return options.endDate;
        }
      }
    })();
    if (!Number.isSafeInteger(end) || end <= Date.now()) {
      throw new RangeError('Invalid schedule end date');
    }
    repeat.endDate = new Date(end);
  }
  if (
    options.startDate !== undefined &&
    options.endDate !== undefined &&
    Number(repeat.endDate instanceof Date ? repeat.endDate.getTime() : 0) <=
      Number((repeat.startDate as Date).getTime())
  ) {
    throw new RangeError('Schedule end must follow start');
  }
  if (options.limit !== undefined) {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 1_000_000
    ) {
      throw new RangeError('Invalid schedule limit');
    }
    repeat.limit = options.limit;
  }
  return repeat;
}
/** Borrow one native queue for durable scheduler operations; host code authorizes access before calling.
 * @param {BullSchedulerQueueLike} queue - Borrowed native queue/service owner.
 * @returns {object} Inert scheduler facade sharing queue/service lifecycle, without a separate close handle.
 */
export function createQueueTaskScheduler(queue: BullSchedulerQueueLike) {
  /** Register only a validated task template through the borrowed native scheduler.
   * @param {string} id - Explicit schedule identity.
   * @param {ScheduledTaskSpec} spec - Registered task and copied data.
   * @param {TaskScheduleOptions} options - Explicit bounded native options.
   * @param {Record<string,unknown>} repeat - Native interval/cron definition.
   * @returns {Promise<BullJobLike>} Native scheduler receipt.
   */
  const recurring = (
    id: string,
    spec: ScheduledTaskSpec,
    options: TaskScheduleOptions,
    repeat: Record<string, unknown>
  ) => {
    validId(id, 'schedule ID');
    validId(spec.task, 'task name');
    if (!queue.upsertJobScheduler) {
      throw new Error('This BullMQ version does not support Job Schedulers');
    }
    return queue.upsertJobScheduler(
      id,
      { ...repeatDates(options), ...repeat },
      {
        name: 'zerux.task',
        data: { task: spec.task, payload: clonePayload(spec.data ?? {}) },
        opts: defaultOptions(options),
      }
    );
  };
  return {
    /** Register one validated future task using native persisted delay and a stable retained job ID.
     * @param {string} id - Conservative opaque schedule ID; never authorization.
     * @param {ScheduledTaskSpec} spec - Explicit registered task reference and bounded plain payload.
     * @param {Date | string | number} when - Future timestamp within the next 366 days.
     * @param {TaskScheduleOptions} options - Explicit native retry/date/timezone settings; host owns permission.
     * @returns {Promise<BullJobLike>} Native acceptance, not execution or permanent business deduplication.
     */
    once(
      id: string,
      spec: ScheduledTaskSpec,
      when: Date | string | number,
      options: TaskScheduleOptions = {}
    ): Promise<BullJobLike> {
      validId(id, 'schedule ID');
      validId(spec.task, 'task name');
      /** Validated future one-off execution epoch milliseconds. */
      const time = validTime(when);
      return queue.add(
        'zerux.task',
        { task: spec.task, payload: clonePayload(spec.data ?? {}) },
        {
          jobId: `task-${id}`,
          delay: time - Date.now(),
          ...defaultOptions(options),
        }
      );
    },
    /** Register one bounded interval scheduler through the native Job Scheduler extension.
     * @param {string} id - Conservative opaque schedule ID; never authorization.
     * @param {ScheduledTaskSpec} spec - Explicit registered task reference and bounded plain payload.
     * @param {number} intervalMs - Safe native interval, 1000 ms through 366 days.
     * @param {TaskScheduleOptions} options - Explicit native retry/date/timezone settings; host owns permission.
     * @returns {Promise<BullJobLike>} Native scheduler receipt; repeated executions remain at-least-once.
     */
    every(
      id: string,
      spec: ScheduledTaskSpec,
      intervalMs: number,
      options: TaskScheduleOptions = {}
    ): Promise<BullJobLike> {
      if (
        !Number.isSafeInteger(intervalMs) ||
        intervalMs < 1000 ||
        intervalMs > 366 * 86_400_000
      ) {
        throw new RangeError('Invalid schedule interval');
      }
      return recurring(id, spec, options, { every: intervalMs });
    },
    /** Register only bounded cron syntax and a native-supported IANA timezone; never interpret command text.
     * @param {string} id - Conservative opaque schedule ID; never authorization.
     * @param {ScheduledTaskSpec} spec - Explicit registered task reference and bounded plain payload.
     * @param {string} pattern - Bounded five/six-field cron expression; native parser owns calendar semantics.
     * @param {TaskScheduleOptions} options - Explicit native retry/date/timezone settings; host owns permission.
     * @returns {Promise<BullJobLike>} Native scheduler receipt; calendar/DST semantics stay with BullMQ.
     */
    cron(
      id: string,
      spec: ScheduledTaskSpec,
      pattern: string,
      options: TaskScheduleOptions = {}
    ): Promise<BullJobLike> {
      // Reject user-supplied command syntax; the BullMQ cron parser validates ranges and calendar semantics.
      if (
        typeof pattern !== 'string' ||
        pattern.length > 100 ||
        !/^[\d\s*,/\-LW#?A-Za-z]+$/.test(pattern) ||
        ![5, 6].includes(pattern.trim().split(/\s+/).length)
      ) {
        throw new TypeError('Invalid cron pattern');
      }
      /** Explicit native IANA timezone, default UTC. */
      const timezone = options.timezone ?? 'UTC';
      try {
        new Intl.DateTimeFormat('en', { timeZone: timezone });
      } catch {
        throw new TypeError('Invalid cron timezone');
      }
      return recurring(id, spec, options, {
        pattern: pattern.trim(),
        tz: timezone,
      });
    },
    /** Remove only a waiting/delayed one-off task; native removal guards a concurrent worker claim.
     * @param {string} id - Conservative opaque schedule ID; never authorization.
     * @returns {Promise<boolean>} False for missing tasks; active/unsupported removal rejects.
     */
    async cancelOnce(id: string): Promise<boolean> {
      validId(id, 'schedule ID');
      /** Borrowed native one-off record used for atomic state-aware removal. */
      const job = await queue.getJob(`task-${id}`);
      if (!job) {
        return false;
      }
      if (
        typeof job.getState !== 'function' ||
        typeof job.remove !== 'function'
      ) {
        throw new Error('This queue driver cannot safely cancel one-off tasks');
      }
      /** Observed native precondition; native removal still guards concurrent claims. */
      const state = await job.getState();
      if (state !== 'delayed' && state !== 'waiting') {
        throw new Error('Only pending one-off tasks can be canceled');
      }
      // BullMQ itself refuses removal if a worker acquires the job concurrently.
      await job.remove();
      return true;
    },
    /** Remove the explicitly named recurring scheduler, separately from one-off cancellation.
     * @param {string} id - Conservative opaque schedule ID; never authorization.
     * @returns {Promise<boolean>} Native removal result; does not undo previously executed side effects.
     */
    async remove(id: string): Promise<boolean> {
      validId(id, 'schedule ID');
      if (!queue.removeJobScheduler) {
        throw new Error('Scheduler removal unsupported');
      }
      return queue.removeJobScheduler(id);
    },
    /** Read bounded redacted native scheduler inventory without task payloads or credentials.
     * @param {number} start - Inclusive inventory offset, default zero and at most 100000.
     * @param {number} limit - Inventory page count, default 20 and at most 100.
     * @returns {Promise<object[]>} ID/name/next facts only; not a durable audit history.
     */
    async list(
      start = 0,
      limit = 20
    ): Promise<
      Array<{
        id: string;
        /** Fixed native task name. */
        name?: string;
        next?: number;
      }>
    > {
      if (
        !Number.isSafeInteger(start) ||
        start < 0 ||
        start > 100_000 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        throw new RangeError('Invalid scheduler pagination');
      }
      if (!queue.getJobSchedulers) {
        throw new Error('Scheduler listing unsupported');
      }
      /** Native inventory page projected to redacted ID/name/next facts. */
      const results = await queue.getJobSchedulers(
        start,
        start + limit - 1,
        true
      );
      // Never expose a scheduled job's payload or credentials through inventory.
      return results.map((item) => ({
        id: String(item.id ?? ''),
        ...(typeof item.name === 'string' ? { name: item.name } : {}),
        ...(typeof item.next === 'number' ? { next: item.next } : {}),
      }));
    },
  };
}

export type ScheduledTaskHandler = (
  payload: JobData,
  context: {
    /** Optional native retained job identity; not permanent idempotency. */
    jobId?: string;
    /** Native observed attempts count, default zero. */
    attemptsMade: number;
    /** Optional native enqueue timestamp. */
    timestamp?: number;
  }
) => Promise<unknown> | unknown;
/** Register only explicit trusted handlers; broker task names never choose executable modules.
 * @returns {object} Inert code-owned registry and processor; application owns native worker lifetime.
 */
export function createTaskRegistry() {
  /** Code-owned handler allowlist; no dynamic package or filesystem discovery. */
  const handlers = new Map<string, ScheduledTaskHandler>();
  return {
    /** Add one unique explicit handler without automatic discovery or executable source strings.
     * @param {string} name - Explicit code-owned task name.
     * @param {ScheduledTaskHandler} handler - Trusted registered callback; never untrusted code.
     * @returns {object} This registry for chaining; duplicate/invalid handlers reject.
     */
    register(name: string, handler: ScheduledTaskHandler) {
      validId(name, 'task name');
      if (typeof handler !== 'function' || handlers.has(name)) {
        throw new TypeError('Invalid or duplicate task handler');
      }
      handlers.set(name, handler);
      return this;
    },
    /** Remove only the named code-owned task handler.
     * @param {string} name - Explicit code-owned task name.
     * @returns {boolean} Whether a registration existed; does not cancel already running callbacks.
     */
    unregister(name: string) {
      return handlers.delete(name);
    },
    /** Snapshot explicitly registered task names.
     * @returns {string[]} Fresh handler-name array without payloads.
     */
    names() {
      return [...handlers.keys()];
    },
    processor: (async (job) => {
      if (job.name !== 'zerux.task') {
        throw new TypeError('Unexpected scheduled job');
      }
      /** Validated task name from the fixed zerux.task envelope. */
      const name = job.data?.task;
      if (typeof name !== 'string' || !identifier.test(name)) {
        throw new TypeError('Invalid scheduled task');
      }
      /** Exact registered trusted handler, invoked only after bounded payload copying. */
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error(`Unregistered task ${name}`);
      }
      return handler(clonePayload((job.data.payload as JobData) ?? {}), {
        jobId: job.id,
        attemptsMade: job.attemptsMade ?? 0,
        timestamp: job.timestamp,
      });
    }) satisfies JobProcessor,
  };
}
