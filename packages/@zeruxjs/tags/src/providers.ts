import type {
  Scalar,
  Values,
  TagContainer,
  TagDefinition,
  TagEvent,
} from './types.js';
export interface ProviderField {
  /** Declared public scalar type; provider callback logic remains trusted code. */
  type: 'string' | 'number' | 'boolean';
  /** True requires this field in publicConfig; omission makes it optional. */
  required?: boolean;
  /** Optional bounded allowlist of values of the declared scalar type. */
  values?: readonly Scalar[];
}
export interface TagProviderContext {
  /** Frozen public event snapshot; no private destination credentials are included. */
  event: Readonly<TagEvent>;
  /** Frozen validated public configuration, never a place for secrets. */
  config: Readonly<Values>;
  /** Frozen resolved scalar parameters; bindings are not JavaScript expressions. */
  parameters: Readonly<Values>;
  /** Borrowed cooperative execution signal; it cannot force-cancel arbitrary JavaScript. */
  signal: AbortSignal;
  /** Only configured destination references; no arbitrary endpoint from container JSON. */
  send(destinationRef: string, payload: Values): Promise<void>;
}
export interface TagProviderDefinition {
  /** Explicit bounded provider name registered by trusted application code. */
  id: string;
  /** Positive integer schema version; register retained versions separately. */
  version: number;
  /** Frozen validated public configuration, never a place for secrets. */
  config: Readonly<Record<string, ProviderField>>;
  /** At most sixteen declared destination references; manager configuration is checked separately. */
  destinations?: readonly string[];
  /** Invoke trusted registered code with validated configuration. Manager owns consent, tenant authorization, deadline and actual-settlement tracking.
   * @param {TagProviderContext} context - Manager-created frozen public event/config and cooperative bounded send capability.
   * @returns {Promise<void>} Trusted handler settlement; direct host side effects cannot be sandboxed or forcibly cancelled.
   */
  dispatch(context: TagProviderContext): Promise<void> | void;
  dispose?(): Promise<void> | void;
}
/** Validate a bounded public provider/schema identifier.
 * @param {unknown} v - Candidate name.
 * @returns {boolean} Whether syntax is supported and prototype-pollution names are excluded.
 */
const name = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
/** Validate finite bounded public scalar data.
 * @param {unknown} v - Candidate scalar.
 * @returns {boolean} Whether null, boolean, bounded string or finite number.
 */
const scalar = (v: unknown): v is Scalar =>
  v === null ||
  typeof v === 'boolean' ||
  (typeof v === 'string' && v.length <= 1024) ||
  (typeof v === 'number' && Number.isFinite(v));
/** Bound tag data traversal and serialization before schema reconstruction; reject accessors, cycles, nonfinite numbers and nonplain object records. Trusted code registration is a separate boundary.
 * @param {unknown} input - Candidate public data, not provider callbacks or credentials.
 * @param {number} maxBytes - UTF-8 key/value and final serialized byte ceiling, default 128 KiB.
 * @returns {void} Completes when the data fits traversal/serialization policy; no source code is evaluated.
 */
export function inertTagJson(input: unknown, maxBytes = 128 * 1024) {
  let nodes = 0,
    bytes = 0;
  /** Current traversal ancestor set detects cycles without rejecting harmless repeated references. */
  const active = new Set<object>();
  /** Traverse data within the shared byte, depth and node budgets.
   * @param {unknown} value - Current candidate data node.
   * @param {number} depth - Ancestor depth, starting at zero.
   * @returns {void} Completes when the subtree fits the declared inert-data limits.
   */
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 20000 || depth > 32) {
      throw new RangeError('Tag JSON complexity limit');
    }
    if (value === undefined || value === null || typeof value === 'boolean') {
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new TypeError('Invalid tag number');
      }
      return;
    }
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value);
      if (bytes > maxBytes) {
        throw new RangeError('Tag JSON byte limit');
      }
      return;
    }
    if (
      typeof value !== 'object' ||
      active.has(value) ||
      (!Array.isArray(value) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    ) {
      throw new TypeError('Inert tag JSON required');
    }
    active.add(value);
    // Inspect descriptors before values so getters cannot run during traversal.
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') {
        continue;
      }
      if (
        typeof key !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      ) {
        throw new TypeError('Invalid tag JSON key');
      }
      bytes += Buffer.byteLength(key);
      if (bytes > maxBytes) {
        throw new RangeError('Tag JSON byte limit');
      }
      /** Own descriptor inspected without invoking an accessor. */
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in d)) {
        throw new TypeError('Tag accessors forbidden');
      }
      visit(d.value, depth + 1);
    }
    active.delete(value);
  };
  visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > maxBytes) {
    throw new RangeError('Tag JSON byte limit');
  }
}
/** Create an explicit app-owned trusted-code registry with versioned public scalar schemas. It performs no discovery, network work or sandboxing; drain all borrowing managers before close.
 * @returns {object} Registration/validation/dispatch API and idempotent asynchronous provider disposal.
 */
export function createTagProviderRegistry() {
  /** Owned app-scoped registration map; no package scanning or global registry. */
  const definitions = new Map<string, TagProviderDefinition>();
  let closed = false,
    closing: Promise<void> | undefined;
  /** Resolve an explicitly registered immutable ID/version pair while rejecting closed or unknown registries.
   * @param {TagDefinition} tag - Validated provider tag carrying the exact registry reference and version.
   * @returns {TagProviderDefinition} Borrowed snapshotted registration with bound trusted callbacks.
   */
  function get(tag: TagDefinition) {
    if (closed) {
      throw new Error('Tag provider registry closed');
    }
    /** Exact registered provider schema/callback snapshot for the tag’s ID/version. */
    const definition = definitions.get(
      tag.providerRef + ':' + tag.providerVersion
    );
    if (!definition) {
      throw new TypeError('Unsupported tag provider schema version');
    }
    return definition;
  }
  return {
    /** Register trusted application callbacks and snapshot the bounded public schema and destination references. Existing ID/version pairs cannot be replaced.
     * @param {TagProviderDefinition} input - Explicit trusted code definition; public fields must not carry credentials.
     * @returns {void} Completes after registration; no callback, network request or package loading occurs.
     */
    register(input: TagProviderDefinition) {
      if (
        closed ||
        !input ||
        !name(input.id) ||
        !Number.isSafeInteger(input.version) ||
        input.version < 1 ||
        input.version > 10000 ||
        typeof input.dispatch !== 'function' ||
        (input.dispose !== undefined && typeof input.dispose !== 'function') ||
        definitions.size >= 32 ||
        definitions.has(input.id + ':' + input.version)
      ) {
        throw new TypeError('Invalid or duplicate provider registration');
      }
      if (
        input.destinations !== undefined &&
        (!Array.isArray(input.destinations) ||
          input.destinations.length > 16 ||
          input.destinations.some((ref) => !name(ref)) ||
          new Set(input.destinations).size !== input.destinations.length)
      ) {
        throw new TypeError('Invalid provider destinations');
      }
      inertTagJson(input.config, 8192);
      if (
        !input.config ||
        Array.isArray(input.config) ||
        Object.keys(input.config).length > 25
      ) {
        throw new TypeError('Invalid provider schema');
      }
      // Snapshot only declared scalar schema fields; reject obvious secret-bearing names.
      for (const [key, field] of Object.entries(input.config)) {
        if (
          !name(key) ||
          /(secret|token|password|authorization|cookie|credential|privatekey)/i.test(
            key
          ) ||
          !field ||
          Object.keys(field).some(
            (k) => !['type', 'required', 'values'].includes(k)
          ) ||
          !['string', 'number', 'boolean'].includes(field.type) ||
          (field.required !== undefined &&
            typeof field.required !== 'boolean') ||
          (field.values !== undefined &&
            (!Array.isArray(field.values) ||
              field.values.length < 1 ||
              field.values.length > 64 ||
              field.values.some((v) => !scalar(v) || typeof v !== field.type)))
        ) {
          throw new TypeError('Invalid public provider field');
        }
      }
      definitions.set(input.id + ':' + input.version, {
        id: input.id,
        version: input.version,
        config: structuredClone(input.config),
        destinations: [...(input.destinations ?? [])],
        dispatch: input.dispatch.bind(input),
        dispose: input.dispose?.bind(input),
      });
    },
    /** Require compatible public configuration against the registered scalar schema. Validation is not tenant authorization.
     * @param {TagDefinition} tag - Candidate provider tag whose publicConfig must contain only declared bounded fields.
     * @returns {void} Completes only for a supported ID/version and valid public values.
     */
    validate(tag: TagDefinition) {
      /** Exact registered provider schema/callback snapshot for the tag’s ID/version. */
      const definition = get(tag);
      /** Candidate public values validated before any trusted handler executes. */
      const config = tag.publicConfig ?? {};
      inertTagJson(config, 16384);
      if (
        !config ||
        Array.isArray(config) ||
        Object.keys(config).some((k) => !Object.hasOwn(definition.config, k))
      ) {
        throw new TypeError('Unknown provider configuration');
      }
      // Check every required field even when it is absent from supplied configuration.
      for (const [key, field] of Object.entries(definition.config)) {
        /** One declared public field value checked for presence, scalar type and allowed values. */
        const value = config[key];
        if (value === undefined) {
          if (field.required) {
            throw new TypeError('Missing provider field');
          }
        } else if (
          !scalar(value) ||
          typeof value !== field.type ||
          (field.values && !field.values.includes(value))
        ) {
          throw new TypeError('Invalid provider field value');
        }
      }
    },
    /** Check the provider’s declared reference allowlist; the manager must separately enforce configured destination policy.
     * @param {TagDefinition} tag - Registered provider tag.
     * @param {string} ref - Opaque configured destination reference, never an arbitrary URL.
     * @returns {boolean} Whether the reference is declared for this exact provider version.
     */
    allowsDestination(tag: TagDefinition, ref: string) {
      return get(tag).destinations!.includes(ref);
    },
    /** Check that every declared provider destination exists in the manager’s available references.
     * @param {TagDefinition} tag - Registered provider tag.
     * @param {readonly string[]} refs - Host-configured destination names; credentials and URLs remain private.
     * @returns {boolean} Whether all declared references are configured; no connectivity probe occurs.
     */
    configured(tag: TagDefinition, refs: readonly string[]) {
      return get(tag).destinations!.every((ref) => refs.includes(ref));
    },
    /** Invoke trusted registered code with validated configuration. Manager owns consent, tenant authorization, deadline and actual-settlement tracking.
     * @param {TagDefinition} tag - Registered tag validated before dispatch.
     * @param {TagProviderContext} context - Manager-created frozen public event/config and cooperative bounded send capability.
     * @returns {Promise<void>} Trusted handler settlement; direct host side effects cannot be sandboxed or forcibly cancelled.
     */
    async dispatch(tag: TagDefinition, context: TagProviderContext) {
      this.validate(tag);
      await get(tag).dispatch(context);
    },
    /** Dispose registrations after all borrowing managers have drained. Attempts every disposer, clears registrations and reports any disposal failure.
     * @returns {Promise<void>} Shared disposal promise; this registry does not independently track active handler work.
     */
    close() {
      return (closing ??= (async () => {
        closed = true;
        /** All disposer outcomes retained so one failure cannot skip later registrations. */
        const results = await Promise.allSettled(
          [...definitions.values()].map((p) =>
            Promise.resolve().then(() => p.dispose?.())
          )
        );
        definitions.clear();
        if (results.some((r) => r.status === 'rejected')) {
          throw new Error('Provider disposal failed');
        }
      })());
    },
  };
}
export type TagProviderRegistry = ReturnType<typeof createTagProviderRegistry>;
/** Check all custom provider tags against an explicit borrowed registry without dispatching or publishing.
 * @param {TagContainer} container - Validated bounded container definition.
 * @param {TagProviderRegistry} registry - Explicit registry required only if provider tags are present.
 * @returns {void} Completes for supported schemas; missing or incompatible registrations reject.
 */
export function validateTagProviders(
  container: TagContainer,
  registry?: TagProviderRegistry
) {
  // Validate every custom tag before a caller can save, publish or dispatch its definition.
  for (const tag of container.tags) {
    if (tag.type === 'provider') {
      if (!registry) {
        throw new TypeError('Explicit provider registry required');
      }
      registry.validate(tag);
    }
  }
}
