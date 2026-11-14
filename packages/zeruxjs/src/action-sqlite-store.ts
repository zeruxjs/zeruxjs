import type {
  SqliteSyncTransactionRunner,
  SqliteSyncTransaction,
} from '@zeruxjs/db-sqlite';
import type {
  ActionStore,
  ActionClaim,
  ActionClaimStatus,
} from './action-stores.js';
import { validateClaimOptions, claimStatus } from './action-claim.js';
export interface SynchronousActionJournal {
  /** Host-declared physical persistence; in-memory SQLite is not a durable journal. */
  readonly durable: true;
  /** Reserve or reconcile an exact durable claim synchronously on the supplied SQLite pin.
   * @param {SqliteSyncTransaction} tx - Borrowed synchronous SQLite transaction.
   * @param {ActionClaim} claim - Opaque exact claim.
   * @returns {ActionClaimStatus} Declared reservation disposition.
   */
  reserve(tx: SqliteSyncTransaction, claim: ActionClaim): ActionClaimStatus;
  /** Complete the exact pending claimant synchronously with the business write.
   * @param {SqliteSyncTransaction} tx - Borrowed synchronous SQLite transaction.
   * @param {ActionClaim} claim - Exact owner/input fingerprint.
   * @returns {boolean} True only when the expected claimant was completed.
   */
  finish(tx: SqliteSyncTransaction, claim: ActionClaim): boolean;
}
/** Borrow a durable synchronous journal and native SQLite transaction runner without owning their lifecycle.
 * @param {{ transactionSync: SqliteSyncTransactionRunner; journal: SynchronousActionJournal; }} input - Explicit host-qualified synchronous persistence contracts.
 * @param {SqliteSyncTransactionRunner} input.transactionSync - Borrowed synchronous runner.
 * @param {SynchronousActionJournal} input.journal - Host-owned physically durable synchronous journal.
 * @returns {ActionStore<SqliteSyncTransaction>} Inert synchronous store adapter; pending claims survive write failures.
 */
export function createSqliteActionStore(input: {
  transactionSync: SqliteSyncTransactionRunner;
  journal: SynchronousActionJournal;
}): ActionStore<SqliteSyncTransaction> {
  if (
    !input ||
    typeof input.transactionSync !== 'function' ||
    input.journal?.durable !== true ||
    typeof input.journal.reserve !== 'function' ||
    typeof input.journal.finish !== 'function'
  ) {
    throw Error('SQLite action journal required');
  }
  /** Borrowed SQLite synchronous transaction runner; never await across its callback. */
  const transaction = input.transactionSync;
  /** Bound synchronous durable reserve/finish methods owned by the host. */
  const journal = {
    reserve: input.journal.reserve.bind(input.journal),
    finish: input.journal.finish.bind(input.journal),
  };
  /** Reject thenables before a synchronous transaction can claim successful completion.
   * @param {T} value - Immediate callback result.
   * @returns {T} Original nonthenable value, otherwise an explicit error.
   */
  const synchronous = <T>(value: T): T => {
    if (value && typeof (value as any).then === 'function') {
      void Promise.resolve(value).catch(() => {});
      throw Error('Async work in synchronous action');
    }
    return value;
  };
  /** Translate the validated absolute deadline to SQLite’s bounded synchronous timeout policy.
   * @param {ActionClaim} claim - Exact signed claim.
   * @param {AbortSignal} signal - Cooperative caller cancellation.
   * @param {number} deadline - Absolute signed-expiry-bounded deadline.
   * @returns {{signal: AbortSignal, timeoutMs: number}} Native synchronous transaction policy.
   */
  const settings = (
    claim: ActionClaim,
    signal: AbortSignal,
    deadline: number
  ) => {
    validateClaimOptions(claim, signal, deadline);
    return {
      signal,
      timeoutMs: Math.max(1, Math.min(60000, deadline - Date.now())),
    };
  };
  return Object.freeze({
    capability: 'action-atomic-v1',
    durable: true,
    synchronous: true,
    /** Persist a reservation inside one synchronous SQLite transaction.
     * @param {ActionClaim} claim - Host-created signed reservation.
     * @param {AbortSignal} signal - Cooperative cancellation.
     * @param {number} deadline - Absolute expiry-bounded deadline.
     * @returns {Promise<ActionClaimStatus>} Reservation result; native transaction callback itself never awaits.
     */
    async claim(claim: ActionClaim, signal: AbortSignal, deadline: number) {
      return claimStatus(
        transaction(
          (tx) => synchronous(journal.reserve(tx, claim)),
          settings(claim, signal, deadline)
        )
      );
    },
    /** Run a synchronous write and completion CAS on the same SQLite pin, rejecting thenables.
     * @param {ActionClaim} claim - Previously reserved exact claim.
     * @param {(tx: SqliteSyncTransaction) => void | Promise<void>} write - Synchronous database-only work; asynchronous results reject.
     * @param {AbortSignal} signal - Cooperative cancellation.
     * @param {number} deadline - Absolute expiry-bounded deadline.
     * @returns {Promise<void>} Confirmed synchronous transaction completion or a reconciliation-requiring failure.
     */
    async commit(
      claim: ActionClaim,
      write: (tx: SqliteSyncTransaction) => void | Promise<void>,
      signal: AbortSignal,
      deadline: number
    ) {
      transaction(
        (tx) => {
          synchronous(write(tx));
          if (synchronous(journal.finish(tx, claim)) !== true) {
            throw Error('Action journal ownership lost');
          }
        },
        settings(claim, signal, deadline)
      );
    },
  });
}
