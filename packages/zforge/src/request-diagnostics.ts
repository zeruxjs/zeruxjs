import type { RequestSpan, TracingAdapter } from 'zeruxjs';
import type { DevtoolsSectionDefinition } from './module-registry.js';
import { escapeHtml } from './components/document.js';
export interface DevtoolsRequestRecord {
  /** Explicit application identity selected by the host telemetry configuration. */
  applicationId: string;
  /** Framework generation identity fencing stale exports. */
  generationId: string;
  /** Opaque framework request correlation label, never authenticated user identity. */
  requestId: string;
  /** Framework trace correlation label with no personal traits. */
  traceId: string;
  /** Framework span correlation label. */
  spanId: string;
  /** Framework event start timestamp in epoch milliseconds. */
  startedAt: number;
  /** Finite nonnegative measured request duration in milliseconds. */
  durationMs: number;
  /** Observed bounded HTTP response status. */
  status: number;
  /** Actual framework terminal classification; not a delivery/durability guarantee. */
  outcome: RequestSpan['outcome'];
  /** Host-allowlisted route label or the fixed other fallback; raw URL/query data is excluded. */
  route: string;
  /** Only validated content-type/content-length values; other headers are omitted. */
  headers: Record<string, string>;
  /** Host-approved primitive projection; no automatic request-body capture. */
  bodyPreview: Record<string, string | number | boolean | null>;
  /** Optional normalized fixed public error code without private message/stack. */
  errorCode?: string;
}
export interface RequestDiagnosticsOptions {
  /** Explicit application allowlist capped before state allocation. */
  applications: readonly string[];
  /** Explicit bounded route-label allowlist, independent of public URL paths. */
  routes: readonly string[];
  /** Per-application retained record count cap; defaults to one hundred. */
  maxRecordsPerApp?: number;
  /** Per-application serialized byte cap; defaults to 256KiB. */
  maxBytesPerApp?: number;
  /** Per-application maximum retained age; defaults to fifteen minutes. */
  retentionMs?: number;
  /** Explicit host-approved primitive field names; secrets remain forbidden by name. */
  bodyFields?: readonly string[];
  /** Borrowed framework error normalizer; never logs or stores its private cause. */
  normalizeApiError?: (typeof import('zeruxjs'))['normalizeApiError'];
  /** Optional host clock for deterministic retention checks. */
  now?: () => number;
}
/** Default-deny field-name guard applied even when the host explicitly approves preview fields. */
const sensitive =
  /password|secret|token|cookie|authorization|credential|api.?key|session|email|stack|message|code/i;
/** Assert one bounded correlation label without converting it into an authenticated identity.
 * @param {unknown} value - Candidate explicit diagnostic identity or correlation label.
 * @returns {void} Returns only for the implemented bounded safe label grammar; otherwise throws.
 */
function label(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
  ) {
    throw new TypeError('Invalid diagnostics label');
  }
}
/** Create a scoped, bounded, generation-fenced store for host-approved framework spans.
 * @param {RequestDiagnosticsOptions} options - Explicit app/route allowlists, preview fields and per-application retention budgets.
 * @returns {object} Diagnostics owner with adapters/read views and synchronous close; mount behind host authorization.
 */
export function createRequestDiagnostics(options: RequestDiagnosticsOptions) {
  if (
    !options ||
    !Array.isArray(options.applications) ||
    !options.applications.length ||
    options.applications.length > 16 ||
    new Set(options.applications).size !== options.applications.length ||
    !Array.isArray(options.routes) ||
    options.routes.length > 64
  ) {
    throw new TypeError('Explicit diagnostics apps/routes required');
  }
  options.applications.forEach(label);
  options.routes.forEach(label);
  /** Explicit allowed application identities; no automatic registration or global application scan. */
  const apps = new Set(options.applications);
  /** Bounded allowlisted route labels plus a single fallback label to avoid path cardinality. */
  const routes = new Set([...options.routes, 'other']);
  /** Explicit host-approved primitive body fields; field names cannot detect secrets disguised as public values. */
  const fields = [...(options.bodyFields ?? [])];
  if (
    fields.length > 16 ||
    fields.some(
      (k) => typeof k !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(k)
    )
  ) {
    throw new TypeError('Invalid preview fields');
  }
  /** Maximum retained records for each explicitly selected application. */
  const max = options.maxRecordsPerApp ?? 100;
  /** Maximum serialized retained record bytes per application. */
  const bytes = options.maxBytesPerApp ?? 262144;
  /** Maximum record age based on the injected host clock. */
  const retention = options.retentionMs ?? 900000;
  /** Host clock used consistently for retention expiry; no per-request wall-clock source is introduced. */
  const now = options.now ?? Date.now;
  /** Borrowed framework error normalizer; private causes never enter retained records. */
  const normalize = options.normalizeApiError;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 1000 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1024 ||
    bytes > 1048576 ||
    !Number.isSafeInteger(retention) ||
    retention < 1 ||
    retention > 3600000 ||
    (normalize !== undefined && typeof normalize !== 'function')
  ) {
    throw new TypeError('Invalid diagnostics budgets');
  }
  /** Per-application bounded state fenced by the currently active generation identity. */
  const state = new Map<
    string,
    {
      /** Currently active application generation label. */
      generation: string;
      /** Retained normalized records belonging to this application entry. */
      records: DevtoolsRequestRecord[];
      /** Current serialized retained byte count for the application. */
      bytes: number;
      /** Number of records omitted or evicted by the configured caps. */
      dropped: number;
    }
  >();
  let closed = false;
  /** Drop expired records and recompute retained serialized bytes.
   * @param {{records: DevtoolsRequestRecord[], bytes: number}} entry - Mutable application retention state.
   * @param {DevtoolsRequestRecord[]} entry.records - Retained normalized application records.
   * @param {number} entry.bytes - Serialized retained byte counter recomputed after expiry.
   * @returns {void} Updates only this application entry, without provider calls or timers.
   */
  const prune = (entry: {
    /** Retained normalized records belonging to this application entry. */
    records: DevtoolsRequestRecord[];
    /** Current serialized retained byte count for the application. */
    bytes: number;
  }) => {
    /** Oldest retained timestamp permitted by the configured retention window. */
    const cutoff = now() - retention;
    entry.records = entry.records.filter((r) => r.startedAt >= cutoff);
    entry.bytes = entry.records.reduce(
      (n, r) => n + Buffer.byteLength(JSON.stringify(r)),
      0
    );
  };
  /** Scoped diagnostics owner; close clears records and invalidates further access. */
  const store = {
    /** Replace one allowed application generation and discard its older retained state.
     * @param {string} app - Explicit configured application identity.
     * @param {string} generation - Bounded active generation label.
     * @returns {void} Creates a fresh empty generation state; rejects closed/unregistered owners.
     */
    activate(app: string, generation: string) {
      label(generation);
      if (closed || !apps.has(app)) {
        throw new Error('Diagnostics app unavailable');
      }
      state.set(app, { generation, records: [], bytes: 0, dropped: 0 });
    },
    /** Retain a normalized span only for its active registered generation.
 * @param {Readonly<RequestSpan>} span - Immutable actual framework span; no caller-supplied identity override is accepted.
 * @param {{
        route?: string;
        headers?: Record<string, unknown>;
        body?: unknown;
        error?: unknown;
      }} preview - Optional already-approved primitive preview inputs; raw request streams are never read.
 * @param {string} [preview.route] - Approved route label, otherwise the fixed fallback.
 * @param {Record<string, unknown>} [preview.headers] - Own data fields considered for MIME/length only.
 * @param {unknown} [preview.body] - Explicit host-approved value, never read from a request stream.
 * @param {unknown} [preview.error] - Private error passed only to the borrowed normalizer.
 * @returns {boolean} Whether the bounded redacted record was retained; false for stale/closed/oversized input.
 */
    record(
      span: Readonly<RequestSpan>,
      preview: {
        /** Host-allowlisted route label or the fixed other fallback; raw URL/query data is excluded. */
        route?: string;
        /** Only validated content-type/content-length values; other headers are omitted. */
        headers?: Record<string, unknown>;
        /** Optional host-approved body value; getters and complex values are not invoked. */
        body?: unknown;
        /** Private host error input projected only through its configured normalizer. */
        error?: unknown;
      } = {}
    ) {
      if (closed) {
        return false;
      }
      /** Selected application generation state; stale generations never mutate a replacement. */
      const entry = state.get(span.applicationId);
      if (!entry || span.generationId !== entry.generation) {
        return false;
      }
      for (const id of [span.requestId, span.traceId, span.spanId]) {
        label(id);
      }
      if (
        !Number.isFinite(span.startedAt) ||
        span.startedAt < 0 ||
        !Number.isFinite(span.durationMs) ||
        span.durationMs < 0 ||
        span.durationMs > 3600000 ||
        !Number.isInteger(span.status) ||
        span.status < 100 ||
        span.status > 599 ||
        !['completed', 'disconnected', 'error'].includes(span.outcome)
      ) {
        throw new TypeError('Invalid framework request span');
      }
      /** Public MIME/length-only header projection; credentials and arbitrary header names are excluded. */
      const headers: Record<string, string> = {};
      for (const name of ['content-type', 'content-length']) {
        /** Own data-property descriptor checked without invoking an untrusted preview getter. */
        const d =
          preview.headers &&
          Object.getOwnPropertyDescriptor(preview.headers, name);
        if (!d || !('value' in d) || typeof d.value !== 'string') {
          continue;
        }
        if (name === 'content-type') {
          /** First MIME segment from a nonempty split result; parameters are intentionally discarded. */
          const mime = d.value.split(';')[0]!.toLowerCase();
          if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) && mime.length < 128) {
            headers[name] = mime;
          }
        } else if (/^\d{1,10}$/.test(d.value)) {
          headers[name] = d.value;
        }
      }
      /** Explicit approved primitive-field projection, separate from raw request body streams. */
      const bodyPreview: DevtoolsRequestRecord['bodyPreview'] = {};
      if (
        preview.body &&
        typeof preview.body === 'object' &&
        !Array.isArray(preview.body)
      ) {
        for (const key of fields) {
          if (sensitive.test(key)) {
            continue;
          }
          /** Own data-property descriptor checked without invoking an untrusted preview getter. */
          const d = Object.getOwnPropertyDescriptor(preview.body, key);
          if (!d || !('value' in d)) {
            continue;
          }
          /** Own primitive candidate accepted only after its field name and property descriptor pass policy. */
          const value = d.value;
          if (
            value === null ||
            typeof value === 'boolean' ||
            (typeof value === 'number' && Number.isFinite(value))
          ) {
            bodyPreview[key] = value;
          } else if (typeof value === 'string') {
            bodyPreview[key] = value.slice(0, 128);
          }
        }
      }
      let errorCode: string | undefined;
      if (preview.error !== undefined && normalize) {
        /** Borrowed framework error-normalization result; only its fixed public error code may survive. */
        const result = normalize(preview.error);
        /** Candidate normalized error code validated against the fixed uppercase label grammar. */
        const code = result.body.error.code;
        if (typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code)) {
          errorCode = code;
        }
      }
      /** Fresh normalized span projection excluding raw URLs, request bodies and private error causes. */
      const record: DevtoolsRequestRecord = {
        applicationId: span.applicationId,
        generationId: span.generationId,
        requestId: span.requestId,
        traceId: span.traceId,
        spanId: span.spanId,
        startedAt: span.startedAt,
        durationMs: span.durationMs,
        status: span.status,
        outcome: span.outcome,
        route: routes.has(preview.route ?? '') ? preview.route! : 'other',
        headers,
        bodyPreview,
        ...(errorCode ? { errorCode } : {}),
      };
      prune(entry);
      /** Exact serialized record byte cost checked before application retention mutation. */
      const size = Buffer.byteLength(JSON.stringify(record));
      if (size > bytes) {
        entry.dropped++;
        return false;
      }
      while (entry.records.length >= max || entry.bytes + size > bytes) {
        entry.bytes -= Buffer.byteLength(JSON.stringify(entry.records.shift()));
        entry.dropped++;
      }
      entry.records.push(record);
      entry.bytes += size;
      return true;
    },
    /** Read a detached retained-record view for the exact active application generation.
     * @param {string} app - Explicit configured application identity.
     * @param {string} generation - Exact generation identity expected by the caller.
     * @returns {DevtoolsRequestRecord[]} Deep JSON clone after expiry pruning, or empty for a stale/unavailable generation.
     */
    list(app: string, generation: string) {
      if (closed) {
        throw new Error('Diagnostics closed');
      }
      /** Selected application generation state; stale generations never mutate a replacement. */
      const entry = state.get(app);
      if (!entry || entry.generation !== generation) {
        return [];
      }
      prune(entry);
      return JSON.parse(
        JSON.stringify(entry.records)
      ) as DevtoolsRequestRecord[];
    },
    /** Activate a fresh generation and expose its borrowed framework tracing callbacks.
     * @param {string} app - Explicit configured application identity.
     * @param {string} generation - Generation identity pinned into this adapter.
     * @returns {TracingAdapter} Synchronous exporter whose shutdown cannot remove a replacement generation.
     */
    adapter(app: string, generation: string): TracingAdapter {
      store.activate(app, generation);
      return {
        /** Record a framework span only while its adapter identity and signal remain valid.
         * @param {Readonly<RequestSpan>} span - Framework-owned immutable completed span.
         * @param {AbortSignal} signal - Framework exporter cancellation signal.
         * @returns {void} Ignores cancelled or mismatched spans; retains no raw request data.
         */
        export(span, signal) {
          if (
            !signal.aborted &&
            span.applicationId === app &&
            span.generationId === generation
          ) {
            store.record(span);
          }
        },
        /** Remove only this adapter generation when it still owns the application slot.
         * @returns {void} Leaves any replacement generation and its records intact.
         */
        shutdown() {
          if (state.get(app)?.generation === generation) {
            state.delete(app);
          }
        },
      };
    },
    /** Create a trusted section callback that rechecks the selected application before rendering.
     * @param {string} app - Explicit configured application identity.
     * @param {string} generation - Expected active generation for the retained-record view.
     * @returns {DevtoolsSectionDefinition} Inert section definition; mounting authorization remains host-owned.
     */
    section(app: string, generation: string): DevtoolsSectionDefinition {
      return {
        id: 'requests',
        title: 'Requests',
        /** Render only the requested registered application diagnostic view.
         * @param {import("./module-registry.js").DevtoolsSectionContext} context - Trusted section host context; route-name mismatch rejects.
         * @returns {string} Escaped bounded diagnostics table for the selected generation.
         */
        render(context) {
          if (context.app.routeName !== app) {
            throw new Error('Diagnostics app denied');
          }
          return renderRequestDiagnostics(store.list(app, generation));
        },
      };
    },
    /** Read fixed-label application retention counters after expiry pruning.
     * @param {string} app - Explicit application identity; unknown applications return zero counters.
     * @returns {{records: number, bytes: number, dropped: number}} Counts only, without routes, headers or body previews.
     */
    status(app: string) {
      /** Selected application generation state; stale generations never mutate a replacement. */
      const entry = state.get(app);
      if (entry) {
        prune(entry);
      }
      return {
        records: entry?.records.length ?? 0,
        bytes: entry?.bytes ?? 0,
        dropped: entry?.dropped ?? 0,
      };
    },
    /** Invalidate this diagnostics owner and synchronously discard retained application records.
     * @returns {void} No external borrowed tracing or HTTP owner is closed.
     */
    close() {
      closed = true;
      state.clear();
    },
  };
  return store;
}
/** Serialize a bounded accessible diagnostic table with context-escaped preview text.
 * @param {readonly DevtoolsRequestRecord[]} records - Host-authorized retained records; the serializer does not grant access to them.
 * @returns {string} At most one thousand escaped table rows with fixed headings and expandable previews.
 */
export function renderRequestDiagnostics(
  records: readonly DevtoolsRequestRecord[]
): string {
  return (
    '<section aria-label="Request diagnostics"><table><caption>Retained request observations</caption><thead><tr><th scope="col">Generation</th><th scope="col">Route</th><th scope="col">Status</th><th scope="col">Duration (ms)</th><th scope="col">Preview</th></tr></thead><tbody>' +
    records
      .slice(0, 1000)
      .map(
        (r) =>
          '<tr><td>' +
          escapeHtml(r.generationId) +
          '</td><td>' +
          escapeHtml(r.route) +
          '</td><td>' +
          escapeHtml(String(r.status)) +
          '</td><td>' +
          escapeHtml(String(r.durationMs)) +
          '</td><td><details><summary>Redacted preview</summary><pre>' +
          escapeHtml(
            JSON.stringify({
              headers: r.headers,
              body: r.bodyPreview,
              errorCode: r.errorCode,
            })
          ) +
          '</pre></details></td></tr>'
      )
      .join('') +
    '</tbody></table></section>'
  );
}
