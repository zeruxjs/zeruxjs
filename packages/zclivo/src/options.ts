import type { ParsedArgs } from './args.js';
import { suggest, stripTerminalCodes } from './format.js';
export type OptionType = 'boolean' | 'string' | 'number';
export interface OptionDefinition { type: OptionType; required?: boolean; default?: string | number | boolean; description?: string; choices?: readonly string[]; alias?: string; conflicts?: readonly string[] }
export type OptionSchema = Record<string, OptionDefinition>;
export type ValidatedOptions = Record<string, string | number | boolean | Array<string | number | boolean>>;
export class OptionError extends TypeError { constructor(message: string) { super(stripTerminalCodes(message)); this.name = 'OptionError'; } }
const validName = (name: string) => typeof name === 'string' && /^[a-z][\w-]{0,127}$/i.test(name) && !['constructor', '__proto__', 'prototype'].includes(name);
/** Validate trusted schema configuration before any command is registered. */
export function validateOptionSchema(schema: OptionSchema): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || Object.keys(schema).length > 128) throw new TypeError('Invalid option schema');
  const aliases = new Set<string>();
  for (const [name, definition] of Object.entries(schema)) {
    if (!validName(name) || !definition || typeof definition !== 'object' || Array.isArray(definition) || !['boolean', 'string', 'number'].includes(definition.type)) throw new TypeError('Invalid schema option');
    if (definition.alias !== undefined) {
      if (!validName(definition.alias) || aliases.has(definition.alias) || Object.hasOwn(schema, definition.alias)) throw new TypeError(`Duplicate or invalid alias for --${name}`);
      aliases.add(definition.alias);
    }
    if (definition.required !== undefined && typeof definition.required !== 'boolean') throw new TypeError('Invalid required flag');
    if (definition.choices !== undefined && (definition.type !== 'string' || !Array.isArray(definition.choices) || definition.choices.length > 128 || definition.choices.some(value => typeof value !== 'string'))) throw new TypeError('Invalid option choices');
    if (definition.default !== undefined && (typeof definition.default !== definition.type || (typeof definition.default === 'number' && !Number.isFinite(definition.default)) || (definition.choices && !definition.choices.includes(String(definition.default))))) throw new TypeError(`Invalid default for --${name}`);
    if (definition.conflicts !== undefined && (!Array.isArray(definition.conflicts) || definition.conflicts.length > 128 || definition.conflicts.some(other => other === name || !Object.hasOwn(schema, other)))) throw new TypeError(`Invalid conflicts for --${name}`);
  }
}
/** Strict typed options; legacy parsedArgs retain their string/boolean shape. */
export function validateOptions(args: ParsedArgs, schema: OptionSchema, allowUnknown = false): ValidatedOptions {
  validateOptionSchema(schema);
  if (typeof allowUnknown !== 'boolean') throw new TypeError('allowUnknown must be boolean');
  const result: ValidatedOptions = Object.create(null);
  const aliases = new Map(Object.entries(schema).filter(([, def]) => def.alias).map(([name, def]) => [def.alias!, name]));
  for (const [key, raw] of Object.entries(args.namedArgs)) {
    const name = aliases.get(key) ?? key, definition = Object.hasOwn(schema, name) ? schema[name] : undefined;
    if (!definition) { if (!allowUnknown) throw new OptionError(`Unknown option: --${key}.${suggest(key, [...Object.keys(schema), ...aliases.keys()])}`); result[key] = raw; continue; }
    if (Object.hasOwn(result, name)) throw new OptionError(`Conflicting spellings for --${name}; use its alias or full name consistently`);
    const convert = (value: string | boolean): string | number | boolean => {
      if (definition.type === 'boolean') { if (value === true || value === 'true') return true; if (value === 'false') return false; throw new OptionError(`Invalid boolean for --${name}`); }
      if (typeof value !== 'string') throw new OptionError(`Missing value for --${name}`);
      if (definition.type === 'number') { const number = Number(value); if (!value.trim() || !Number.isFinite(number)) throw new OptionError(`Invalid number for --${name}`); return number; }
      if (definition.choices && !definition.choices.includes(value)) throw new OptionError(`Invalid value for --${name}`);
      return value;
    };
    result[name] = Array.isArray(raw) ? raw.map(convert) : convert(raw);
  }
  // Conflicts apply to explicitly supplied options, including explicit false/empty.
  for (const name of Object.keys(result)) for (const other of schema[name]?.conflicts ?? []) if (Object.hasOwn(result, other)) throw new OptionError(`Conflicting options: --${name} and --${other}`);
  for (const [key, definition] of Object.entries(schema)) if (!Object.hasOwn(result, key)) {
    if (definition.required) throw new OptionError(`Required option: --${key}`);
    if (definition.default !== undefined) result[key] = definition.default;
  }
  return result;
}
