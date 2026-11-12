import { createHash, randomUUID } from 'node:crypto';
import { validateEmailAddress, addressString } from './validation.js';
import type { EmailMessage } from './types.js';

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled';
export type CampaignPrimitive = string | number | boolean | null;
export interface CampaignContact {
  /** Explicit stable campaign/contact identity according to the owning contract; not authorization. */
  id: string;
  /** Private canonical recipient; never serialize it into queue jobs or public metrics. */
  email: string;
  /** Private bounded scalar audience traits; not subscription evidence. */
  traits?: Record<string, CampaignPrimitive>;
}
export interface CampaignCondition {
  /** Explicit allowed primitive trait/email field, never SQL or JavaScript. */
  field: string;
  /** Allowlisted primitive comparison operator. */
  operator: 'eq' | 'ne' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists';
  /** Bounded scalar/membership/exists operand; no expression execution. */
  value?: CampaignPrimitive | CampaignPrimitive[];
}
export interface CampaignSegment {
  /** Optional conjunction of at most twelve primitive conditions. */
  all?: CampaignCondition[];
  /** Optional disjunction of at most twelve primitive conditions. */
  any?: CampaignCondition[];
}
export interface CampaignDefinition {
  /** Explicit stable campaign/contact identity according to the owning contract; not authorization. */
  id: string;
  /** Inert authored campaign label, bounded 1–120 characters. */
  name: string;
  /** Explicit epoch schedule, at most one year ahead at creation; no process timer scheduling. */
  sendAt: number;
  /** Optional bounded primitive audience rules; consent/suppression remain separate. */
  segment?: CampaignSegment;
  /** Fully independent from consent: absence/disabled is never auto-enabled. */
  tracking?: EmailMessage['tracking'];
}
export interface CampaignTarget {
  /** Opaque stable durable-message reference; not exactly-once transport evidence. */
  messageId: string;
  /** Private contact reference used only by durable application staging. */
  contactId: string;
  /** Private validated mailbox retained in staged campaign state, never queue job payload. */
  recipient: string;
}
export interface CampaignState extends CampaignDefinition {
  /** Monotonic committed document revision used for CAS. */
  version: number;
  /** Planning state; completed does not mean messages were delivered. */
  status: CampaignStatus;
  /** Exclusive audience continuation, null initially. */
  cursor: string | null;
  /** Explicit source completion, independent of pending staged deliveries. */
  endOfScan: boolean;
  /** Finite staged private targets persisted before queue side effects. */
  pending: CampaignTarget[];
  /** Recorded audience rows inspected by committed planning checkpoints. */
  scanned: number;
  /** Recorded eligible targets after consent/suppression checks. */
  eligible: number;
  /** Recorded enqueue checkpoints; queue acceptance is not SMTP delivery. */
  queued: number;
  /** Recorded audience rows excluded by segment/consent/suppression. */
  skipped: number;
  /** Optional token/expiry ownership; no automatic native cancellation or lease renewal. */
  lease: null | {
    /** Random per-run lease owner token; stale workers cannot release a new lease. */
    token: string; /** Explicit epoch lease expiration checked before checkpoint/side effects. */
    expiresAt: number;
  };
  /** Trusted creation timestamp retained in the persisted draft. */
  createdAt: number;
  /** Trusted timestamp of the committed next revision. */
  updatedAt: number;
}
/** Production implementation MUST provide atomic insert-if-absent and version-checked updates. */
export interface CampaignStore {
  /** Reserve one cloned campaign state without replacing an existing identity.
   * @param {CampaignState} record - Complete private state for unique insertion or revision-checked replacement.
   * @returns {Promise<boolean>} True for a new state; false for an existing identity.
   */
  create(record: CampaignState): Promise<boolean>;
  /** Read one private campaign state without interpreting planning completion as delivery completion.
   * @param {string} id - Validated explicit campaign identity, not principal authorization.
   * @returns {Promise<CampaignState | null>} Detached stored state or null.
   */
  load(id: string): Promise<CampaignState | null>;
  /** Replace one state only against the expected prior revision and exactly one version increment.
   * @param {CampaignState} record - Complete private state for unique insertion or revision-checked replacement.
   * @param {number} expectedVersion - Exact expected prior committed revision.
   * @returns {Promise<boolean>} True only for an accepted revision-checked update; conflicts return false.
   */
  save(record: CampaignState, expectedVersion: number): Promise<boolean>;
}
export interface CampaignSource {
  /** Stable, unique contacts; opaque exclusive cursor; repeatable order for resuming. */
  page(args: {
    /** Exclusive audience continuation, null initially. */
    cursor: string | null;
    /** Requested finite page size, never an unbounded table scan. */
    limit: number;
  }): Promise<{
    /** Bounded private unique audience rows; duplicate canonical recipients in a page reject. */
    contacts: CampaignContact[];
    /** Opaque exclusive continuation, bounded 1024 characters; must advance unless done. */
    nextCursor: string | null;
    /** Explicit source completion independent of planning/delivery outcomes. */
    done: boolean;
  }>;
}
export interface CampaignPlannerOptions {
  /** Host-supplied atomic unique-insert/CAS persistence; no fallback durability. */
  store: CampaignStore;
  /** Host-authorized stable unique audience source with bounded paging. */
  source: CampaignSource;
  /** Fresh affirmative consent check; outages stop page checkpointing. */
  isSubscribed: (email: string) => Promise<boolean>;
  /** Independent suppression check; outages stop page checkpointing. */
  isSuppressed: (email: string) => Promise<boolean>;
  /** Idempotently persist a durable marketing message. DO NOT send here. */
  ensureMessage: (
    target: CampaignTarget,
    context: {
      /** Optional explicit campaign binding for staging/delivery policies; not user role authority. */
      campaignId: string;
      tracking: EmailMessage['tracking'];
    }
  ) => Promise<void>;
  /** Idempotently enqueue a stable BullMQ jobId based on messageId. */
  enqueue: (messageId: string, sendAt: number) => Promise<void>;
  /** Optional trusted epoch clock, default Date.now. */
  now?: () => number;
  /** Audience page budget 1–200, default 100. */
  batchSize?: number;
  /** Lease duration 3000–3600000ms, default 60000; host callbacks must be idempotent after expiry. */
  leaseMs?: number;
  /** Best-effort host metadata hook after state persistence; no payload/secret logging. */
  onAudit?: (entry: {
    /** Optional explicit campaign binding for staging/delivery policies; not user role authority. */
    campaignId: string;
    /** Fixed planning/audit transition metadata. */
    action: string;
    /** Trusted metadata timestamp; ISO for audit, epoch for metrics according to containing contract. */
    at: string;
  }) => void | Promise<void>;
  /** Best-effort aggregate operational telemetry; never contains recipient PII or controls activity tracking. */
  onMetric?: (metric: {
    /** Optional explicit campaign binding for staging/delivery policies; not user role authority. */
    campaignId: string;
    kind: 'queued' | 'scheduled' | 'completed' | 'cancelled';
    /** Trusted metadata timestamp; ISO for audit, epoch for metrics according to containing contract. */
    at: number;
    /** Bounded-by-planning operational count; no recipient identity. */
    count: number;
  }) => Promise<void> | void;
}
/** Bounded authored campaign/contact identifier syntax, not authentication. */
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Bounded explicit scalar audience field syntax; prototype names reject separately. */
const fieldPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Validate explicit static identity syntax without granting access.
 * @param {unknown} id - Candidate campaign/contact/worker identity.
 * @returns {boolean} Whether the supported bounded identifier shape matches. */
const validId = (id: unknown): id is string =>
  typeof id === 'string' && idPattern.test(id);
/** Permit only bounded inert scalar segment operands.
 * @param {unknown} v - Candidate segment scalar.
 * @returns {boolean} True only for null, boolean, bounded string or finite number. */
const isPrimitive = (v: unknown): v is CampaignPrimitive =>
  v === null ||
  (typeof v === 'string' && v.length <= 512) ||
  typeof v === 'boolean' ||
  (typeof v === 'number' && Number.isFinite(v));
/** Validate a private recipient before normalizing stable planner identity.
 * @param {string} s - Private literal mailbox.
 * @returns {string} Lowercase trimmed canonical mailbox; not subscription proof. */
const canonical = (s: string) =>
  addressString(validateEmailAddress(s)).toLowerCase().trim();
/** Detach private state or target data before crossing host callback boundaries.
 * @param {T} value - Cloneable private record.
 * @returns {T} Detached structured clone; no code/template evaluation. */
const clone = <T>(value: T): T => structuredClone(value);
/** Validate only bounded typed all/any scalar comparisons; no executable segment expressions.
 * @param {CampaignSegment | undefined} segment - Optional bounded authored all/any condition groups.
 * @returns {void} Unsupported fields/operators/depth/list shapes reject before audience work.
 */
function validateSegment(segment: CampaignSegment | undefined): void {
  if (segment === undefined) {
    return;
  }
  if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
    throw new TypeError('Invalid campaign segment');
  }
  if (Object.keys(segment).some((k) => k !== 'all' && k !== 'any')) {
    throw new TypeError('Unknown campaign segment key');
  }
  // Validate both optional flat condition groups before evaluating any contact.
  for (const conditions of [segment.all, segment.any]) {
    if (conditions === undefined) {
      continue;
    }
    if (!Array.isArray(conditions) || conditions.length > 12) {
      throw new RangeError('Invalid segment conditions');
    }
    // Validate each allowlisted primitive predicate without compiling expression text.
    for (const c of conditions) {
      if (
        !c ||
        !fieldPattern.test(c.field) ||
        ['constructor', 'prototype', '__proto__'].includes(c.field) ||
        Object.keys(c).some(
          (k) => !['field', 'operator', 'value'].includes(k)
        ) ||
        !['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'exists'].includes(
          c.operator
        )
      ) {
        throw new TypeError('Invalid segment condition');
      }
      if (c.operator === 'exists') {
        if (typeof c.value !== 'boolean') {
          throw new TypeError('exists expects a boolean');
        }
      } else if (c.operator === 'in') {
        if (
          !Array.isArray(c.value) ||
          !c.value.length ||
          c.value.length > 30 ||
          !c.value.every(isPrimitive)
        ) {
          throw new TypeError('in expects 1..30 primitive values');
        }
      } else if (['gt', 'gte', 'lt', 'lte'].includes(c.operator)) {
        if (typeof c.value !== 'number' || !Number.isFinite(c.value)) {
          throw new TypeError('Numeric comparison required');
        }
      } else if (!isPrimitive(c.value)) {
        throw new TypeError('Invalid condition value');
      }
    }
  }
}
/** Evaluate one already validated primitive predicate without evaluating arbitrary code.
 * @param {CampaignContact} contact - Private contact/traits evaluated only as data; no consent is inferred.
 * @param {CampaignCondition} c - One already validated primitive condition.
 * @returns {boolean} Exact supported comparison result; missing/nonnumeric operands follow explicit semantics.
 */
function matchesOne(contact: CampaignContact, c: CampaignCondition) {
  /** Current explicit contact email/trait operand; unsupported/missing values follow primitive comparison rules. */
  const value = c.field === 'email' ? contact.email : contact.traits?.[c.field];
  if (c.operator === 'exists') {
    return (value !== undefined && value !== null) === c.value;
  }
  if (c.operator === 'in') {
    return (c.value as CampaignPrimitive[]).includes(
      value as CampaignPrimitive
    );
  }
  if (c.operator === 'eq') {
    return value === c.value;
  }
  if (c.operator === 'ne') {
    return value !== undefined && value !== c.value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }
  /** Validated finite numeric comparison operand. */
  const compare = c.value as number;
  if (c.operator === 'gt') {
    return value > compare;
  }
  if (c.operator === 'gte') {
    return value >= compare;
  }
  if (c.operator === 'lt') {
    return value < compare;
  }
  return value <= compare;
}
/** Validate and evaluate bounded primitive all/any conditions over a private contact.
 * @param {CampaignContact} contact - Private contact/traits evaluated only as data; no consent is inferred.
 * @param {CampaignSegment} segment - Optional bounded authored all/any condition groups.
 * @returns {boolean} Whether the contact matches; never subscription/tenant authorization.
 */
export function matchesCampaignSegment(
  contact: CampaignContact,
  segment?: CampaignSegment
) {
  validateSegment(segment);
  return (
    (!segment?.all || segment.all.every((c) => matchesOne(contact, c))) &&
    (!segment?.any?.length || segment.any.some((c) => matchesOne(contact, c)))
  );
}
/** Validate only the explicit per-campaign tracking policy without silently enabling it.
 * @param {CampaignDefinition['tracking']} t - Optional explicit tracking policy; absence stays disabled.
 * @returns {void} Unsupported/malformed tracking values reject before persistence.
 */
function validateTracking(t: CampaignDefinition['tracking']): void {
  if (t === undefined) {
    return;
  }
  if (
    !t ||
    typeof t !== 'object' ||
    Array.isArray(t) ||
    Object.keys(t).some(
      (k) =>
        ![
          'enabled',
          'opens',
          'clicks',
          'downloads',
          'downloadLinks',
          'campaign',
        ].includes(k)
    )
  ) {
    throw new TypeError('Invalid campaign tracking policy');
  }
  // Require explicit booleans for every optional tracking flag; omission never opts in.
  for (const field of ['enabled', 'opens', 'clicks', 'downloads'] as const) {
    if (t[field] !== undefined && typeof t[field] !== 'boolean') {
      throw new TypeError('Invalid campaign tracking flag');
    }
  }
  if (
    t.downloadLinks !== undefined &&
    (!Array.isArray(t.downloadLinks) ||
      t.downloadLinks.length > 20 ||
      t.downloadLinks.some((v) => typeof v !== 'string' || v.length > 2048))
  ) {
    throw new TypeError('Invalid campaign download links');
  }
  if (t.campaign !== undefined && !validId(t.campaign)) {
    throw new TypeError('Invalid tracking campaign');
  }
}
/** Derive a stable opaque campaign/recipient reference for host-owned durable staging/enqueue idempotence.
 * @param {string} campaignId - Validated campaign identity within the host-authorized namespace.
 * @param {string} recipient - Canonical private mailbox used only for deterministic reference hashing.
 * @returns {string} Deterministic reference; no exactly-once SMTP or permission guarantee.
 */
function makeMessageId(campaignId: string, recipient: string) {
  return (
    'cmp_' +
    createHash('sha256')
      .update(campaignId + '\0' + recipient)
      .digest('hex')
      .slice(0, 40)
  );
}
/** Create a cloned-state local CAS fixture; initial records validate only identity/duplicates.
 * @param {CampaignState[]} initial - Trusted cloned fixture states; full persisted-state schema validation remains host-owned.
 * @returns {CampaignStore} Reference store, not durable multi-worker production storage.
 */
export function createMemoryCampaignStore(
  initial: CampaignState[] = []
): CampaignStore {
  /** Process-local cloned campaign fixture states; no durable fallback or global lock. */
  const records = new Map<string, CampaignState>();
  // Validate fixture identities/duplicates before retaining each detached initial state.
  for (const v of initial) {
    if (!validId(v.id) || records.has(v.id)) {
      throw new TypeError('Duplicate campaign');
    }
    records.set(v.id, clone(v));
  }
  return {
    /** Reserve one cloned campaign state without replacing an existing identity.
     * @param {CampaignState} v - Complete private current/next campaign state under the owning API.
     * @returns {Promise<boolean>} True for a new state; false for an existing identity.
     */
    async create(v) {
      if (records.has(v.id)) {
        return false;
      }
      records.set(v.id, clone(v));
      return true;
    },
    /** Read one private campaign state without interpreting planning completion as delivery completion.
     * @param {string} id - Validated explicit campaign identity, not principal authorization.
     * @returns {Promise<CampaignState | null>} Detached stored state or null.
     */
    async load(id) {
      return records.has(id) ? clone(records.get(id)!) : null;
    },
    /** Replace one state only against the expected prior revision and exactly one version increment.
     * @param {CampaignState} v - Complete private current/next campaign state under the owning API.
     * @param {number} expected - Exact expected prior committed revision.
     * @returns {Promise<boolean>} True only for an accepted revision-checked update; conflicts return false.
     */
    async save(v, expected) {
      /** Current committed private state loaded before a finite CAS/lease decision. */
      const old = records.get(v.id);
      if (!old || old.version !== expected || v.version !== expected + 1) {
        return false;
      }
      records.set(v.id, clone(v));
      return true;
    },
  };
}
/** Plan finite audience pages with store-backed lease/revision checkpoints before queue side effects.
 * @param {CampaignPlannerOptions} options - Explicit store/source/consent/suppression/durable staging/enqueue contracts and finite policies.
 * @returns {CampaignPlanner} Explicit application-owned planner; caller provides authenticated scope and idempotent durable callbacks.
 */
export function createCampaignPlanner(options: CampaignPlannerOptions) {
  // Require explicit store/source/policy/side-effect dependencies before any campaign operation.
  for (const key of [
    'store',
    'source',
    'isSubscribed',
    'isSuppressed',
    'ensureMessage',
    'enqueue',
  ] as const) {
    if (!options?.[key]) {
      throw new TypeError(`Campaign planner missing ${key}`);
    }
  }
  /** Audience page budget 1–200, default 100. */
  const batchSize = options.batchSize ?? 100;
  /** Lease lifetime 3000–3600000ms, default one minute; callbacks remain idempotent. */
  const leaseMs = options.leaseMs ?? 60_000;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 200) {
    throw new RangeError('Invalid campaign batch size');
  }
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 3000 || leaseMs > 3_600_000) {
    throw new RangeError('Invalid campaign lease');
  }
  /** Explicit trusted epoch clock, default Date.now. */
  const clock = options.now ?? Date.now;
  /** Require a safe nonnegative trusted epoch before lease/checkpoint decisions.

 * @returns {number} Validated current epoch milliseconds. */
  const now = () => {
    /** One trusted clock read; unsafe/negative values reject before persistence. */
    const t = clock();
    if (!Number.isSafeInteger(t) || t < 0) {
      throw new Error('Invalid campaign clock');
    }
    return t;
  };
  /** Apply one planner change with an incremented revision and trusted update time through the store CAS.
   * @param {CampaignState} v - Complete private current/next campaign state under the owning API.
   * @param {Partial<CampaignState>} change - Explicit private next-state fields; planner owns revision/time increments.
   * @returns {Promise<CampaignState | null>} Committed next state, or null when another writer changed the expected revision.
   */
  async function save(
    v: CampaignState,
    change: Partial<CampaignState>
  ): Promise<CampaignState | null> {
    /** Candidate next private revision/lease retaining prior state fields. */
    const next = { ...v, ...change, version: v.version + 1, updatedAt: now() };
    return (await options.store.save(next, v.version)) ? next : null;
  }
  /** Emit best-effort metadata after persistence; audit failure must not replay queue side effects.
   * @param {string} id - Validated explicit campaign identity, not principal authorization.
   * @param {string} action - Explicit transition or bounded host audit action metadata.
   * @returns {Promise<void>} Host audit observation settled or isolated; no distributed transaction is implied.
   */
  async function audit(id: string, action: string) {
    try {
      await options.onAudit?.({
        campaignId: id,
        action,
        at: new Date(now()).toISOString(),
      });
    } catch {
      /* auditing failures cannot replay queue operations */
    }
  }
  /** Emit best-effort operational counters separately from recipient activity tracking.
   * @param {string} id - Validated explicit campaign identity, not principal authorization.
   * @param {'queued' | 'scheduled' | 'completed' | 'cancelled'} kind - Fixed queued/scheduled/completed/cancelled operational metric kind.
   * @param {number} count - Operational count, default one.
   * @returns {Promise<void>} Analytics failure never undoes committed planning.
   */
  async function metric(
    id: string,
    kind: 'queued' | 'scheduled' | 'completed' | 'cancelled',
    count = 1
  ) {
    try {
      await options.onMetric?.({ campaignId: id, kind, count, at: now() });
    } catch {
      /* Analytics is best effort and independent from mail activity tracking */
    }
  }
  /** Validate an authored definition and persist one new draft before best-effort metadata hooks.
   * @param {CampaignDefinition} def - Validated authored draft definition, not executable template or permission data.
   * @returns {Promise<CampaignState>} Committed detached draft; duplicate identity and malformed definitions reject.
   */
  async function create(def: CampaignDefinition) {
    if (
      !validId(def?.id) ||
      typeof def.name !== 'string' ||
      def.name.trim().length < 1 ||
      def.name.length > 120 ||
      !Number.isSafeInteger(def.sendAt) ||
      def.sendAt < 0 ||
      def.sendAt > now() + 365 * 86_400_000
    ) {
      throw new TypeError('Invalid campaign definition');
    }
    if (
      Object.keys(def).some(
        (k) => !['id', 'name', 'sendAt', 'segment', 'tracking'].includes(k)
      )
    ) {
      throw new TypeError('Unknown campaign definition field');
    }
    validateSegment(def.segment);
    validateTracking(def.tracking);
    /** Validated persisted draft state; planning completion and SMTP delivery remain separate. */
    const state: CampaignState = {
      ...clone(def),
      version: 1,
      status: 'draft',
      cursor: null,
      endOfScan: false,
      pending: [],
      scanned: 0,
      eligible: 0,
      queued: 0,
      skipped: 0,
      lease: null,
      createdAt: now(),
      updatedAt: now(),
    };
    if (!(await options.store.create(state))) {
      throw new Error('Campaign already exists');
    }
    await audit(def.id, 'create');
    return clone(state);
  }
  /** Apply only supported explicit schedule/pause/resume/cancel transitions with finite CAS retries.
   * @param {string} id - Validated explicit campaign identity, not principal authorization.
   * @param {'schedule' | 'pause' | 'resume' | 'cancel'} action - Explicit transition or bounded host audit action metadata.
   * @returns {Promise<CampaignState>} Committed state or explicit transition/contention failure.
   */
  async function command(
    id: string,
    action: 'schedule' | 'pause' | 'resume' | 'cancel'
  ) {
    if (!validId(id)) {
      throw new TypeError('Invalid campaign ID');
    }
    // Reload on command conflict rather than silently overwriting a concurrent state transition.
    for (let i = 0; i < 20; i++) {
      /** Current committed private state loaded before a finite CAS/lease decision. */
      const old = await options.store.load(id);
      if (!old) {
        throw new Error('Campaign not found');
      }
      let status: CampaignStatus;
      if (action === 'schedule' && old.status === 'draft') {
        status = 'scheduled';
      } else if (
        action === 'pause' &&
        ['running', 'scheduled'].includes(old.status)
      ) {
        status = 'paused';
      } else if (action === 'resume' && old.status === 'paused') {
        status = now() < old.sendAt ? 'scheduled' : 'running';
      } else if (
        action === 'cancel' &&
        ['draft', 'scheduled', 'running', 'paused'].includes(old.status)
      ) {
        status = 'cancelled';
      } else {
        throw new Error('Invalid campaign transition');
      }
      /** Committed transition result; null conflict triggers bounded reload. */
      const updated = await save(old, { status });
      if (updated) {
        await audit(id, action);
        if (action === 'schedule' || action === 'cancel') {
          await metric(id, action === 'schedule' ? 'scheduled' : 'cancelled');
        }
        return updated;
      }
    }
    throw new Error('Campaign state contention');
  }
  /** Claim one finite lease, stage one audience page, then ensure/enqueue stable references and checkpoint each result.
   * @param {string} id - Validated explicit campaign identity, not principal authorization.
   * @param {string} workerId - Validated operator worker label; lease ownership uses a separate random token.
   * @returns {Promise<{status: string, processed: number}>} Planning progress only; queue/store atomicity and receiver idempotence remain host-owned.
   */
  async function runOnce(id: string, workerId: string) {
    if (!validId(id) || !validId(workerId)) {
      throw new TypeError('Invalid campaign/worker ID');
    }
    /** Random per-run lease token independent of the worker label. */
    const token = randomUUID();
    let claimed: CampaignState | undefined;
    // Claim a live lease with finite CAS attempts; worker names never substitute for lease tokens.
    for (let i = 0; i < 20; i++) {
      /** Current committed private state loaded before a finite CAS/lease decision. */
      const old = await options.store.load(id);
      if (!old) {
        throw new Error('Campaign not found');
      }
      if (['draft', 'paused', 'completed', 'cancelled'].includes(old.status)) {
        return { status: old.status, processed: 0 };
      }
      if (old.sendAt > now()) {
        return { status: 'scheduled', processed: 0 };
      }
      if (old.lease && old.lease.expiresAt > now()) {
        return { status: 'busy', processed: 0 };
      }
      /** Candidate next private revision/lease retaining prior state fields. */
      const next = await save(old, {
        status: 'running',
        lease: { token, expiresAt: now() + leaseMs },
      });
      if (next) {
        claimed = next;
        break;
      }
    }
    if (!claimed) {
      throw new Error('Campaign lease contention');
    }
    let current = claimed,
      processed = 0;
    /** Recheck exact revision, live lease token/expiry and running state before saving a checkpoint.
     * @param {Partial<CampaignState>} change - Explicit private next-state fields; planner owns revision/time increments.
     * @returns {Promise<void>} Current state advanced only after successful CAS; stale owners reject.
     */
    async function commit(change: Partial<CampaignState>) {
      /** Latest committed lease/revision reread before checkpoint/side effects or conditional release. */
      const fresh = await options.store.load(id);
      if (
        !fresh ||
        fresh.version !== current.version ||
        fresh.lease?.token !== token ||
        fresh.lease.expiresAt <= now() ||
        fresh.status !== 'running'
      ) {
        throw new Error('Campaign lease lost or paused');
      }
      /** Committed checkpoint accepted only through exact revision CAS. */
      const saved = await save(fresh, change);
      if (!saved) {
        throw new Error('Campaign checkpoint contention');
      }
      current = saved;
    }
    try {
      if (!current.pending.length && !current.endOfScan) {
        /** Bounded private audience page; cursor/completion shape is checked before state mutation. */
        const result = await options.source.page({
          cursor: current.cursor,
          limit: batchSize,
        });
        if (
          !result ||
          !Array.isArray(result.contacts) ||
          result.contacts.length > batchSize ||
          typeof result.done !== 'boolean' ||
          (result.nextCursor !== null &&
            (typeof result.nextCursor !== 'string' ||
              result.nextCursor.length > 1024)) ||
          (!result.done &&
            (!result.nextCursor || result.nextCursor === current.cursor))
        ) {
          throw new Error('Invalid audience page');
        }
        /** Page-local canonical recipient uniqueness set; cross-page uniqueness is the source contract. */
        const seen = new Set<string>();
        /** Finite eligible targets staged into durable application state before enqueue side effects. */
        const pending: CampaignTarget[] = [];
        let skipped = 0;
        // Validate every audience identity and fresh consent/suppression decision before checkpointing the page.
        for (const contact of result.contacts) {
          if (
            !contact ||
            !validId(contact.id) ||
            typeof contact.email !== 'string'
          ) {
            throw new TypeError('Invalid audience contact');
          }
          /** Canonical private recipient used for segment/consent/suppression admission. */
          const email = canonical(contact.email);
          if (seen.has(email)) {
            throw new Error('Duplicate recipient in audience page');
          }
          seen.add(email);
          if (!matchesCampaignSegment({ ...contact, email }, current.segment)) {
            skipped++;
            continue;
          }
          // Consent & suppression outages stop the checkpoint; never assume eligibility.
          /** Fresh literal boolean consent; malformed/outage responses stop page advance. */
          const subscribed = await options.isSubscribed(email);
          if (typeof subscribed !== 'boolean') {
            throw new Error('Invalid consent response');
          }
          if (!subscribed) {
            skipped++;
            continue;
          }
          /** Independent fresh literal boolean suppression state; no truthy coercion. */
          const suppressed = await options.isSuppressed(email);
          if (typeof suppressed !== 'boolean') {
            throw new Error('Invalid suppression response');
          }
          if (suppressed) {
            skipped++;
            continue;
          }
          pending.push({
            messageId: makeMessageId(id, email),
            contactId: contact.id,
            recipient: email,
          });
        }
        await commit({
          cursor: result.nextCursor,
          endOfScan: result.done,
          pending,
          scanned: current.scanned + result.contacts.length,
          eligible: current.eligible + pending.length,
          skipped: current.skipped + skipped,
        });
      }
      // Process only persisted pending targets, rechecking the live lease before each idempotent side effect.
      while (current.pending.length) {
        /** First persisted pending target, retained until durable ensure/enqueue/checkpoint complete. */
        const target = current.pending[0];
        // Recheck the current state before each side effect. Consent is checked again at delivery.
        /** Latest committed lease/revision reread before checkpoint/side effects or conditional release. */
        const fresh = await options.store.load(id);
        if (
          !fresh ||
          fresh.version !== current.version ||
          fresh.status !== 'running' ||
          fresh.lease?.token !== token ||
          fresh.lease.expiresAt <= now()
        ) {
          throw new Error('Campaign paused, cancelled, or lease lost');
        }
        await options.ensureMessage(clone(target), {
          campaignId: id,
          tracking: clone(current.tracking),
        });
        await options.enqueue(target.messageId, current.sendAt);
        await commit({
          pending: current.pending.slice(1),
          queued: current.queued + 1,
        });
        processed++;
        await metric(id, 'queued');
      }
      if (current.endOfScan) {
        await commit({ status: 'completed', lease: null });
        await audit(id, 'completed');
        await metric(id, 'completed');
        return { status: 'completed', processed };
      }
      await commit({ lease: null });
      return { status: 'running', processed };
    } catch (error) {
      // Preserve pending work and cursor. A stale owner cannot release a newer lease.
      try {
        /** Latest committed lease/revision reread before checkpoint/side effects or conditional release. */
        const fresh = await options.store.load(id);
        if (fresh?.lease?.token === token) {
          await save(fresh, { lease: null });
        }
      } catch {
        /* lease expires for takeover */
      }
      throw error;
    }
  }
  return {
    create,
    command,
    runOnce,
    get: (id: string) => options.store.load(id),
  };
}
export type CampaignPlanner = ReturnType<typeof createCampaignPlanner>;
/** Read explicit campaign state at the durable-email delivery boundary without sending mail.
 * @param {CampaignStore} store - Borrowed campaign state store; caller owns durability and lifecycle.
 * @returns {(record: {campaignId?: string}) => Promise<"allow" | "defer" | "suppress">} Missing reference allows; paused/scheduled defers, cancelled suppresses, planning-complete still allows.
 */
export function createCampaignDeliveryGate(store: CampaignStore) {
  return async (record: {
    /** Optional explicit campaign binding for staging/delivery policies; not user role authority. */
    campaignId?: string;
  }): Promise<'allow' | 'defer' | 'suppress'> => {
    if (!record.campaignId) {
      return 'allow';
    }
    if (!validId(record.campaignId)) {
      throw new Error('Invalid campaign delivery reference');
    }
    /** Current planning record observed at the delivery-time gate; missing state fails closed. */
    const campaign = await store.load(record.campaignId);
    if (!campaign) {
      throw new Error('Campaign delivery state unavailable');
    }
    if (campaign.status === 'cancelled') {
      return 'suppress';
    }
    if (campaign.status === 'running' || campaign.status === 'completed') {
      return 'allow';
    }
    return 'defer';
  };
}
