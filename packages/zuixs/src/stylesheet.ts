import { createZuix } from "./compiler.js";
import { resolveLimits } from "./safety.js";
import type { GenerateResult, ZuixConfig } from "./types.js";

/** Compile trusted authored CSS with generated template utilities.
 * @param source CSS entry containing @import "zuixs"; never visitor input.
 * @param classes Literal classes extracted from templates/components.
 * @param config Optional theme/recipes/limits. No globals or filesystem access.
 * @returns CSS with native rules preserved and unsupported utility tokens reported.
 */
export function compileStylesheet(
  source: string,
  classes: Iterable<string>,
  config: ZuixConfig = {},
): GenerateResult {
  const limits = resolveLimits(config.limits);
  if (new TextEncoder().encode(source).length > limits.maxFileBytes)
    throw new Error("zuix: stylesheet exceeds maxFileBytes");
  const compiler = createZuix(config),
    applied: string[] = [];
  let output = "",
    start = 0,
    quote = "",
    comment = false,
    imports = 0;
  // Skip strings/comments so literal directive examples remain untouched.
  for (let i = 0; i < source.length; i++) {
    const ch = source[i],
      next = source[i + 1];
    if (comment) {
      if (ch === "*" && next === "/") {
        comment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && next === "*") {
      comment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch !== "@") continue;
    const rest = source.slice(i),
      imported = /^@import\s+(["'])zuixs\1\s*;/.exec(rest);
    if (imported) {
      if (++imports > 1)
        throw new Error("zuix: use one Zuixs import per entry");
      output += source.slice(start, i) + "\u0000ZUIX\u0000";
      i += imported[0].length - 1;
      start = i + 1;
      continue;
    }
    if (!/^@apply\s/.test(rest)) continue;
    const end = source.indexOf(";", i);
    if (end < 0) throw new Error("zuix: @apply requires a semicolon");
    const tokens = source
      .slice(i + 6, end)
      .trim()
      .split(/\s+/);
    applied.push(...tokens);
    if (applied.length > limits.maxClasses)
      throw new Error("zuix: @apply limit exceeded");
    const composed = createZuix({
      ...config,
      preflight: false,
      recipes: [{ selector: ".zuix-apply", apply: tokens }],
    }).generate([]).css;
    const marker = ".zuix-apply{",
      bodyStart = composed.indexOf(marker) + marker.length;
    const declarations = composed.slice(
      bodyStart,
      composed.indexOf("}", bodyStart),
    );
    output += source.slice(start, i) + declarations;
    i = end;
    start = end + 1;
  }
  if (comment || quote)
    throw new Error("zuix: unterminated CSS string/comment");
  if (!imports) throw new Error('zuix: expected @import "zuixs";');
  output += source.slice(start);
  // Applied animation utilities must retain their tree-shaken keyframes too.
  const result = compiler.generate(new Set([...classes, ...applied]));
  return { ...result, css: output.replace("\u0000ZUIX\u0000", result.css) };
}
