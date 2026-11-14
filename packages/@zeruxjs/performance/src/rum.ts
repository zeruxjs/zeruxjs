import type { PerformanceMetric } from './types.js';
/** Fixed approved observation provenance labels. */
const coverages = [
  'native-observation',
  'web-vitals-5',
  'server-request',
  'custom',
] as const;
/** Fixed approved consent/data-classification labels; not authentication evidence. */
const consents = ['granted', 'denied', 'unknown', 'not-applicable'] as const;
/** Validate bounded scalar observation facts and copy only approved fields. Does not authenticate consent/site or anonymize a personal caller label.
 * @param {PerformanceMetric} metric - Explicit observation; extra properties never enter the returned transport projection.
 * @returns {PerformanceMetric} Fresh approved metric with custom/unknown provenance defaults; invalid values reject.
 */
export function validatePerformanceMetric(
  metric: PerformanceMetric
): PerformanceMetric {
  if (
    !metric ||
    typeof metric.name !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(metric.name) ||
    !Number.isFinite(metric.value) ||
    metric.value < 0 ||
    !Number.isFinite(metric.timestamp) ||
    metric.timestamp < 0 ||
    metric.timestamp > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError('Invalid performance metric');
  }
  if (
    (metric.statusClass !== undefined &&
      !['1xx', '2xx', '3xx', '4xx', '5xx'].includes(metric.statusClass)) ||
    (metric.outcome !== undefined &&
      !['completed', 'disconnected', 'error'].includes(metric.outcome))
  ) {
    throw new TypeError('Invalid operational metadata');
  }
  if (
    (metric.rating !== undefined &&
      !['good', 'needs-improvement', 'poor'].includes(metric.rating)) ||
    (metric.coverage !== undefined && !coverages.includes(metric.coverage)) ||
    (metric.consent !== undefined && !consents.includes(metric.consent))
  ) {
    throw new TypeError('Invalid performance metadata');
  }
  return {
    name: metric.name,
    value: metric.value,
    timestamp: metric.timestamp,
    ...(metric.statusClass ? { statusClass: metric.statusClass } : {}),
    ...(metric.outcome ? { outcome: metric.outcome } : {}),
    ...(metric.rating ? { rating: metric.rating } : {}),
    coverage: metric.coverage ?? 'custom',
    consent: metric.consent ?? 'unknown',
  };
}
/** Keep bounded per-label observation samples without observers/network. Percentiles describe retained observations, not final pages, unique people or a population.
 * @param {object} options - Explicit retained sample/cardinality ceilings.
 * @param {number} [options.maxPerMetric] - Retained sample ceiling, default 200.
 * @param {number} [options.maxMetricNames] - Distinct label ceiling, default 32.
 * @returns {object} Inert record/snapshot/clear operations; no persistent cleanup handle.
 */
export function createVitalCollector(
  options: {
    /** Retained samples per metric, default 200 and valid 1 through 10000. */
    maxPerMetric?: number;
    /** Distinct metric labels, default 32 and valid 1 through 128. */
    maxMetricNames?: number;
  } = {}
) {
  /** Validated retained-sample limit or per-batch observation limit in its owning factory. */
  const max = options.maxPerMetric ?? 200;
  /** Validated distinct-label ceiling; no unbounded dynamic per-route grouping. */
  const names = options.maxMetricNames ?? 32;
  if (
    !Number.isInteger(max) ||
    max < 1 ||
    max > 10000 ||
    !Number.isInteger(names) ||
    names < 1 ||
    names > 128
  ) {
    throw new RangeError('Invalid sample limit');
  }
  /** Per-collector bounded labels and newest samples; no shared global observations. */
  const buckets = new Map<
    string,
    {
      /** Bounded retained observations for this one approved label. */
      items: PerformanceMetric[];
      /** Total observations admitted for this label, including samples later truncated. */
      observed: number;
    }
  >();
  return {
    /** Validate one observation and retain only the configured newest bounded samples for its label.
     * @param {PerformanceMetric} metric - Approved scalar observation; private arbitrary fields are stripped.
     * @returns {void} Updates sample and total-observed counts; invalid/new excess labels reject.
     */
    record(metric: PerformanceMetric) {
      metric = validatePerformanceMetric(metric);
      let bucket = buckets.get(metric.name);
      if (!bucket) {
        if (buckets.size >= names) {
          throw new RangeError('Metric cardinality exceeded');
        }
        bucket = { items: [], observed: 0 };
        buckets.set(metric.name, bucket);
      }
      bucket.observed++;
      bucket.items.push(metric);
      if (bucket.items.length > max) {
        bucket.items.shift();
      }
    },
    /** Calculate deterministic retained-sample percentiles with provenance, total counts and explicit truncation.
     * @returns {object[]} Fresh observation summaries, not persisted exact population statistics.
     */
    snapshot() {
      return [...buckets].map(([name, { items, observed }]) => {
        /** Copied retained numeric values sorted only for deterministic sample percentiles. */
        const sorted = items.map((x) => x.value).sort((a, b) => a - b);
        return {
          name,
          count: items.length,
          sampleSize: items.length,
          totalObserved: observed,
          truncated: observed > items.length,
          coverageVersion: 1,
          unit: (() => {
            if (name === 'CLS') {
              return 'score';
            } else {
              if (
                ['LCP', 'INP', 'FCP', 'TTFB'].includes(name) ||
                name.startsWith('request.')
              ) {
                return 'milliseconds';
              } else {
                return 'unspecified';
              }
            }
          })(),
          coverage: [...new Set(items.map((x) => x.coverage!))],
          consent: [...new Set(items.map((x) => x.consent!))],
          p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
          p75: sorted[Math.ceil(sorted.length * 0.75) - 1],
          p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
          latest: { ...items[items.length - 1]! },
        };
      });
    },
    /** Clear retained samples or queued reporter work. Reporter generations fence late failures so cleared observations cannot be requeued.
     * @returns {void} Drops owned in-memory data; transmitted bytes cannot be recalled.
     */
    clear() {
      buckets.clear();
    },
  };
}
export interface VitalReporterOptions {
  /** Explicit HTTP(S) endpoint without credentials/query/fragment; mutually exclusive with send. */
  url?: string;
  /** Optional borrowed Fetch transport; no global pool is closed here. */
  fetch?: typeof fetch;
  /** Trusted host transport; literal true reports success, not necessarily database commit. */
  send?: (
    metrics: readonly PerformanceMetric[],
    context: {
      /** Borrowed owner cancellation; clears queued work and signals active transport. */
      signal: AbortSignal;
    }
  ) => Promise<boolean>;
  /** Per-flush observation ceiling, default 50 and valid 1 through 500. */
  maxBatch?: number;
  /** Pending observation ceiling, default maxBatch and valid 1 through 2000. */
  maxQueue?: number;
  /** UTF-8 serialized batch ceiling, default 32768 and valid 256 through 60000 bytes. */
  maxBatchBytes?: number;
  /** Borrowed owner cancellation; clears queued work and signals active transport. */
  signal?: AbortSignal;
  /** Fetch credential mode, default omit; host explicitly owns any credential inclusion. */
  credentials?: RequestCredentials;
  /** Additional transient attempts, default 3 and valid 0 through 20. */
  maxRetries?: number;
  /** Queue admission age ceiling, default 60000 and valid 1 through 3600000 ms. */
  maxAgeMs?: number;
  /** Explicit exponential retry base, legacy default zero and valid 0 through 60000 ms. */
  retryBaseMs?: number;
  /** Retry delay ceiling, default 60000 ms and at least retryBaseMs. */
  retryMaxMs?: number;
  /** Observation deadline, default 3000 and valid 1 through 60000 ms; native work can outlive waiting. */
  timeoutMs?: number;
  /** Optional trusted clock for deterministic deadlines; returns nonnegative safe epoch milliseconds. */
  now?: () => number;
}
/** Own one explicitly flushed transport with bounded queue/age/attempt/byte budgets. No retry timer or durable delivery is created; unknown acknowledgements can duplicate metrics if the host retries.
 * @param {VitalReporterOptions} options - Exactly one explicit URL or trusted send callback plus bounded retry/lifecycle policy.
 * @returns {object} Reporter with destroy and awaited whenClosed; native work retains its slot through actual settlement.
 */
export function createVitalReporter(options: VitalReporterOptions) {
  if (
    !options ||
    typeof options !== 'object' ||
    (options.url !== undefined && options.send !== undefined) ||
    (options.send !== undefined && typeof options.send !== 'function')
  ) {
    throw new TypeError('Invalid RUM transport');
  }
  let url: URL | undefined;
  if (options.url !== undefined) {
    url = new URL(options.url);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new TypeError('Invalid RUM URL');
    }
  } else if (!options.send) {
    throw new TypeError('RUM transport required');
  }
  /** Validate explicit safe-integer limits before queue/transport work.
   * @param {number} value - Requested safe-integer bound.
   * @param {number} min - Inclusive minimum.
   * @param {number} max - Inclusive maximum.
   * @returns {number} Validated bound or an explicit RangeError.
   */
  const bound = (value: number, min: number, max: number) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new RangeError('Invalid RUM bound');
    }
    return value;
  };
  /** Validated retained-sample limit or per-batch observation limit in its owning factory. */
  const max = bound(options.maxBatch ?? 50, 1, 500);
  /** Validated pending queue ceiling, default the selected batch size. */
  const capacity = bound(options.maxQueue ?? max, 1, 2000);
  /** Validated UTF-8 batch byte ceiling; no arbitrary object serialization is allowed. */
  const bytes = bound(options.maxBatchBytes ?? 32768, 256, 60000);
  /** Validated maximum additional transient attempts after the initial send. */
  const retries = bound(options.maxRetries ?? 3, 0, 20);
  /** Validated maximum admission age before pending observations are discarded. */
  const age = bound(options.maxAgeMs ?? 60000, 1, 3600000);
  /** Validated exponential retry base; zero preserves explicit legacy flush behavior. */
  const base = bound(options.retryBaseMs ?? 0, 0, 60000);
  /** Validated retry ceiling greater than or equal to the configured base. */
  const backoff = bound(options.retryMaxMs ?? 60000, base, 60000);
  /** Validated caller observation deadline; native work keeps its slot until settlement. */
  const timeout = bound(options.timeoutMs ?? 3000, 1, 60000);
  if (
    (options.signal !== undefined &&
      !(options.signal instanceof AbortSignal)) ||
    (options.now !== undefined && typeof options.now !== 'function') ||
    (options.credentials !== undefined &&
      !['omit', 'same-origin', 'include'].includes(options.credentials))
  ) {
    throw new TypeError('Invalid RUM options');
  }
  /** Borrowed explicit or native clock, checked on each queue-time use. */
  const now = options.now ?? Date.now;
  /** Borrowed trusted application transport; exactly one transport mode is selected. */
  const send = options.send;
  /** Borrowed explicit/global Fetch transport; responses are cancelled but pools stay host-owned. */
  const fetcher = options.fetch ?? globalThis.fetch;
  /** Explicit Fetch credential policy, default omitted. */
  const credentials = options.credentials ?? 'omit';
  if (!send && typeof fetcher !== 'function') {
    throw new TypeError('Fetch unavailable');
  }
  interface Item {
    /** Approved copied scalar observation; no arbitrary caller object is retained. */
    metric: PerformanceMetric;
    /** Queue admission time in milliseconds, used for maximum retry age. */
    created: number;
    /** Actual transport invocation count, including the initial attempt. */
    attempts: number;
    /** Earliest explicit flush time for the next permitted attempt. */
    next: number;
  }
  /** Bounded pending records only; ambiguous active delivery is tracked separately. */
  const pending: Item[] = [];
  let generation = 0;
  let native: Promise<number> | undefined,
    observed: Promise<number> | undefined,
    controller: AbortController | undefined,
    disposed = false,
    dropped = 0,
    failures = 0,
    delivered = 0;
  /** Read the trusted clock through safe-integer validation.
   * @returns {number} Current validated clock milliseconds.
   */
  const time = () => bound(now(), 0, Number.MAX_SAFE_INTEGER);
  /** Fence the current generation, discard queued records and signal native delivery.
   * @returns {void} Fences queue state and signals active work without claiming rollback.
   */
  const abort = () => {
    generation++;
    dropped += pending.length;
    pending.length = 0;
    controller?.abort();
  };
  options.signal?.addEventListener('abort', abort);
  /** Drop expired pending records before queue/flush operations without scheduling background work.
   * @returns {void} Removes expired pending observations and increments dropped count.
   */
  const trim = () => {
    /** Current validated admission/flush/failure time for this queue decision. */
    const at = time();
    // Process only the bounded pending records for this explicit queue decision.
    for (let i = pending.length - 1; i >= 0; i--) {
      if (at - pending[i]!.created >= age) {
        pending.splice(i, 1);
        dropped++;
      }
    }
  };
  /** Owned explicit-flush API; dispose and await whenClosed for real native settlement. */
  const reporter = {
    /** Copy one validated scalar observation into the bounded queue, dropping the oldest pending sample on overflow.
     * @param {PerformanceMetric} metric - Explicit approved metric, independently checked against the batch byte ceiling.
     * @returns {void} Admits a queue record only; not a persistence acknowledgement.
     */
    add(metric: PerformanceMetric) {
      if (disposed) {
        throw new Error('Reporter destroyed');
      }
      if (options.signal?.aborted) {
        throw new Error('Reporter cancelled');
      }
      metric = validatePerformanceMetric(metric);
      /** Fresh approved metric fields, independent of arbitrary caller extras. */
      const copy = { ...metric };
      if (new TextEncoder().encode(JSON.stringify([copy])).byteLength > bytes) {
        throw new RangeError('Metric exceeds batch byte budget');
      }
      trim();
      if (pending.length >= capacity) {
        pending.shift();
        dropped++;
      }
      /** Current validated admission/flush/failure time for this queue decision. */
      const at = time();
      pending.push({ metric: copy, created: at, attempts: 0, next: at });
    },
    /** Send only due bounded observations once; reject overlapping native work after a timeout until that work really settles.
     * @returns {Promise<number>} Reported successful observation count, zero during backoff/no work; failure may retain bounded transient retries.
     */
    flush(): Promise<number> {
      if (observed) {
        return observed;
      }
      if (native) {
        return Promise.reject(new Error('RUM transport still pending'));
      }
      if (disposed) {
        return Promise.resolve(0);
      }
      if (options.signal?.aborted) {
        return Promise.reject(new Error('Reporter cancelled'));
      }
      trim();
      /** Current validated admission/flush/failure time for this queue decision. */
      const at = time();
      /** Single bounded due batch removed from pending before one transport attempt. */
      const batch: Item[] = [];
      let size = 2;
      // Process only the bounded pending records for this explicit queue decision.
      for (let i = 0; i < pending.length && batch.length < max; ) {
        /** One due queue record whose age/attempt schedule remains explicit. */
        const item = pending[i]!;
        if (item.next > at) {
          i++;
          continue;
        }
        /** Serialized UTF-8 metric bytes plus the actual JSON comma overhead. */
        const n =
          new TextEncoder().encode(JSON.stringify(item.metric)).byteLength +
          (batch.length ? 1 : 0);
        if (size + n > bytes) {
          break;
        }
        size += n;
        batch.push(...pending.splice(i, 1));
      }
      if (!batch.length) {
        return Promise.resolve(0);
      }
      controller = new AbortController();
      /** Owned per-batch controller retained until the native operation settles. */
      const active = controller;
      /** Generation fence captured before send; late failures cannot restore cleared/old-consent work. */
      const epoch = generation;
      if (options.signal?.aborted) {
        active.abort();
      }
      let timedOut = false,
        timer: ReturnType<typeof setTimeout> | undefined,
        stop = () => {};
      /** Observation-only cancellation/deadline rejection; does not release native capacity. */
      const stopped = new Promise<never>((_, reject) => {
        stop = () =>
          reject(
            new Error(
              timedOut
                ? 'RUM delivery deadline exceeded'
                : 'RUM delivery cancelled'
            )
          );
        active.signal.addEventListener('abort', stop, { once: true });
        if (active.signal.aborted) {
          stop();
        }
        timer = setTimeout(() => {
          timedOut = true;
          active.abort();
        }, timeout);
      });
      native = Promise.resolve().then(async () => {
        let retryable = true;
        try {
          active.signal.throwIfAborted();
          batch.forEach((item) => item.attempts++);
          /** Frozen approved scalar batch passed to the trusted sender or serialized Fetch. */
          const metrics = batch.map((x) => Object.freeze({ ...x.metric }));
          let ok: boolean;
          if (send) {
            ok = await send(Object.freeze(metrics), { signal: active.signal });
          } else {
            /** Borrowed Fetch result; its body is cancelled before releasing native ownership. */
            const result = await fetcher!(url!.href, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(metrics),
              signal: active.signal,
              credentials,
              redirect: 'error',
              cache: 'no-store',
              keepalive: true,
            });
            ok = result.ok;
            retryable =
              ok ||
              result.status === 408 ||
              result.status === 429 ||
              result.status >= 500;
            if (result.body) {
              await result.body.cancel();
            }
            if (!ok) {
              retryable =
                result.status === 408 ||
                result.status === 429 ||
                result.status >= 500;
              throw new Error(`RUM delivery failed (${result.status})`);
            }
          }
          if (ok !== true) {
            throw new Error('RUM delivery unavailable');
          }
          delivered += batch.length;
          return batch.length;
        } catch (error) {
          failures++;
          if (!disposed && epoch === generation && retryable) {
            /** Current validated admission/flush/failure time for this queue decision. */
            const at = time();
            /** Only transient records still within attempt and age budgets after failure. */
            const retry = batch.filter(
              (item) => item.attempts <= retries && at - item.created < age
            );
            // Process only the bounded pending records for this explicit queue decision.
            for (const item of retry) {
              item.next =
                at +
                Math.min(backoff, base * 2 ** Math.min(item.attempts - 1, 20));
            }
            /** Actual remaining pending capacity; retries cannot overflow newer admitted samples. */
            const room = Math.max(0, capacity - pending.length);
            pending.unshift(...retry.slice(0, room));
            dropped += batch.length - Math.min(retry.length, room);
          } else {
            dropped += batch.length;
          }
          throw error instanceof Error &&
            /^RUM delivery failed \(\d{3}\)$/.test(error.message)
            ? error
            : new Error('RUM delivery unavailable', { cause: error });
        } finally {
          native = undefined;
          controller = undefined;
        }
      });
      observed = Promise.race([native, stopped]).finally(() => {
        if (timer) {
          clearTimeout(timer);
        }
        active.signal.removeEventListener('abort', stop);
        observed = undefined;
      });
      return observed;
    },
    /** Clear retained samples or queued reporter work. Reporter generations fence late failures so cleared observations cannot be requeued.
     * @returns {void} Drops owned in-memory data; transmitted bytes cannot be recalled.
     */
    clear() {
      generation++;
      dropped += pending.length;
      pending.length = 0;
      controller?.abort();
    },
    get pending() {
      trim();
      return pending.length;
    },
    /** Project fixed path/identity-free counters without queued payloads or transport causes.
     * @returns {object} Current queue/native/drop/failure/delivery status.
     */
    diagnostics() {
      return {
        disposed,
        pending: pending.length,
        inFlight: !!native,
        dropped,
        failures,
        delivered,
      };
    },
    /** Stop admission, remove the borrowed abort listener and abort active delivery. Recover only known queued samples; ambiguous in-flight bytes are never labelled safe to replay.
     * @param {object} settings - Explicit unsent discard/recover policy; default discard.
     * @param {string} [settings.unsent] - Explicit discard or known-queued recover policy.
     * @returns {object} Approved queued recovery values and none/unknown in-flight outcome; repeated calls recover nothing.
     */
    destroy(
      settings: {
        /** Explicit queued-data teardown policy: discard by default or recover known unsent samples. */
        unsent?: 'discard' | 'recover';
      } = {}
    ) {
      if (
        settings.unsent !== undefined &&
        !['discard', 'recover'].includes(settings.unsent)
      ) {
        throw new TypeError('Invalid unsent policy');
      }
      if (disposed) {
        return {
          recovered: [] as PerformanceMetric[],
          inFlightOutcome: 'none' as 'none' | 'unknown',
        };
      }
      disposed = true;
      /** Only known queued approved values under explicit recover policy, never ambiguous active data. */
      const recovered =
        settings.unsent === 'recover'
          ? pending.map((x) => ({ ...x.metric }))
          : [];
      dropped += pending.length;
      pending.length = 0;
      options.signal?.removeEventListener('abort', abort);
      /** None/unknown active-delivery certainty; no exactly-once claim. */
      const outcome = native ? ('unknown' as const) : ('none' as const);
      controller?.abort();
      return { recovered, inFlightOutcome: outcome };
    },
    /** Await actual owned native delivery cleanup after destroy, without closing borrowed Fetch pools or forcing arbitrary JavaScript to stop.
     * @returns {Promise<void>} Settles after native transport settlement; calling before destroy rejects.
     */
    async whenClosed() {
      if (!disposed) {
        throw new Error('Reporter not destroyed');
      }
      await Promise.allSettled([native]);
    },
  };
  return reporter;
}
