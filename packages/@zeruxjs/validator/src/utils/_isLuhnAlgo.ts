/**
 * Non-digit regex.
 */
const NON_DIGIT_REGEX = /\D/gu;

/**
 * Checks whether a string with numbers corresponds to the luhn algorithm.
 *
 * @param {string} input - Candidate text; non-digit characters are removed before computing the legacy checksum.
 *
 * @returns {boolean} Whether the remaining digits satisfy the checksum; this does not establish issuance, ownership or authorization.
 *
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _isLuhnAlgo(input: string): boolean {
  /** Decimal-only working text; the original submitted string is not mutated. */
  const number = input.replace(NON_DIGIT_REGEX, '');

  // Create necessary variables
  let length = number.length;
  let bit = 1;
  let sum = 0;

  // Traverse existing digits from the right and alternate the decimal doubling table.
  while (length) {
    /** Current decimal digit; loop bounds and non-digit removal establish both lookup ranges. */
    const value = +number[--length]!;
    bit ^= 1;
    sum += bit ? [0, 2, 4, 6, 8, 1, 3, 5, 7, 9][value]! : value;
  }

  // Return whether its valid
  return sum % 10 === 0;
}
