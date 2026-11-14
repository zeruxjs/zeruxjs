/**
 * [Validates an ISBN-10](https://en.wikipedia.org/wiki/ISBN#ISBN-10_check_digits).
 *
 * @param {string} input - Separator-free 10-digit candidate already matched by the ISBN action; this helper does not validate the alphabet or length.
 *
 * @returns {boolean} `true` if the input has a valid ISBN-10, `false` otherwise.
 *
 * @internal
 */
export function _isIsbn10(input: string): boolean {
  /** Numeric checksum positions; ISBN-10 alone maps its final X to ten. */
  const digits = input.split('').map((c) => (c === 'X' ? 10 : parseInt(c, 10)));
  let sum = 0;
  // Accumulate fixed positional weights; this is a checksum, not an authenticity check.
  for (let i = 0; i < 10; i++) {
    // Callers validate the digit count; malformed direct calls retain their existing NaN result.
    sum += digits[i]! * (10 - i);
  }
  return sum % 11 === 0;
}
