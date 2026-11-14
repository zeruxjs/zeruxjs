import { stripTerminalCodes } from './format.js';
/** Parsing independent of process.argv, so commands can be tested and embedded. */
export interface ParsedArgs {
  /** Prototype-free named values; repeated options become ordered string arrays. */
  namedArgs: Record<string, string | boolean | string[]>;
  /** Positional arguments in their original order, including values after --. */
  positionalArgs: string[];
}
/** Sanitized CLI usage failure; terminal sanitization is not secret redaction. */
export class ArgumentError extends Error {
  /** Construct a terminal-safe usage message without changing the caller's exit status.
   * @param {string} message - Diagnostic text; callers still redact secrets separately.
   */
  constructor(message: string) {
    super(stripTerminalCodes(message));
    this.name = 'ArgumentError';
  }
}
/** Parse bounded inert argv with legacy value consumption and explicit boolean hints.
 * @param {readonly string[]} args - Explicit argument array, independent of process.argv.
 * @param {readonly string[]} booleanOptions - Names whose bare flags do not consume an ordinary following positional.
 * @returns {ParsedArgs} Ordered positional data and prototype-free named values; no command is invoked.
 */
export function parseArguments(
  args: readonly string[],
  booleanOptions: readonly string[] = []
): ParsedArgs {
  if (
    !Array.isArray(args) ||
    args.length > 1024 ||
    args.some((arg) => typeof arg !== 'string' || arg.length > 8192) ||
    args.reduce((size, arg) => size + arg.length, 0) > 65536
  ) {
    throw new ArgumentError('Invalid or oversized argument list');
  }
  if (
    !Array.isArray(booleanOptions) ||
    booleanOptions.length > 256 ||
    booleanOptions.some((name) => typeof name !== 'string' || name.length > 128)
  ) {
    throw new ArgumentError('Invalid boolean option names');
  }
  /** Invocation-local parsed values with a prototype-free named option map. */
  const result: ParsedArgs = {
    namedArgs: Object.create(null),
    positionalArgs: [],
  };
  /** Validate option names and accumulate repeated values without prototype mutation.
   * @param {string} key - Parsed literal option name.
   * @param {string | boolean} value - Parsed inert option value.
   * @returns {void} Stores the first value or an ordered array of repeated string values.
   */
  const set = (key: string, value: string | boolean) => {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(key) ||
      ['__proto__', 'prototype', 'constructor'].includes(key)
    ) {
      throw new ArgumentError(`Invalid option: ${key}`);
    }
    if (Object.hasOwn(result.namedArgs, key)) {
      /** Own previously parsed option value; repeats preserve original input order. */
      const existing = result.namedArgs[key];
      result.namedArgs[key] = Array.isArray(existing)
        ? [...existing, String(value)]
        : [String(existing), String(value)];
    } else {
      result.namedArgs[key] = value;
    }
  };
  let positionalOnly = false;
  for (let i = 0; i < args.length; i++) {
    /** Current bounded argument data; no input is executed as code. */
    const token = args[i];
    if (positionalOnly || token === '-' || !token.startsWith('-')) {
      if (token === '--' && !positionalOnly) {
        positionalOnly = true;
      } else {
        result.positionalArgs.push(token);
      }
      continue;
    }
    if (token === '--') {
      positionalOnly = true;
      continue;
    }
    /** Whether this token uses the explicit double-dash long-option form. */
    const long = token.startsWith('--');
    /** Option text after the selected dash prefix. */
    const trimmed = token.slice(long ? 2 : 1);
    /** First equals separator preserving empty explicit string values. */
    const eq = trimmed.indexOf('=');
    if (!long && eq >= 0) {
      throw new ArgumentError(`Use --${trimmed} rather than -${trimmed}`);
    }
    /** Canonical inert option name before its optional equals value. */
    const key = eq >= 0 ? trimmed.slice(0, eq) : trimmed;
    let value: string | boolean = eq >= 0 ? trimmed.slice(eq + 1) : true;
    if (
      eq < 0 &&
      (!booleanOptions.includes(key) ||
        ['true', 'false'].includes(args[i + 1])) &&
      i + 1 < args.length &&
      args[i + 1] !== '--' &&
      (!args[i + 1].startsWith('-') || /^-\d+(\.\d+)?$/.test(args[i + 1]))
    ) {
      value = args[++i];
    }
    set(key, value);
  }
  return result;
}
