import type { DatabaseTransaction, TransactionDatabase } from '@zeruxjs/db';
export interface ActionClaim {
  /** Principal/application/action-bound opaque reservation fingerprint, not raw identity. */
  readonly key: string;
  /** Canonical validated-input fingerprint; no private submitted values are stored here. */
  readonly digest: string;
  /** Unique exact claimant token used for completion CAS. */
  readonly owner: string;
  /** Absolute signed claim expiry including the declared retention/skew policy. */
  readonly expiresAt: number;
}
export type ActionClaimStatus =
  | 'claimed'
  | 'committed'
  | 'pending'
  | 'conflict';
/** Host-owned durable journal. reserve must atomically create-if-absent or compare
 * the fingerprint; never recycle a pending claim to authorize a retry. Expiry
 * cleanup must wait until no signed key is acceptable on any participating instance.
 * finish must CAS this exact owner/fingerprint and use the supplied transaction. */
export interface ActionJournal<T> {
  /** Explicit host guarantee of durable persistence; memory storage cannot claim this. */
  readonly durable: true;
  /** Atomically reserve a create-only fingerprint or report its existing exact disposition.
   * @param {T} tx - Real host transaction pin.
   * @param {ActionClaim} claim - Opaque signed-key/input fingerprints and exact claimant.
   * @returns {ActionClaimStatus | Promise<ActionClaimStatus>} Declared disposition; pending/uncertain claims are never recycled automatically.
   */
  reserve(
    tx: T,
    claim: ActionClaim
  ): ActionClaimStatus | Promise<ActionClaimStatus>;
  /** CAS the exact pending owner/fingerprint to committed on the same pin as the business write.
   * @param {T} tx - Real host transaction pin.
   * @param {ActionClaim} claim - Exact owner and input fingerprint to complete.
   * @returns {boolean | Promise<boolean>} True only for exact affected ownership.
   */
  finish(tx: T, claim: ActionClaim): boolean | Promise<boolean>;
}
export interface ActionStore<T> {
  /** Required exact atomic journal contract discriminator. */
  readonly capability: 'action-atomic-v1';
  /** Explicit host guarantee of durable persistence; memory storage cannot claim this. */
  readonly durable: true;
  /** Whether action writes must remain synchronous across the transaction pin. */
  readonly synchronous: boolean;
  /** Persist or reconcile one durable reservation before admitting a business write.
   * @param {ActionClaim} claim - Host-created opaque claim.
   * @param {AbortSignal} signal - Cooperative caller cancellation.
   * @param {number} deadline - Absolute execution deadline bounded by signed expiry.
   * @returns {Promise<ActionClaimStatus>} Durable reservation result; unknown outcomes are not permission to replay.
   */
  claim(
    claim: ActionClaim,
    signal: AbortSignal,
    deadline: number
  ): Promise<ActionClaimStatus>;
  /** Run the business write and exact journal completion on one real transaction pin.
   * @param {ActionClaim} claim - Previously reserved exact owner/fingerprint.
   * @param {(tx: T) => void | Promise<void>} write - Database-only callback; no external side effects.
   * @param {AbortSignal} signal - Cooperative execution cancellation.
   * @param {number} deadline - Absolute execution deadline bounded by signed expiry.
   * @returns {Promise<void>} Confirmed transaction completion or a failure requiring reconciliation.
   */
  commit(
    claim: ActionClaim,
    write: (tx: T) => void | Promise<void>,
    signal: AbortSignal,
    deadline: number
  ): Promise<void>;
}
import { validateClaimOptions, claimStatus } from './action-claim.js';
/** Borrow an explicitly durable journal and negotiated pinned transaction without callback replay.
 * @param {{ transaction: DatabaseTransaction; journal: ActionJournal<TransactionDatabase>; }} options - Host-owned transaction and journal contracts.
 * @param {DatabaseTransaction} options.transaction - Borrowed real pinned transaction runner.
 * @param {ActionJournal<TransactionDatabase>} options.journal - Host-owned physically durable journal.
 * @returns {ActionStore<TransactionDatabase>} Inert store adapter; ownership of durable storage remains with the host.
 */
export function createPinnedActionStore(options: {
  transaction: DatabaseTransaction;
  journal: ActionJournal<TransactionDatabase>;
}): ActionStore<TransactionDatabase> {
  if (
    !options ||
    typeof options.transaction !== 'function' ||
    options.journal?.durable !== true ||
    typeof options.journal.reserve !== 'function' ||
    typeof options.journal.finish !== 'function'
  ) {
    throw Error('Pinned action journal required');
  }
  /** Borrowed real pinned transaction runner; this adapter never closes the database. */
  const transaction = options.transaction;
  /** Bound host-owned reserve/finish methods sharing the supplied transaction pin. */
  const journal = {
    reserve: options.journal.reserve.bind(options.journal),
    finish: options.journal.finish.bind(options.journal),
  };
  return Object.freeze({
    capability: 'action-atomic-v1',
    durable: true,
    synchronous: false,
    /** Persist or reconcile one durable reservation before admitting a business write.
     * @param {ActionClaim} claim - Host-created opaque claim.
     * @param {AbortSignal} signal - Cooperative caller cancellation.
     * @param {number} deadline - Absolute execution deadline bounded by signed expiry.
     * @returns {Promise<ActionClaimStatus>} Durable reservation result; unknown outcomes are not permission to replay.
     */
    async claim(claim: ActionClaim, signal: AbortSignal, deadline: number) {
      return claimStatus(
        await transaction(
          (tx) => journal.reserve(tx, claim),
          validateClaimOptions(claim, signal, deadline)
        )
      );
    },
    /** Run the business write and exact journal completion on one real transaction pin.
     * @param {ActionClaim} claim - Previously reserved exact owner/fingerprint.
     * @param {(tx: TransactionDatabase) => void | Promise<void>} write - Database-only callback; no external side effects.
     * @param {AbortSignal} signal - Cooperative execution cancellation.
     * @param {number} deadline - Absolute execution deadline bounded by signed expiry.
     * @returns {Promise<void>} Confirmed transaction completion or a failure requiring reconciliation.
     */
    async commit(
      claim: ActionClaim,
      write: (tx: TransactionDatabase) => void | Promise<void>,
      signal: AbortSignal,
      deadline: number
    ) {
      await transaction(
        async (tx) => {
          await write(tx);
          if ((await journal.finish(tx, claim)) !== true) {
            throw Error('Action journal ownership lost');
          }
        },
        validateClaimOptions(claim, signal, deadline)
      );
    },
  });
}
