import { createHash, randomUUID } from 'node:crypto';

export interface PrivacyScope {
  tenant: string;
  subject: string;
}
export type PrivacyOperation = 'export' | 'erase';
export interface PrivacyCoverage {
  id: string;
  version: number;
  find: boolean;
  export: boolean;
  erase: boolean;
  /** Nonpersonal coverage/limitation codes, e.g. local-metadata, remote-provider, backups. */
  records: readonly string[];
  outside: readonly string[];
}
export interface PrivacyPage {
  scanned: number;
  affected: number;
  held: number;
  next: string | null;
  done: boolean;
  data?: readonly Record<string, unknown>[];
}
export interface PrivacyPageContext extends PrivacyScope {
  jobId: string;
  operation: PrivacyOperation;
  pageKey: string;
  cursor: string | null;
  limit: number;
  signal: AbortSignal;
  deadline: number;
}
export interface PrivacyParticipant {
  coverage: PrivacyCoverage;
  /** Read-only discovery. Return counts, never subject payloads. */
  preview(context: PrivacyPageContext): Promise<PrivacyPage>;
  /** MUST atomically journal an idempotent durable page receipt with local effects.
   * Recheck holds, tenant/subject and local permissions on every page. */
  execute(context: PrivacyPageContext): Promise<PrivacyPage>;
  /** Return the same completed receipt, or null for unresolved/in-flight work. Never repeat effects. */
  recover(context: PrivacyPageContext): Promise<PrivacyPage | null>;
}
export interface PrivacyCheckpoint {
  coverage: PrivacyCoverage;
  preview: {
    cursor: string | null;
    pages: number;
    scanned: number;
    held: number;
    done: boolean;
  };
  cursor: string | null;
  pages: number;
  scanned: number;
  affected: number;
  held: number;
  state:
    | 'pending'
    | 'running'
    | 'uncertain'
    | 'failed'
    | 'complete'
    | 'partial'
    | 'unsupported';
  code?: 'UNAVAILABLE' | 'UNCERTAIN';
}
export interface PrivacyJob extends PrivacyScope {
  schema: 1;
  id: string;
  revision: number;
  operation: PrivacyOperation;
  policyVersion: string;
  createdAt: number;
  expiresAt: number;
  exportExpiresAt: number;
  exportBytes: number;
  phase:
    | 'preview'
    | 'approval'
    | 'approved'
    | 'running'
    | 'complete'
    | 'partial';
  participants: PrivacyCheckpoint[];
  approval?: {
    evidence: string;
    actor: string;
    at: number;
    expiresAt: number;
    planHash: string;
  };
}
export interface PrivacyJobStore {
  contract: 'privacy-jobs-cas-v1';
  durability: 'durable';
  /** Tenant-keyed current reads, linearizable create/CAS, unique nonreused revisions.
   * Atomically retain a metadata-only revision journal under host retention/hold policy. */
  get(
    tenant: string,
    id: string,
    signal: AbortSignal,
  ): Promise<PrivacyJob | null>;
  cas(
    expectedRevision: number | null,
    next: Readonly<PrivacyJob>,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export interface PrivacyExportStore {
  /** Private immutable idempotent pages; same key/different bytes MUST reject. No public URLs. */
  putPage(
    context: PrivacyPageContext,
    bytes: Uint8Array,
    expiresAt: number,
  ): Promise<void>;
  /** Ordered completed-job pages only; must enforce tenant/job binding and expiry independently. */
  read(
    job: Readonly<PrivacyJob>,
    signal: AbortSignal,
  ): AsyncIterable<Uint8Array>;
}
export interface PrivacyApproval {
  evidence: string;
  actor: string;
  expiresAt: number;
}
export interface PrivacyCoordinatorOptions {
  policyVersion: string;
  store: PrivacyJobStore;
  participants: readonly PrivacyParticipant[];
  exports?: PrivacyExportStore;
  /** Host verifies account linkage/proof; never resolve an email string alone into an identity. */
  resolveSubject(
    principal: unknown,
    proof: unknown,
    signal: AbortSignal,
  ): Promise<PrivacyScope | null>;
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
    signal: AbortSignal,
  ): Promise<boolean>;
  approve(
    job: Readonly<PrivacyJob>,
    planHash: string,
    evidence: unknown,
    principal: unknown,
    signal: AbortSignal,
  ): Promise<PrivacyApproval | null>;
  /** Required metadata-only host policy; return only approved public-to-subject export fields. */
  projectExport(
    record: Readonly<Record<string, unknown>>,
    context: PrivacyPageContext,
  ): Record<string, unknown>;
  now?: () => number;
  pageSize?: number;
  maxPages?: number;
  maxPending?: number;
  timeoutMs?: number;
  jobTtlMs?: number;
  exportTtlMs?: number;
  maxExportBytes?: number;
}
export class PrivacyError extends Error {
  constructor(
    readonly code: string,
    cause?: unknown,
  ) {
    super(`Privacy operation failed (${code})`);
    this.name = 'PrivacyError';
    if (cause !== undefined)
      Object.defineProperty(this, 'cause', { value: cause });
  }
}
const fail = (code: string, cause?: unknown) => new PrivacyError(code, cause);
const token = (v: unknown, max = 128): v is string =>
  typeof v === 'string' && new RegExp('^[A-Za-z0-9_-]{1,' + max + '}$').test(v);
const integer = (v: unknown, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    throw fail('INVALID_INPUT');
  return v;
};
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clone = <T>(v: T): T => structuredClone(v);
function keys(value: object, allowed: readonly string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw fail('CORRUPT_JOB');
}
const freeze = <T>(v: T): T => {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
function scope(v: PrivacyScope) {
  if (!v || !token(v.tenant) || !token(v.subject)) throw fail('INVALID_SCOPE');
  return { tenant: v.tenant, subject: v.subject };
}
function coverage(v: PrivacyCoverage): PrivacyCoverage {
  if (
    !v ||
    !token(v.id, 64) ||
    typeof v.find !== 'boolean' ||
    typeof v.export !== 'boolean' ||
    typeof v.erase !== 'boolean'
  )
    throw fail('INVALID_PARTICIPANT');
  integer(v.version, 1, 10000);
  for (const list of [v.records, v.outside])
    if (
      !Array.isArray(list) ||
      list.length > 32 ||
      list.some((x) => !token(x, 64))
    )
      throw fail('INVALID_COVERAGE');
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
/** JSON only, bounded, with defense-in-depth secret key rejection after host projection. */
function exportJson(value: unknown): string {
  let count = 0;
  const visit = (v: unknown, depth: number): unknown => {
    if (++count > 4096 || depth > 8) throw fail('EXPORT_COMPLEXITY');
    if (
      v === null ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    )
      return v;
    if (typeof v === 'string') {
      if (Buffer.byteLength(v) > 8192) throw fail('EXPORT_SIZE');
      return v;
    }
    if (Array.isArray(v)) {
      if (v.length > 100) throw fail('EXPORT_SIZE');
      return v.map((x) => visit(x, depth + 1));
    }
    if (
      !v ||
      typeof v !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    )
      throw fail('INVALID_EXPORT');
    const out: Record<string, unknown> = Object.create(null);
    if (Object.keys(v).length > 64) throw fail('EXPORT_SIZE');
    for (const key of Object.keys(v)) {
      if (
        /password|secret|token|cookie|authorization|credential|signed.?url|private.?key/i.test(
          key,
        )
      )
        throw fail('SECRET_EXPORT');
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (!('value' in d)) throw fail('INVALID_EXPORT');
      out[key] = visit(d.value, depth + 1);
    }
    return out;
  };
  return JSON.stringify(visit(value, 0));
}
/** Formula-safe cell helper for host CSV renderers. JSONL is the coordinator's portable format. */
export function privacyCsvCell(
  value: string | number | boolean | null,
): string {
  let s = String(value ?? '');
  // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function createPrivacyCoordinator(options: PrivacyCoordinatorOptions) {
  if (
    !token(options.policyVersion, 64) ||
    options.store?.contract !== 'privacy-jobs-cas-v1' ||
    options.store.durability !== 'durable' ||
    typeof options.store.get !== 'function' ||
    typeof options.store.cas !== 'function' ||
    ['resolveSubject', 'authorize', 'approve', 'projectExport'].some(
      (k) => typeof (options as any)[k] !== 'function',
    ) ||
    !Array.isArray(options.participants) ||
    !options.participants.length ||
    options.participants.length > 16
  )
    throw fail('INVALID_CONFIGURATION');
  const store = options.store,
    clock = options.now ?? Date.now,
    policy = options.policyVersion;
  const pageSize = integer(options.pageSize ?? 50, 1, 100),
    maxPages = integer(options.maxPages ?? 1000, 1, 10000),
    maxPending = integer(options.maxPending ?? 4, 1, 16),
    timeout = integer(options.timeoutMs ?? 5000, 1, 60000),
    ttl = integer(options.jobTtlMs ?? 86400000, 1000, 7 * 86400000),
    exportTtl = integer(options.exportTtlMs ?? 3600000, 1, 86400000),
    maxBytes = integer(options.maxExportBytes ?? 10485760, 1, 104857600);
  if (
    options.exports &&
    (typeof options.exports.putPage !== 'function' ||
      typeof options.exports.read !== 'function')
  )
    throw fail('INVALID_EXPORT_STORE');
  const participants = new Map(
    options.participants.map((p) => {
      const c = coverage(p.coverage);
      if (
        ['preview', 'execute', 'recover'].some(
          (k) => typeof (p as any)[k] !== 'function',
        )
      )
        throw fail('INVALID_PARTICIPANT');
      return [c.id, { adapter: p, coverage: c }] as const;
    }),
  );
  if (participants.size !== options.participants.length)
    throw fail('DUPLICATE_PARTICIPANT');
  let closed = false;
  const pending = new Set<Promise<unknown>>(),
    controllers = new Set<AbortController>();
  let closing: Promise<void> | undefined;
  const run = <T>(
    callback: (signal: AbortSignal, deadline: number) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (closed) return Promise.reject(fail('CLOSED'));
    if (pending.size >= maxPending) return Promise.reject(fail('OVERLOAD'));
    if (signal !== undefined && !(signal instanceof AbortSignal))
      return Promise.reject(fail('INVALID_SIGNAL'));
    const c = new AbortController(),
      abort = () => c.abort();
    controllers.add(c);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, timeout);
    const deadline = clock() + timeout;
    // Keep slots through actual settlement; a timeout never proves rollback.
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
  const allowed = async (
    action: Parameters<PrivacyCoordinatorOptions['authorize']>[0],
    s: PrivacyScope,
    principal: unknown,
    signal: AbortSignal,
  ) => {
    signal.throwIfAborted();
    if (
      (await options.authorize(action, freeze(scope(s)), principal, signal)) !==
      true
    )
      throw fail('DENIED');
    signal.throwIfAborted();
  };
  async function get(
    reference: { tenant: string; id: string },
    principal: unknown,
    action: Parameters<PrivacyCoordinatorOptions['authorize']>[0],
    signal: AbortSignal,
  ) {
    if (!reference || !token(reference.tenant) || !token(reference.id, 64))
      throw fail('INVALID_REFERENCE');
    const raw = await store.get(reference.tenant, reference.id, signal);
    if (!raw) throw fail('NOT_FOUND');
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
    if (Buffer.byteLength(JSON.stringify(j)) > 65536) throw fail('CORRUPT_JOB');
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
    )
      throw fail('CORRUPT_JOB');
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
      )
        throw fail('CORRUPT_JOB');
      integer(j.approval.at, j.createdAt, j.expiresAt);
      integer(j.approval.expiresAt, j.approval.at + 1, j.expiresAt);
    }
    if (j.expiresAt <= clock()) throw fail('EXPIRED');
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
      )
        throw fail('CORRUPT_JOB');
      cp.coverage = coverage(cp.coverage);
      const p = participants.get(cp.coverage.id);
      if (
        !p ||
        seen.has(p.coverage.id) ||
        digest(coverage(cp.coverage)) !== digest(p.coverage)
      )
        throw fail('PARTICIPANT_CHANGED');
      seen.add(p.coverage.id);
      for (const n of [cp.pages, cp.preview.pages]) integer(n, 0, maxPages);
      for (const n of [
        cp.scanned,
        cp.affected,
        cp.held,
        cp.preview.scanned,
        cp.preview.held,
      ])
        integer(n, 0, maxPages * pageSize);
      for (const cur of [cp.cursor, cp.preview.cursor])
        if (cur !== null && !token(cur, 256)) throw fail('CORRUPT_CURSOR');
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
      )
        throw fail('CORRUPT_JOB');
    }
    await allowed(action, j, principal, signal);
    return j;
  }
  const save = async (job: PrivacyJob, signal: AbortSignal) => {
    const next = { ...job, revision: job.revision + 1 };
    if (!(await store.cas(job.revision, freeze(clone(next)), signal)))
      throw fail('CONFLICT');
    return next;
  };
  const plan = (j: PrivacyJob) =>
    digest([
      j.id,
      j.tenant,
      j.subject,
      j.operation,
      j.policyVersion,
      j.participants.map((p) => ({ coverage: p.coverage, preview: p.preview })),
    ]);
  function page(raw: PrivacyPage, cursor: string | null, isPreview: boolean) {
    if (
      !raw ||
      typeof raw.done !== 'boolean' ||
      (raw.next !== null && !token(raw.next, 256))
    )
      throw fail('INVALID_PAGE');
    for (const n of [raw.scanned, raw.affected, raw.held])
      integer(n, 0, pageSize);
    if (
      raw.affected + raw.held > raw.scanned ||
      (raw.done && raw.next !== null) ||
      (!raw.done && (!raw.next || raw.next === cursor))
    )
      throw fail('INVALID_PAGE');
    if (isPreview && raw.data !== undefined) throw fail('PREVIEW_PAYLOAD');
    if (
      raw.data !== undefined &&
      (!Array.isArray(raw.data) || raw.data.length > pageSize)
    )
      throw fail('INVALID_PAGE');
    return raw;
  }
  const context = (
    j: PrivacyJob,
    cp: PrivacyCheckpoint,
    signal: AbortSignal,
    deadline: number,
    preview = false,
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
  function finish(j: PrivacyJob) {
    if (
      j.participants.every((p) =>
        ['complete', 'partial', 'unsupported'].includes(p.state),
      )
    )
      j.phase = j.participants.some(
        (p) => p.state !== 'complete' || p.coverage.outside.length,
      )
        ? 'partial'
        : 'complete';
  }
  return {
    create(
      operation: PrivacyOperation,
      proof: unknown,
      principal: unknown,
      execution: { signal?: AbortSignal } = {},
    ) {
      return run(async (signal) => {
        if (
          !['export', 'erase'].includes(operation) ||
          (operation === 'export' && !options.exports)
        )
          throw fail('UNSUPPORTED');
        const verified = await options.resolveSubject(principal, proof, signal);
        if (!verified) throw fail('IDENTITY');
        const s = scope(verified);
        await allowed('create', s, principal, signal);
        const at = clock();
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
        if (!(await store.cas(null, freeze(clone(job)), signal)))
          throw fail('CONFLICT');
        return clone(job);
      }, execution.signal);
    },
    inspect(
      reference: { tenant: string; id: string },
      principal: unknown,
      execution: { signal?: AbortSignal } = {},
    ) {
      return run(
        async (signal) =>
          clone(await get(reference, principal, 'inspect', signal)),
        execution.signal,
      );
    },
    /** One participant page per call: preview never calls execute or writes export bytes. */
    preview(
      reference: { tenant: string; id: string },
      principal: unknown,
      execution: { signal?: AbortSignal } = {},
    ) {
      return run(async (signal, deadline) => {
        const j = await get(reference, principal, 'preview', signal);
        if (j.phase !== 'preview') return j;
        const cp = j.participants.find((p) => !p.preview.done);
        if (cp) {
          if (cp.preview.pages >= maxPages) throw fail('PAGE_LIMIT');
          const p = participants.get(cp.coverage.id)!;
          try {
            const result = page(
              await p.adapter.preview(context(j, cp, signal, deadline, true)),
              cp.preview.cursor,
              true,
            );
            signal.throwIfAborted();
            cp.preview = {
              cursor: result.next,
              pages: cp.preview.pages + 1,
              scanned: cp.preview.scanned + result.scanned,
              held: cp.preview.held + result.held,
              done: result.done,
            };
            if (cp.state === 'failed')
              cp.state = cp.coverage[j.operation] ? 'pending' : 'unsupported';
            delete cp.code;
          } catch (error) {
            cp.state = 'failed';
            cp.code = 'UNAVAILABLE';
            try {
              await save(j, signal);
            } catch { /* Preserve the original participant failure when checkpoint persistence also fails. */ }
            throw error instanceof PrivacyError
              ? error
              : fail(
                  signal.aborted ? 'CANCELLED' : 'PREVIEW_UNAVAILABLE',
                  error,
                );
          }
        }
        if (j.participants.every((p) => p.preview.done)) j.phase = 'approval';
        return save(j, signal);
      }, execution.signal);
    },
    approve(
      reference: { tenant: string; id: string },
      evidence: unknown,
      principal: unknown,
      execution: { signal?: AbortSignal } = {},
    ) {
      return run(async (signal) => {
        const j = await get(reference, principal, 'approve', signal);
        if (j.phase !== 'approval') throw fail('NOT_PREVIEWED');
        const hash = plan(j),
          approval = await options.approve(
            freeze(clone(j)),
            hash,
            evidence,
            principal,
            signal,
          );
        signal.throwIfAborted();
        if (
          !approval ||
          !token(approval.evidence) ||
          !token(approval.actor) ||
          !Number.isSafeInteger(approval.expiresAt) ||
          approval.expiresAt <= clock() ||
          approval.expiresAt > j.expiresAt
        )
          throw fail('APPROVAL');
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
    resume(
      reference: { tenant: string; id: string },
      principal: unknown,
      execution: { signal?: AbortSignal } = {},
    ) {
      return run(async (signal, deadline) => {
        let j = await get(reference, principal, 'resume', signal);
        if (
          !j.approval ||
          j.approval.expiresAt <= clock() ||
          j.approval.planHash !== plan(j)
        )
          throw fail('APPROVAL');
        if (j.phase === 'complete' || j.phase === 'partial') return j;
        if (!['approved', 'running'].includes(j.phase))
          throw fail('NOT_APPROVED');
        const index = j.participants.findIndex(
          (p) => !['complete', 'partial', 'unsupported'].includes(p.state),
        );
        if (index < 0) {
          finish(j);
          return save(j, signal);
        }
        let cp = j.participants[index];
        if (cp.pages >= maxPages) throw fail('PAGE_LIMIT');
        const p = participants.get(cp.coverage.id)!,
          ctx = context(j, cp, signal, deadline);
        const recovering = cp.state === 'running' || cp.state === 'uncertain';
        if (!recovering) {
          cp.state = 'running';
          delete cp.code;
          j.phase = 'running';
          j = await save(j, signal);
          cp = j.participants[index];
        }
        const claimed = clone(j);
        try {
          await allowed('resume', j, principal, signal);
          if (!j.approval || j.approval.expiresAt <= clock())
            throw fail('APPROVAL');
          const raw = recovering
            ? await p.adapter.recover(ctx)
            : await p.adapter.execute(ctx);
          if (!raw) {
            cp.state = 'uncertain';
            cp.code = 'UNCERTAIN';
            return await save(j, signal);
          }
          const result = page(raw, cp.cursor, false);
          signal.throwIfAborted();
          await allowed('resume', j, principal, signal);
          if (j.operation === 'export') {
            if (clock() >= j.exportExpiresAt) throw fail('EXPORT_EXPIRED');
            if (
              !Array.isArray(result.data) ||
              result.data.length !== result.affected
            )
              throw fail('INVALID_EXPORT');
            const lines = result.data.map((record) =>
              exportJson({
                participant: cp.coverage.id,
                record: options.projectExport(freeze(clone(record)), ctx),
              }),
            );
            const bytes = Buffer.from(
              lines.length ? lines.join('\n') + '\n' : '',
            );
            if (
              bytes.byteLength > 262144 ||
              j.exportBytes + bytes.byteLength > maxBytes
            )
              throw fail('EXPORT_SIZE');
            await options.exports!.putPage(ctx, bytes, j.exportExpiresAt);
            j.exportBytes += bytes.byteLength;
          } else if (result.data !== undefined) throw fail('ERASURE_PAYLOAD');
          cp.pages++;
          cp.cursor = result.next;
          cp.scanned += result.scanned;
          cp.affected += result.affected;
          cp.held += result.held;
          cp.state = result.done
            ? cp.held
              ? 'partial'
              : 'complete'
            : 'pending';
          delete cp.code;
          finish(j);
          return await save(j, signal);
        } catch (error) {
          // Effects may already have committed. Do not advance the cursor or replay execute.
          const latest = await store.get(claimed.tenant, claimed.id, signal);
          if (latest?.revision === claimed.revision) {
            claimed.participants[index].state = 'uncertain';
            claimed.participants[index].code = 'UNCERTAIN';
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
    /** Private JSONL, backpressured by consumer; reauthorization/expiry checked for every chunk. */
    async *download(
      reference: { tenant: string; id: string },
      principal: unknown,
      execution: { signal?: AbortSignal } = {},
    ): AsyncGenerator<Uint8Array> {
      if (closed) throw fail('CLOSED');
      const controller = new AbortController(),
        abort = () => controller.abort();
      controllers.add(controller);
      execution.signal?.addEventListener('abort', abort, { once: true });
      if (execution.signal?.aborted) abort();
      let release!: () => void;
      const done = new Promise<void>((r) => (release = r));
      if (pending.size >= maxPending) {
        controllers.delete(controller);
        execution.signal?.removeEventListener('abort', abort);
        throw fail('OVERLOAD');
      }
      pending.add(done);
      const timer = setTimeout(abort, timeout);
      try {
        const j = await get(
          reference,
          principal,
          'download',
          controller.signal,
        );
        if (
          j.operation !== 'export' ||
          !['complete', 'partial'].includes(j.phase) ||
          clock() >= j.exportExpiresAt ||
          !options.exports
        )
          throw fail('EXPORT_UNAVAILABLE');
        let bytes = 0;
        for await (const chunk of options.exports.read(
          freeze(clone(j)),
          controller.signal,
        )) {
          await allowed('download', j, principal, controller.signal);
          if (clock() >= j.exportExpiresAt) throw fail('EXPORT_EXPIRED');
          if (
            !(chunk instanceof Uint8Array) ||
            chunk.byteLength > 262144 ||
            (bytes += chunk.byteLength) > Math.min(maxBytes, j.exportBytes)
          )
            throw fail('EXPORT_SIZE');
          yield chunk;
        }
        if (bytes !== j.exportBytes) throw fail('EXPORT_INCOMPLETE');
      } catch (error) {
        throw error instanceof PrivacyError
          ? error
          : fail(
              controller.signal.aborted ? 'CANCELLED' : 'EXPORT_UNAVAILABLE',
              error,
            );
      } finally {
        clearTimeout(timer);
        execution.signal?.removeEventListener('abort', abort);
        controllers.delete(controller);
        pending.delete(done);
        release();
      }
    },
    status() {
      return { closed, pending: pending.size };
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const c of controllers) c.abort();
      return (closing = Promise.allSettled([...pending]).then(() => {}));
    },
  };
}
