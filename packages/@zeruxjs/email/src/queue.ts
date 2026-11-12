import { isRetryableSmtpError } from './smtp-outcomes.js';
import type { EmailMessage, EmailResult } from './types.js';
export interface EmailQueueOptions {
  /** Local active sends 1–32, default two. */
  concurrency?: number;
  /** Combined queued/active budget 1–100000, default 100. */
  maxPending?: number;
  /** Additional qualified retries 0–10, default two; uncertain sends never qualify. */
  retries?: number;
  /** Initial retry delay 0–60000ms, default 250ms. */
  backoffMs?: number;
  /** Maximum retry delay 1–600000ms, default 5000. */
  maxBackoffMs?: number;
}
interface Job {
  /** Private queued payload; not automatically cloned or persisted. */
  message: EmailMessage;
  /** Per-job success callback, called after sender settlement. */
  resolve: (r: EmailResult) => void;
  /** Per-job failure callback; raw private errors stay host-owned. */
  reject: (e: unknown) => void;
  /** Optional cooperative cancellation passed to the sender and backoff delay. */
  signal?: AbortSignal;
}
/** Create a bounded process-local retry queue; this is separate from durable scheduling/outbox storage.
 * @param {{
    send(
      message: EmailMessage,
      options?: { signal?: AbortSignal }
    ): Promise<EmailResult>;
  }} sender - Borrowed send service; lifecycle and SMTP consent checks stay with its owner.
 * @param {(message: EmailMessage, options?: {signal?: AbortSignal}) => Promise<EmailResult>} sender.send - Borrowed submission callback; transport ownership remains external.
 * @param {EmailQueueOptions} settings - Bounded local worker/retry limits; defaults apply when omitted.
 * @returns {object} Local queue owner exposing enqueue/stats/flush/close; sender remains borrowed.
 */
export function createEmailQueue(
  sender: {
    /** Submit through the borrowed sender and retry only explicitly qualified transient failures.
     * @param {EmailMessage} message - Private message retained for this local job; no durable copy is made.
     * @param {{ signal?: AbortSignal }} options - Explicit cooperative per-job signal or local close drain policy.
     * @returns {Promise<EmailResult>} One send result; uncertain SMTP acceptance is never replayed automatically.
     */
    send(
      message: EmailMessage,
      options?: {
        /** Optional cooperative cancellation passed to the sender and backoff delay. */
        signal?: AbortSignal;
      }
    ): Promise<EmailResult>;
  },
  settings: EmailQueueOptions = {}
) {
  /** Validated local worker count, default two; native sender lifecycle stays borrowed. */
  const concurrency = settings.concurrency ?? 2;
  /** Combined pending/active admission ceiling, default 100. */
  const maxPending = settings.maxPending ?? 100;
  /** Finite additional qualified transient attempts, default two. */
  const retries = settings.retries ?? 2;
  /** Initial bounded retry wait, default 250ms; no ambiguous acceptance replay. */
  const backoff = settings.backoffMs ?? 250;
  /** Maximum exponential delay, default 5000ms. */
  const maxBackoff = settings.maxBackoffMs ?? 5000;
  // Validate each independent local resource/retry budget before accepting work.
  for (const [label, n, max] of [
    ['concurrency', concurrency, 32],
    ['maxPending', maxPending, 100000],
    ['retries', retries, 10],
    ['backoffMs', backoff, 60000],
    ['maxBackoffMs', maxBackoff, 600000],
  ] as const) {
    if (
      !Number.isSafeInteger(n) ||
      n < (label === 'retries' || label.includes('backoff') ? 0 : 1) ||
      n > max
    ) {
      throw new RangeError(`Invalid ${label}`);
    }
  }
  /** Instance-local FIFO message references; this is not restart-safe storage. */
  const queue: Job[] = [];
  let active = 0,
    closed = false;
  let drainWaiters: Array<() => void> = [];
  /** Release all drain observers only when both active and queued work are empty.

 * @returns {void} No native sender resource is closed. */
  const wake = () => {
    if (active === 0 && queue.length === 0) {
      // Settle every observer once the actual local queue and active count are empty.
      for (const done of drainWaiters) {
        done();
      }
      drainWaiters = [];
    }
  };
  /** Shared SMTP retry classifier, preserving uncertain-result rejection. */
  const transient = isRetryableSmtpError;
  /** Own one finite backoff timer with cooperative cancellation cleanup.
   * @param {number} ms - Bounded retry interval.
   * @param {AbortSignal} signal - Optional per-job cancellation signal.
   * @returns {Promise<void>} Settles after delay or rejects on cancellation, removing its listener. */
  const delay = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error('Aborted'));
        return;
      }
      /** Owned backoff timer removed on cancellation; does not implement broker scheduling. */
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, ms);
      /** Clear the owned backoff timer and detach cancellation observation.
       * @returns {void} Delay rejects with the caller reason; no message is reinserted.
       */
      function abort() {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        reject(signal?.reason ?? new Error('Aborted'));
      }
      signal?.addEventListener('abort', abort, { once: true });
    });
  /** Submit through the borrowed sender and retry only explicitly qualified transient failures.
   * @param {Job} job - One queued message with private completion callbacks and optional signal.
   * @returns {Promise<EmailResult>} One send result; uncertain SMTP acceptance is never replayed automatically.
   */
  async function send(job: Job) {
    // Retry only finite qualified failures; no branch auto-replays uncertain SMTP acceptance.
    for (let attempt = 0; ; attempt++) {
      if (job.signal?.aborted) {
        throw job.signal.reason ?? new Error('Aborted');
      }
      try {
        return await sender.send(job.message, { signal: job.signal });
      } catch (error) {
        if (attempt >= retries || !transient(error)) {
          throw error;
        }
        await delay(Math.min(backoff * 2 ** attempt, maxBackoff), job.signal);
      }
    }
  }
  /** Start only available local worker slots and release capacity after sender settlement.
   * @returns {void} Pending jobs scheduled without closing the borrowed sender.
   */
  function tick() {
    // Fill available slots without releasing them before borrowed sender settlement.
    while (!closed && active < concurrency && queue.length) {
      /** Next admitted local FIFO job; its active slot remains until sender settlement. */
      const job = queue.shift()!;
      active++;
      void send(job)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          tick();
          wake();
        });
    }
    wake();
  }
  return {
    /** Accept one message while pending-plus-active capacity allows it.
     * @param {EmailMessage} message - Private message retained for this local job; no durable copy is made.
     * @param {{ signal?: AbortSignal }} options - Explicit cooperative per-job signal or local close drain policy.
     * @param {AbortSignal} options.signal - Optional cancellation passed to sender/backoff observation.
     * @returns {Promise<EmailResult>} Per-job result; closed/full queues reject without submission.
     */
    enqueue(
      message: EmailMessage,
      options: {
        /** Optional cooperative cancellation passed to the sender and backoff delay. */
        signal?: AbortSignal;
      } = {}
    ): Promise<EmailResult> {
      if (closed) {
        return Promise.reject(new Error('Queue closed'));
      }
      if (queue.length + active >= maxPending) {
        return Promise.reject(
          Object.assign(new Error('Email queue full'), {
            code: 'EMAIL_QUEUE_FULL',
          })
        );
      }
      return new Promise((resolve, reject) => {
        queue.push({ message, resolve, reject, signal: options.signal });
        tick();
      });
    },
    /** Return bounded local worker state without recipient or message data.
     * @returns {{active: number, pending: number, closed: boolean}} Process-local status only; not durable delivery evidence.
     */
    stats() {
      return { active, pending: queue.length, closed };
    },
    /** Observe queue drain without cancelling in-flight sends or closing the borrowed sender.
     * @returns {Promise<void>} Settles when both pending and active counts are zero.
     */
    async flush() {
      if (!active && !queue.length) {
        return;
      }
      await new Promise<void>((resolve) => drainWaiters.push(resolve));
    },
    /** Close this local queue; explicit drain waits first, default rejects queued jobs without cancelling active sends.
     * @param {{ drain?: boolean }} options - Explicit cooperative per-job signal or local close drain policy.
     * @param {boolean} options.drain - Explicitly await queue drain before closing when true.
     * @returns {Promise<void>} Local close applied; default close is not an actual active-send settlement barrier.
     */
    async close(options: { drain?: boolean } = {}) {
      if (options.drain) {
        await this.flush();
        closed = true;
        return;
      }
      closed = true;
      // Reject queued work explicitly; active sends remain owned by the borrowed sender.
      for (const item of queue.splice(0)) {
        item.reject(new Error('Queue closed'));
      }
      wake();
    },
  };
}
