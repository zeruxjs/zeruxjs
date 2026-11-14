import type { BaseIssue, Config } from '../types/index.js';

/**
 * The global config type.
 */
export type GlobalConfig = Pick<
  Config<never>,
  'lang' | 'abortEarly' | 'abortPipeEarly'
>;

// Create global configuration store
let store: GlobalConfig | undefined;

/**
 * Set legacy process-wide language/abort flags only. Never place tenant-specific handlers, signals or identity in this shared compatibility store.
 *
 * @param {GlobalConfig} config - Explicit validated legacy flags; only declared own fields are retained.
 * @returns {void} Updates the compatibility store without retaining per-parse hooks or cancellation.
 */
export function setGlobalConfig(config: GlobalConfig): void {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('global config must be an object');
  }
  if (config.lang !== undefined && typeof config.lang !== 'string') {
    throw new TypeError('lang must be a string');
  }
  // Validate every accepted legacy Boolean before changing the shared store.
  for (const key of ['abortEarly', 'abortPipeEarly'] as const) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new TypeError(`${key} must be boolean`);
    }
  }
  // Pick only legacy process-wide flags. Never retain signals or event handlers.
  store = {
    lang: Object.hasOwn(config, 'lang') ? config.lang : store?.lang,
    abortEarly: Object.hasOwn(config, 'abortEarly')
      ? config.abortEarly
      : store?.abortEarly,
    abortPipeEarly: Object.hasOwn(config, 'abortPipeEarly')
      ? config.abortPipeEarly
      : store?.abortPipeEarly,
  };
}

/**
 * Merge legacy process-wide flags with one parse configuration; per-call messages, hooks, limits and signal remain caller-owned.
 *
 * @param {Config<TIssue>} config - Optional per-call configuration whose explicit legacy flags override global defaults.
 *
 * @returns {Config<TIssue>} Fresh merged parse configuration without storing request-specific controls globally.
 */
// @__NO_SIDE_EFFECTS__
export function getGlobalConfig<const TIssue extends BaseIssue<unknown>>(
  config?: Config<TIssue>
): Config<TIssue> {
  // Hint: The configuration is deliberately not constructed with the spread
  // operator for performance reasons
  return {
    ...config,
    lang: config?.lang ?? store?.lang,
    message: config?.message,
    abortEarly: config?.abortEarly ?? store?.abortEarly,
    abortPipeEarly: config?.abortPipeEarly ?? store?.abortPipeEarly,
  };
}

/**
 * Clear only the legacy process-wide compatibility flags.
 * @returns {void} Removes shared defaults; active parse state and caller-owned schemas are unaffected.
 */
export function deleteGlobalConfig(): void {
  store = undefined;
}
