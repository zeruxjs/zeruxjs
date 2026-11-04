/** Client-safe feedback contains no rejected values or custom error messages. */
export interface ClientIssue { readonly path: string; readonly message: string; readonly code?: string }
export function safeCode(code: unknown): string {
  return typeof code === 'string' && /^[a-z_]+\.[a-z_]+$/.test(code) && code.length <= 80 ? code : 'input.invalid';
}

