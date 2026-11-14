/** Finite user choices; no identity, speech text, voice queue or auto-start state. */
export interface PreferenceValues {
  /** Finite parent-relative scale: 1, 1.25, 1.5 or 2; fixed child typography may not scale. */
  readonly textScale: 1 | 1.25 | 1.5 | 2;
  /** Explicit palette choice; system leaves host styling and forced colors keeps precedence. */
  readonly contrast: 'system' | 'light' | 'dark' | 'high';
  /** System or reduce; no user value forces motion against a reduced-motion system preference. */
  readonly motion: 'system' | 'reduce';
}
/** Observed/injected system safeguards kept separate from persisted user choices. */
export interface PreferenceSystem {
  /** Current injected/observed system reduced-motion flag; reset does not disable it. */
  readonly reducedMotion: boolean;
  /** Current injected/observed system forced-colors flag; takes precedence over contrast choices. */
  readonly forcedColors: boolean;
}
/** Frozen V2 view of user choices, system safeguards and effective policy. */
export interface PreferenceSnapshot {
  /** Current normalized snapshot schema version, exactly 2. */
  readonly version: 2;
  /** Validated scalar preference choices; never includes speech text, identity or execution flags. */
  readonly values: PreferenceValues;
  /** Per-owner system state, observed only through explicit bindings or setSystem. */
  readonly system: PreferenceSystem;
  /** Frozen derived policy respecting system motion and forced-color safeguards. */
  readonly effective: {
    /** Effective reduction is system reduced motion OR an explicit reduce choice. */
    readonly reducedMotion: boolean;
    /** Explicit palette choice; system leaves host styling and forced colors keeps precedence. */
    readonly contrast: PreferenceValues['contrast'] | 'forced';
  };
}
/** Injected synchronous key/value facade; no storage is selected implicitly. */
export interface PreferenceStorage {
  /** Read only the explicit scoped persistence key synchronously.
   * @param {string} key - Host-scoped storage key; the implementation must not access unrelated keys.
   * @returns {string | null} Current scoped value or null; blocked storage may throw synchronously.
   */
  getItem(key: string): string | null;
  /** Write only the explicitly scoped key and serialized value synchronously.
   * @param {string} key - Host-scoped storage key; the implementation must not access unrelated keys.
   * @param {string} value - Explicit authored value; validation/ownership depends on the declared method.
   * @returns {void} No value; the injected implementation writes only the selected key or throws synchronously.
   */
  setItem(key: string, value: string): void;
  /** Remove only the explicitly scoped key synchronously.
   * @param {string} key - Host-scoped storage key; the implementation must not access unrelated keys.
   * @returns {void} No value; the injected implementation removes only the selected key or throws synchronously.
   */
  removeItem(key: string): void;
}
export type PreferenceErrorCode =
  | 'STORAGE_READ'
  | 'STORAGE_WRITE'
  | 'STORAGE_RESET'
  | 'INVALID_SNAPSHOT'
  | 'SUBSCRIBER_FAILED';
/** Per-owner headless state and bounded observers; no cross-account singleton is implied. */
export interface PreferenceState {
  /** Read the stable frozen state view without initiating media, speech or network work.
   * @returns {PreferenceSnapshot} Stable frozen snapshot until values/system state changes.
   */
  getSnapshot(): PreferenceSnapshot;
  /** Read fixed capability/persistence status without exposing text or native errors.
   * @returns {Readonly<{ persistence: 'disabled' | 'ready' | 'failed'; lastError?: PreferenceErrorCode; }>} Current fixed status; no private text/native error events are returned.
   */
  getStatus(): Readonly<{
    /** disabled without injection, ready after successful access, failed on observed storage errors. */
    persistence: 'disabled' | 'ready' | 'failed';
    /** Most recent fixed diagnostic; it may remain after later persistence recovery. */
    lastError?: PreferenceErrorCode;
  }>;
  /** Apply explicit validated values/attributes; no arbitrary executable content is evaluated.
   * @param {Partial<PreferenceValues>} values - Explicit finite partial update; unknown keys and invalid values reject before state changes.
   * @returns {void} No value; commits changed validated choices and tries only the configured storage key.
   */
  set(values: Partial<PreferenceValues>): void;
  /** Merge explicit boolean system flags without changing the persisted user preference schema.
   * @param {Partial<PreferenceSystem>} values - Explicit finite partial update; unknown keys and invalid values reject before state changes.
   * @returns {void} No value; updates system/effective flags without persisting them as user preferences.
   */
  setSystem(values: Partial<PreferenceSystem>): void;
  /** Restore library values and remove only this scoped persistence key; system safeguards remain.
   * @returns {void} No value; restores default choices/removes the scoped key, retaining system safeguards.
   */
  reset(): void;
  /** Register a bounded owner-local observer and return its exact unsubscribe callback.
   * @param {() => void} listener - Borrowed synchronous observer; unsubscribe removes only this registration.
   * @returns {() => void} Exact unsubscribe handle; callers own eventual invocation.
   */
  subscribe(listener: () => void): () => void;
  /** Release this owner resources; borrowed dependencies remain caller-owned.
   * @returns {void} No value; clears local subscriptions/storage references and rejects subsequent state operations.
   */
  destroy(): void;
}
/** Frozen defaults; each state instance keeps its own mutable selection/observer ownership. */
export const defaultPreferences: PreferenceValues = Object.freeze({
  textScale: 1,
  contrast: 'system',
  motion: 'system',
});
/** Validate bounded own data descriptors without reading getters.
 * @param {unknown} value - Explicit input/attribute value; validation and effect are described by this helper.
 * @returns {Record<string,unknown>} Detached own property data; symbols, accessors and excess fields reject.
 */
function record(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length
  ) {
    throw new TypeError('Invalid preference data');
  }
  /** Own data descriptors checked without invoking property getters. */
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.keys(descriptors).length > 8 ||
    Object.values(descriptors).some((item) => !Object.hasOwn(item, 'value'))
  ) {
    throw new TypeError('Invalid preference properties');
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [
      key,
      descriptor.value,
    ])
  );
}
/** Validate full or partial finite preference choices without coercion.
 * @param {unknown} input - Candidate own data; no executable strings/getters are evaluated as preferences or content.
 * @param {boolean} partial - Permit a validated subset when true; full snapshots require all three value keys.
 * @returns {PreferenceValues | Partial<PreferenceValues>} Frozen validated data; only the documented keys/enums are accepted.
 */
function values(
  input: unknown,
  partial = false
): PreferenceValues | Partial<PreferenceValues> {
  /** Detached plain-data candidate; unknown fields/values reject before state mutation. */
  const data = record(input);
  if (
    Object.keys(data).some(
      (key) => !['textScale', 'contrast', 'motion'].includes(key)
    ) ||
    (!partial && Object.keys(data).length !== 3)
  ) {
    throw new TypeError('Invalid preference fields');
  }
  if (
    (Object.hasOwn(data, 'textScale') &&
      ![1, 1.25, 1.5, 2].includes(data.textScale as number)) ||
    (Object.hasOwn(data, 'contrast') &&
      !['system', 'light', 'dark', 'high'].includes(data.contrast as string)) ||
    (Object.hasOwn(data, 'motion') &&
      !['system', 'reduce'].includes(data.motion as string))
  ) {
    throw new TypeError('Invalid preference value');
  }
  return Object.freeze(data) as unknown as PreferenceValues;
}
/** Parse at most 4,096 UTF-8 bytes and explicitly migrate only supported V1/V2 shapes.
 * @param {string} text - Bounded JSON/approved text; it is never used as a program or remote endpoint.
 * @returns {Readonly<{version:2,values:PreferenceValues}>} Frozen normalized V2 snapshot; unknown data is never guessed or evaluated.
 * @throws {RangeError} For nonstring/oversized input exceeding the explicit snapshot boundary.
 * @throws {SyntaxError} When text is malformed JSON.
 * @throws {TypeError} For unsupported versions, fields or enum values; no arbitrary legacy shape is inferred.
 */
export function parsePreferenceSnapshot(text: string): Readonly<{
  /** Current normalized snapshot schema version, exactly 2. */
  version: 2;
  /** Validated scalar preference choices; never includes speech text, identity or execution flags. */
  values: PreferenceValues;
}> {
  if (
    typeof text !== 'string' ||
    text.length > 4096 ||
    new TextEncoder().encode(text).length > 4096
  ) {
    throw new RangeError('Preference snapshot byte limit exceeded');
  }
  /** Detached plain-data candidate; unknown fields/values reject before state mutation. */
  const data = record(JSON.parse(text));
  let parsed: PreferenceValues;
  if (
    data.version === 2 &&
    Object.keys(data).length === 2 &&
    Object.hasOwn(data, 'values')
  ) {
    parsed = values(data.values) as PreferenceValues;
  } else if (
    data.version === 1 &&
    Object.keys(data).length === 2 &&
    Object.hasOwn(data, 'preferences')
  ) {
    /** Validated explicit V1 import shape; migration never guesses arbitrary legacy fields. */
    const old = record(data.preferences);
    if (
      Object.keys(old).length !== 3 ||
      ![100, 125, 150, 200].includes(old.textSize as number) ||
      !['default', 'high'].includes(old.contrast as string) ||
      typeof old.reducedMotion !== 'boolean'
    ) {
      throw new TypeError('Invalid V1 preference snapshot');
    }
    if (
      Object.keys(old).some(
        (key) => !['textSize', 'contrast', 'reducedMotion'].includes(key)
      )
    ) {
      throw new TypeError('Invalid V1 preference fields');
    }
    parsed = Object.freeze({
      textScale: Number(old.textSize) / 100,
      contrast: old.contrast === 'high' ? 'high' : 'system',
      motion: old.reducedMotion ? 'reduce' : 'system',
    }) as PreferenceValues;
  } else {
    throw new TypeError('Unsupported preference snapshot');
  }
  return Object.freeze({ version: 2, values: parsed });
}
/** Serialize validated preferences to the deterministic V2 storage shape.
 * @param {PreferenceValues} input - Candidate own data; no executable strings/getters are evaluated as preferences or content.
 * @returns {string} JSON containing values only; no system state, identity, speech text or execution flags.
 * @throws {TypeError} For unknown/missing keys or invalid finite preference choices.
 */
export function serializePreferenceSnapshot(input: PreferenceValues): string {
  /** Validated finite preference update, detached before serialization/state commit. */
  const checked = values(input) as PreferenceValues;
  return JSON.stringify({
    version: 2,
    values: {
      textScale: checked.textScale,
      contrast: checked.contrast,
      motion: checked.motion,
    },
  });
}
/** Create headless per-owner preferences with optional explicitly injected synchronous storage.
 * @param {{ initial?: Partial<PreferenceValues>; persistence?: { key: string; storage: PreferenceStorage | (() => PreferenceStorage); }; onError?: (code: PreferenceErrorCode) => void; }} options - Caller-owned options; see documented fields for defaults, limits and ownership.
 * @param {Partial<PreferenceValues>} [options.initial] - Validated partial choices overriding defaults and valid persisted values.
 * @param {{ key: string; storage: PreferenceStorage | (() => PreferenceStorage); }} [options.persistence] - Explicit scoped synchronous storage; omission keeps memory-only state.
 * @param {string} options.persistence.key - Only this host-scoped key is read/written/removed; no remote synchronization occurs.
 * @param {PreferenceStorage | (() => PreferenceStorage)} options.persistence.storage - Injected storage object/lazy factory; blocked access is reported locally.
 * @param {(code: PreferenceErrorCode) => void} [options.onError] - Host hook receiving fixed codes only; no private values or native utterance payloads.
 * @returns {PreferenceState} Owned state; no DOM/media/storage access unless explicitly configured.
 * @throws {TypeError} For invalid initial values/storage keys; actual storage/observer failures use fixed status codes instead.
 */
export function createPreferenceState(
  options: {
    /** Validated partial overrides applied after defaults and valid persisted values. */
    initial?: Partial<PreferenceValues>;
    /** disabled without injection, ready after successful access, failed on observed storage errors. */
    persistence?: {
      /** Host-selected scoped storage key; at most 128 characters and no ASCII controls. */
      key: string;
      /** Explicit synchronous storage or lazy factory; failures fall back to in-memory state. */
      storage: PreferenceStorage | (() => PreferenceStorage);
    };
    /** Trusted diagnostic callback receiving fixed codes only; failures/reentrancy are isolated. */
    onError?: (code: PreferenceErrorCode) => void;
  } = {}
): PreferenceState {
  /** Validated partial initial overrides applied after persisted values. */
  const initial = values(options.initial ?? {}, true);
  let current: PreferenceValues = defaultPreferences,
    system: PreferenceSystem = Object.freeze({
      reducedMotion: false,
      forcedColors: false,
    });
  let storage: PreferenceStorage | undefined,
    key = '',
    persistence: 'disabled' | 'ready' | 'failed' = 'disabled',
    lastError: PreferenceErrorCode | undefined,
    disposed = false;
  /** Per-instance subscriptions, capped at 128 and removed on destroy. */
  const listeners = new Set<() => void>();
  let notifying = false,
    pending = false;
  let reporting = false;
  /** Fixed-code diagnostic reporter guarded against recursive/failing host callbacks.
   * @param {PreferenceErrorCode} code - Fixed diagnostic code; never include persisted values or approved speech text.
   * @returns {void} Records a fixed diagnostic code; failing host hooks cannot disable the preference UI.
   */
  const error = (code: PreferenceErrorCode) => {
    lastError = code;
    if (reporting) {
      return;
    }
    reporting = true;
    try {
      options.onError?.(code);
    } catch {
      /* Diagnostic callbacks never disable the preference UI. */
    } finally {
      reporting = false;
    }
  };
  if (options.persistence) {
    key = options.persistence.key;
    if (
      typeof key !== 'string' ||
      !key ||
      key.length > 128 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\u0000-\u001f\u007f]/.test(key)
    ) {
      throw new TypeError('Invalid preference storage key');
    }
    try {
      storage =
        typeof options.persistence.storage === 'function'
          ? options.persistence.storage()
          : options.persistence.storage;
      if (
        !storage ||
        ['getItem', 'setItem', 'removeItem'].some(
          (name) =>
            typeof (storage as unknown as Record<string, unknown>)[name] !==
            'function'
        )
      ) {
        throw new TypeError();
      }
      persistence = 'ready';
      /** Only the explicitly configured storage key value; corrupt data stays a local failure. */
      const stored = storage.getItem(key);
      if (stored !== null) {
        try {
          current = parsePreferenceSnapshot(stored).values;
        } catch {
          persistence = 'failed';
          error('INVALID_SNAPSHOT');
        }
      }
    } catch {
      persistence = 'failed';
      error('STORAGE_READ');
    }
  }
  current = Object.freeze({ ...current, ...initial });
  /** Create a stable frozen view of current choices, system state and effective policy.
   * @returns {PreferenceSnapshot} Frozen view of current choices, system state and effective media safeguards.
   */
  const snapshot = (): PreferenceSnapshot =>
    Object.freeze({
      version: 2,
      values: current,
      system,
      effective: Object.freeze({
        reducedMotion: system.reducedMotion || current.motion === 'reduce',
        contrast: system.forcedColors ? 'forced' : current.contrast,
      }),
    });
  let view = snapshot();
  /** Reject state operations after this owner has been destroyed.
   * @returns {void} No value; throws after this controller/state has been destroyed.
   */
  const assertLive = () => {
    if (disposed) {
      throw new Error('Preference state destroyed');
    }
  };
  /** Bound synchronous reentrant notifications to 32 cycles and isolate observer failures.
   * @returns {void} Notifies a bounded set of listeners with bounded reentrant cycles and fixed failure codes.
   */
  const emit = () => {
    if (
      current.textScale !== view.values.textScale ||
      current.contrast !== view.values.contrast ||
      current.motion !== view.values.motion ||
      system.reducedMotion !== view.system.reducedMotion ||
      system.forcedColors !== view.system.forcedColors
    ) {
      view = snapshot();
    }
    pending = true;
    if (notifying) {
      return;
    }
    notifying = true;
    try {
      let cycles = 0;
      while (pending) {
        if (++cycles > 32) {
          pending = false;
          error('SUBSCRIBER_FAILED');
          break;
        }
        pending = false;
        // listener is still registered in this instance; callback failures become fixed codes and reentrancy is bounded.
        for (const listener of [...listeners]) {
          if (listeners.has(listener)) {
            try {
              listener();
            } catch {
              error('SUBSCRIBER_FAILED');
            }
          }
        }
      }
    } finally {
      notifying = false;
    }
  };
  return {
    /** Read the stable frozen state view without initiating media, speech or network work.
     * @returns {PreferenceSnapshot} Stable frozen snapshot until values/system state changes.
     */
    getSnapshot() {
      assertLive();
      return view;
    },
    /** Read fixed capability/persistence status without exposing text or native errors.
     * @returns {Readonly<{persistence:'disabled'|'ready'|'failed',lastError?:PreferenceErrorCode}>} Current fixed status; no private text/native error events are returned.
     */
    getStatus() {
      assertLive();
      return Object.freeze({
        persistence,
        ...(lastError ? { lastError } : {}),
      });
    },
    /** Apply explicit validated values/attributes; no arbitrary executable content is evaluated.
     * @param {unknown} input - Explicit update data validated before replacing state or writing storage.
     * @returns {void} No value; commits changed validated choices and tries only the configured storage key.
     */
    set(input) {
      assertLive();
      /** Validated finite preference update, detached before serialization/state commit. */
      const checked = values(input, true);
      /** Frozen candidate; unchanged values preserve snapshot identity and avoid persistence writes. */
      const next = Object.freeze({ ...current, ...checked });
      if (JSON.stringify(next) === JSON.stringify(current)) {
        return;
      }
      current = next;
      if (storage) {
        try {
          storage.setItem(key, serializePreferenceSnapshot(current));
          persistence = 'ready';
        } catch {
          persistence = 'failed';
          error('STORAGE_WRITE');
        }
      }
      emit();
    },
    /** Merge explicit boolean system flags without changing the persisted user preference schema.
     * @param {unknown} input - Explicit update data validated before replacing state or writing storage.
     * @returns {void} No value; updates system/effective flags without persisting them as user preferences.
     */
    setSystem(input) {
      assertLive();
      /** Detached plain-data candidate; unknown fields/values reject before state mutation. */
      const data = record(input);
      if (
        Object.keys(data).some(
          (key) => !['reducedMotion', 'forcedColors'].includes(key)
        ) ||
        Object.values(data).some((value) => typeof value !== 'boolean')
      ) {
        throw new TypeError('Invalid system preference');
      }
      /** Frozen candidate; unchanged values preserve snapshot identity and avoid persistence writes. */
      const next = Object.freeze({ ...system, ...data }) as PreferenceSystem;
      if (
        next.reducedMotion === system.reducedMotion &&
        next.forcedColors === system.forcedColors
      ) {
        return;
      }
      system = next;
      emit();
    },
    /** Restore library values and remove only this scoped persistence key; system safeguards remain.
     * @returns {void} No value; restores default choices/removes the scoped key, retaining system safeguards.
     */
    reset() {
      assertLive();
      current = defaultPreferences;
      if (storage) {
        try {
          storage.removeItem(key);
          persistence = 'ready';
        } catch {
          persistence = 'failed';
          error('STORAGE_RESET');
        }
      }
      emit();
    },
    /** Register a bounded owner-local observer and return its exact unsubscribe callback.
     * @param {() => void} listener - Borrowed synchronous observer; unsubscribe removes only this registration.
     * @returns {() => void} Exact unsubscribe handle; callers own eventual invocation.
     */
    subscribe(listener) {
      assertLive();
      if (typeof listener !== 'function' || listeners.size >= 128) {
        throw new TypeError('Invalid or excessive preference subscribers');
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Release this owner resources; borrowed dependencies remain caller-owned.
     * @returns {void} No value; clears local subscriptions/storage references and rejects subsequent state operations.
     */
    destroy() {
      if (disposed) {
        return;
      }
      disposed = true;
      listeners.clear();
      pending = false;
      storage = undefined;
    },
  };
}
