import type { ParsedArgs } from './args.js';
import { suggest, stripTerminalCodes } from './format.js';
/** Supported scalar conversion policies; arbitrary coercion callbacks are unavailable. */
export type OptionType = 'boolean' | 'string' | 'number';
/** Trusted registration-time option policy; parsing does not invoke a command. */
export interface OptionDefinition {
  /** Required scalar conversion policy. */
  type: OptionType;
  /** Require explicit input even when a default exists. */
  required?: boolean;
  /** Trusted fallback matching the declared scalar type and choices. */
  default?: string | number | boolean;
  /** Display-only help text, sanitized when rendered. */
  description?: string;
  /** Allowed literal strings; only valid for a string option. */
  choices?: readonly string[];
  /** Alternative spelling; mixing canonical and alias spellings rejects. */
  alias?: string;
  /** Canonical option names incompatible with explicit presence, even false/empty. */
  conflicts?: readonly string[];
}
/** Bounded canonical option-name map, validated before registration/use. */
export type OptionSchema = Record<string, OptionDefinition>;
/** Converted scalar values or ordered repeats; values remain private CLI/tool input. */
export type ValidatedOptions = Record<
  string,
  string | number | boolean | Array<string | number | boolean>
>;
/** Terminal-safe usage failure distinct from handler/cleanup errors. */
export class OptionError extends TypeError {
  /** Construct a sanitized option usage message without exposing a stack automatically.
   * @param {string} message - Display text; sanitization does not redact credentials.
   */
  constructor(message: string) {
    super(stripTerminalCodes(message));
    this.name = 'OptionError';
  }
}
/** Accept only bounded option identifiers without prototype-sensitive names.
 * @param {string} name - Candidate schema option name.
 * @returns {boolean} Whether the literal name is safe for this option map.
 */
const validName = (name: string) =>
  typeof name === 'string' &&
  /^[a-z][\w-]{0,127}$/i.test(name) &&
  !['constructor', '__proto__', 'prototype'].includes(name);
/** Validate trusted schema configuration before any command is registered.
 * @param {OptionSchema} schema - Trusted bounded schema with explicit aliases/defaults/conflicts.
 * @returns {void} Returns after validation or throws; no registry or input is mutated.
 */
export function validateOptionSchema(schema: OptionSchema): void {
  if (
    !schema ||
    typeof schema !== 'object' ||
    Array.isArray(schema) ||
    Object.keys(schema).length > 128
  ) {
    throw new TypeError('Invalid option schema');
  }
  /** Registered alias names used to reject duplicate or shadowed schema spellings. */
  const aliases = new Set<string>();
  for (const [name, definition] of Object.entries(schema)) {
    if (
      !validName(name) ||
      !definition ||
      typeof definition !== 'object' ||
      Array.isArray(definition) ||
      !['boolean', 'string', 'number'].includes(definition.type)
    ) {
      throw new TypeError('Invalid schema option');
    }
    if (definition.alias !== undefined) {
      if (
        !validName(definition.alias) ||
        aliases.has(definition.alias) ||
        Object.hasOwn(schema, definition.alias)
      ) {
        throw new TypeError(`Duplicate or invalid alias for --${name}`);
      }
      aliases.add(definition.alias);
    }
    if (
      definition.required !== undefined &&
      typeof definition.required !== 'boolean'
    ) {
      throw new TypeError('Invalid required flag');
    }
    if (
      definition.choices !== undefined &&
      (definition.type !== 'string' ||
        !Array.isArray(definition.choices) ||
        definition.choices.length > 128 ||
        definition.choices.some((value) => typeof value !== 'string'))
    ) {
      throw new TypeError('Invalid option choices');
    }
    if (
      definition.default !== undefined &&
      (typeof definition.default !== definition.type ||
        (typeof definition.default === 'number' &&
          !Number.isFinite(definition.default)) ||
        (definition.choices &&
          !definition.choices.includes(String(definition.default))))
    ) {
      throw new TypeError(`Invalid default for --${name}`);
    }
    if (
      definition.conflicts !== undefined &&
      (!Array.isArray(definition.conflicts) ||
        definition.conflicts.length > 128 ||
        definition.conflicts.some(
          (other) => other === name || !Object.hasOwn(schema, other)
        ))
    ) {
      throw new TypeError(`Invalid conflicts for --${name}`);
    }
  }
}
/** Strict typed options; legacy parsedArgs retain their string/boolean shape.
 * @param {ParsedArgs} args - Parsed inert CLI values retained without mutation.
 * @param {OptionSchema} schema - Trusted registration schema validated before conversion.
 * @param {boolean} allowUnknown - Explicit legacy opt-in to retain unrecognized values without conversion.
 * @returns {ValidatedOptions} New prototype-free map with validated repeats/defaults and explicit-presence conflicts.
 */
export function validateOptions(
  args: ParsedArgs,
  schema: OptionSchema,
  allowUnknown = false
): ValidatedOptions {
  validateOptionSchema(schema);
  if (typeof allowUnknown !== 'boolean') {
    throw new TypeError('allowUnknown must be boolean');
  }
  /** Prototype-free converted option map; defaults are applied only after explicit conflicts. */
  const result: ValidatedOptions = Object.create(null);
  /** Registered alias names used to reject duplicate or shadowed schema spellings. */
  /** Canonical lookup for aliases from the already validated schema. */
  const aliases = new Map(
    Object.entries(schema)
      .filter(([, def]) => def.alias)
      .map(([name, def]) => [def.alias!, name])
  );
  for (const [key, raw] of Object.entries(args.namedArgs)) {
    /** Canonical schema name resolved from the literal input spelling. */
    const name = aliases.get(key) ?? key;
    /** Own validated schema definition; inherited properties never define accepted options. */
    const definition = Object.hasOwn(schema, name) ? schema[name] : undefined;
    if (!definition) {
      if (!allowUnknown) {
        throw new OptionError(
          `Unknown option: --${key}.${suggest(key, [...Object.keys(schema), ...aliases.keys()])}`
        );
      }
      result[key] = raw;
      continue;
    }
    if (Object.hasOwn(result, name)) {
      throw new OptionError(
        `Conflicting spellings for --${name}; use its alias or full name consistently`
      );
    }
    /** Convert one inert input value under this fixed trusted definition.
     * @param {string | boolean} value - Parsed literal flag value.
     * @returns {string | number | boolean} Validated scalar or throws a sanitized usage failure.
     */
    const convert = (value: string | boolean): string | number | boolean => {
      if (definition.type === 'boolean') {
        if (value === true || value === 'true') {
          return true;
        }
        if (value === 'false') {
          return false;
        }
        throw new OptionError(`Invalid boolean for --${name}`);
      }
      if (typeof value !== 'string') {
        throw new OptionError(`Missing value for --${name}`);
      }
      if (definition.type === 'number') {
        /** Native numeric conversion checked for nonempty finite input. */
        const number = Number(value);
        if (!value.trim() || !Number.isFinite(number)) {
          throw new OptionError(`Invalid number for --${name}`);
        }
        return number;
      }
      if (definition.choices && !definition.choices.includes(value)) {
        throw new OptionError(`Invalid value for --${name}`);
      }
      return value;
    };
    result[name] = Array.isArray(raw) ? raw.map(convert) : convert(raw);
  }
  // Conflicts apply to explicitly supplied options, including explicit false/empty.
  for (const name of Object.keys(result)) {
    for (const other of schema[name]?.conflicts ?? []) {
      if (Object.hasOwn(result, other)) {
        throw new OptionError(`Conflicting options: --${name} and --${other}`);
      }
    }
  }
  for (const [key, definition] of Object.entries(schema)) {
    if (!Object.hasOwn(result, key)) {
      if (definition.required) {
        throw new OptionError(`Required option: --${key}`);
      }
      if (definition.default !== undefined) {
        result[key] = definition.default;
      }
    }
  }
  return result;
}
