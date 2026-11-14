import type { ActionClaim, ActionClaimStatus } from './action-stores.js';
/** Check journal fingerprint/owner encodings and integer expiry before entering persistence.
 * @param {ActionClaim} claim - Host-created opaque claim.
 * @returns {boolean} Whether the required claim shape is admitted.
 */
const valid = (claim: ActionClaim) =>
  claim &&
  /^[A-Za-z0-9_-]{43}$/.test(claim.key) &&
  /^[A-Za-z0-9_-]{43}$/.test(claim.digest) &&
  /^[A-Za-z0-9_-]{32}$/.test(claim.owner) &&
  Number.isSafeInteger(claim.expiresAt);
/** Validate bounded claim lifetime and caller cancellation before invoking a real transaction runner.
 * @param {ActionClaim} claim - Principal-bound opaque fingerprints and exact owner.
 * @param {AbortSignal} signal - Caller cancellation; abort does not prove rollback.
 * @param {number} deadline - Absolute deadline no later than the signed claim expiry.
 * @returns {{signal: AbortSignal; deadline: number}} Validated transaction execution options.
 */
export function validateClaimOptions(
  claim: ActionClaim,
  signal: AbortSignal,
  deadline: number
) {
  if (
    !valid(claim) ||
    !(signal instanceof AbortSignal) ||
    !Number.isSafeInteger(deadline) ||
    deadline <= Date.now() ||
    claim.expiresAt < Date.now() ||
    deadline > claim.expiresAt
  ) {
    throw Error('Invalid action claim');
  }
  signal.throwIfAborted();
  return { signal, deadline };
}
/** Reject invented journal dispositions rather than treating them as permission to write.
 * @param {ActionClaimStatus} value - Host journal result.
 * @returns {ActionClaimStatus} One of the four declared claim dispositions.
 */
export function claimStatus(value: ActionClaimStatus) {
  if (!['claimed', 'committed', 'pending', 'conflict'].includes(value)) {
    throw Error('Invalid journal outcome');
  }
  return value;
}
