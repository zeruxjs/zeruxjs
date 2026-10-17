/** Parsing independent of process.argv, so commands can be tested and embedded. */
export interface ParsedArgs {
  namedArgs: Record<string, string | boolean | string[]>;
  positionalArgs: string[];
}
export class ArgumentError extends Error { constructor(message: string) { super(message); this.name = 'ArgumentError'; } }
export function parseArguments(args: readonly string[]): ParsedArgs {
  const result: ParsedArgs = { namedArgs: Object.create(null), positionalArgs: [] };
  const set = (key: string, value: string | boolean) => {
    if (!key || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new ArgumentError(`Invalid option: ${key}`);
    if (Object.hasOwn(result.namedArgs, key)) {
      const existing = result.namedArgs[key];
      result.namedArgs[key] = Array.isArray(existing) ? [...existing, String(value)] : [String(existing), String(value)];
    } else result.namedArgs[key] = value;
  };
  let positionalOnly = false;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (positionalOnly || token === '-' || !token.startsWith('-')) { if (token === '--' && !positionalOnly) positionalOnly = true; else result.positionalArgs.push(token); continue; }
    if (token === '--') { positionalOnly = true; continue; }
    const long = token.startsWith('--');
    const trimmed = token.slice(long ? 2 : 1);
    const eq = trimmed.indexOf('=');
    if (!long && eq >= 0) throw new ArgumentError(`Use --${trimmed} rather than -${trimmed}`);
    const key = eq >= 0 ? trimmed.slice(0, eq) : trimmed;
    let value: string | boolean = eq >= 0 ? trimmed.slice(eq + 1) : true;
    if (eq < 0 && i + 1 < args.length && args[i + 1] !== '--' && (!args[i + 1].startsWith('-') || /^-\d+(\.\d+)?$/.test(args[i + 1]))) value = args[++i];
    set(key, value);
  }
  return result;
}
