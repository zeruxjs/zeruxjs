import { resolveLimits } from './safety.js';
import type { ZuixLimits } from './safety.js';

/** Extract literal attributes/directives and recognized helper strings without evaluating source or resolving dynamic expressions.
 * @param {string} source - Trusted application source text; still subject to byte and token limits.
 * @param {{ limits?: ZuixLimits }} options - Optional extraction budgets.
 * @param {ZuixLimits} [options.limits] - Extraction ceilings shared with compiler/build limits.
 * @returns {string[]} Unique statically discovered tokens in discovery order.
 */
export function extractClasses(
  source: string,
  options: { limits?: ZuixLimits } = {}
): string[] {
  /** Resolved extraction budgets checked before scanning any source text. */
  const limits = resolveLimits(options.limits);
  if (
    typeof source !== 'string' ||
    source.length > limits.maxFileBytes ||
    new TextEncoder().encode(source).length > limits.maxFileBytes
  ) {
    throw new Error('zuix: scanner maxFileBytes limit exceeded');
  }
  /** Unique literal tokens accumulated without executing source expressions. */
  const result = new Set<string>();
  /** Validate and collect whitespace-separated literal tokens.
   * @param {string} value - Static attribute/helper string.
   * @returns {void} Tokens are added or a resource limit throws.
   */
  const add = (value: string) => {
    for (const token of value.split(/\s+/)) {
      if (!token || /[<>{}`$]/.test(token)) {
        continue;
      }
      if (token.length > limits.maxTokenLength) {
        throw new Error('zuix: scanner maxTokenLength limit exceeded');
      }
      result.add(token);
      if (result.size > limits.maxClasses) {
        throw new Error('zuix: scanner maxClasses limit exceeded');
      }
    }
  };
  /** Literal class/className attribute forms; dynamic expressions remain unsupported. */
  const attrs =
    /(?:\bclass(?:Name)?|\bclass)\s*=\s*(?:["']([^"']*)["']|\{\s*["'`]([^"'`]*?)["'`]\s*\})/g;
  for (const match of source.matchAll(attrs)) {
    add(match[1]! ?? match[2]! ?? '');
  }
  for (const match of source.matchAll(/\bclass:([\w:![\]#%./-]+)/g)) {
    add(match[1]!);
  }
  /** Recognized class helper calls, advanced beyond each complete nested expression. */
  const helpers = /\b(?:cn|clsx|cx|classNames)\s*\(/g;
  while (helpers.exec(source) !== null) {
    /** Balanced helper delimiters; depth is capped independently of input byte limits. */
    const stack = ['('];
    /** Candidate quoted strings held until the surrounding helper closes correctly. */
    const literals: string[] = [];
    let index = helpers.lastIndex,
      quote = '',
      start = 0,
      comment = '';
    for (; index < source.length; index++) {
      /** Current source character within the bounded scan loop. */
      const ch = source[index];
      /** Optional lookahead character used for comment and escape recognition. */
      const next = source[index + 1];
      if (comment === 'line') {
        if (ch === '\n') {
          comment = '';
        }
        continue;
      }
      if (comment === 'block') {
        if (ch === '*' && next === '/') {
          comment = '';
          index++;
        }
        continue;
      }
      if (quote) {
        if (ch === '\\') {
          index++;
          continue;
        }
        if (ch === quote) {
          /** Quoted helper string; interpolation disqualifies it from static extraction. */
          const literal = source.slice(start, index);
          if (!literal.includes('${')) {
            literals.push(literal);
          }
          quote = '';
        }
        continue;
      }
      if (ch === '/' && (next === '/' || next === '*')) {
        comment = next === '/' ? 'line' : 'block';
        index++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        start = index + 1;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') {
        stack.push(ch);
        if (stack.length > 32) {
          throw new Error('zuix: scanner nesting limit exceeded');
        }
      } else if (ch === ')' || ch === ']' || ch === '}') {
        /** Opening delimiter required by the encountered closing character. */
        let expected = '{';
        if (ch === ')') {
          expected = '(';
        } else if (ch === ']') {
          expected = '[';
        }
        if (stack.pop() !== expected) {
          break;
        }
        if (!stack.length) {
          for (const literal of literals) {
            add(literal);
          }
          index++;
          break;
        }
      }
    }
    // Nested helpers are scanned in the outer pass, never reparsed quadratically.
    helpers.lastIndex = Math.max(index, helpers.lastIndex);
  }
  return [...result];
}
