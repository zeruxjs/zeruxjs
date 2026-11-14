export interface PasswordPolicy {
  /** Minimum Unicode code points, default 12 and minimum eight. */
  minLength?: number;
  /** Maximum Unicode code points, default 256 and maximum 4096. */
  maxLength?: number;
  /** Require a Unicode uppercase letter when true; default false. */
  requireUppercase?: boolean;
  /** Require a Unicode lowercase letter when true; default false. */
  requireLowercase?: boolean;
  /** Require a Unicode decimal digit when true; default false. */
  requireDigit?: boolean;
  /** Require a nonletter/nonnumber/nonwhitespace symbol when true; default false. */
  requireSymbol?: boolean;
}
export interface PasswordAssessment {
  /** Whether all enabled policy checks passed. */
  valid: boolean;
  /** Value-free policy messages, never the supplied password. */
  issues: string[];
}
/** Assess an explicit password policy without hashing, storing or echoing the password.
 * @param {string} value - Private password candidate; control characters are rejected.
 * @param {PasswordPolicy} policy - Explicit length/character-class policy; defaults only enforce length/control rules.
 * @returns {PasswordAssessment} Value-free issues; invalid policy configuration throws.
 */
export function validatePasswordStrength(
  value: string,
  policy: PasswordPolicy = {}
): PasswordAssessment {
  /** Value-free policy messages; the submitted password is never included. */
  const issues: string[] = [];
  /** Minimum Unicode code-point length, default 12 and at least eight. */
  const min = policy.minLength ?? 12;
  /** Maximum Unicode code-point length, default 256 and at most 4096. */
  const max = policy.maxLength ?? 256;
  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min < 8 ||
    max < min ||
    max > 4096
  ) {
    throw new RangeError('Invalid password policy');
  }
  if (typeof value !== 'string') {
    return { valid: false, issues: ['Password must be a string'] };
  }
  /** Unicode code-point count, distinct from byte limits used by password hashing. */
  const length = Array.from(value).length;
  if (length < min) {
    issues.push(`Must contain at least ${min} characters`);
  }
  if (length > max) {
    issues.push(`Must contain no more than ${max} characters`);
  }
  if (/\p{Cc}/u.test(value)) {
    issues.push('Control characters are not allowed');
  }
  if ((policy.requireUppercase ?? false) && !/\p{Lu}/u.test(value)) {
    issues.push('An uppercase letter is required');
  }
  if ((policy.requireLowercase ?? false) && !/\p{Ll}/u.test(value)) {
    issues.push('A lowercase letter is required');
  }
  if ((policy.requireDigit ?? false) && !/\p{Nd}/u.test(value)) {
    issues.push('A digit is required');
  }
  if ((policy.requireSymbol ?? false) && !/[^\p{L}\p{N}\s]/u.test(value)) {
    issues.push('A symbol is required');
  }
  return { valid: issues.length === 0, issues };
}
