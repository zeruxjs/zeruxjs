import { stripTerminalCodes } from './format.js';
/** Parsing independent of process.argv, so commands can be tested and embedded. */
export interface ParsedArgs {
  namedArgs: Record<string, string | boolean | string[]>;
  positionalArgs: string[];
}
export class ArgumentError extends Error { constructor(message: string) { super(stripTerminalCodes(message)); this.name = 'ArgumentError'; } }
export function parseArguments(args: readonly string[], booleanOptions: readonly string[] = []): ParsedArgs {
  if (!Array.isArray(args) || args.length > 1024 || args.some(arg => typeof arg !== 'string' || arg.length > 8192) || args.reduce((size, arg) => size + arg.length, 0) > 65536) throw new ArgumentError('Invalid or oversized argument list');
  if (!Array.isArray(booleanOptions) || booleanOptions.length > 256 || booleanOptions.some(name => typeof name !== 'string' || name.length > 128)) throw new ArgumentError('Invalid boolean option names');
  const result: ParsedArgs = { namedArgs: Object.create(null), positionalArgs: [] };
  const set = (key: string, value: string | boolean) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new ArgumentError(`Invalid option: ${key}`);
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
    if (eq < 0 && (!booleanOptions.includes(key) || ['true', 'false'].includes(args[i + 1])) && i + 1 < args.length && args[i + 1] !== '--' && (!args[i + 1].startsWith('-') || /^-\d+(\.\d+)?$/.test(args[i + 1]))) value = args[++i];
    set(key, value);
  }
  return result;
}
