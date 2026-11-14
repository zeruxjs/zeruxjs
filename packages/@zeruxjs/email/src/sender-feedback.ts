import { createHash, createHmac } from 'node:crypto';
import { addressString, validateEmailAddress } from './validation.js';
import type { EmailAddress } from './types.js';
import type { CampaignDatabaseConnection } from './campaign-storage.js';
export type SenderFeedbackKind =
  | 'accepted'
  | 'delivered'
  | 'deferred'
  | 'hard-bounce'
  | 'soft-bounce'
  | 'complaint';
export interface SenderFeedbackInput {
  /** Authenticated provider/SMTP correlation identity; syntax alone is not authorship. */
  eventId: string;
  /** Private exact outbound message reference; hashed before persistence. */
  messageId: string;
  /** Private validated mailbox input; never persisted as plaintext in this correlated ledger. */
  email: EmailAddress;
  /** Fixed authenticated acceptance/delivery/deferred/bounce/complaint observation kind. */
  kind: SenderFeedbackKind;
  /** Authenticated observation epoch; bounded against future skew before storage. */
  at: number;
}
export interface SenderFeedbackRecord {
  /** Opaque immutable keyed event identity; not an authorization capability. */
  id: string;
  /** Private tenant/site/account/provider binding digest checked on every returned record. */
  scope: string;
  /** Private keyed recipient linkage; pseudonymous rather than anonymized. */
  recipientHash: string;
  /** Private keyed outbound-message linkage; never analytics/audit labels. */
  messageHash: string;
  /** Fixed authenticated acceptance/delivery/deferred/bounce/complaint observation kind. */
  kind: SenderFeedbackKind;
  /** Authenticated observation epoch; bounded against future skew before storage. */
  at: number;
  /** Trusted local receipt epoch retained independently of event time. */
  recordedAt: number;
  /** Fixed consistency hash; verifies record meaning, not authorship or permission. */
  fingerprint: string;
}
export interface SenderFeedbackStore {
  /** Exact sender-feedback-v1 contract; unknown stores reject. */
  capability: 'sender-feedback-v1';
  /** Explicit durable/process declaration; host must qualify real durable commit/unique behavior. */
  durability: 'durable' | 'process';
  /** Insert one immutable event identity; exact duplicates return false and conflicting content rejects.
   * @param {SenderFeedbackRecord} record - Checked immutable private record; exact identity conflicts must throw.
   * @returns {Promise<boolean>} New committed insert true or exact duplicate false; host qualifies actual durable uniqueness.
   */
  append(record: SenderFeedbackRecord): Promise<boolean>;
  /** Return an explicitly scope/recipient-filtered ascending immutable-ID page.
   * @param {string} scope - Exact private tenant/site/account/provider digest; never derived from user query text.
   * @param {string | null} after - Exclusive immutable ID continuation; null starts the scope scan.
   * @param {number} limit - Requested native page size 1–500; aggregate service scan has a separate ceiling.
   * @param {string} recipientHash - Optional exact private recipient digest filter, independently verified on returned records.
   * @returns {Promise<SenderFeedbackRecord[]>} At most the requested bounded records; no cross-page snapshot isolation.
   */
  page(
    scope: string,
    after: string | null,
    limit: number,
    recipientHash?: string
  ): Promise<SenderFeedbackRecord[]>;
}
/** Derive a fixed consistency/reference digest without claiming authorship or anonymization.
 * @param {string} s - Private deterministic linkage/consistency input.
 * @returns {string} SHA-256 digest; not a signature. */
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** Validate the exact fixed digest encoding before store/query use.
 * @param {unknown} s - Candidate opaque digest.
 * @returns {boolean} True only for sixty-four lowercase hexadecimal characters. */
const hex = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
/** Fixed accepted/delivery/deferred/bounce/complaint schema vocabulary. */
const kinds: SenderFeedbackKind[] = [
  'accepted',
  'delivered',
  'deferred',
  'hard-bounce',
  'soft-bounce',
  'complaint',
];
/** Validate fixed record shape and its consistency fingerprint without treating a hash as authorship/authentication.
 * @param {SenderFeedbackRecord} input - Private fixed-shape record/input; host authenticates provider/account/recipient correlation first.
 * @returns {SenderFeedbackRecord} Detached checked private pseudonymous record; caller/store authorization stays external.
 */
function record(input: SenderFeedbackRecord) {
  if (
    !input ||
    Object.keys(input).some(
      (k) =>
        ![
          'id',
          'scope',
          'recipientHash',
          'messageHash',
          'kind',
          'at',
          'recordedAt',
          'fingerprint',
        ].includes(k)
    ) ||
    !['id', 'scope', 'recipientHash', 'messageHash', 'fingerprint'].every((k) =>
      hex(input[k as keyof SenderFeedbackRecord])
    ) ||
    !kinds.includes(input.kind) ||
    !Number.isSafeInteger(input.at) ||
    input.at < 0 ||
    !Number.isSafeInteger(input.recordedAt) ||
    input.recordedAt < 0
  ) {
    throw new TypeError('Invalid sender feedback record');
  }
  if (
    input.fingerprint !==
    hash(
      JSON.stringify([
        input.id,
        input.scope,
        input.recipientHash,
        input.messageHash,
        input.kind,
        input.kind === 'accepted' ? null : input.at,
      ])
    )
  ) {
    throw new Error('Corrupt feedback fingerprint');
  }
  return { ...input };
}
/** Create an explicitly bounded process-local reference ledger; no durable fallback is implied.
 * @param {number} maxRecords - Reference-store ceiling 1–100000, default 10000; overflow rejects.
 * @returns {SenderFeedbackStore} Local fixture with capacity failure and conflict-checked unique IDs.
 */
export function createMemorySenderFeedbackStore(
  maxRecords = 10000
): SenderFeedbackStore {
  if (
    !Number.isSafeInteger(maxRecords) ||
    maxRecords < 1 ||
    maxRecords > 100000
  ) {
    throw new RangeError('Invalid feedback capacity');
  }
  /** Bounded private primitive records retained for the local reference store or one authorized scan. */
  const rows = new Map<string, SenderFeedbackRecord>();
  return {
    capability: 'sender-feedback-v1',
    durability: 'process',
    /** Insert one immutable event identity; exact duplicates return false and conflicting content rejects.
     * @param {SenderFeedbackRecord} input - Private fixed-shape record/input; host authenticates provider/account/recipient correlation first.
     * @returns {Promise<boolean>} New committed insert true or exact duplicate false; host qualifies actual durable uniqueness.
     */
    async append(input) {
      /** Checked detached private record before unique insertion. */
      const value = record(input);
      /** Existing immutable identity; only exact consistency fingerprints count as duplicates. */
      const prior = rows.get(value.id);
      if (prior) {
        if (prior.fingerprint !== value.fingerprint) {
          throw new Error('Conflicting sender feedback identity');
        }
        return false;
      }
      if (rows.size >= maxRecords) {
        throw new Error('Sender feedback capacity reached');
      }
      rows.set(value.id, value);
      return true;
    },
    /** Return an explicitly scope/recipient-filtered ascending immutable-ID page.
     * @param {string} scope - Exact private tenant/site/account/provider digest; never derived from user query text.
     * @param {string | null} after - Exclusive immutable ID continuation; null starts the scope scan.
     * @param {number} limit - Requested native page size 1–500; aggregate service scan has a separate ceiling.
     * @param {string} recipientHash - Optional exact private recipient digest filter, independently verified on returned records.
     * @returns {Promise<SenderFeedbackRecord[]>} At most the requested bounded records; no cross-page snapshot isolation.
     */
    async page(scope, after, limit, recipientHash) {
      if (
        !hex(scope) ||
        (after !== null && !hex(after)) ||
        (recipientHash !== undefined && !hex(recipientHash)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 500
      ) {
        throw new TypeError('Invalid feedback page');
      }
      return [...rows.values()]
        .filter(
          (r) =>
            r.scope === scope &&
            (!after || r.id > after) &&
            (!recipientHash || r.recipientHash === recipientHash)
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
  };
}
/** Adapt a borrowed database to unique inserts, checked duplicates and explicit scope/recipient indexes.
 * @param {CampaignDatabaseConnection} db - Borrowed structured database; host owns unique commits, credential privacy and lifecycle.
 * @param {string} table - Validated private table identity, default zerux_sender_feedback.
 * @returns {SenderFeedbackStore} Lazy schema/record facade; real commit/unique guarantees and native close remain host-owned.
 */
export function createDatabaseSenderFeedbackStore(
  db: CampaignDatabaseConnection,
  table = 'zerux_sender_feedback'
): SenderFeedbackStore {
  if (
    !/^[a-z][a-z0-9_]{0,47}$/.test(table) ||
    !db ||
    !['createTable', 'insert', 'select'].every(
      (k) => typeof db[k as keyof CampaignDatabaseConnection] === 'function'
    )
  ) {
    throw new TypeError('Feedback database required');
  }
  let ready: Promise<void> | undefined;
  /** Coalesce explicit ledger schema/index initialization; a failed required index leaves initialization failed.

 * @returns {Promise<void>} Borrowed schema/index operations settled; no native client is owned here. */
  const ensure = () =>
    (ready ??= (async () => {
      /** Validated private primitive record, independently scoped before storage/reporting. */
      const r = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 64,
            primary: true,
            notNull: true,
          },
          { name: 'scope', type: 'varchar', length: 64, notNull: true },
          {
            name: 'recipient_hash',
            type: 'varchar',
            length: 64,
            notNull: true,
          },
          { name: 'payload_json', type: 'text', notNull: true },
        ],
      });
      if (!r.ok) {
        throw new Error('Feedback table unavailable');
      }
      if (db.createIndex) {
        // Create the explicit scope and scope/recipient keyset indexes; required index failures remain visible.
        for (const [suffix, columns] of [
          ['scope_idx', ['scope', 'id']],
          ['recipient_idx', ['scope', 'recipient_hash', 'id']],
        ] as const) {
          /** Required explicit native index result; declared support does not hide schema failure. */
          const index = await db.createIndex({
            table,
            name: table + '_' + suffix,
            columns: [...columns],
            ifNotExists: true,
          });
          if (!index.ok) {
            throw new Error('Feedback index unavailable');
          }
        }
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    }));
  /** Validate bounded stored JSON and its identity/scope/recipient columns before use.
   * @param {any} row - Private native row from the trusted structured adapter.
   * @returns {SenderFeedbackRecord} Checked private primitive record; no payload code is executed. */
  const decode = (row: any) => {
    if (
      !row ||
      typeof row.payload_json !== 'string' ||
      row.payload_json.length > 4096
    ) {
      throw new Error('Corrupt feedback row');
    }
    /** Validated private primitive record, independently scoped before storage/reporting. */
    const r = record(JSON.parse(row.payload_json));
    if (
      r.id !== row.id ||
      r.scope !== row.scope ||
      r.recipientHash !== row.recipient_hash
    ) {
      throw new Error('Feedback row scope mismatch');
    }
    return r;
  };
  return {
    capability: 'sender-feedback-v1',
    durability: 'durable',
    /** Insert one immutable event identity; exact duplicates return false and conflicting content rejects.
     * @param {SenderFeedbackRecord} input - Private fixed-shape record/input; host authenticates provider/account/recipient correlation first.
     * @returns {Promise<boolean>} New committed insert true or exact duplicate false; host qualifies actual durable uniqueness.
     */
    async append(input) {
      /** Validated private primitive record, independently scoped before storage/reporting. */
      const r = record(input);
      await ensure();
      let cause: unknown;
      try {
        /** Actual unique insert outcome; failed/unknown insert is reconciled by exact identity lookup. */
        const added = await db.insert({
          table,
          values: {
            id: r.id,
            scope: r.scope,
            recipient_hash: r.recipientHash,
            payload_json: JSON.stringify(r),
          },
        });
        if (added.ok) {
          return true;
        }
      } catch (error) {
        cause = error;
      }
      /** Private native read result checked before trusting duplicate or page records. */
      const result = await db.select({
        table,
        columns: ['id', 'scope', 'recipient_hash', 'payload_json'],
        where: { field: 'id', operator: 'eq', value: r.id },
        limit: 1,
      });
      if (!result.ok || !result.rows?.length) {
        throw new Error('Feedback persistence unavailable', { cause });
      }
      /** Existing immutable identity; only exact consistency fingerprints count as duplicates. */
      const prior = decode(result.rows[0]);
      if (prior.fingerprint !== r.fingerprint) {
        throw new Error('Conflicting sender feedback identity');
      }
      return false;
    },
    /** Return an explicitly scope/recipient-filtered ascending immutable-ID page.
     * @param {string} scope - Exact private tenant/site/account/provider digest; never derived from user query text.
     * @param {string | null} after - Exclusive immutable ID continuation; null starts the scope scan.
     * @param {number} limit - Requested native page size 1–500; aggregate service scan has a separate ceiling.
     * @param {string} recipientHash - Optional exact private recipient digest filter, independently verified on returned records.
     * @returns {Promise<SenderFeedbackRecord[]>} At most the requested bounded records; no cross-page snapshot isolation.
     */
    async page(scope, after, limit, recipientHash) {
      if (
        !hex(scope) ||
        (after !== null && !hex(after)) ||
        (recipientHash !== undefined && !hex(recipientHash)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 500
      ) {
        throw new TypeError('Invalid feedback page');
      }
      await ensure();
      /** Private native read result checked before trusting duplicate or page records. */
      const result = await db.select({
        table,
        columns: ['id', 'scope', 'recipient_hash', 'payload_json'],
        where: {
          and: [
            { field: 'scope', operator: 'eq', value: scope },
            ...(after ? [{ field: 'id', operator: 'gt', value: after }] : []),
            ...(recipientHash
              ? [
                  {
                    field: 'recipient_hash',
                    operator: 'eq',
                    value: recipientHash,
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ by: 'id', direction: 'asc' }],
        limit,
      });
      if (!result.ok || !Array.isArray(result.rows)) {
        throw new Error('Feedback read unavailable');
      }
      return result.rows.map(decode);
    },
  };
}
export interface SenderReputationReport {
  /** Fixed version-one report coverage/schema identity. */
  version: 1;
  /** Inclusive UTC accepted-cohort start. */
  from: number;
  /** Exclusive UTC accepted-cohort end; event arrival may occur later. */
  until: number;
  /** Trusted observation time for retained evidence; not a database snapshot pin. */
  asOf: number;
  /** Distinct retained accepted message/recipient pairs in the cohort. */
  denominator: number;
  /** Distinct per-kind retained outcomes; categories may overlap and must not be summed as exclusive states. */
  counts: Record<
    'accepted' | 'delivered' | 'hardBounces' | 'softBounces' | 'complaints',
    number
  >;
  /** Per-kind percentages relative to the accepted cohort; null when denominator is zero. */
  rates: {
    /** Authenticated reported-delivery percentage, not proven inbox placement. */
    deliveryPercent: number | null;
    /** Reported hard-bounce percentage for the retained accepted cohort. */
    bouncePercent: number | null;
    /** Reported soft-bounce percentage for the retained accepted cohort. */
    softBouncePercent: number | null;
    /** Reported complaint percentage for the retained accepted cohort. */
    complaintPercent: number | null;
  };
  /** At most ninety-one ordered UTC acceptance-day count rows. */
  days: Array<{
    /** Canonical UTC calendar day of acceptance, not feedback arrival. */
    day: string;
    /** Distinct retained accepted message/recipient pairs; SMTP acceptance is not inbox delivery. */
    accepted: number;
    /** Distinct authenticated reported deliveries for accepted pairs. */
    delivered: number;
    /** Distinct reported hard-bounce pairs within the accepted cohort. */
    hardBounces: number;
    /** Distinct reported soft-bounce pairs within the accepted cohort. */
    softBounces: number;
    /** Distinct reported complaint pairs within the accepted cohort. */
    complaints: number;
  }>;
  /** Explicit retained-history, correlation, clock and durability limits. */
  coverage: {
    /** Fixed accepted-message-recipient-cohort denominator contract. */
    basis: 'accepted-message-recipient-cohort';
    /** Fixed authenticated-reported-only coverage; missing reports are not successful delivery. */
    feedback: 'authenticated-reported-only';
    /** Always false: paged reads do not pin a cross-page database snapshot. */
    snapshotConsistent: false;
    /** Retained as-of records returned to this calculation; not a physical native-read counter. */
    scanned: number;
    /** Distinct outcomes without a retained acceptance in this selected cohort. */
    unmatchedFeedback: number;
    /** Distinct correlated outcomes first recorded at/after the cohort end. */
    lateFeedback: number;
    /** Explicit durable/process declaration; host must qualify real durable commit/unique behavior. */
    durability: 'durable' | 'process';
    /** Always true; this is a local reported-observation view. */
    heuristic: true;
    /** Always not-measured; no mailbox/provider grade is inferred. */
    providerReputation: 'not-measured';
    /** Always not-measured; no SPF/DKIM/DMARC/DNS proof is synthesized. */
    dnsAuthentication: 'not-measured';
  };
}
/** Bind an explicit tenant/site/account/provider and copied private HMAC key to one declared-capability ledger.
 * @param {{
  store: SenderFeedbackStore;
  tenant: string;
  site: string;
  account: string;
  provider: string;
  lookupKey: Uint8Array;
  requireDurable?: boolean;
  scanLimit?: number;
  softBounceThreshold?: number;
  now?: () => number;
}} options - Explicit host-verified scope, private key/store or endpoint authorization policy.
 * @param {SenderFeedbackStore} options.store - Explicit declared-capability committed ledger.
 * @param {string} options.tenant - Host-verified tenant binding.
 * @param {string} options.site - Host-verified site binding.
 * @param {string} options.account - Exact configured sending account.
 * @param {string} options.provider - Authenticated provider identity.
 * @param {Uint8Array} options.lookupKey - Exactly 32 private bytes copied on construction.
 * @param {boolean} options.requireDurable - Defaults true; process fixtures require explicit false.
 * @param {number} options.scanLimit - Retained-history ceiling 1–100000, default 10000.
 * @param {number} options.softBounceThreshold - Distinct soft-message threshold 1–20, default three.
 * @param {() => number} options.now - Optional trusted safe epoch clock.
 * @returns {object} Private validation/record/suppression/report APIs; no automatic collection or key rotation.
 */
export function createSenderFeedbackService(options: {
  /** Explicit declared-capability ledger; no automatic remote/memory fallback. */
  store: SenderFeedbackStore;
  /** Host-verified tenant binding; never a browser role/tenant string assertion. */
  tenant: string;
  /** Host-verified site binding within the configured tenant. */
  site: string;
  /** Host-verified sending account binding. */
  account: string;
  /** Host-verified feedback provider identity; no arbitrary endpoint fetch. */
  provider: string;
  /** Exactly 32 private bytes copied on construction; host owns key retention/rotation/migration. */
  lookupKey: Uint8Array;
  /** Defaults true; process fixtures require explicit false. */
  requireDurable?: boolean;
  /** Retained-history ceiling 1–100000, default 10000; overflow rejects. */
  scanLimit?: number;
  /** Distinct soft-bounced message threshold 1–20, default three. */
  softBounceThreshold?: number;
  /** Optional trusted safe epoch clock, default Date.now. */
  now?: () => number;
}) {
  if (
    !options ||
    (options.now !== undefined && typeof options.now !== 'function') ||
    (options.requireDurable !== undefined &&
      typeof options.requireDurable !== 'boolean') ||
    options.store?.capability !== 'sender-feedback-v1' ||
    !['durable', 'process'].includes(options.store.durability) ||
    typeof options.store.append !== 'function' ||
    typeof options.store.page !== 'function' ||
    (options.requireDurable !== false &&
      options.store.durability !== 'durable') ||
    !['tenant', 'site', 'account', 'provider'].every(
      (k) =>
        typeof options[k as 'tenant'] === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(options[k as 'tenant'])
    ) ||
    !(options.lookupKey instanceof Uint8Array) ||
    options.lookupKey.length !== 32
  ) {
    throw new TypeError('Tenant-bound durable feedback configuration required');
  }
  /** Explicit declared-capability ledger; no silent process fallback for required durable mode. */
  const store = options.store;
  /** Stable tenant/site/account/provider binding; user report parameters cannot replace it. */
  const scope = hash(
    JSON.stringify([
      options.tenant,
      options.site,
      options.account,
      options.provider,
    ])
  );
  /** Private copied HMAC lookup key; host owns retention/rotation/migration and access. */
  const key = Buffer.from(options.lookupKey);
  /** Explicit trusted clock, default Date.now. */
  const now = options.now ?? Date.now;
  /** Retained-history scan ceiling, default ten thousand; overflow fails coverage closed. */
  const limit = options.scanLimit ?? 10000;
  /** Distinct soft-bounced message threshold, default three, maximum twenty. */
  const threshold = options.softBounceThreshold ?? 3;
  /** Fixed configured sending account; recordAccepted rejects another account. */
  const account = options.account;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100000 ||
    !Number.isSafeInteger(threshold) ||
    threshold < 1 ||
    threshold > 20
  ) {
    throw new RangeError('Invalid sender feedback limits');
  }
  /** HMAC private linkage values with the copied host key.
   * @param {string} s - Private recipient/message/event reference data.
   * @returns {string} Keyed private pseudonymous digest, never proof of permission. */
  const digest = (s: string) =>
    createHmac('sha256', key).update(s).digest('hex');
  /** Validate and canonicalize a mailbox before private keyed linkage.
   * @param {EmailAddress} email - Private literal/structured mailbox.
   * @returns {string} Private keyed recipient hash; never a telemetry label. */
  const recipient = (email: EmailAddress) =>
    digest(addressString(validateEmailAddress(email)).toLowerCase());
  /** Validate exact correlated input and derive scope-bound immutable private record identity/meaning.
   * @param {SenderFeedbackInput} input - Authenticated host/provider correlation data.
   * @returns {SenderFeedbackRecord} Checked primitive record; preparation performs no persistence. */
  const prepare = (input: SenderFeedbackInput): SenderFeedbackRecord => {
    /** Trusted receipt/acceptance epoch captured for this one operation. */
    const at = now();
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      !input ||
      Object.keys(input).some(
        (k) => !['eventId', 'messageId', 'email', 'kind', 'at'].includes(k)
      ) ||
      typeof input.eventId !== 'string' ||
      !/^[A-Za-z0-9:_./-]{1,160}$/.test(input.eventId) ||
      typeof input.messageId !== 'string' ||
      !input.messageId ||
      input.messageId.length > 512 ||
      /[\r\n\0]/.test(input.messageId) ||
      !kinds.includes(input.kind) ||
      !Number.isSafeInteger(input.at) ||
      input.at < 0 ||
      input.at > at + 300000
    ) {
      throw new TypeError('Invalid correlated feedback');
    }
    /** Private keyed mailbox linkage; remains personal linkage under host privacy policy. */
    const recipientHash = recipient(input.email);
    /** Private keyed exact outbound-message linkage. */
    const messageHash = digest(input.messageId);
    /** Opaque immutable scoped event or report-pair key; never an authorization capability. */
    const id = digest(
      JSON.stringify([
        scope,
        input.kind === 'accepted' ? 'smtp' : 'provider',
        input.eventId,
        recipientHash,
      ])
    );
    /** Unkeyed meaning-consistency hash; accepted replays intentionally ignore later acceptance-time changes. */
    const fingerprint = hash(
      JSON.stringify([
        id,
        scope,
        recipientHash,
        messageHash,
        input.kind,
        input.kind === 'accepted' ? null : input.at,
      ])
    );
    return {
      id,
      scope,
      recipientHash,
      messageHash,
      kind: input.kind,
      at: input.at,
      recordedAt: at,
      fingerprint,
    };
  };
  /** Validate every bounded keyset record and enforce scope/order/recipient fences before report assembly.
   * @param {string} recipientHash - Optional exact private recipient digest filter, independently verified on returned records.
   * @param {number} asOf - Trusted report observation epoch; future-recorded rows are excluded from returned evidence.
   * @param {AbortSignal} signal - Optional cooperative report cancellation checked between bounded page operations.
   * @returns {Promise<SenderFeedbackRecord[]>} As-of retained rows; overflow/outage rejects coverage rather than returning sampled suppression.
   */
  async function scan(
    recipientHash?: string,
    asOf = now(),
    signal?: AbortSignal
  ) {
    /** Honor cooperative report cancellation before/after bounded page reads.

 * @returns {void} Throws only a fixed cancellation code/message; native reads retain their own ownership. */
    const check = () => {
      if (signal?.aborted) {
        throw Object.assign(new Error('Sender report cancelled'), {
          code: 'EMAIL_REPORT_CANCELLED',
        });
      }
    };
    check();
    /** Bounded private primitive records retained for the local reference store or one authorized scan. */
    const rows: SenderFeedbackRecord[] = [];
    let after: string | null = null;
    // Keep every native page within both the per-page and total retained-history ceiling.
    while (rows.length < limit) {
      check();
      /** Next native page size bounded by five hundred and remaining retained-history capacity. */
      const take = Math.min(500, limit - rows.length);
      /** Scope/recipient/order-checked native page; foreign or nonprogressing records reject. */
      const batch = await store.page(scope, after, take, recipientHash);
      check();
      if (!Array.isArray(batch) || batch.length > take) {
        throw new Error('Invalid feedback page');
      }
      // Check each primitive record scope, recipient and strict continuation before including any report evidence.
      for (const raw of batch) {
        /** Validated private primitive record, independently scoped before storage/reporting. */
        const r = record(raw);
        if (
          r.scope !== scope ||
          (recipientHash && r.recipientHash !== recipientHash) ||
          (after && r.id <= after)
        ) {
          throw new Error('Feedback isolation/order violation');
        }
        after = r.id;
        rows.push(r);
      }
      if (batch.length < take) {
        return rows.filter((r) => r.recordedAt <= asOf);
      }
    }
    if ((await store.page(scope, after, 1, recipientHash)).length) {
      throw new Error('Feedback scan limit reached; coverage unavailable');
    }
    return rows.filter((r) => r.recordedAt <= asOf);
  }
  return {
    /** Prepare and validate one correlated input without persisting it.
     * @param {SenderFeedbackInput} input - Private fixed-shape record/input; host authenticates provider/account/recipient correlation first.
     * @returns {void} Malformed private data rejects; schema validation is not provider authorization.
     */
    validateFeedback(input: SenderFeedbackInput) {
      prepare(input);
    },
    /** Prepare one authenticated host input and submit its immutable identity to the supplied ledger.
     * @param {SenderFeedbackInput} input - Private fixed-shape record/input; host authenticates provider/account/recipient correlation first.
     * @returns {Promise<boolean>} New insert or exact duplicate; no binary/provider payload is stored.
     */
    recordFeedback(input: SenderFeedbackInput) {
      /** Validated private primitive record, independently scoped before storage/reporting. */
      const r = prepare(input);
      return store.append(r);
    },
    /** Record one actual SMTP-accepted recipient for this exact configured account.
     * @param {string} name - Exact configured sending account; other account identities reject.
     * @param {EmailAddress} email - Private validated recipient, HMACed before ledger storage.
     * @param {string} messageId - Private exact outbound identity; never public analytics/audit labels.
     * @param {number} at - Optional actual acceptance epoch, default trusted clock.
     * @returns {Promise<boolean>} First retained identity wins; SMTP acceptance is not inbox delivery.
     */
    recordAccepted(
      name: string,
      email: EmailAddress,
      messageId: string,
      at = now()
    ) {
      if (name !== account) {
        throw new TypeError('Sender account mismatch');
      }
      return store.append(
        prepare({
          eventId: hash(messageId),
          messageId,
          email,
          kind: 'accepted',
          at,
        })
      );
    },
    /** Read the complete bounded recipient history and fail closed on unavailable coverage.
     * @param {EmailAddress} email - Private validated recipient, HMACed before ledger storage.
     * @returns {Promise<boolean>} True for any retained hard bounce/complaint or threshold distinct soft-bounced messages.
     */
    async isSuppressed(email: EmailAddress) {
      /** Bounded private primitive records retained for the local reference store or one authorized scan. */
      const rows = await scan(recipient(email));
      if (
        rows.some((r) => r.kind === 'hard-bounce' || r.kind === 'complaint')
      ) {
        return true;
      }
      return (
        new Set(
          rows.filter((r) => r.kind === 'soft-bounce').map((r) => r.messageHash)
        ).size >= threshold
      );
    },
    /** Request the completed rolling UTC cohort window through the same bounded report validation.
     * @param {number} windowMs - Requested rolling duration, default seven days; report validates a maximum ninety-day window.
     * @returns {Promise<SenderReputationReport>} Default seven-day retained cohort; no statistical/provider-reputation claim.
     */
    rolling(windowMs = 7 * 86400000) {
      /** Trusted exclusive completed rolling-window end. */
      const until = now();
      return this.report(Math.max(0, until - windowMs), until);
    },
    /** Assemble accepted-message/recipient cohorts and distinct authenticated outcomes in a bounded completed UTC window.
     * @param {number} from - Inclusive nonnegative UTC epoch start of the accepted cohort.
     * @param {number} until - Exclusive completed UTC epoch end, at most the current asOf time.
     * @param {AbortSignal} signal - Optional cooperative report cancellation checked between bounded page operations.
     * @returns {Promise<SenderReputationReport>} Counts, null-denominator rates and explicit retained-history/as-of/late/unmatched coverage.
     */
    async report(
      from: number,
      until: number,
      signal?: AbortSignal
    ): Promise<SenderReputationReport> {
      if (signal !== undefined && !(signal instanceof AbortSignal)) {
        throw new TypeError('Invalid report cancellation');
      }
      /** One trusted observation epoch; paged reads still do not form a pinned database snapshot. */
      const asOf = now();
      if (
        !Number.isSafeInteger(asOf) ||
        asOf < 0 ||
        asOf > 8640000000000000 ||
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(until) ||
        from < 0 ||
        until <= from ||
        until > asOf ||
        until - from > 90 * 86400000
      ) {
        throw new RangeError('Bounded completed UTC window required');
      }
      /** Bounded private primitive records retained for the local reference store or one authorized scan. */
      const rows = await scan(undefined, asOf, signal);
      /** Distinct retained accepted message/recipient pairs within the explicit UTC window. */
      const cohort = new Map<string, SenderFeedbackRecord>();
      /** Group only exact private message/recipient digest pairs.
       * @param {SenderFeedbackRecord} r - Checked primitive private record.
       * @returns {string} Private pair key used only within this report computation. */
      const identity = (r: SenderFeedbackRecord) =>
        r.messageHash + ':' + r.recipientHash;
      /** Earliest retained acceptance per exact pair; hash ordering cannot silently rebucket it. */
      const firstAccepted = new Map<string, SenderFeedbackRecord>();
      // Choose earliest retained acceptance per exact message/recipient pair independently of hash sort order.
      for (const r of rows) {
        if (r.kind === 'accepted' && r.at <= asOf) {
          /** Previously selected earliest acceptance/receipt for this exact private pair/outcome. */
          const old = firstAccepted.get(identity(r));
          if (!old || r.at < old.at) {
            firstAccepted.set(identity(r), r);
          }
        }
      }
      // Select only earliest acceptances in the requested inclusive/exclusive completed UTC cohort window.
      for (const [id, r] of firstAccepted) {
        if (r.at >= from && r.at < until) {
          cohort.set(id, r);
        }
      }
      /** Fixed distinct cohort counters; outcome categories can overlap. */
      const counts = {
        accepted: cohort.size,
        delivered: 0,
        hardBounces: 0,
        softBounces: 0,
        complaints: 0,
      };
      /** Ordered UTC acceptance-day counters, independent of feedback arrival day. */
      const days = new Map<string, SenderReputationReport['days'][number]>();
      // Create only the bounded UTC acceptance-day rows; feedback arrival never rebuckets a cohort.
      for (
        let at = Date.UTC(
          new Date(from).getUTCFullYear(),
          new Date(from).getUTCMonth(),
          new Date(from).getUTCDate()
        );
        at < until;
        at += 86400000
      ) {
        /** Canonical UTC acceptance calendar date for a bounded report day. */
        const day = new Date(at).toISOString().slice(0, 10);
        days.set(day, {
          day,
          accepted: 0,
          delivered: 0,
          hardBounces: 0,
          softBounces: 0,
          complaints: 0,
        });
      }
      // Count distinct retained accepted pairs in their original UTC acceptance day.
      for (const r of cohort.values()) {
        days.get(new Date(r.at).toISOString().slice(0, 10))!.accepted++;
      }
      /** Earliest received retained outcome for each pair/kind, deduplicated across provider event IDs. */
      const outcomes = new Map<string, SenderFeedbackRecord>();
      // Deduplicate each pair/outcome by earliest recorded receipt, excluding future and nonterminal deferred data.
      for (const r of rows) {
        if (r.at > asOf || r.kind === 'accepted' || r.kind === 'deferred') {
          continue;
        }
        /** Opaque immutable scoped event or report-pair key; never an authorization capability. */
        const id = identity(r) + ':' + r.kind;
        /** Previously selected earliest acceptance/receipt for this exact private pair/outcome. */
        const old = outcomes.get(id);
        if (!old || r.recordedAt < old.recordedAt) {
          outcomes.set(id, r);
        }
      }
      let unmatchedFeedback = 0,
        lateFeedback = 0;
      // Retain unmatched and late coverage instead of guessing missing acceptance as successful delivery.
      for (const r of outcomes.values()) {
        if (r.kind === 'accepted' || r.kind === 'deferred') {
          continue;
        }
        /** Exact matching retained cohort acceptance; missing correlation remains unmatched coverage. */
        const accepted = cohort.get(identity(r));
        if (!accepted) {
          unmatchedFeedback++;
          continue;
        }
        if (r.recordedAt >= until) {
          lateFeedback++;
        }
        /** Fixed per-kind count field; arbitrary labels or recipient values are never emitted. */
        const metric = (
          {
            delivered: 'delivered',
            'hard-bounce': 'hardBounces',
            'soft-bounce': 'softBounces',
            complaint: 'complaints',
          } as const
        )[r.kind];
        counts[metric]++;
        days.get(new Date(accepted.at).toISOString().slice(0, 10))![metric]++;
      }
      /** Compute a cohort percentage while preserving unknown zero-denominator coverage as null.
       * @param {number} n - Distinct validated retained outcome count.
       * @returns {number | null} Percent of accepted cohort, or null when no denominator exists. */
      const rate = (n: number) =>
        counts.accepted ? (100 * n) / counts.accepted : null;
      return {
        version: 1,
        from,
        until,
        asOf,
        denominator: counts.accepted,
        counts,
        rates: {
          deliveryPercent: rate(counts.delivered),
          bouncePercent: rate(counts.hardBounces),
          softBouncePercent: rate(counts.softBounces),
          complaintPercent: rate(counts.complaints),
        },
        days: [...days.values()],
        coverage: {
          basis: 'accepted-message-recipient-cohort',
          feedback: 'authenticated-reported-only',
          snapshotConsistent: false,
          scanned: rows.length,
          unmatchedFeedback,
          lateFeedback,
          durability: store.durability,
          heuristic: true,
          providerReputation: 'not-measured',
          dnsAuthentication: 'not-measured',
        },
      };
    },
  };
}
/** Validate count/day/coverage consistency before projecting fixed Reports-compatible UTC trend data.
 * @param {SenderReputationReport} report - Version-one retained-cohort report; counts/days are checked before chart projection.
 * @returns {Record<"accepted" | "delivered" | "bounces" | "softBounces" | "complaints", object>} Count-only chart records with denominator/coverage; no Reports runtime dependency or recipient linkage.
 */
export function senderReputationCharts(report: SenderReputationReport) {
  if (
    report?.version !== 1 ||
    report.coverage?.basis !== 'accepted-message-recipient-cohort' ||
    report.coverage.feedback !== 'authenticated-reported-only' ||
    !Array.isArray(report.days) ||
    report.days.length > 91 ||
    report.denominator !== report.counts.accepted ||
    Object.values(report.counts).some((v) => !Number.isSafeInteger(v) || v < 0)
  ) {
    throw new TypeError('Invalid sender report');
  }
  /** Fixed allowed cohort/day counters checked before chart projection. */
  const fields = [
    'accepted',
    'delivered',
    'hardBounces',
    'softBounces',
    'complaints',
  ] as const;
  if (
    !Number.isSafeInteger(report.coverage.scanned) ||
    report.coverage.scanned < report.denominator ||
    report.days.some((d, i) => {
      /** Previous daily record used to enforce chronological ordering. */
      const previous = report.days[i - 1];
      return (
        !d ||
        typeof d.day !== 'string' ||
        !/^\d{4}-\d\d-\d\d$/.test(d.day) ||
        !Number.isFinite(Date.parse(d.day + 'T00:00:00Z')) ||
        new Date(d.day + 'T00:00:00Z').toISOString().slice(0, 10) !== d.day ||
        (i > 0 && previous !== undefined && d.day <= previous.day) ||
        fields.some((k) => !Number.isSafeInteger(d[k]) || d[k] < 0)
      );
    }) ||
    fields.some(
      (k) =>
        report.days.reduce((n, d) => n + d[k], 0) !== report.counts[k] ||
        report.counts[k] > report.denominator
    )
  ) {
    throw new TypeError('Invalid sender trend counts');
  }
  /** Build fixed Reports-compatible count-only UTC trend data without importing the Reports runtime.
   * @param {"accepted" | "delivered" | "hardBounces" | "softBounces" | "complaints"} field - Fixed validated aggregate field.
   * @param {string} title - Fixed authored chart caption, never a recipient/provider response.
   * @returns {object} Count-only line/table-compatible chart specification with explicit local coverage. */
  const make = (
    field:
      | 'accepted'
      | 'delivered'
      | 'hardBounces'
      | 'softBounces'
      | 'complaints',
    title: string
  ) => ({
    id: 'sender_' + field,
    title,
    type: 'line' as const,
    labels: report.days.map((d) => d.day),
    values: report.days.map((d) => d[field]),
    total: report.counts[field],
    sampledRows: report.coverage.scanned,
    truncated: false,
    coverage:
      'accepted-message-recipient-cohort; authenticated reported feedback only; local heuristic; no DNS/provider score',
  });
  return {
    accepted: make('accepted', 'SMTP-accepted cohort denominator by UTC day'),
    delivered: make(
      'delivered',
      'Provider-reported delivery for the accepted cohort'
    ),
    bounces: make(
      'hardBounces',
      'Reported hard bounces for the accepted cohort'
    ),
    softBounces: make(
      'softBounces',
      'Reported soft bounces for the accepted cohort'
    ),
    complaints: make(
      'complaints',
      'Reported complaints for the accepted cohort'
    ),
  };
}
/** Require fresh host authorization before resolving a dedicated tenant-bound report service.
 * @param {{
  authorize: (request: Request) => boolean | Promise<boolean>;
  resolveService: (
    request: Request
  ) =>
    | ReturnType<typeof createSenderFeedbackService>
    | Promise<ReturnType<typeof createSenderFeedbackService>>;
  path?: string;
}} options - Explicit host-verified scope, private key/store or endpoint authorization policy.
 * @param {(request: Request) => boolean | Promise<boolean>} options.authorize - Fresh tenant/site authorization before resolving a source.
 * @param {(request: Request) => ReturnType<typeof createSenderFeedbackService> | Promise<ReturnType<typeof createSenderFeedbackService>>} options.resolveService - Explicit trusted scoped service resolver.
 * @param {string} options.path - Explicit validated host route declaration.
 * @returns {object} Explicit GET endpoint declarations with private no-store JSON and fixed redacted errors.
 */
export function createSenderReputationReportEndpoint(options: {
  /** Fresh request authorization must enforce this tenant/site before source resolution. */
  authorize: (request: Request) => boolean | Promise<boolean>;
  /** Explicit trusted scoped resolver; never provider/tenant selection from arbitrary query data. */
  resolveService: (
    request: Request
  ) =>
    | ReturnType<typeof createSenderFeedbackService>
    | Promise<ReturnType<typeof createSenderFeedbackService>>;
  /** Validated explicit route declaration, default /_email/sender-report; host owns mount matching. */
  path?: string;
}) {
  if (
    typeof options?.authorize !== 'function' ||
    typeof options.resolveService !== 'function'
  ) {
    throw new TypeError('Sender report authorization required');
  }
  /** Explicit validated host GET route declaration, default /_email/sender-report. */
  const path = options.path ?? '/_email/sender-report';
  if (
    !/^\/[A-Za-z0-9/_-]+$/.test(path) ||
    path.includes('//') ||
    path.endsWith('/')
  ) {
    throw new TypeError('Invalid sender report path');
  }
  /** Serialize only an authorized report/count or fixed error projection with private no-store headers.
   * @param {unknown} value - Internal count/coverage or fixed error object.
   * @param {number} status - Explicit status, default 200.
   * @returns {Response} Private JSON with Cookie/Authorization variation and no raw provider/storage cause. */
  const response = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
        vary: 'Cookie, Authorization',
        'x-content-type-options': 'nosniff',
      },
    });
  /** Authorize before resolving a scoped source and accept only bounded exact from/until query values.
   * @param {Request} request - One host-routed explicit GET request.
   * @returns {Promise<Response>} Authorized private report/charts or fixed redacted error status. */
  const handle = async (request: Request) => {
    try {
      if ((await options.authorize(request)) !== true) {
        return response({ error: 'FORBIDDEN' }, 403);
      }
    } catch {
      return response({ error: 'FORBIDDEN' }, 403);
    }
    if (request.method !== 'GET') {
      return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }
    /** Untrusted query parameters restricted to exactly one from and one until. */
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some((k) => !['from', 'until'].includes(k)) ||
      params.getAll('from').length !== 1 ||
      params.getAll('until').length !== 1 ||
      !/^\d{1,16}$/.test(params.get('from') ?? '') ||
      !/^\d{1,16}$/.test(params.get('until') ?? '')
    ) {
      return response({ error: 'INVALID_WINDOW' }, 422);
    }
    try {
      /** Explicit host-resolved tenant-bound report service, never an arbitrary endpoint/module. */
      const service = await options.resolveService(request);
      /** Authorized bounded retained-cohort result projected without private linkage values. */
      const report = await service.report(
        Number(params.get('from')),
        Number(params.get('until')),
        request.signal
      );
      return response({ report, charts: senderReputationCharts(report) });
    } catch (error) {
      if (
        (
          error as {
            /** Fixed cancellation code used only for redacted HTTP status mapping. */
            code?: string;
          }
        )?.code === 'EMAIL_REPORT_CANCELLED'
      ) {
        return response({ error: 'CANCELLED' }, 408);
      }
      return response(
        {
          error:
            error instanceof RangeError
              ? 'INVALID_WINDOW'
              : 'REPORT_UNAVAILABLE',
        },
        error instanceof RangeError ? 422 : 503
      );
    }
  };
  return { path, handle, routes: () => [{ pattern: path, handler: handle }] };
}
