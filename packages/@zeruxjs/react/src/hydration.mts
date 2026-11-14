import { serializeJsonForScript } from '@zeruxjs/security/encoding';
import { createReactStore, type WritableExternalStore } from './store.js';
import {
  ReactAdapterError,
  reactByteLimit,
  reactPrefix,
} from './render-errors.js';
export { ReactAdapterError } from './render-errors.js';
export interface ReactStatePolicy<T> {
  /** Required trusted synchronous public projection; authorization/privacy are not inferred from a schema or field-name filter. */
  validateState: (input: unknown) => T;
  /** Default65536, maximum1048576 complete script-data UTF-8 bytes; depth16 and4096 entries are separate caps. */
  maxBytes?: number;
}
export interface ReactHydrationState<T> {
  /** Fixed version1 payload contract; unknown versions reject. */
  readonly version: 1;
  /** Required validated prefix retained exactly between server HTML and client hydration. */
  readonly identifierPrefix: string;
  /** Independently script-encoded JSON for a fixed application/json text sink, never an existing JS string/attribute. */
  readonly data: string;
  /** Owned fresh immutable public store with a pinned server snapshot matching data; dispose on owner teardown. */
  readonly store: WritableExternalStore<T>;
  /** Idempotently destroy only this owned public hydration store; do not destroy an unrelated borrowed source.
   * @returns {void} Explicit bounded public state owner or validation failure; private causes remain host-only.
   */
  dispose(): void;
}
/** Validate the encoded-state ceiling: default64 KiB and maximum1 MiB, separate from larger SSR HTML budgets.
 * @param {unknown} value - Untrusted explicit byte-budget input; absent uses64 KiB.
 * @returns {number} Explicit bounded public state owner or validation failure; private causes remain host-only.
 */
function limit(value: unknown) {
  /** Validated finite encoded-state budget, default64 KiB. */
  const bytes = reactByteLimit(value, 65536);
  if (bytes > 1048576) {
    throw new ReactAdapterError('STATE_BYTE_LIMIT');
  }
  return bytes;
}
/** Run the required trusted projection, then deeply snapshot/freeze inert JSON under depth16/4096-entry/byte budgets. Never invoke data getters/toJSON; key screening alone cannot prove secrecy.
 * @param {unknown} input - Unknown state passed through the required trusted public projection.
 * @param {ReactStatePolicy<T>} policy - Required synchronous public projection and finite byte budget; projection owns privacy/tenant authorization.
 * @param {number} bytes - Validated complete encoded-state byte ceiling; structural checks also limit depth/entries.
 * @returns {T} Explicit bounded public state owner or validation failure; private causes remain host-only.
 */
function snapshot<T>(
  input: unknown,
  policy: ReactStatePolicy<T>,
  bytes: number
): T {
  if (!policy || typeof policy.validateState !== 'function') {
    throw new ReactAdapterError('STATE_VALIDATOR_REQUIRED');
  }
  let value: T;
  try {
    value = policy.validateState(input);
  } catch (cause) {
    throw new ReactAdapterError('STATE_VALIDATION_FAILED', cause);
  }
  let entries = 0,
    size = 0;
  /** Active object ancestors reject cycles while allowing repeated noncyclic references. */
  const ancestors = new Set<object>();
  /** Count UTF-8 key/value bytes before complete encoded-envelope verification.
   * @param {string} value - Explicit immutable next value or caller-controlled policy input.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const text = (value: string) => {
    size += new TextEncoder().encode(value).length;
    if (size > bytes) {
      throw new ReactAdapterError('STATE_BYTE_LIMIT');
    }
  };
  /** Deeply copy/freeze inert JSON with finite depth/entry/byte checks; never evaluate getters or custom serialization.
   * @param {unknown} value - Explicit immutable next value or caller-controlled policy input.
   * @param {number} depth - Current bounded traversal depth.
   * @returns {unknown} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const visit = (value: unknown, depth: number): unknown => {
    if (++entries > 4096 || depth > 16) {
      throw new ReactAdapterError('STATE_STRUCTURE_LIMIT');
    }
    if (value === null || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value === 'string') {
      if (value.length > bytes) {
        throw new ReactAdapterError('STATE_BYTE_LIMIT');
      }
      text(value);
      return value;
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) {
      throw new ReactAdapterError('INVALID_PUBLIC_STATE');
    }
    /** Whether this container requires dense own numeric array keys. */
    const array = Array.isArray(value);
    /** Actual object prototype; class instances cannot silently serialize. */
    const proto = Object.getPrototypeOf(value);
    if (!array && proto !== Object.prototype && proto !== null) {
      throw new ReactAdapterError('INVALID_PUBLIC_STATE');
    }
    /** Finite own string/symbol keys inspected through descriptors, not property reads. */
    const keys = Reflect.ownKeys(value);
    if (keys.length > 4097 || (array && value.length > 4096)) {
      throw new ReactAdapterError('STATE_STRUCTURE_LIMIT');
    }
    ancestors.add(value);
    /** New inert array/null-prototype object frozen after validated children. */
    const result: any = array ? [] : Object.create(null);
    // Inspect only bounded own descriptors; never execute state properties to discover public data.
    for (const key of keys) {
      if (array && key === 'length') {
        continue;
      }
      if (
        typeof key !== 'string' ||
        key.length > 256 ||
        /^(?:__proto__|prototype|constructor|toJSON)$/i.test(key) ||
        /(?:password|secret|token|credential|authorization|cookie|privatekey|apikey)/i.test(
          key
        )
      ) {
        throw new ReactAdapterError('PRIVATE_STATE_KEY');
      }
      /** Own data descriptor; accessors/nonenumerable fields reject without execution. */
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        (array && !/^(0|[1-9][0-9]*)$/.test(key))
      ) {
        throw new ReactAdapterError('INVALID_PUBLIC_STATE');
      }
      text(key);
      result[key] = visit(descriptor.value, depth + 1);
    }
    if (
      array &&
      (result.length !== value.length ||
        Object.keys(result).length !== value.length)
    ) {
      throw new ReactAdapterError('INVALID_PUBLIC_STATE');
    }
    ancestors.delete(value);
    return Object.freeze(result);
  };
  return visit(value, 0) as T;
}
/** Create a separately script-encoded V1 payload and owned store whose pinned server snapshot is exactly the immutable encoded state.
 * @param {T} state - Already snapshotted immutable inert public JSON, never a store/React element.
 * @param {string} identifierPrefix - Validated required identifier shared with the exact server/browser tree.
 * @param {number} maxBytes - Validated complete script-data UTF-8 ceiling, not merely raw string length.
 * @returns {ReactHydrationState<T>} Explicit bounded public state owner or validation failure; private causes remain host-only.
 */
function owned<T>(
  state: T,
  identifierPrefix: string,
  maxBytes: number
): ReactHydrationState<T> {
  /** V1 independently encoded script text whose full escaped UTF-8 size is checked. */
  const data = serializeJsonForScript({ version: 1, identifierPrefix, state });
  if (new TextEncoder().encode(data).length > maxBytes) {
    throw new ReactAdapterError('STATE_BYTE_LIMIT');
  }
  /** Owned fresh public store with its exact pinned server state. */
  const store = createReactStore(state, { serverSnapshot: state });
  return Object.freeze({
    version: 1 as const,
    identifierPrefix,
    data,
    store,
    dispose: () => store.destroy(),
  });
}
/** Create fresh request-owned public state; host projection owns privacy/authorization and disposal. Never share per-user state through a server singleton.
 * @param {unknown} input - Unknown state passed through the required trusted public projection.
 * @param {object} options - Explicit trusted public projection and required server prefix.
 * @param {function} options.validateState - Synchronous public projection; owns privacy/authorization.
 * @param {string} options.identifierPrefix - Required matching server/client identifier.
 * @param {number} [options.maxBytes] - Default 65536, maximum 1048576 complete encoded bytes.
 * @returns {ReactHydrationState<T>} Explicit bounded public state owner or validation failure; private causes remain host-only.
 */
export function createReactHydrationState<T>(
  input: unknown,
  options: ReactStatePolicy<T> & {
    /** Required validated prefix retained exactly between server HTML and client hydration. */
    identifierPrefix: string;
  }
): ReactHydrationState<T> {
  reactPrefix(options?.identifierPrefix, true);
  /** Validated finite input/output state ceiling. */
  const max = limit(options.maxBytes);
  return owned(snapshot(input, options, max), options.identifierPrefix, max);
}
/** Validate the exact V1 payload/prefix and rerun the public projection. Reject non-idempotent transforms that alter serialized state instead of hiding hydration divergence.
 * @param {string} data - Bounded inert JSON script text read from a fixed textContent sink; never eval/HTML/attribute input.
 * @param {ReactStatePolicy<T>} options - Required synchronous idempotent projection and optional encoded byte ceiling.
 * @returns {ReactHydrationState<T>} Explicit bounded public state owner or validation failure; private causes remain host-only.
 */
export function readReactHydrationState<T>(
  data: string,
  options: ReactStatePolicy<T>
): ReactHydrationState<T> {
  /** Validated finite input/output state ceiling. */
  const max = limit(options?.maxBytes);
  if (
    typeof data !== 'string' ||
    data.length > max ||
    new TextEncoder().encode(data).length > max
  ) {
    throw new ReactAdapterError('STATE_BYTE_LIMIT');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch (cause) {
    throw new ReactAdapterError('INVALID_STATE_JSON', cause);
  }
  if (
    !parsed ||
    parsed.version !== 1 ||
    Object.keys(parsed).sort().join(',') !== 'identifierPrefix,state,version'
  ) {
    throw new ReactAdapterError('INVALID_STATE_VERSION');
  }
  reactPrefix(parsed.identifierPrefix, true);
  /** Validated immutable public state; parser-side revalidation must preserve its serialized value. */
  const state = snapshot(parsed.state, options, max);
  if (JSON.stringify(state) !== JSON.stringify(parsed.state)) {
    throw new ReactAdapterError('HYDRATION_STATE_CHANGED');
  }
  return owned(state, parsed.identifierPrefix, max);
}
