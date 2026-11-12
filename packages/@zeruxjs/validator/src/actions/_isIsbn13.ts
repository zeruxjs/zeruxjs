/**
 * [Validates an ISBN-13](https://en.wikipedia.org/wiki/ISBN#ISBN-13_check_digit_calculation).
 *
 * @param {string} input - Separator-free 13-digit candidate already matched by the ISBN action; this helper does not validate the alphabet or length.
 *
 * @returns {boolean} `true` if the input has a valid ISBN-13, `false` otherwise.
 *
 * @internal
 */
export function _isIsbn13(input: string): boolean {
  /** Numeric checksum positions after the caller has matched thirteen decimal digits. */
  const digits = input.split('').map((c) => parseInt(c, 10));
  let sum = 0;
  // Accumulate fixed positional weights; this is a checksum, not an authenticity check.
  for (let i = 0; i < 13; i++) {
    // Callers validate the digit count; malformed direct calls retain their existing NaN result.
    sum += digits[i]! * (i % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}
