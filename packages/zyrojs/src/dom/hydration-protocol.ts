import { serializeJsonForScript } from '@zeruxjs/security/encoding';

export const HYDRATION_VERSION = 1 as const;
export interface HydrationLimits { maxNodes?: number; maxDepth?: number; maxBytes?: number; maxPropsBytes?: number }
export interface HydrationPolicy<P> { validateProps: (input: unknown) => P; signal?: AbortSignal }
export interface HydrationData<P> { version: 1; idPrefix: string; props: P }
export class HydrationError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) { super(message, options); this.name = 'HydrationError'; }
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) { const error = new HydrationError('RENDER_ABORTED', 'ZyroJS: render aborted', {cause: signal.reason}); error.name = 'AbortError'; throw error; }
}
export function validatePrefix(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(value)) throw new HydrationError('INVALID_PREFIX', 'ZyroJS: idPrefix must be a short HTML-safe identifier');
}
export function hydrationLimits(input: HydrationLimits = {}) {
  const bounds = {maxNodes: [10000, 100000], maxDepth: [64, 128], maxBytes: [1024 * 1024, 16 * 1024 * 1024], maxPropsBytes: [65536, 1024 * 1024]} as const;
  const result = {} as Record<keyof typeof bounds, number>;
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !Object.hasOwn(bounds, key))) throw new TypeError('ZyroJS: invalid hydration limits');
  for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
    const value = input[key] ?? bounds[key][0];
    if (!Number.isSafeInteger(value) || value < 1 || value > bounds[key][1]) throw new RangeError('ZyroJS: invalid hydration limit');
    result[key] = value;
  }
  return result;
}
/** Clone only inert JSON data. No getters/toJSON, class instances, prototype keys or implicit omission. */
export function publicProps<P>(input: unknown, policy: HydrationPolicy<P>, maxBytes = 65536): P {
  if (!policy || typeof policy.validateProps !== 'function') throw new TypeError('ZyroJS: a public-props validator is required');
  if (policy.signal !== undefined && (typeof policy.signal.aborted !== 'boolean' || typeof policy.signal.addEventListener !== 'function' || typeof policy.signal.removeEventListener !== 'function')) throw new TypeError('ZyroJS: invalid render signal');
  checkAbort(policy.signal);
  const validated = policy.validateProps(input);
  checkAbort(policy.signal);
  let entries = 0, bytes = 0;
  const countText = (text: string) => { bytes += new TextEncoder().encode(text).length; if (bytes > maxBytes) throw new HydrationError('PROPS_LIMIT', 'ZyroJS: public props exceed byte limit'); };
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): unknown => {
    checkAbort(policy.signal);
    if (++entries > 10000 || depth > 32) throw new HydrationError('PROPS_LIMIT', 'ZyroJS: public props exceed structural limits');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { if (value.length > maxBytes) throw new HydrationError('PROPS_LIMIT', 'ZyroJS: public props exceed byte limit'); countText(value); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw new HydrationError('INVALID_PUBLIC_PROPS', 'ZyroJS: public props must be acyclic inert JSON data');
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new HydrationError('INVALID_PUBLIC_PROPS', 'ZyroJS: class instances cannot be public props');
    if (Reflect.ownKeys(value).length > 10000 || (array && value.length > 10000)) throw new HydrationError('PROPS_LIMIT', 'ZyroJS: public props exceed collection limit');
    ancestors.add(value);
    const result: any = array ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || /^(?:__proto__|constructor|prototype|toJSON)$/i.test(key) || /(?:password|secret|token|credential|authorization|cookie|privatekey|apikey)/i.test(key)) throw new HydrationError('PRIVATE_PUBLIC_PROPS', 'ZyroJS: private or unsafe public-props key rejected');
      if (key.length > 256) throw new HydrationError('PROPS_LIMIT', 'ZyroJS: public props key exceeds limit');
      countText(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !('value' in descriptor) || (array && !/^(0|[1-9][0-9]*)$/.test(key))) throw new HydrationError('INVALID_PUBLIC_PROPS', 'ZyroJS: public props cannot contain accessors or hidden fields');
      result[key] = visit(descriptor.value, depth + 1);
    }
    if (array && (result.length !== value.length || Object.keys(result).length !== value.length)) throw new HydrationError('INVALID_PUBLIC_PROPS', 'ZyroJS: sparse public arrays are unsupported');
    ancestors.delete(value);
    return result;
  };
  const result = visit(validated, 0) as P;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new HydrationError('INVALID_PUBLIC_PROPS', 'ZyroJS: public component props must be a plain record');
  if (new TextEncoder().encode(JSON.stringify(result)).length > maxBytes) throw new HydrationError('PROPS_LIMIT', 'ZyroJS: public props exceed byte limit');
  return result;
}
/** Script-data encoding is separate from HTML attribute/text encoding. */
export function serializeHydrationData<P>(data: HydrationData<P>, maxBytes = 65536): string {
  const json = serializeJsonForScript(data);
  if (new TextEncoder().encode(json).length > maxBytes) throw new HydrationError('PROPS_LIMIT', 'ZyroJS: encoded public props exceed byte limit');
  return json;
}
export function readHydrationData<P>(json: string, policy: HydrationPolicy<P>, maxBytes = 65536): HydrationData<P> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) throw new RangeError('ZyroJS: invalid hydration payload byte limit');
  if (typeof json !== 'string' || json.length > maxBytes || new TextEncoder().encode(json).length > maxBytes) throw new HydrationError('PROPS_LIMIT', 'ZyroJS: invalid hydration payload size');
  let data: any;
  try { data = JSON.parse(json); } catch { throw new HydrationError('INVALID_DATA', 'ZyroJS: invalid hydration JSON'); }
  if (!data || data.version !== HYDRATION_VERSION || Object.keys(data).sort().join(',') !== 'idPrefix,props,version') throw new HydrationError('INVALID_VERSION', 'ZyroJS: unsupported hydration payload version');
  validatePrefix(data.idPrefix);
  return {version: 1, idPrefix: data.idPrefix, props: publicProps(data.props, policy, maxBytes)};
}
let ids: {prefix: string; component: number; local: number} | undefined;
export function withComponentIds<T>(prefix: string, component: number, fn: () => T): T {
  const previous = ids; ids = {prefix, component, local: 0};
  try { return fn(); } finally { ids = previous; }
}
/** Setup-only deterministic IDs. The same component tree and unique host prefix must reach both ends. */
export function useId(): string {
  if (!ids) throw new HydrationError('ID_SCOPE_REQUIRED', 'ZyroJS: useId requires renderToHydratable/hydrate component setup');
  if (++ids.local > 1024) throw new HydrationError('ID_LIMIT', 'ZyroJS: component ID limit exceeded');
  return `${ids.prefix}-c${ids.component}-${ids.local}`;
}
