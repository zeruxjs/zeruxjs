import {
  createVitalCollector,
  createVitalReporter,
  validatePerformanceMetric,
  type VitalReporterOptions,
} from './rum.js';
import {
  observeWebVitals,
  type VitalObserverOptions,
} from './utils/webVitals.js';
import type { PerformanceMetric, VitalName } from './types.js';

/** Finite supported vital names shared by schema generation and admission validation. */
const names: VitalName[] = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'];
/** Check explicit session-token syntax only; never authenticate or fingerprint a person.
 * @param {unknown} v - Explicit candidate token; syntax only.
 * @returns {boolean} Whether a declared opaque session token has the allowed bounded form.
 */
const opaque = (v: unknown) =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v);
/** Check finite public operational-label syntax, not authorization.
 * @param {unknown} v - Explicit public operational route label.
 * @returns {boolean} Whether bounded label syntax is valid.
 */
const label = (v: unknown) =>
  typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,54}$/.test(v);
/** Create inert finite-cardinality string dimension data for the owning analytics schema.
 * @param {T[]} values - Explicit finite schema vocabulary.
 * @returns {object} Inert required finite-cardinality dimension definition.
 */
const dimension = <T extends string>(values: T[]) => ({
  kind: 'dimension' as const,
  type: 'string' as const,
  values,
  maxCardinality: values.length,
  required: true as const,
});
/** Return inert versioned analytics schema data for approved vitals. CLS remains a score parameter, not an invented unbounded ratio metric.
 * @returns {object[]} Schema definitions only; no sink, identity, observer or remote upload starts.
 */
export function performanceAnalyticsSchemas() {
  return [
    {
      name: 'performance.vital.v1',
      version: 1,
      properties: {
        metric: dimension(names),
        unit: dimension(['milliseconds', 'score']),
        coverage: dimension(['native-observation', 'web-vitals-5']),
        sample_size: {
          kind: 'metric' as const,
          unit: 'count' as const,
          min: 1,
        },
        duration_ms: {
          kind: 'metric' as const,
          unit: 'milliseconds' as const,
          min: 0,
          max: 3600000,
        },
        layout_shift_score: {
          kind: 'parameter' as const,
          type: 'number' as const,
        },
      },
    },
  ];
}
export interface PerformanceAnalyticsEvent {
  /** Fixed event/schema or declared INP observation name; not an endpoint. */
  name: 'performance.vital.v1';
  /** Fixed web provenance; no document payload or URL is copied. */
  source: 'web';
  /** Bounded public nonpersonal site label; collection server must independently authorize tenant/site. */
  site: string;
  /** Explicit host collection permission; unknown/denied prevents startup/admission/send. */
  consent: 'granted';
  /** Optional opaque consented token, 16 through 128 safe characters; no automatic identity creation. */
  sessionId?: string;
  /** Approved scalar schema/event facts, not arbitrary caller attributes. */
  properties: {
    /** Finite supported vital label. */
    metric: VitalName;
    /** Explicit milliseconds or CLS score; no ratio semantics are invented. */
    unit: 'milliseconds' | 'score';
    /** Native/maintained provenance; not complete page/population coverage. */
    coverage: 'native-observation' | 'web-vitals-5';
    /** Observation count, not unique people or final page count. */
    sample_size: number;
    /** Approved bounded duration in milliseconds. */
    duration_ms?: number;
    /** Nonnegative CLS score parameter, not a bounded ratio metric. */
    layout_shift_score?: number;
  };
}
export interface BrowserPerformanceOptions {
  /** Bounded public nonpersonal site label; collection server must independently authorize tenant/site. */
  site: string;
  /** Explicit host collection permission; unknown/denied prevents startup/admission/send. */
  consent?: 'granted' | 'denied' | 'unknown';
  /** Optional opaque consented token, 16 through 128 safe characters; no automatic identity creation. */
  sessionId?: string;
  /** Explicit trusted host transport; success is transport-reported, not a durability guarantee. */
  send: (
    events: readonly PerformanceAnalyticsEvent[],
    context: { signal: AbortSignal }
  ) => Promise<boolean>;
  /** Optional finite in-memory queue/attempt/age/deadline policy; no automatic background retry. */
  reporter?: Pick<
    VitalReporterOptions,
    | 'maxBatch'
    | 'maxQueue'
    | 'maxBatchBytes'
    | 'maxRetries'
    | 'maxAgeMs'
    | 'retryBaseMs'
    | 'retryMaxMs'
    | 'timeoutMs'
    | 'now'
  >;
  /** Optional borrowed native observation capabilities; no maintained INP source starts here. */
  observer?: Omit<VitalObserverOptions, 'onMetric' | 'onUnsupported'>;
  /** Trusted page-owned maintained source. This bridge never starts or owns its library observers. */
  webVitals?: {
    /** Declared supported web-vitals 5.x version, not automatic library loading. */
    version: string;
    /** Host-qualified browser capability flag; unsupported produces no fake zero INP. */
    inpSupported: boolean;
  };
  /** Optional borrowed page visibility/event owner; only registered listeners are removed. */
  document?: Pick<
    Document,
    'visibilityState' | 'addEventListener' | 'removeEventListener'
  >;
  /** Optional borrowed page lifecycle target; import remains DOM-free. */
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}
/** Own an explicitly started consent-gated native observer/reporter scope with approved scalar fields. Never create identities, infer consent, copy URLs/attribution or start the optional maintained INP source.
 * @param {BrowserPerformanceOptions} options - Verified public site label, explicit transport, consent/identity and borrowed native capabilities.
 * @returns {object} Start/consent/record/flush/snapshot API with destroy then awaited whenClosed.
 */
export function createBrowserPerformanceAnalytics(
  options: BrowserPerformanceOptions
) {
  if (
    !options ||
    typeof options.send !== 'function' ||
    typeof options.site !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.site) ||
    (options.sessionId !== undefined && !opaque(options.sessionId))
  ) {
    throw new TypeError('Invalid browser analytics options');
  }
  /** Copied verified public label; browser syntax alone does not authenticate tenant/site. */
  const site = options.site;
  /** Borrowed trusted transport; lifecycle remains bounded by the owned reporter. */
  const send = options.send;
  /** Copied declared maintained-source support/version metadata, not a loaded observer. */
  const source = options.webVitals ? { ...options.webVitals } : undefined;
  if (
    source &&
    (!/^5\.\d+\.\d+$/.test(source.version) ||
      typeof source.inpSupported !== 'boolean')
  ) {
    throw new TypeError('Unsupported web-vitals source');
  }
  let consent = options.consent ?? 'unknown',
    sessionId = options.sessionId;
  if (!['granted', 'denied', 'unknown'].includes(consent)) {
    throw new TypeError('Invalid consent');
  }
  /** Copied native observer settings, including a separate support-list snapshot. */
  const observer = (() => {
    if (options.observer) {
      return {
        ...options.observer,
        ...(options.observer.supportedEntryTypes
          ? { supportedEntryTypes: [...options.observer.supportedEntryTypes] }
          : {}),
      };
    } else {
      return undefined;
    }
  })();
  /** Owned bounded in-memory samples; clearing never erases already transmitted data. */
  const collector = createVitalCollector({ maxMetricNames: 5 });
  /** Per-scope last metric observation ID/value, cleared on identity/consent changes. */
  const latest = new Map<
    string,
    {
      /** Maintained-source observation ID used only for duplicate suppression, never transported. */
      id?: string;
      /** Finite nonnegative observed value under the supported metric budget. */
      value: number;
    }
  >();
  let active = false,
    disposed = false,
    stop: (() => void) | undefined,
    invalid = 0;
  /** Native supported entry-type snapshot used to report explicit coverage gaps. */
  const supported = new Set(
    observer?.supportedEntryTypes ??
      (typeof PerformanceObserver !== 'undefined'
        ? PerformanceObserver.supportedEntryTypes
        : [])
  );
  /** Per-metric provenance/unsupported state, separate from retained sample counts. */
  const coverage: Record<VitalName, string> = {
    LCP: supported.has('largest-contentful-paint')
      ? 'not-observed'
      : 'unsupported',
    CLS: supported.has('layout-shift') ? 'not-observed' : 'unsupported',
    FCP: supported.has('paint') ? 'not-observed' : 'unsupported',
    TTFB:
      observer?.navigation || supported.has('navigation')
        ? 'not-observed'
        : 'unsupported',
    INP: source?.inpSupported ? 'external-source-not-observed' : 'unsupported',
  };
  /** Owned bounded explicit-flush transport; destroy and await actual native settlement. */
  const reporter = createVitalReporter({
    ...options.reporter,
    retryBaseMs: options.reporter?.retryBaseMs ?? 1000,
    send: async (metrics, context) => {
      if (consent !== 'granted' || disposed) {
        return false;
      }
      return send(
        metrics.map((metric) => ({
          name: 'performance.vital.v1' as const,
          source: 'web' as const,
          site,
          consent: 'granted' as const,
          ...(sessionId ? { sessionId } : {}),
          properties: {
            metric: metric.name as VitalName,
            unit:
              metric.name === 'CLS'
                ? ('score' as const)
                : ('milliseconds' as const),
            coverage: metric.coverage as 'native-observation' | 'web-vitals-5',
            sample_size: 1,
            ...(metric.name === 'CLS'
              ? { layout_shift_score: metric.value }
              : { duration_ms: metric.value }),
          },
        })),
        context
      );
    },
  });
  /** Admit only active consented approved observations and suppress identical metric-ID/value updates. Invalid metrics are counted, not sent.
   * @param {PerformanceMetric} metric - Scalar observation projected through independent validation.
   * @param {string} id - Optional maintained-source observation identity, never included in transported fields.
   * @returns {boolean} Whether a new observation entered the bounded collector/reporter.
   */
  function record(metric: PerformanceMetric, id?: string) {
    if (!active || disposed || consent !== 'granted') {
      return false;
    }
    try {
      metric = validatePerformanceMetric(metric);
      if (
        !names.includes(metric.name as VitalName) ||
        metric.value > 3600000 ||
        (metric.name === 'INP' && metric.coverage !== 'web-vitals-5')
      ) {
        throw new TypeError();
      }
      /** Last accepted ID/value for this metric; identical updates are suppressed. */
      const previous = latest.get(metric.name);
      if (previous && previous.id === id && previous.value === metric.value) {
        return false;
      }
      latest.set(metric.name, { id, value: metric.value });
      /** Approved scalar observation copy with explicit granted consent provenance. */
      const value = { ...metric, consent: 'granted' as const };
      collector.record(value);
      reporter.add(value);
      coverage[metric.name as VitalName] = metric.coverage!;
      return true;
    } catch {
      invalid++;
      return false;
    }
  }
  /** Borrowed optional native visibility target, read only when configuring the owner. */
  const doc =
    options.document ??
    (typeof document === 'undefined' ? undefined : document);
  /** Borrowed optional page lifecycle target; listener registrations belong to this scope. */
  const win =
    options.window ?? (typeof window === 'undefined' ? undefined : window);
  /** Request one bounded best-effort lifecycle flush and isolate transport failure.
   * @returns {void} Starts no retry loop and absorbs lifecycle delivery failure.
   */
  const flushQuietly = () => {
    void reporter.flush().catch(() => {});
  };
  /** Flush only when the explicitly borrowed document becomes hidden.
   * @returns {void} Requests a best-effort flush only under hidden visibility.
   */
  const hidden = () => {
    if (doc?.visibilityState === 'hidden') {
      flushQuietly();
    }
  };
  /** Request a bounded explicit page-exit flush; keepalive cannot guarantee delivery.
   * @returns {void} Requests one bounded page-exit flush.
   */
  const pagehide = () => flushQuietly();
  /** Start one native observation/lifecycle scope only after explicit granted consent. Buffered browser entries may predate start; host policy decides whether that history is permitted.
   * @returns {boolean} True for a newly started scope, false when active/denied; destroyed owners reject.
   */
  function start() {
    if (disposed) {
      throw new Error('Performance analytics destroyed');
    }
    if (active || consent !== 'granted') {
      return false;
    }
    active = true;
    stop = observeWebVitals({
      ...observer,
      onMetric: (metric) => {
        record({ ...metric, coverage: 'native-observation' });
      },
      onUnsupported: (type) => {
        /** Approved metric label or sanitized server observation, never URL/trace/identity copying. */
        const metric = (() => {
          if (type === 'paint') {
            return 'FCP';
          } else {
            if (type === 'layout-shift') {
              return 'CLS';
            } else {
              if (type === 'largest-contentful-paint') {
                return 'LCP';
              } else {
                return undefined;
              }
            }
          }
        })();
        if (metric) {
          coverage[metric] = 'unsupported';
        }
      },
    });
    doc?.addEventListener('visibilitychange', hidden);
    win?.addEventListener('pagehide', pagehide);
    return true;
  }
  /** Disconnect only owned native observers and lifecycle listeners; the optional maintained library source remains page-owned.
   * @returns {void} Ends this local observation scope without claiming to recall transmitted data.
   */
  function halt() {
    stop?.();
    stop = undefined;
    active = false;
    doc?.removeEventListener('visibilitychange', hidden);
    win?.removeEventListener('pagehide', pagehide);
  }
  return {
    start,
    /** Apply explicit host consent/identity changes, fencing old queued/native work and clearing samples on revocation or identity replacement. A new granted scope requires explicit start.
     * @param {'granted' | 'denied' | 'unknown'} value - Host-resolved consent state, not a browser authorization credential.
     * @param {object} identity - Optional explicit opaque consented session mapping; omission preserves current identity only while granted.
     * @param {string} [identity.sessionId] - Optional explicitly consented opaque session.
     * @returns {void} Updates collection permission and bounded local identity; never persists or fingerprints a user.
     */
    setConsent(
      value: 'granted' | 'denied' | 'unknown',
      identity?: {
        /** Optional opaque consented token, 16 through 128 safe characters; no automatic identity creation. */
        sessionId?: string;
      }
    ) {
      if (disposed) {
        throw new Error('Performance analytics destroyed');
      }
      if (
        !['granted', 'denied', 'unknown'].includes(value) ||
        (identity?.sessionId !== undefined && !opaque(identity.sessionId))
      ) {
        throw new TypeError('Invalid consent/identity');
      }
      if (
        value !== 'granted' ||
        (identity && identity.sessionId !== sessionId)
      ) {
        halt();
        reporter.clear();
        collector.clear();
        latest.clear();
      }
      consent = value;
      sessionId = (() => {
        if (value === 'granted') {
          if (identity) {
            return identity.sessionId;
          } else {
            return sessionId;
          }
        } else {
          return undefined;
        }
      })();
    },
    /** Accept only declared supported web-vitals 5 INP observations after consent/start. Strip entries, attribution, native IDs and arbitrary source fields before sending.
     * @param {object} metric - Maintained source observation; not an arbitrary Event Timing duration.
     * @param {string} metric.name - Maintained metric name; only INP accepted.
     * @param {number} metric.value - Observed INP duration in milliseconds.
     * @param {string} metric.id - Bounded maintained observation ID for local deduplication.
     * @param {string} [metric.rating] - Optional fixed maintained rating.
     * @returns {boolean} Whether the approved changed INP observation was admitted.
     */
    receiveWebVital(metric: {
      /** Fixed event/schema or declared INP observation name; not an endpoint. */
      name: string;
      /** Finite nonnegative observed value under the supported metric budget. */
      value: number;
      /** Maintained-source observation ID used only for duplicate suppression, never transported. */
      id: string;
      /** Optional fixed maintained-source rating. */
      rating?: PerformanceMetric['rating'];
    }) {
      if (
        !source?.inpSupported ||
        disposed ||
        !active ||
        consent !== 'granted'
      ) {
        return false;
      }
      if (
        !metric ||
        metric.name !== 'INP' ||
        typeof metric.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(metric.id)
      ) {
        invalid++;
        return false;
      }
      return record(
        {
          name: 'INP',
          value: metric.value,
          timestamp: Date.now(),
          rating: metric.rating,
          coverage: 'web-vitals-5',
        },
        metric.id
      );
    },
    flush: () => reporter.flush(),
    /** Project retained observation samples, coverage version and explicit consent/operational provenance, without private session or trace identifiers.
     * @returns {object} Bounded local sample summaries and reporter counters; missing coverage is never zero-filled.
     */
    snapshot() {
      /** Fresh retained-sample summaries with coverage and truncation metadata. */
      const observations = collector.snapshot();
      return {
        coverageVersion: 1,
        consent,
        sampleSize: observations.reduce((n, x) => n + x.sampleSize, 0),
        coverage: { ...coverage },
        observations,
        invalid,
        reporter: reporter.diagnostics(),
      };
    },
    /** Disconnect owned collection/listeners, clear samples and destroy the reporter using an explicit unsent policy. Maintained INP library observers remain page-owned.
     * @param {object} settings - Discard by default, or recover only known queued approved scalars.
     * @param {string} [settings.unsent] - Explicit discard or known-queued recover policy.
     * @returns {object} Known queued recovery and explicit in-flight uncertainty; await whenClosed separately.
     */
    destroy(
      settings: {
        /** Explicit queued-data discard/recover choice; ambiguous active work is never safe-to-retry recovery. */
        unsent?: 'discard' | 'recover';
      } = {}
    ) {
      halt();
      disposed = true;
      collector.clear();
      latest.clear();
      return reporter.destroy(settings);
    },
    whenClosed: () => reporter.whenClosed(),
  };
}
/** Define a separate bounded operational analytics namespace with explicit route vocabulary, units and classification.
 * @param {readonly string[]} routes - At most 32 unique safe host labels; raw URLs/tenant/user route values reject.
 * @param {string} name - Explicit compatible schema namespace, default performance.request.v1.
 * @returns {object} Inert schema including the fixed other label; no trace/marketing join or collection starts.
 */
export function requestPerformanceAnalyticsSchema(
  routes: readonly string[],
  name = 'performance.request.v1'
) {
  if (
    !Array.isArray(routes) ||
    routes.length > 32 ||
    routes.some((r) => !label(r)) ||
    new Set(routes).size !== routes.length ||
    typeof name !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(name)
  ) {
    throw new TypeError('Invalid operational schema');
  }
  return {
    name,
    version: 1,
    properties: {
      route: dimension([...new Set([...routes, 'other'])]),
      status_class: dimension(['1xx', '2xx', '3xx', '4xx', '5xx']),
      outcome: dimension(['completed', 'disconnected', 'error']),
      scope: dimension(['operational-only']),
      duration_ms: {
        kind: 'metric' as const,
        unit: 'milliseconds' as const,
        min: 0,
        max: 3600000,
      },
      sample_size: { kind: 'metric' as const, unit: 'count' as const, min: 1 },
    },
  };
}
export interface RequestPerformanceSample {
  /** Trusted completed request duration, 0 through 3600000 ms. */
  durationMs: number;
  /** Trusted terminal HTTP status, integer 100 through 599. */
  status: number;
  /** Fixed completed/disconnected/error outcome. */
  outcome: 'completed' | 'disconnected' | 'error';
}
/** Own a bounded operational-only reporter over a trusted completed-request subset. Copy no URL, request/trace ID, tenant fields or marketing identity; host owns sink authorization.
 * @param {object} options - Finite approved routes, private trusted sender and optional reporter budgets.
 * @param {readonly string[]} options.routes - Finite approved operational route labels.
 * @param {function} options.send - Trusted private operational transport.
 * @param {object} [options.reporter] - Optional bounded reporter policy.
 * @returns {object} Explicit record/flush/snapshot/destroy API; await whenClosed after destruction.
 */
export function createServerPerformanceAdapter(options: {
  /** Finite host-approved operational labels; maximum 32 unique safe values. */
  routes: readonly string[];
  /** Explicit trusted host transport; success is transport-reported, not a durability guarantee. */
  send: (
    metrics: readonly PerformanceMetric[],
    context: { signal: AbortSignal }
  ) => Promise<boolean>;
  /** Optional finite in-memory queue/attempt/age/deadline policy; no automatic background retry. */
  reporter?: BrowserPerformanceOptions['reporter'];
}) {
  if (
    !options ||
    !Array.isArray(options.routes) ||
    options.routes.length > 32 ||
    new Set(options.routes).size !== options.routes.length ||
    options.routes.some((r) => !label(r)) ||
    typeof options.send !== 'function'
  ) {
    throw new TypeError('Invalid operational metrics options');
  }
  /** Per-owner immutable-by-convention finite route set; no global shared labels. */
  const routes = new Set(options.routes);
  /** Owned bounded in-memory samples; clearing never erases already transmitted data. */
  const collector = createVitalCollector({ maxMetricNames: 33 });
  /** Owned bounded explicit-flush transport; destroy and await actual native settlement. */
  const reporter = createVitalReporter({
    ...options.reporter,
    retryBaseMs: options.reporter?.retryBaseMs ?? 1000,
    send: options.send,
  });
  let disposed = false;
  return {
    /** Admit one bounded trusted terminal request measurement under an approved finite route label.
     * @param {Readonly<RequestPerformanceSample>} sample - Readonly trusted duration/status/outcome subset; arbitrary extras are excluded.
     * @param {string} route - Approved safe route label, default other; never extracted from request URLs.
     * @returns {void} Adds an operational observation, not a marketing event or persistence acknowledgement.
     */
    record(sample: Readonly<RequestPerformanceSample>, route = 'other') {
      if (disposed) {
        throw new Error('Operational metrics destroyed');
      }
      if (route !== 'other' && !routes.has(route)) {
        throw new TypeError('Unapproved route label');
      }
      if (
        !sample ||
        !Number.isFinite(sample.durationMs) ||
        sample.durationMs < 0 ||
        sample.durationMs > 3600000 ||
        !Number.isSafeInteger(sample.status) ||
        sample.status < 100 ||
        sample.status > 599 ||
        !['completed', 'disconnected', 'error'].includes(sample.outcome)
      ) {
        throw new TypeError('Invalid operational sample');
      }
      /** Approved metric label or sanitized server observation, never URL/trace/identity copying. */
      const metric: PerformanceMetric = {
        name: 'request.' + route,
        value: sample.durationMs,
        timestamp: Date.now(),
        coverage: 'server-request',
        consent: 'not-applicable',
        statusClass: (Math.floor(sample.status / 100) +
          'xx') as PerformanceMetric['statusClass'],
        outcome: sample.outcome,
      };
      collector.record(metric);
      reporter.add(metric);
    },
    flush: () => reporter.flush(),
    /** Project retained observation samples, coverage version and explicit consent/operational provenance, without private session or trace identifiers.
     * @returns {object} Bounded local sample summaries and reporter counters; missing coverage is never zero-filled.
     */
    snapshot() {
      /** Fresh retained-sample summaries with coverage and truncation metadata. */
      const observations = collector.snapshot();
      return {
        sampleSize: observations.reduce((n, x) => n + x.sampleSize, 0),
        coverageVersion: 1,
        consent: 'not-applicable' as const,
        scope: 'operational-only' as const,
        observations,
        reporter: reporter.diagnostics(),
      };
    },
    /** Disconnect owned collection/listeners, clear samples and destroy the reporter using an explicit unsent policy. Maintained INP library observers remain page-owned.
     * @param {object} settings - Discard by default, or recover only known queued approved scalars.
     * @param {string} [settings.unsent] - Explicit discard or known-queued recover policy.
     * @returns {object} Known queued recovery and explicit in-flight uncertainty; await whenClosed separately.
     */
    destroy(
      settings: {
        /** Explicit queued-data discard/recover choice; ambiguous active work is never safe-to-retry recovery. */
        unsent?: 'discard' | 'recover';
      } = {}
    ) {
      disposed = true;
      collector.clear();
      return reporter.destroy(settings);
    },
    whenClosed: () => reporter.whenClosed(),
  };
}
