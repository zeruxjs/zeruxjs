import { serializeJsonForScript } from '@zeruxjs/security/encoding';

/** Stores the HYDRATION_VERSION value used by this module. */
export const HYDRATION_VERSION = 1 as const;
export interface HydrationLimits {
  /** Maximum number of nodes accepted during hydration. */
  maxNodes?: number;
  /** Maximum nesting depth accepted during hydration. */
  maxDepth?: number;
  /** Maximum serialized hydration payload size in bytes. */
  maxBytes?: number;
  /** Maximum serialized public-props size in bytes. */
  maxPropsBytes?: number;
}
export interface HydrationPolicy<P> {
  /** Validate and normalize the serialized public props. */
  validateProps: (input: unknown) => P;
  /** Abort signal that cancels rendering or hydration work. */
  signal?: AbortSignal;
}
export interface HydrationData<P> {
  /** Protocol version used to encode this payload. */
  version: 1;
  /** Stable identifier prefix shared by server and client rendering. */
  idPrefix: string;
  /** Host-validated public props for the root component. */
  props: P;
}
/** Coded validation failure raised while producing or adopting hydratable markup. */
export class HydrationError extends Error {
  /**
   * Create an error that preserves its stable protocol code and original cause.
   *
   * @param {string} code - Stable machine-readable error code.
   * @param {string} message - Safe human-readable error message.
   * @param {ErrorOptions} options - Optional native error cause metadata.
   */
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'HydrationError';
  }
}
/**
 * checkAbort.
 * @param {AbortSignal} signal - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    /** Stores the error value used by this module. */
    const error = new HydrationError(
      'RENDER_ABORTED',
      'ZyroJS: render aborted',
      { cause: signal.reason }
    );
    error.name = 'AbortError';
    throw error;
  }
}
/**
 * validatePrefix.
 * @param {unknown} value - Input value for this operation.
 * @returns {asserts value is string} Result produced by this operation.
 */
export function validatePrefix(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(value)
  ) {
    throw new HydrationError(
      'INVALID_PREFIX',
      'ZyroJS: idPrefix must be a short HTML-safe identifier'
    );
  }
}
/**
 * hydrationLimits.
 * @param {HydrationLimits} input - Input value for this operation.
 * @returns {unknown} Result produced by this operation.
 */
export function hydrationLimits(input: HydrationLimits = {}) {
  /** Stores the bounds value used by this module. */
  const bounds = {
    maxNodes: [10000, 100000],
    maxDepth: [64, 128],
    maxBytes: [1024 * 1024, 16 * 1024 * 1024],
    maxPropsBytes: [65536, 1024 * 1024],
  } as const;
  /** Stores the result value used by this module. */
  const result = {} as Record<keyof typeof bounds, number>;
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).some((key) => !Object.hasOwn(bounds, key))
  ) {
    throw new TypeError('ZyroJS: invalid hydration limits');
  }
  for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
    /** Stores the value value used by this module. */
    const value = input[key] ?? bounds[key][0];
    if (!Number.isSafeInteger(value) || value < 1 || value > bounds[key][1]) {
      throw new RangeError('ZyroJS: invalid hydration limit');
    }
    result[key] = value;
  }
  return result;
}
/** Clone only inert JSON data. No getters/toJSON, class instances, prototype keys or implicit omission. */
/**
 * publicProps.
 * @param {unknown} input - Input value for this operation.
 * @param {HydrationPolicy<P>} policy - Input value for this operation.
 * @param {unknown} maxBytes - Input value for this operation.
 * @returns {P} Result produced by this operation.
 */
export function publicProps<P>(
  input: unknown,
  policy: HydrationPolicy<P>,
  maxBytes = 65536
): P {
  if (!policy || typeof policy.validateProps !== 'function') {
    throw new TypeError('ZyroJS: a public-props validator is required');
  }
  if (
    policy.signal !== undefined &&
    (typeof policy.signal.aborted !== 'boolean' ||
      typeof policy.signal.addEventListener !== 'function' ||
      typeof policy.signal.removeEventListener !== 'function')
  ) {
    throw new TypeError('ZyroJS: invalid render signal');
  }
  checkAbort(policy.signal);
  /** Stores the validated value used by this module. */
  const validated = policy.validateProps(input);
  checkAbort(policy.signal);
  let entries = 0,
    bytes = 0;
  /**
   * Application function countText.
   * @param {string} text - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
   */
  const countText = (text: string) => {
    bytes += new TextEncoder().encode(text).length;
    if (bytes > maxBytes) {
      throw new HydrationError(
        'PROPS_LIMIT',
        'ZyroJS: public props exceed byte limit'
      );
    }
  };
  /** Stores the ancestors value used by this module. */
  const ancestors = new Set<object>();
  /**
   * Application function visit.
   * @param {unknown} value - Input value for this operation.
   * @param {number} depth - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
   */
  const visit = (value: unknown, depth: number): unknown => {
    checkAbort(policy.signal);
    if (++entries > 10000 || depth > 32) {
      throw new HydrationError(
        'PROPS_LIMIT',
        'ZyroJS: public props exceed structural limits'
      );
    }
    if (value === null || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > maxBytes) {
        throw new HydrationError(
          'PROPS_LIMIT',
          'ZyroJS: public props exceed byte limit'
        );
      }
      countText(value);
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) {
      throw new HydrationError(
        'INVALID_PUBLIC_PROPS',
        'ZyroJS: public props must be acyclic inert JSON data'
      );
    }
    /** Stores the array value used by this module. */
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new HydrationError(
        'INVALID_PUBLIC_PROPS',
        'ZyroJS: class instances cannot be public props'
      );
    }
    if (
      Reflect.ownKeys(value).length > 10000 ||
      (array && value.length > 10000)
    ) {
      throw new HydrationError(
        'PROPS_LIMIT',
        'ZyroJS: public props exceed collection limit'
      );
    }
    ancestors.add(value);
    /** Stores the result value used by this module. */
    const result: any = array ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') {
        continue;
      }
      if (
        typeof key !== 'string' ||
        /^(?:__proto__|constructor|prototype|toJSON)$/i.test(key) ||
        /(?:password|secret|token|credential|authorization|cookie|privatekey|apikey)/i.test(
          key
        )
      ) {
        throw new HydrationError(
          'PRIVATE_PUBLIC_PROPS',
          'ZyroJS: private or unsafe public-props key rejected'
        );
      }
      if (key.length > 256) {
        throw new HydrationError(
          'PROPS_LIMIT',
          'ZyroJS: public props key exceeds limit'
        );
      }
      countText(key);
      /** Stores the descriptor value used by this module. */
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        (array && !/^(0|[1-9][0-9]*)$/.test(key))
      ) {
        throw new HydrationError(
          'INVALID_PUBLIC_PROPS',
          'ZyroJS: public props cannot contain accessors or hidden fields'
        );
      }
      result[key] = visit(descriptor.value, depth + 1);
    }
    if (
      array &&
      (result.length !== value.length ||
        Object.keys(result).length !== value.length)
    ) {
      throw new HydrationError(
        'INVALID_PUBLIC_PROPS',
        'ZyroJS: sparse public arrays are unsupported'
      );
    }
    ancestors.delete(value);
    return result;
  };
  /** Stores the result value used by this module. */
  const result = visit(validated, 0) as P;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new HydrationError(
      'INVALID_PUBLIC_PROPS',
      'ZyroJS: public component props must be a plain record'
    );
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > maxBytes) {
    throw new HydrationError(
      'PROPS_LIMIT',
      'ZyroJS: public props exceed byte limit'
    );
  }
  return result;
}
/** Script-data encoding is separate from HTML attribute/text encoding. */
/**
 * serializeHydrationData.
 * @param {HydrationData<P>} data - Input value for this operation.
 * @param {unknown} maxBytes - Input value for this operation.
 * @returns {string} Result produced by this operation.
 */
export function serializeHydrationData<P>(
  data: HydrationData<P>,
  maxBytes = 65536
): string {
  /** Stores the json value used by this module. */
  const json = serializeJsonForScript(data);
  if (new TextEncoder().encode(json).length > maxBytes) {
    throw new HydrationError(
      'PROPS_LIMIT',
      'ZyroJS: encoded public props exceed byte limit'
    );
  }
  return json;
}
/**
 * readHydrationData.
 * @param {string} json - Input value for this operation.
 * @param {HydrationPolicy<P>} policy - Input value for this operation.
 * @param {unknown} maxBytes - Input value for this operation.
 * @returns {HydrationData<P>} Result produced by this operation.
 */
export function readHydrationData<P>(
  json: string,
  policy: HydrationPolicy<P>,
  maxBytes = 65536
): HydrationData<P> {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 1024 * 1024
  ) {
    throw new RangeError('ZyroJS: invalid hydration payload byte limit');
  }
  if (
    typeof json !== 'string' ||
    json.length > maxBytes ||
    new TextEncoder().encode(json).length > maxBytes
  ) {
    throw new HydrationError(
      'PROPS_LIMIT',
      'ZyroJS: invalid hydration payload size'
    );
  }
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new HydrationError('INVALID_DATA', 'ZyroJS: invalid hydration JSON');
  }
  if (
    !data ||
    data.version !== HYDRATION_VERSION ||
    Object.keys(data).sort().join(',') !== 'idPrefix,props,version'
  ) {
    throw new HydrationError(
      'INVALID_VERSION',
      'ZyroJS: unsupported hydration payload version'
    );
  }
  validatePrefix(data.idPrefix);
  return {
    version: 1,
    idPrefix: data.idPrefix,
    props: publicProps(data.props, policy, maxBytes),
  };
}
let ids: { prefix: string; component: number; local: number } | undefined;
/**
 * withComponentIds.
 * @param {string} prefix - Input value for this operation.
 * @param {number} component - Input value for this operation.
 * @param {() => T} fn - Input value for this operation.
 * @returns {T} Result produced by this operation.
 */
export function withComponentIds<T>(
  prefix: string,
  component: number,
  fn: () => T
): T {
  /** Stores the previous value used by this module. */
  const previous = ids;
  ids = { prefix, component, local: 0 };
  try {
    return fn();
  } finally {
    ids = previous;
  }
}
/** Setup-only deterministic IDs. The same component tree and unique host prefix must reach both ends. */
/**
 * useId.
 * @returns {string} Result produced by this operation.
 */
export function useId(): string {
  if (!ids) {
    throw new HydrationError(
      'ID_SCOPE_REQUIRED',
      'ZyroJS: useId requires renderToHydratable/hydrate component setup'
    );
  }
  if (++ids.local > 1024) {
    throw new HydrationError('ID_LIMIT', 'ZyroJS: component ID limit exceeded');
  }
  return `${ids.prefix}-c${ids.component}-${ids.local}`;
}
