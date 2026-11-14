/** Client-safe feedback contains no rejected values or custom error messages. */
export interface ClientIssue {
  /** Bounded public schema-declared field path or redacted dynamic segment; never a selector. */
  readonly path: string;
  /** Generic public feedback text; raw custom validation messages remain private. */
  readonly message: string;
  /** Optional stable public kind.type category; unsupported codes receive a fixed fallback. */
  readonly code?: string;
}
/** Select a bounded fixed-shape public issue code independently of raw validation messages and input values.
 * @param {unknown} code - Candidate issue code from trusted or custom issue producers.
 * @returns {string} Supported kind.type code or fixed input.invalid fallback; no submitted value is echoed.
 */
export function safeCode(code: unknown): string {
  return typeof code === 'string' &&
    /^[a-z_]+\.[a-z_]+$/.test(code) &&
    code.length <= 80
    ? code
    : 'input.invalid';
}
