import { createZuix } from './compiler.js';
import { resolveLimits } from './safety.js';
import type { GenerateResult, ZuixConfig } from './types.js';

/** Compile trusted authored CSS while preserving native rules and skipping directive-like strings/comments.
 * @param {string} source - Trusted CSS entry containing one explicit Zuixs import.
 * @param {Iterable<string>} classes - Literal tokens discovered by the host scanner.
 * @param {ZuixConfig} config - Application theme, recipes, plugins and limits.
 * @returns {GenerateResult} Generated CSS and token diagnostics; no filesystem/global access occurs.
 */
export function compileStylesheet(
  source: string,
  classes: Iterable<string>,
  config: ZuixConfig = {}
): GenerateResult {
  /** Resolved byte and application-count budgets for this authored stylesheet. */
  const limits = resolveLimits(config.limits);
  if (new TextEncoder().encode(source).length > limits.maxFileBytes) {
    throw new Error('zuix: stylesheet exceeds maxFileBytes');
  }
  /** Per-call compiler bound to the supplied application configuration. */
  const compiler = createZuix(config);
  /** Base utility tokens collected from @apply so required keyframes are retained. */
  const applied: string[] = [];
  let output = '',
    start = 0,
    quote = '',
    comment = false,
    imports = 0;
  // Skip strings/comments so literal directive examples remain untouched.
  for (let i = 0; i < source.length; i++) {
    /** Current source character; directive recognition skips strings and comments. */
    const ch = source[i];
    /** Optional next character used to identify comment delimiters. */
    const next = source[i + 1];
    if (comment) {
      if (ch === '*' && next === '/') {
        comment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      comment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch !== '@') {
      continue;
    }
    /** Remaining source at a possible directive boundary, never evaluated as JavaScript. */
    const rest = source.slice(i);
    /** Exact supported Zuixs import match; other CSS imports remain authored text. */
    const imported = /^@import\s+(["'])zuixs\1\s*;/.exec(rest);
    if (imported) {
      if (++imports > 1) {
        throw new Error('zuix: use one Zuixs import per entry');
      }
      output += source.slice(start, i) + '\u0000ZUIX\u0000';
      i += imported[0].length - 1;
      start = i + 1;
      continue;
    }
    if (!/^@apply\s/.test(rest)) {
      continue;
    }
    /** Required semicolon ending the current @apply directive. */
    const end = source.indexOf(';', i);
    if (end < 0) {
      throw new Error('zuix: @apply requires a semicolon');
    }
    /** Base application tokens from the current @apply body. */
    const tokens = source
      .slice(i + 6, end)
      .trim()
      .split(/\s+/);
    applied.push(...tokens);
    if (applied.length > limits.maxClasses) {
      throw new Error('zuix: @apply limit exceeded');
    }
    /** Temporary recipe output used to extract validated base declarations. */
    const composed = createZuix({
      ...config,
      preflight: false,
      recipes: [{ selector: '.zuix-apply', apply: tokens }],
    }).generate([]).css;
    /** Fixed temporary selector identifying the recipe declaration block. */
    const marker = '.zuix-apply{';
    /** Offset immediately after the temporary recipe opening brace. */
    const bodyStart = composed.indexOf(marker) + marker.length;
    /** Validated base declarations replacing only the @apply directive. */
    const declarations = composed.slice(
      bodyStart,
      composed.indexOf('}', bodyStart)
    );
    output += source.slice(start, i) + declarations;
    i = end;
    start = end + 1;
  }
  if (comment || quote) {
    throw new Error('zuix: unterminated CSS string/comment');
  }
  if (!imports) {
    throw new Error('zuix: expected @import "zuixs";');
  }
  output += source.slice(start);
  // Applied animation utilities must retain their tree-shaken keyframes too.
  /** Generated utility/keyframe result inserted at the single explicit import marker. */
  const result = compiler.generate(new Set([...classes, ...applied]));
  return { ...result, css: output.replace('\u0000ZUIX\u0000', result.css) };
}
