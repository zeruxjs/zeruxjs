/** CSS from utility tokens is deliberately a restricted subset, not arbitrary authored CSS.
 * Plugins and addBase() remain trusted application code. */
export const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 20000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxClasses: 50000,
  maxTokenLength: 256,
  maxOutputBytes: 64 * 1024 * 1024,
});
export type ZuixLimits = Partial<Record<keyof typeof DEFAULT_LIMITS, number>>;
/** Validate explicit budgets without silently permitting unlimited work.
 * @param {ZuixLimits} input - Optional positive integer overrides, at most sixteen times each default.
 * @returns {Record<keyof typeof DEFAULT_LIMITS, number>} Fresh resolved limits; invalid overrides throw.
 */
export function resolveLimits(
  input: ZuixLimits = {}
): Record<keyof typeof DEFAULT_LIMITS, number> {
  /** Resolved integer budgets copied from defaults before applying validated overrides. */
  const result: Record<keyof typeof DEFAULT_LIMITS, number> = {
    ...DEFAULT_LIMITS,
  };
  for (const key of Object.keys(result) as (keyof typeof DEFAULT_LIMITS)[]) {
    /** Explicit configured ceiling; omission retains the documented default. */
    const value = input[key];
    if (value !== undefined) {
      if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > DEFAULT_LIMITS[key] * 16
      ) {
        throw new Error(`zuix: invalid ${key} limit`);
      }
      result[key] = value;
    }
  }
  return result;
}
/** Check the restricted utility-value grammar; trusted authored CSS uses a different boundary.
 * @param {string} value - Decoded declaration value, never executed or fetched.
 * @returns {boolean} Whether bounded delimiters, parentheses and forbidden functions pass.
 */
export function safeCssValue(value: string): boolean {
  if (
    !value ||
    value.length > 512 ||
    // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
    /[\u0000-\u001f\u007f{};<>\\"'`]/.test(value) ||
    /\/\*|\*\/|!\s*important|@(?:import|charset)|\b(?:url|image-set|expression|behavior)\s*\(/i.test(
      value
    )
  ) {
    return false;
  }
  // Parentheses must balance. Disallow closing out of the active declaration.
  let depth = 0;
  for (const c of value) {
    if (c === '(') {
      if (++depth > 8) {
        return false;
      }
    } else if (c === ')' && --depth < 0) {
      return false;
    }
  }
  return depth === 0;
}
/** Validate one property/value pair before utility emission.
 * @param {string} property - CSS identifier or custom property name.
 * @param {string} value - Decoded inert declaration value.
 * @returns {boolean} Whether both the bounded property and value grammar are admitted.
 */
export function safeDeclaration(property: string, value: string): boolean {
  return (
    /^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/i.test(property) &&
    property.length <= 100 &&
    safeCssValue(value)
  );
}
/** Validate restricted arbitrary media/support/container conditions.
 * @param {string} value - Decoded condition containing no declaration or rule delimiters.
 * @returns {boolean} Whether syntax is balanced and uses the allowlisted condition characters.
 */
export function safeCondition(value: string): boolean {
  return (
    balancedSyntax(value) &&
    value.length > 0 &&
    value.length <= 160 &&
    /^[a-zA-Z0-9\s:.,#%()[\]_<>=!+-]+$/.test(value) &&
    !/(?:url|expression)\s*\(/i.test(value)
  );
}
/** Encode a class token as a CSS identifier, including leading digits.
 * @param {string} name - Literal class name whose selector must match the original token.
 * @returns {string} Escaped identifier without a leading selector dot.
 */
export function cssEscapeClass(name: string): string {
  return [...name]
    .map((c, i) => {
      if (
        (i === 0 && /[0-9]/.test(c)) ||
        (i === 1 && name[0] === '-' && /[0-9]/.test(c))
      ) {
        return `\\${c.codePointAt(0)!.toString(16)} `;
      }
      return /[a-zA-Z0-9_-]/.test(c)
        ? c
        : `\\${c.codePointAt(0)!.toString(16)} `;
    })
    .join('');
}

/** Match bracket, parenthesis and quote ownership without evaluating CSS.
 * @param {string} value - Literal syntax to inspect.
 * @param {number} maxDepth - Maximum simultaneous bracket/parenthesis owners, default eight.
 * @returns {boolean} Whether quotes and delimiters close within the fixed nesting budget.
 */
export function balancedSyntax(value: string, maxDepth = 8): boolean {
  /** Bracket/parenthesis owners, bounded independently of source length. */
  const stack: string[] = [];
  let quote = '';
  for (const ch of value) {
    if (quote) {
      if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') {
      stack.push(ch);
      if (stack.length > maxDepth) {
        return false;
      }
    } else if (ch === ')' || ch === ']') {
      if (stack.pop() !== (ch === ')' ? '(' : '[')) {
        return false;
      }
    }
  }
  return !quote && !stack.length;
}
/** Split variant separators outside arbitrary brackets and reject malformed tokens.
 * @param {string} input - Literal class token, including any variant prefix.
 * @returns {string[] | undefined} At most twelve nonempty segments, or undefined for rejected syntax.
 */
export function splitToken(input: string): string[] | undefined {
  // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
  if (!balancedSyntax(input) || /[\u0000-\u001f\u007f{};\\]/.test(input)) {
    return;
  }
  /** Resolved integer budgets copied from defaults before applying validated overrides. */
  const result: string[] = [];
  let start = 0,
    depth = 0;
  for (let index = 0; index < input.length; index++) {
    /** Current character; optional lookahead is handled separately. */
    const ch = input[index];
    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
    }
    if (ch === ':' && depth === 0) {
      if (index === start) {
        return;
      }
      result.push(input.slice(start, index));
      start = index + 1;
    }
  }
  if (start === input.length) {
    return;
  }
  result.push(input.slice(start));
  return result.length <= 12 ? result : undefined;
}
