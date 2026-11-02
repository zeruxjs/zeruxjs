import type { BaseIssue, Config } from '../types/index.js';

/**
 * The global config type.
 */
export type GlobalConfig = Pick<Config<never>, 'lang' | 'abortEarly' | 'abortPipeEarly'>;

// Create global configuration store
let store: GlobalConfig | undefined;

/**
 * Sets the global configuration.
 *
 * @param config The configuration.
 */
export function setGlobalConfig(config: GlobalConfig): void {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('global config must be an object');
  if (config.lang !== undefined && typeof config.lang !== 'string') throw new TypeError('lang must be a string');
  for (const key of ['abortEarly', 'abortPipeEarly'] as const) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  }
  // Pick only legacy process-wide flags. Never retain signals or event handlers.
  store = {
    lang: Object.hasOwn(config, 'lang') ? config.lang : store?.lang,
    abortEarly: Object.hasOwn(config, 'abortEarly') ? config.abortEarly : store?.abortEarly,
    abortPipeEarly: Object.hasOwn(config, 'abortPipeEarly') ? config.abortPipeEarly : store?.abortPipeEarly,
  };
}

/**
 * Returns the global configuration.
 *
 * @param config The config to merge.
 *
 * @returns The configuration.
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
 * Deletes the global configuration.
 */
export function deleteGlobalConfig(): void {
  store = undefined;
}
