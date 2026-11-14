import { createHash, randomUUID } from 'node:crypto';

export interface PrivacyScope {
  /** Host-verified tenant identifier used in every job/store/participant boundary. */
  tenant: string;
  /** Host-verified opaque subject/account linkage; never inferred from email alone. */
  subject: string;
}
export type PrivacyOperation = 'export' | 'erase';
export interface PrivacyCoverage {
  /** Opaque job or explicit participant identity. */
  id: string;
  /** Pinned participant coverage/schema version. */
  version: number;
  /** Whether this participant can discover subject-linked records. */
  find: boolean;
  /** Whether this participant supports bounded subject export. */
  export: boolean;
  /** Whether this participant supports explicitly approved local erasure. */
  erase: boolean;
  /** Nonpersonal coverage/limitation codes, e.g. local-metadata, remote-provider, backups. */
  records: readonly string[];
  /** Explicit external/provider/backup limitations retained in partial coverage. */
  outside: readonly string[];
}
export interface PrivacyPage {
  /** Bounded scanned record count without payload evidence. */
  scanned: number;
  /** Bounded affected/exported local record count. */
  affected: number;
  /** Retained records protected by explicit host retention/hold policy. */
  held: number;
  /** Opaque forward-only participant cursor, or null at terminal page. */
  next: string | null;
  /** Whether the current discovery/page sequence has completed. */
  done: boolean;
  /** Explicit portable export records only; previews and erasure receipts never return payloads. */
  data?: readonly Record<string, unknown>[];
}
export interface PrivacyPageContext extends PrivacyScope {
  /** Opaque durable job identity bound to verified tenant/subject. */
  jobId: string;
  /** Explicit export or erase operation. */
  operation: PrivacyOperation;
  /** Stable participant/version/page identity for durable idempotent local receipt recovery. */
  pageKey: string;
  /** Opaque current participant cursor, separate for preview and execution. */
  cursor: string | null;
  /** Maximum records accepted for this participant page. */
  limit: number;
  /** Cooperative operation/download cancellation signal. */
  signal: AbortSignal;
  /** Absolute host-clock page deadline, never rollback evidence. */
  deadline: number;
}
export interface PrivacyParticipant {
  /** Pinned immutable participant capability/version/coverage metadata. */
  coverage: PrivacyCoverage;
  /** Read one bounded discovery page without deleting records or writing export bytes.
   * @param {PrivacyPageContext} context - Verified tenant/subject and separate preview cursor.
   * @returns {Promise<PrivacyPage>} Explicit host contract result; persistence and permission guarantees remain host-owned.
   */
  preview(context: PrivacyPageContext): Promise<PrivacyPage>;
  /** Execute only an approved local page with an atomic durable idempotent receipt; recheck holds and authorization at the participant boundary.
   * @param {PrivacyPageContext} context - Verified scope and stable page identity; journal receipt must commit with local effects.
   * @returns {Promise<PrivacyPage>} Explicit host contract result; persistence and permission guarantees remain host-owned.
   */
  execute(context: PrivacyPageContext): Promise<PrivacyPage>;
  /** Recover the existing durable page receipt without repeating uncertain effects.
   * @param {PrivacyPageContext} context - Same verified scope/page identity as the interrupted execution.
   * @returns {Promise<PrivacyPage | null>} Existing durable receipt or null when unresolved; never repeated effects.
   */
  recover(context: PrivacyPageContext): Promise<PrivacyPage | null>;
}
export interface PrivacyCheckpoint {
  /** Pinned immutable participant capability/version/coverage metadata. */
  coverage: PrivacyCoverage;
  /** Separate read-only discovery progress with no deletion or export bytes. */
  preview: {
    /** Opaque current participant cursor, separate for preview and execution. */
    cursor: string | null;
    /** Bounded completed page count used for stable receipt identities. */
    pages: number;
    /** Bounded scanned record count without payload evidence. */
    scanned: number;
    /** Retained records protected by explicit host retention/hold policy. */
    held: number;
    /** Whether the current discovery/page sequence has completed. */
    done: boolean;
  };
  /** Opaque current participant cursor, separate for preview and execution. */
  cursor: string | null;
  /** Bounded completed page count used for stable receipt identities. */
  pages: number;
  /** Bounded scanned record count without payload evidence. */
  scanned: number;
  /** Bounded affected/exported local record count. */
  affected: number;
  /** Retained records protected by explicit host retention/hold policy. */
  held: number;
  /** Explicit participant outcome including uncertain/partial/unsupported, never global atomic success. */
  state:
    | 'pending'
    | 'running'
    | 'uncertain'
    | 'failed'
    | 'complete'
    | 'partial'
    | 'unsupported';
  /** Fixed metadata-only unavailable/uncertain diagnostic code. */
  code?: 'UNAVAILABLE' | 'UNCERTAIN';
}
export interface PrivacyJob extends PrivacyScope {
  /** Durable coordinator job schema version 1. */
  schema: 1;
  /** Opaque job or explicit participant identity. */
  id: string;
  /** Unique nonreused linearizable CAS revision owned by the host journal. */
  revision: number;
  /** Explicit export or erase operation. */
  operation: PrivacyOperation;
  /** Declared host privacy/retention policy version pinned into the job. */
  policyVersion: string;
  /** Durable job creation time in Unix milliseconds. */
  createdAt: number;
  /** Absolute job/approval expiry under the host policy. */
  expiresAt: number;
  /** Independent private export access expiry, capped by job expiry. */
  exportExpiresAt: number;
  /** Durable aggregate portable export byte count. */
  exportBytes: number;
  /** Explicit preview/approval/approved/running/terminal job phase. */
  phase:
    | 'preview'
    | 'approval'
    | 'approved'
    | 'running'
    | 'complete'
    | 'partial';
  /** Explicit participant checkpoints with honest coverage/outcome metadata. */
  participants: PrivacyCheckpoint[];
  /** Expiring authorized evidence bound to the exact preview plan hash. */
  approval?: {
    /** Opaque host approval evidence reference, never a raw secret or subject payload. */
    evidence: string;
    /** Verified authorized operator reference under the host audit policy. */
    actor: string;
    /** Host-clock approval evidence time. */
    at: number;
    /** Absolute job/approval expiry under the host policy. */
    expiresAt: number;
    /** Metadata-only scope/policy/preview identity approved by the host. */
    planHash: string;
  };
}
export interface PrivacyJobStore {
  /** Required privacy-jobs-cas-v1 host persistence contract. */
  contract: 'privacy-jobs-cas-v1';
  /** Required durable journal declaration; no memory fallback is provided. */
  durability: 'durable';
  /** Read tenant-keyed current durable state; callers separately validate schema and current operation authorization.
   * @param {string} tenant - Verified tenant namespace.
   * @param {string} id - Opaque job ID.
   * @param {AbortSignal} signal - Current operation cancellation signal.
   * @returns {Promise<PrivacyJob | null>} Explicit host contract result; persistence and permission guarantees remain host-owned.
   */
  get(
    tenant: string,
    id: string,
    signal: AbortSignal
  ): Promise<PrivacyJob | null>;
  /** Atomically create or compare-and-set one job revision and retain metadata-only revision evidence under host holds/retention policy.
   * @param {number | null} expectedRevision - Current revision, or null for create-only reservation.
   * @param {Readonly<PrivacyJob>} next - Detached immutable next durable job metadata.
   * @param {AbortSignal} signal - Current operation cancellation signal.
   * @returns {Promise<boolean>} Explicit host contract result; persistence and permission guarantees remain host-owned.
   */
  cas(
    expectedRevision: number | null,
    next: Readonly<PrivacyJob>,
    signal: AbortSignal
  ): Promise<boolean>;
}
export interface PrivacyExportStore {
  /** Persist a private immutable page idempotently; same identity with different bytes must reject.
   * @param {PrivacyPageContext} context - Verified tenant/subject/job/page context.
   * @param {Uint8Array} bytes - Bounded approved portable JSONL bytes.
   * @param {number} expiresAt - Absolute private access expiry independently enforced by this store.
   * @returns {Promise<void>} Explicit host contract result; persistence and permission guarantees remain host-owned.
   */
  putPage(
    context: PrivacyPageContext,
    bytes: Uint8Array,
    expiresAt: number
  ): Promise<void>;
  /** Stream only ordered completed-job private pages with independent tenant/job/expiry enforcement.
   * @param {Readonly<PrivacyJob>} job - Immutable validated completed/partial export job.
   * @param {AbortSignal} signal - Consumer/coordinator cancellation signal.
   * @returns {AsyncIterable<Uint8Array>} Explicit host contract result; persistence and permission guarantees remain host-owned.
   */
  read(
    job: Readonly<PrivacyJob>,
    signal: AbortSignal
  ): AsyncIterable<Uint8Array>;
}
export interface PrivacyApproval {
  /** Opaque host approval evidence reference, never a raw secret or subject payload. */
  evidence: string;
  /** Verified authorized operator reference under the host audit policy. */
  actor: string;
  /** Absolute job/approval expiry under the host policy. */
  expiresAt: number;
}
export interface PrivacyCoordinatorOptions {
  /** Declared host privacy/retention policy version pinned into the job. */
  policyVersion: string;
  /** Borrowed host durable linearizable job/checkpoint journal. */
  store: PrivacyJobStore;
  /** Explicit participant checkpoints with honest coverage/outcome metadata. */
  participants: readonly PrivacyParticipant[];
  /** Optional borrowed private immutable page store with independent tenant/job expiry enforcement. */
  exports?: PrivacyExportStore;
  /** Verify subject/account linkage from trusted proof; never infer identity from a caller email alone.
   * @param {unknown} principal - Fresh initiating host authority.
   * @param {unknown} proof - Host-verifiable subject/account linkage evidence.
   * @param {AbortSignal} signal - Operation cancellation signal.
   * @returns {Promise<PrivacyScope | null>} Explicit host contract result; persistence and permission guarantees remain host-owned.
   */
  resolveSubject(
    principal: unknown,
    proof: unknown,
    signal: AbortSignal
  ): Promise<PrivacyScope | null>;
  /** Freshly authorize each exact operation under verified tenant/subject binding.
   * @param {| 'create' | 'inspect' | 'preview' | 'approve' | 'resume' | 'download'} action - Explicit coordinator operation name.
   * @param {Readonly<PrivacyScope>} scope - Immutable verified subject scope.
   * @param {unknown} principal - Fresh initiating host authority.
   * @param {AbortSignal} signal - Operation cancellation signal.
   * @returns {Promise<boolean>} Explicit host contract result; persistence and permission guarantees remain host-owned.
   */
  authorize(
    action:
      | 'create'
      | 'inspect'
      | 'preview'
      | 'approve'
      | 'resume'
      | 'download',
    scope: Readonly<PrivacyScope>,
    principal: unknown,
    signal: AbortSignal
  ): Promise<boolean>;
  /** Validate expiring operator approval evidence against the exact completed preview plan.
   * @param {Readonly<PrivacyJob>} job - Immutable validated preview job.
   * @param {string} planHash - Metadata-only tenant/subject/policy/coverage plan identity.
   * @param {unknown} evidence - Host-verifiable approval evidence.
   * @param {unknown} principal - Fresh initiating authorized operator.
   * @param {AbortSignal} signal - Operation cancellation signal.
   * @returns {Promise<PrivacyApproval | null>} Explicit host contract result; persistence and permission guarantees remain host-owned.
   */
  approve(
    job: Readonly<PrivacyJob>,
    planHash: string,
    evidence: unknown,
    principal: unknown,
    signal: AbortSignal
  ): Promise<PrivacyApproval | null>;
  /** Project only host-approved portable subject fields before bounded secret-defense validation.
   * @param {Readonly<Record<string, unknown>>} record - Detached immutable participant export record.
   * @param {PrivacyPageContext} context - Verified scope/page context; never a public URL.
   * @returns {Record<string, unknown>} Explicit host contract result; persistence and permission guarantees remain host-owned.
   */
  projectExport(
    record: Readonly<Record<string, unknown>>,
    context: PrivacyPageContext
  ): Record<string, unknown>;
  /** Optional deterministic host clock. */
  now?: () => number;
  /** Maximum participant records per bounded call. */
  pageSize?: number;
  /** Maximum participant preview/execution pages. */
  maxPages?: number;
  /** Maximum actual unsettled operations/downloads. */
  maxPending?: number;
  /** Cooperative per-operation wait budget; ignored cancellation retains capacity. */
  timeoutMs?: number;
  /** Maximum job lifetime, capped at seven days. */
  jobTtlMs?: number;
  /** Private export lifetime bounded by job expiry. */
  exportTtlMs?: number;
  /** Maximum private portable export bytes across all pages. */
  maxExportBytes?: number;
}
/** Classified coordinator failure retaining private causes without deleted/exported payloads in messages. */
export class PrivacyError extends Error {
  /** Classify privacy operation failures while retaining private internal causes outside public receipts.
   * @param {string} code - Fixed privacy diagnostic classification.
   * @param {unknown} cause - Optional private participant/journal failure.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`Privacy operation failed (${code})`);
    this.name = 'PrivacyError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Classify a privacy failure without embedding subject payloads in its message.
 * @param {string} code - Fixed private operation classification.
 * @param {unknown} cause - Optional private participant/store cause.
 * @returns {PrivacyError} Classified failure with its private cause retained.
 */
const fail = (code: string, cause?: unknown) => new PrivacyError(code, cause);
/** Validate opaque bounded references rather than accepting emails or arbitrary path/query text.
 * @param {unknown} v - Candidate opaque identifier.
 * @param {number} max - Internal maximum token length.
 * @returns {boolean} Whether the bounded token grammar matches.
 */
const token = (v: unknown, max = 128): v is string =>
  typeof v === 'string' && new RegExp('^[A-Za-z0-9_-]{1,' + max + '}$').test(v);
/** Validate an explicit safe integer budget or persisted counter without coercion.
 * @param {unknown} v - Candidate numeric value.
 * @param {number} min - Minimum accepted value.
 * @param {number} max - Maximum accepted value.
 * @returns {number} Validated integer.
 */
const integer = (v: unknown, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    throw fail('INVALID_INPUT');
  }
  return v;
};
/** Hash an explicit metadata-only plan/page identity; hashing is not anonymization or authorization.
 * @param {unknown} v - Internal validated identity/coverage tuple.
 * @returns {string} SHA-256 hexadecimal identity.
 */
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Detach a trusted validated record before callbacks or mutation.
 * @param {T} v - Structured-clone-compatible record.
 * @returns {T} Independent record clone.
 */
const clone = <T>(v: T): T => structuredClone(v);
/** Reject unexpected persisted job/checkpoint fields before trusting a durable record.
 * @param {object} value - Persisted record candidate.
 * @param {readonly string[]} allowed - Exact supported own-key names.
 * @returns {void} Record shape validation completion.
 */
function keys(value: object, allowed: readonly string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  ) {
    throw fail('CORRUPT_JOB');
  }
}
/** Recursively freeze detached validated metadata before passing it to host callbacks.
 * @param {T} v - Detached metadata record.
 * @returns {T} Immutable record projection.
 */
const freeze = <T>(v: T): T => {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
/** Validate opaque host-verified tenant/subject linkage without inferring identity from personal contact data.
 * @param {PrivacyScope} v - Private host-linked scope candidate.
 * @returns {PrivacyScope} Detached verified-shape tenant/subject projection.
 */
function scope(v: PrivacyScope) {
  if (!v || !token(v.tenant) || !token(v.subject)) {
    throw fail('INVALID_SCOPE');
  }
  return { tenant: v.tenant, subject: v.subject };
}
/** Validate and freeze nonpersonal participant capability/version/coverage metadata.
 * @param {PrivacyCoverage} v - Explicit host participant coverage descriptor.
 * @returns {PrivacyCoverage} Immutable coverage metadata; inaccessible providers/backups remain outside scope.
 */
function coverage(v: PrivacyCoverage): PrivacyCoverage {
  if (
    !v ||
    !token(v.id, 64) ||
    typeof v.find !== 'boolean' ||
    typeof v.export !== 'boolean' ||
    typeof v.erase !== 'boolean'
  ) {
    throw fail('INVALID_PARTICIPANT');
  }
  integer(v.version, 1, 10000);
  for (const list of [v.records, v.outside]) {
    if (
      !Array.isArray(list) ||
      list.length > 32 ||
      list.some((x) => !token(x, 64))
    ) {
      throw fail('INVALID_COVERAGE');
    }
  }
  return freeze({
    id: v.id,
    version: v.version,
    find: v.find,
    export: v.export,
    erase: v.erase,
    records: [...v.records],
    outside: [...v.outside],
  });
}
/** Validate bounded portable subject-export JSON after explicit host projection, with additional secret-key rejection.
 * @param {unknown} value - Host-approved subject record projection, never a raw service payload by default.
 * @returns {string} Inert bounded JSON record; this does not automatically anonymize identifiers.
 */
function exportJson(value: unknown): string {
  let count = 0;
  /** Rebuild bounded subject-export JSON without executing own property accessors.
   * @param {unknown} v - Host-projected export subtree.
   * @param {number} depth - Current bounded nesting depth.
   * @returns {unknown} Validated inert export JSON.
   */
  const visit = (v: unknown, depth: number): unknown => {
    if (++count > 4096 || depth > 8) {
      throw fail('EXPORT_COMPLEXITY');
    }
    if (
      v === null ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ) {
      return v;
    }
    if (typeof v === 'string') {
      if (Buffer.byteLength(v) > 8192) {
        throw fail('EXPORT_SIZE');
      }
      return v;
    }
    if (Array.isArray(v)) {
      if (v.length > 100) {
        throw fail('EXPORT_SIZE');
      }
      return v.map((x) => visit(x, depth + 1));
    }
    if (
      !v ||
      typeof v !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    ) {
      throw fail('INVALID_EXPORT');
    }
    /** Null-prototype portable export object containing only approved inert projected fields. */
    const out: Record<string, unknown> = Object.create(null);
    if (Object.keys(v).length > 64) {
      throw fail('EXPORT_SIZE');
    }
    for (const key of Object.keys(v)) {
      if (
        /password|secret|token|cookie|authorization|credential|signed.?url|private.?key/i.test(
          key
        )
      ) {
        throw fail('SECRET_EXPORT');
      }
      /** Own export property descriptor; getters reject instead of executing. */
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (!('value' in d)) {
        throw fail('INVALID_EXPORT');
      }
      out[key] = visit(d.value, depth + 1);
    }
    return out;
  };
  return JSON.stringify(visit(value, 0));
}
/** Escape spreadsheet formula prefixes and CSV quotes for explicit host CSV renderers; coordinator downloads remain private JSONL.
 * @param {string | number | boolean | null} value - One approved scalar cell value.
 * @returns {string} Quoted formula-guarded cell.
 */
export function privacyCsvCell(
  value: string | number | boolean | null
): string {
  let s = String(value ?? '');
  // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) {
    s = "'" + s;
  }
  return '"' + s.replace(/"/g, '""') + '"';
}

/** Create explicit host-authorized durable privacy orchestration; no participant effects run at construction or preview.
 * @param {PrivacyCoordinatorOptions} options - Host identity/auth/approval/projection policy, durable journal and explicit participants.
 * @returns {object} Owned coordinator; close drains accepted work while stores/participants stay borrowed.
 */
export function createPrivacyCoordinator(options: PrivacyCoordinatorOptions) {
  if (
    !token(options.policyVersion, 64) ||
    options.store?.contract !== 'privacy-jobs-cas-v1' ||
    options.store.durability !== 'durable' ||
    typeof options.store.get !== 'function' ||
    typeof options.store.cas !== 'function' ||
    ['resolveSubject', 'authorize', 'approve', 'projectExport'].some(
      (k) => typeof (options as any)[k] !== 'function'
    ) ||
    !Array.isArray(options.participants) ||
    !options.participants.length ||
    options.participants.length > 16
  ) {
    throw fail('INVALID_CONFIGURATION');
  }
  /** Borrowed host-owned durable CAS job journal; coordinator close does not close it. */
  const store = options.store;
  /** Explicit host clock or Date.now used consistently for approval/export expiry. */
  const clock = options.now ?? Date.now;
  /** Declared host policy version pinned into every durable job. */
  const policy = options.policyVersion;
  /** Validated participant scan/write page ceiling. */
  const pageSize = integer(options.pageSize ?? 50, 1, 100);
  /** Validated per-participant page ceiling. */
  const maxPages = integer(options.maxPages ?? 1000, 1, 10000);
  /** Maximum actual unsettled coordinator operations/downloads. */
  const maxPending = integer(options.maxPending ?? 4, 1, 16);
  /** Cooperative operation deadline; expiry never proves rollback. */
  const timeout = integer(options.timeoutMs ?? 5000, 1, 60000);
  /** Maximum durable job lifetime under the host retention policy. */
  const ttl = integer(options.jobTtlMs ?? 86400000, 1000, 7 * 86400000);
  /** Maximum private export access lifetime, bounded by job expiry. */
  const exportTtl = integer(options.exportTtlMs ?? 3600000, 1, 86400000);
  /** Maximum portable export bytes for this coordinator. */
  const maxBytes = integer(options.maxExportBytes ?? 10485760, 1, 104857600);
  if (
    options.exports &&
    (typeof options.exports.putPage !== 'function' ||
      typeof options.exports.read !== 'function')
  ) {
    throw fail('INVALID_EXPORT_STORE');
  }
  /** Explicit captured participant IDs and immutable capability/coverage versions. */
  const participants = new Map(
    options.participants.map((p) => {
      /** Operation-owned cancellation controller or validated captured participant coverage. */
      const c = coverage(p.coverage);
      if (
        ['preview', 'execute', 'recover'].some(
          (k) => typeof (p as any)[k] !== 'function'
        )
      ) {
        throw fail('INVALID_PARTICIPANT');
      }
      return [c.id, { adapter: p, coverage: c }] as const;
    })
  );
  if (participants.size !== options.participants.length) {
    throw fail('DUPLICATE_PARTICIPANT');
  }
  let closed = false;
  /** Actual operation/download settlements retained for capacity and shutdown drain. */
  const pending = new Set<Promise<unknown>>();
  /** Owned cooperative cancellation controllers for accepted operations/downloads. */
  const controllers = new Set<AbortController>();
  let closing: Promise<void> | undefined;
  /** Admit one bounded operation and retain capacity until actual callback/store settlement.
   * @param {Function} callback - Trusted signal/deadline-aware operation callback.
   * @param {AbortSignal | undefined} signal - Optional initiating caller cancellation.
   * @returns {Promise<T>} Actual operation result or classified failure; ambiguous effects are not retried.
   */
  const run = <T>(
    callback: (signal: AbortSignal, deadline: number) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> => {
    if (closed) {
      return Promise.reject(fail('CLOSED'));
    }
    if (pending.size >= maxPending) {
      return Promise.reject(fail('OVERLOAD'));
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      return Promise.reject(fail('INVALID_SIGNAL'));
    }
    /** Operation-owned cancellation controller or validated captured participant coverage. */
    const c = new AbortController();
    /** Propagate caller/timeout/shutdown cancellation without pretending durable work rolled back.
     * @returns {void} Cooperative cancellation notification completion.
     */
    const abort = () => c.abort();
    controllers.add(c);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
    /** Owned operation/download deadline timer removed after actual settlement. */
    const timer = setTimeout(abort, timeout);
    /** Absolute host-clock operation deadline supplied to participant/store work. */
    const deadline = clock() + timeout;
    // Keep slots through actual settlement; a timeout never proves rollback.
    /** Actual operation promise retained despite ignored cancellation. */
    const task = Promise.resolve()
      .then(() => {
        c.signal.throwIfAborted();
        return callback(c.signal, deadline);
      })
      .catch((e) => {
        throw e instanceof PrivacyError
          ? e
          : fail(c.signal.aborted ? 'CANCELLED' : 'UNAVAILABLE', e);
      })
      .finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        controllers.delete(c);
        pending.delete(task);
      });
    pending.add(task);
    return task;
  };
  /** Recheck current host authorization for the exact tenant/subject/action before continuation.
   * @param {string} action - Explicit coordinator operation name.
   * @param {PrivacyScope} s - Verified tenant/subject scope.
   * @param {unknown} principal - Fresh host-verified initiating authority.
   * @param {AbortSignal} signal - Current operation cancellation signal.
   * @returns {Promise<void>} Authorization completion; only true admits work.
   */
  const allowed = async (
    action: Parameters<PrivacyCoordinatorOptions['authorize']>[0],
    s: PrivacyScope,
    principal: unknown,
    signal: AbortSignal
  ) => {
    signal.throwIfAborted();
    if (
      (await options.authorize(action, freeze(scope(s)), principal, signal)) !==
      true
    ) {
      throw fail('DENIED');
    }
    signal.throwIfAborted();
  };
  /** Read and validate tenant-bound persisted state and apply fresh operation authorization before returning it.
   * @param {{ tenant: string; id: string }} reference - Explicit tenant/job reference checked against the durable record.
   * @param {string} reference.tenant - Verified host tenant namespace.
   * @param {string} reference.id - Opaque durable job ID.
   * @param {unknown} principal - Fresh initiating host authority.
   * @param {Parameters<PrivacyCoordinatorOptions['authorize']>[0]} action - Exact requested coordinator operation.
   * @param {AbortSignal} signal - Current operation cancellation signal.
   * @returns {Promise<PrivacyJob | null>} Validated authorized job; internal missing/corrupt/expired records reject.
   */
  async function get(
    reference: {
      /** Host-verified tenant identifier used in every job/store/participant boundary. */
      tenant: string; /** Opaque job or explicit participant identity. */
      id: string;
    },
    principal: unknown,
    action: Parameters<PrivacyCoordinatorOptions['authorize']>[0],
    signal: AbortSignal
  ) {
    if (!reference || !token(reference.tenant) || !token(reference.id, 64)) {
      throw fail('INVALID_REFERENCE');
    }
    /** Borrowed durable job or participant receipt, validated before checkpoint mutation. */
    const raw = await store.get(reference.tenant, reference.id, signal);
    if (!raw) {
      throw fail('NOT_FOUND');
    }
    /** Detached validated durable job; never shared mutable store state. */
    const j = clone(raw);
    keys(j, [
      'schema',
      'id',
      'revision',
      'tenant',
      'subject',
      'operation',
      'policyVersion',
      'createdAt',
      'expiresAt',
      'exportExpiresAt',
      'exportBytes',
      'phase',
      'participants',
      'approval',
    ]);
    if (Buffer.byteLength(JSON.stringify(j)) > 65536) {
      throw fail('CORRUPT_JOB');
    }
    if (
      j.schema !== 1 ||
      j.tenant !== reference.tenant ||
      j.id !== reference.id ||
      j.policyVersion !== policy ||
      !['erase', 'export'].includes(j.operation) ||
      ![
        'preview',
        'approval',
        'approved',
        'running',
        'complete',
        'partial',
      ].includes(j.phase) ||
      !Array.isArray(j.participants) ||
      j.participants.length !== participants.size
    ) {
      throw fail('CORRUPT_JOB');
    }
    scope(j);
    integer(j.revision, 1, Number.MAX_SAFE_INTEGER - 1);
    integer(j.exportBytes, 0, maxBytes);
    integer(j.createdAt, 0, 8e15);
    integer(j.expiresAt, j.createdAt + 1, j.createdAt + 7 * 86400000);
    integer(j.exportExpiresAt, j.createdAt + 1, j.expiresAt);
    if (j.approval) {
      keys(j.approval, ['actor', 'evidence', 'at', 'expiresAt', 'planHash']);
      if (
        !token(j.approval.actor) ||
        !token(j.approval.evidence) ||
        !/^[a-f0-9]{64}$/.test(j.approval.planHash)
      ) {
        throw fail('CORRUPT_JOB');
      }
      integer(j.approval.at, j.createdAt, j.expiresAt);
      integer(j.approval.expiresAt, j.approval.at + 1, j.expiresAt);
    }
    if (j.expiresAt <= clock()) {
      throw fail('EXPIRED');
    }
    /** Seen persisted participant IDs used to reject duplicate/replaced coverage. */
    const seen = new Set<string>();
    for (const cp of j.participants) {
      keys(cp, [
        'coverage',
        'preview',
        'cursor',
        'pages',
        'scanned',
        'affected',
        'held',
        'state',
        'code',
      ]);
      keys(cp.preview, ['cursor', 'pages', 'scanned', 'held', 'done']);
      if (
        cp.code !== undefined &&
        !['UNAVAILABLE', 'UNCERTAIN'].includes(cp.code)
      ) {
        throw fail('CORRUPT_JOB');
      }
      cp.coverage = coverage(cp.coverage);
      /** Explicit registered participant matching the job’s pinned coverage version. */
      const p = participants.get(cp.coverage.id);
      if (
        !p ||
        seen.has(p.coverage.id) ||
        digest(coverage(cp.coverage)) !== digest(p.coverage)
      ) {
        throw fail('PARTICIPANT_CHANGED');
      }
      seen.add(p.coverage.id);
      for (const n of [cp.pages, cp.preview.pages]) {
        integer(n, 0, maxPages);
      }
      for (const n of [
        cp.scanned,
        cp.affected,
        cp.held,
        cp.preview.scanned,
        cp.preview.held,
      ]) {
        integer(n, 0, maxPages * pageSize);
      }
      for (const cur of [cp.cursor, cp.preview.cursor]) {
        if (cur !== null && !token(cur, 256)) {
          throw fail('CORRUPT_CURSOR');
        }
      }
      if (
        ![
          'pending',
          'running',
          'uncertain',
          'failed',
          'complete',
          'partial',
          'unsupported',
        ].includes(cp.state) ||
        typeof cp.preview.done !== 'boolean'
      ) {
        throw fail('CORRUPT_JOB');
      }
    }
    await allowed(action, j, principal, signal);
    return j;
  }
  /** Commit one metadata-only next revision through the host linearizable CAS journal.
   * @param {PrivacyJob} job - Detached current revision and checkpoint metadata.
   * @param {AbortSignal} signal - Current operation cancellation signal.
   * @returns {Promise<PrivacyJob>} Next durable revision or explicit conflict.
   */
  const save = async (job: PrivacyJob, signal: AbortSignal) => {
    /** Detached next revision submitted to the durable compare-and-set owner. */
    const next = { ...job, revision: job.revision + 1 };
    if (!(await store.cas(job.revision, freeze(clone(next)), signal))) {
      throw fail('CONFLICT');
    }
    return next;
  };
  /** Bind approval to the verified job/scope/policy and complete preview coverage.
   * @param {PrivacyJob} j - Validated durable preview job.
   * @returns {string} Metadata-only approval plan hash, not a legal compliance assertion.
   */
  const plan = (j: PrivacyJob) =>
    digest([
      j.id,
      j.tenant,
      j.subject,
      j.operation,
      j.policyVersion,
      j.participants.map((p) => ({ coverage: p.coverage, preview: p.preview })),
    ]);
  /** Validate one bounded participant receipt and require forward-only cursor progress without preview payloads.
   * @param {PrivacyPage} raw - Participant receipt candidate.
   * @param {string | null} cursor - Prior durable cursor, or null at the beginning.
   * @param {boolean} isPreview - Whether payload-bearing discovery results must reject.
   * @returns {PrivacyPage} Validated receipt; actual participant effects remain participant-owned.
   */
  function page(raw: PrivacyPage, cursor: string | null, isPreview: boolean) {
    if (
      !raw ||
      typeof raw.done !== 'boolean' ||
      (raw.next !== null && !token(raw.next, 256))
    ) {
      throw fail('INVALID_PAGE');
    }
    for (const n of [raw.scanned, raw.affected, raw.held]) {
      integer(n, 0, pageSize);
    }
    if (
      raw.affected + raw.held > raw.scanned ||
      (raw.done && raw.next !== null) ||
      (!raw.done && (!raw.next || raw.next === cursor))
    ) {
      throw fail('INVALID_PAGE');
    }
    if (isPreview && raw.data !== undefined) {
      throw fail('PREVIEW_PAYLOAD');
    }
    if (
      raw.data !== undefined &&
      (!Array.isArray(raw.data) || raw.data.length > pageSize)
    ) {
      throw fail('INVALID_PAGE');
    }
    return raw;
  }
  /** Create immutable tenant/subject/page-key context for one explicit participant page.
   * @param {PrivacyJob} j - Validated durable job.
   * @param {PrivacyCheckpoint} cp - Selected participant checkpoint.
   * @param {AbortSignal} signal - Current operation signal.
   * @param {number} deadline - Absolute operation deadline.
   * @param {boolean} preview - Whether to use the separate read-only discovery cursor.
   * @returns {PrivacyPageContext} Immutable participant scope and stable idempotent page identity.
   */
  const context = (
    j: PrivacyJob,
    cp: PrivacyCheckpoint,
    signal: AbortSignal,
    deadline: number,
    preview = false
  ): PrivacyPageContext =>
    Object.freeze({
      tenant: j.tenant,
      subject: j.subject,
      jobId: j.id,
      operation: j.operation,
      pageKey: digest([j.id, cp.coverage.id, cp.coverage.version, cp.pages]),
      cursor: preview ? cp.preview.cursor : cp.cursor,
      limit: pageSize,
      signal,
      deadline,
    });
  /** Mark only fully terminal participant checkpoints complete/partial, preserving holds and explicit external coverage gaps.
   * @param {PrivacyJob} j - Detached current durable job.
   * @returns {void} Terminal phase update without deleting participant records.
   */
  function finish(j: PrivacyJob) {
    if (
      j.participants.every((p) =>
        ['complete', 'partial', 'unsupported'].includes(p.state)
      )
    ) {
      j.phase = j.participants.some(
        (p) => p.state !== 'complete' || p.coverage.outside.length
      )
        ? 'partial'
        : 'complete';
    }
  }
  return {
    /** Create a durable preview-only job after verified identity linkage and fresh create authorization.
     * @param {PrivacyOperation} operation - Explicit export or erase operation.
     * @param {unknown} proof - Host-verifiable account linkage proof.
     * @param {unknown} principal - Fresh initiating host authority.
     * @param {{ signal?: AbortSignal }} execution - Optional caller cancellation owner.
     * @param {AbortSignal} execution.signal - Optional caller cancellation signal.
     * @returns {Promise<PrivacyJob>} Authorized bounded operation result; errors preserve honest partial/uncertain state.
     */
    create(
      operation: PrivacyOperation,
      proof: unknown,
      principal: unknown,
      execution: {
        /** Cooperative operation/download cancellation signal. */
        signal?: AbortSignal;
      } = {}
    ) {
      return run(async (signal) => {
        if (
          !['export', 'erase'].includes(operation) ||
          (operation === 'export' && !options.exports)
        ) {
          throw fail('UNSUPPORTED');
        }
        /** Host-resolved subject/account linkage; an email string alone never establishes identity. */
        const verified = await options.resolveSubject(principal, proof, signal);
        if (!verified) {
          throw fail('IDENTITY');
        }
        /** Validated tenant/subject projection used for fresh create authorization. */
        const s = scope(verified);
        await allowed('create', s, principal, signal);
        /** Host-clock durable job creation time. */
        const at = clock();
        /** Initial durable preview-only job; no participant effects have run. */
        const job: PrivacyJob = {
          schema: 1,
          id: randomUUID().replace(/-/g, ''),
          revision: 1,
          ...s,
          operation,
          policyVersion: policy,
          createdAt: at,
          expiresAt: at + ttl,
          exportExpiresAt: Math.min(at + ttl, at + exportTtl),
          exportBytes: 0,
          phase: 'preview',
          participants: [...participants.values()].map((p) => ({
            coverage: clone(p.coverage),
            preview: {
              cursor: null,
              pages: 0,
              scanned: 0,
              held: 0,
              done: !p.coverage.find,
            },
            cursor: null,
            pages: 0,
            scanned: 0,
            affected: 0,
            held: 0,
            state:
              p.coverage.find && p.coverage[operation]
                ? 'pending'
                : 'unsupported',
          })),
        };
        if (!(await store.cas(null, freeze(clone(job)), signal))) {
          throw fail('CONFLICT');
        }
        return clone(job);
      }, execution.signal);
    },
    /** Read a validated authorized durable checkpoint without participant effects.
     * @param {{ tenant: string; id: string }} reference - Explicit tenant/job identity.
     * @param {string} reference.tenant - Host-verified tenant namespace.
     * @param {string} reference.id - Opaque durable job ID.
     * @param {unknown} principal - Fresh initiating authority rechecked for inspect.
     * @param {{ signal?: AbortSignal }} execution - Optional caller cancellation owner.
     * @param {AbortSignal} execution.signal - Optional caller cancellation signal.
     * @returns {Promise<PrivacyJob>} Authorized bounded operation result; errors preserve honest partial/uncertain state.
     */
    inspect(
      reference: {
        /** Host-verified tenant identifier used in every job/store/participant boundary. */
        tenant: string; /** Opaque job or explicit participant identity. */
        id: string;
      },
      principal: unknown,
      execution: {
        /** Cooperative operation/download cancellation signal. */
        signal?: AbortSignal;
      } = {}
    ) {
      return run(
        async (signal) =>
          clone(await get(reference, principal, 'inspect', signal)),
        execution.signal
      );
    },
    /** Inspect at most one participant discovery page; never invoke execute or write export payloads.
     * @param {{ tenant: string; id: string }} reference - Explicit tenant/job identity.
     * @param {string} reference.tenant - Host-verified tenant namespace.
     * @param {string} reference.id - Opaque durable job ID.
     * @param {unknown} principal - Fresh initiating authority rechecked for preview.
     * @param {{ signal?: AbortSignal }} execution - Optional caller cancellation owner.
     * @param {AbortSignal} execution.signal - Optional caller cancellation signal.
     * @returns {Promise<PrivacyJob>} Authorized bounded operation result; errors preserve honest partial/uncertain state.
     */
    preview(
      reference: {
        /** Host-verified tenant identifier used in every job/store/participant boundary. */
        tenant: string; /** Opaque job or explicit participant identity. */
        id: string;
      },
      principal: unknown,
      execution: {
        /** Cooperative operation/download cancellation signal. */
        signal?: AbortSignal;
      } = {}
    ) {
      return run(async (signal, deadline) => {
        /** Detached validated durable job; never shared mutable store state. */
        const j = await get(reference, principal, 'preview', signal);
        if (j.phase !== 'preview') {
          return j;
        }
        /** Selected detached participant checkpoint; array position remains guarded before indexed use. */
        const cp = j.participants.find((p) => !p.preview.done);
        if (cp) {
          if (cp.preview.pages >= maxPages) {
            throw fail('PAGE_LIMIT');
          }
          /** Explicit registered participant matching the job’s pinned coverage version. */
          const p = participants.get(cp.coverage.id)!;
          try {
            /** Validated participant page receipt used only after fresh scope/deadline checks. */
            const result = page(
              await p.adapter.preview(context(j, cp, signal, deadline, true)),
              cp.preview.cursor,
              true
            );
            signal.throwIfAborted();
            cp.preview = {
              cursor: result.next,
              pages: cp.preview.pages + 1,
              scanned: cp.preview.scanned + result.scanned,
              held: cp.preview.held + result.held,
              done: result.done,
            };
            if (cp.state === 'failed') {
              cp.state = cp.coverage[j.operation] ? 'pending' : 'unsupported';
            }
            delete cp.code;
          } catch (error) {
            cp.state = 'failed';
            cp.code = 'UNAVAILABLE';
            try {
              await save(j, signal);
            } catch {
              /* Preserve the original participant failure when checkpoint persistence also fails. */
            }
            throw error instanceof PrivacyError
              ? error
              : fail(
                  signal.aborted ? 'CANCELLED' : 'PREVIEW_UNAVAILABLE',
                  error
                );
          }
        }
        if (j.participants.every((p) => p.preview.done)) {
          j.phase = 'approval';
        }
        return save(j, signal);
      }, execution.signal);
    },
    /** Bind verified expiring approval to the complete current preview before enabling execution.
     * @param {{ tenant: string; id: string }} reference - Explicit tenant/job identity.
     * @param {string} reference.tenant - Host-verified tenant namespace.
     * @param {string} reference.id - Opaque durable job ID.
     * @param {unknown} evidence - Host-verifiable operator approval evidence.
     * @param {unknown} principal - Fresh authorized approving operator.
     * @param {{ signal?: AbortSignal }} execution - Optional caller cancellation owner.
     * @param {AbortSignal} execution.signal - Optional caller cancellation signal.
     * @returns {Promise<PrivacyJob>} Authorized bounded operation result; errors preserve honest partial/uncertain state.
     */
    approve(
      reference: {
        /** Host-verified tenant identifier used in every job/store/participant boundary. */
        tenant: string; /** Opaque job or explicit participant identity. */
        id: string;
      },
      evidence: unknown,
      principal: unknown,
      execution: {
        /** Cooperative operation/download cancellation signal. */
        signal?: AbortSignal;
      } = {}
    ) {
      return run(async (signal) => {
        /** Detached validated durable job; never shared mutable store state. */
        const j = await get(reference, principal, 'approve', signal);
        if (j.phase !== 'approval') {
          throw fail('NOT_PREVIEWED');
        }
        /** Current metadata-only preview plan identity approved by the host. */
        const hash = plan(j);
        /** Host-verified expiring evidence/actor receipt, bound to the current plan hash. */
        const approval = await options.approve(
          freeze(clone(j)),
          hash,
          evidence,
          principal,
          signal
        );
        signal.throwIfAborted();
        if (
          !approval ||
          !token(approval.evidence) ||
          !token(approval.actor) ||
          !Number.isSafeInteger(approval.expiresAt) ||
          approval.expiresAt <= clock() ||
          approval.expiresAt > j.expiresAt
        ) {
          throw fail('APPROVAL');
        }
        j.approval = {
          evidence: approval.evidence,
          actor: approval.actor,
          expiresAt: approval.expiresAt,
          at: clock(),
          planHash: hash,
        };
        j.phase = 'approved';
        return save(j, signal);
      }, execution.signal);
    },
    /** Reauthorize and process at most one bounded participant page, recovering uncertain receipts instead of replaying effects.
     * @param {{ tenant: string; id: string }} reference - Explicit tenant/job identity.
     * @param {string} reference.tenant - Host-verified tenant namespace.
     * @param {string} reference.id - Opaque durable job ID.
     * @param {unknown} principal - Fresh initiating authority rechecked before and after participant work.
     * @param {{ signal?: AbortSignal }} execution - Optional caller cancellation owner.
     * @param {AbortSignal} execution.signal - Optional caller cancellation signal.
     * @returns {Promise<PrivacyJob>} Authorized bounded operation result; errors preserve honest partial/uncertain state.
     */
    resume(
      reference: {
        /** Host-verified tenant identifier used in every job/store/participant boundary. */
        tenant: string; /** Opaque job or explicit participant identity. */
        id: string;
      },
      principal: unknown,
      execution: {
        /** Cooperative operation/download cancellation signal. */
        signal?: AbortSignal;
      } = {}
    ) {
      return run(async (signal, deadline) => {
        let j = await get(reference, principal, 'resume', signal);
        if (
          !j.approval ||
          j.approval.expiresAt <= clock() ||
          j.approval.planHash !== plan(j)
        ) {
          throw fail('APPROVAL');
        }
        if (j.phase === 'complete' || j.phase === 'partial') {
          return j;
        }
        if (!['approved', 'running'].includes(j.phase)) {
          throw fail('NOT_APPROVED');
        }
        /** Nonnegative selected checkpoint index checked before all array access. */
        const index = j.participants.findIndex(
          (p) => !['complete', 'partial', 'unsupported'].includes(p.state)
        );
        if (index < 0) {
          finish(j);
          return save(j, signal);
        }
        // A nonnegative findIndex above selects a validated checkpoint; save preserves this array.
        let cp = j.participants[index]!;
        if (cp.pages >= maxPages) {
          throw fail('PAGE_LIMIT');
        }
        /** Explicit registered participant matching the job’s pinned coverage version. */
        const p = participants.get(cp.coverage.id)!;
        /** Immutable selected participant page identity and verified scope. */
        const ctx = context(j, cp, signal, deadline);
        /** Whether an earlier durable running/uncertain page must recover its receipt instead of executing effects again. */
        const recovering = cp.state === 'running' || cp.state === 'uncertain';
        if (!recovering) {
          cp.state = 'running';
          delete cp.code;
          j.phase = 'running';
          j = await save(j, signal);
          cp = j.participants[index]!;
        }
        /** Detached durable running revision retained to fence uncertain page recovery. */
        const claimed = clone(j);
        try {
          await allowed('resume', j, principal, signal);
          if (!j.approval || j.approval.expiresAt <= clock()) {
            throw fail('APPROVAL');
          }
          /** Borrowed durable job or participant receipt, validated before checkpoint mutation. */
          const raw = recovering
            ? await p.adapter.recover(ctx)
            : await p.adapter.execute(ctx);
          if (!raw) {
            cp.state = 'uncertain';
            cp.code = 'UNCERTAIN';
            return await save(j, signal);
          }
          /** Validated participant page receipt used only after fresh scope/deadline checks. */
          const result = page(raw, cp.cursor, false);
          signal.throwIfAborted();
          await allowed('resume', j, principal, signal);
          if (j.operation === 'export') {
            if (clock() >= j.exportExpiresAt) {
              throw fail('EXPORT_EXPIRED');
            }
            if (
              !Array.isArray(result.data) ||
              result.data.length !== result.affected
            ) {
              throw fail('INVALID_EXPORT');
            }
            /** Approved bounded subject-export JSONL records; erased payloads never enter metadata checkpoints. */
            const lines = result.data.map((record) =>
              exportJson({
                participant: cp.coverage.id,
                record: options.projectExport(freeze(clone(record)), ctx),
              })
            );
            /** Bounded private export page bytes charged to the durable aggregate budget. */
            const bytes = Buffer.from(
              lines.length ? lines.join('\n') + '\n' : ''
            );
            if (
              bytes.byteLength > 262144 ||
              j.exportBytes + bytes.byteLength > maxBytes
            ) {
              throw fail('EXPORT_SIZE');
            }
            await options.exports!.putPage(ctx, bytes, j.exportExpiresAt);
            j.exportBytes += bytes.byteLength;
          } else if (result.data !== undefined) {
            throw fail('ERASURE_PAYLOAD');
          }
          cp.pages++;
          cp.cursor = result.next;
          cp.scanned += result.scanned;
          cp.affected += result.affected;
          cp.held += result.held;
          if (result.done) {
            if (cp.held) {
              cp.state = 'partial';
            } else {
              cp.state = 'complete';
            }
          } else {
            cp.state = 'pending';
          }
          delete cp.code;
          finish(j);
          return await save(j, signal);
        } catch (error) {
          // Effects may already have committed. Do not advance the cursor or replay execute.
          /** Fresh durable revision checked before recording uncertainty without clobbering concurrent progress. */
          const latest = await store.get(claimed.tenant, claimed.id, signal);
          if (latest?.revision === claimed.revision) {
            claimed.participants[index]!.state = 'uncertain';
            claimed.participants[index]!.code = 'UNCERTAIN';
            try {
              await save(claimed, signal);
            } catch {
              /* durable running claim still fences replay */
            }
          }
          throw error instanceof PrivacyError
            ? error
            : fail('PARTICIPANT_UNCERTAIN', error);
        }
      }, execution.signal);
    },
    /** Stream private bounded JSONL under per-chunk authorization/expiry checks; consumer backpressure controls iteration.
     * @param {{ tenant: string; id: string }} reference - Explicit tenant/job identity.
     * @param {string} reference.tenant - Host-verified tenant namespace.
     * @param {string} reference.id - Opaque durable job ID.
     * @param {unknown} principal - Fresh initiating authority rechecked for every chunk.
     * @param {{ signal?: AbortSignal }} execution - Optional caller cancellation owner.
     * @param {AbortSignal} execution.signal - Optional caller cancellation signal.
     * @returns {AsyncGenerator<Uint8Array>} Authorized bounded operation result; errors preserve honest partial/uncertain state.
     */
    async *download(
      reference: {
        /** Host-verified tenant identifier used in every job/store/participant boundary. */
        tenant: string; /** Opaque job or explicit participant identity. */
        id: string;
      },
      principal: unknown,
      execution: {
        /** Cooperative operation/download cancellation signal. */
        signal?: AbortSignal;
      } = {}
    ): AsyncGenerator<Uint8Array> {
      if (closed) {
        throw fail('CLOSED');
      }
      /** Owned private download cancellation controller. */
      const controller = new AbortController();
      /** Propagate caller/timeout/shutdown cancellation without pretending durable work rolled back.
       * @returns {void} Cooperative cancellation notification completion.
       */
      const abort = () => controller.abort();
      controllers.add(controller);
      execution.signal?.addEventListener('abort', abort, { once: true });
      if (execution.signal?.aborted) {
        abort();
      }
      let release!: () => void;
      /** Actual download iterator lifetime retained until consumer/reader cleanup completes. */
      const done = new Promise<void>((r) => (release = r));
      if (pending.size >= maxPending) {
        controllers.delete(controller);
        execution.signal?.removeEventListener('abort', abort);
        throw fail('OVERLOAD');
      }
      pending.add(done);
      /** Owned operation/download deadline timer removed after actual settlement. */
      const timer = setTimeout(abort, timeout);
      try {
        /** Detached validated durable job; never shared mutable store state. */
        const j = await get(
          reference,
          principal,
          'download',
          controller.signal
        );
        if (
          j.operation !== 'export' ||
          !['complete', 'partial'].includes(j.phase) ||
          clock() >= j.exportExpiresAt ||
          !options.exports
        ) {
          throw fail('EXPORT_UNAVAILABLE');
        }
        let bytes = 0;
        for await (const chunk of options.exports.read(
          freeze(clone(j)),
          controller.signal
        )) {
          await allowed('download', j, principal, controller.signal);
          if (clock() >= j.exportExpiresAt) {
            throw fail('EXPORT_EXPIRED');
          }
          if (
            !(chunk instanceof Uint8Array) ||
            chunk.byteLength > 262144 ||
            (bytes += chunk.byteLength) > Math.min(maxBytes, j.exportBytes)
          ) {
            throw fail('EXPORT_SIZE');
          }
          yield chunk;
        }
        if (bytes !== j.exportBytes) {
          throw fail('EXPORT_INCOMPLETE');
        }
      } catch (error) {
        throw error instanceof PrivacyError
          ? error
          : fail(
              controller.signal.aborted ? 'CANCELLED' : 'EXPORT_UNAVAILABLE',
              error
            );
      } finally {
        clearTimeout(timer);
        execution.signal?.removeEventListener('abort', abort);
        controllers.delete(controller);
        pending.delete(done);
        release();
      }
    },
    /** Read fixed owner-local lifecycle/capacity counters without subject data.
     * @returns {{closed: boolean; pending: number}} Authorized bounded operation result; errors preserve honest partial/uncertain state.
     */
    status() {
      return { closed, pending: pending.size };
    },
    /** Reject new operations, abort observation and drain actual accepted work without closing borrowed stores or participants.
     * @returns {Promise<void>} Actual accepted-work drain settlement.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      for (const c of controllers) {
        c.abort();
      }
      return (closing = Promise.allSettled([...pending]).then(() => {}));
    },
  };
}
