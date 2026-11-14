import type {
  BaseIssue,
  BaseTransformation,
  ErrorMessage,
  MaybeReadonly,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _joinExpects, _stringify } from '../utils/index.js';

/** Default truthy scalar/string tokens; matching is distinct from Boolean truthiness and HTTP strict coercion. */
const TRUTHY = [true, 1, 'true', '1', 'yes', 'y', 'on', 'enabled'];
/** Default falsy scalar/string tokens; overlap resolution checks the truthy list first. */
const FALSY = [false, 0, 'false', '0', 'no', 'n', 'off', 'disabled'];

/**
 * Parse boolean config interface.
 *
 * @beta
 */
export interface ParseBooleanConfig {
  /** Explicit truthy token list; strings are lowercased without trimming, normalized custom lists are captured at construction and truthy wins overlaps. */
  truthy?: MaybeReadonly<unknown[]> | undefined;
  /** Explicit falsy token list; compare using native includes after only string lowercasing. */
  falsy?: MaybeReadonly<unknown[]> | undefined;
}

/**
 * Parse boolean issue interface.
 *
 * @beta
 */
export interface ParseBooleanIssue<TInput> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'transformation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'parse_boolean';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: string;
}

/**
 * Parse boolean action interface.
 *
 * @beta
 */
export interface ParseBooleanAction<
  TInput,
  TConfig extends ParseBooleanConfig | undefined,
  TMessage extends ErrorMessage<ParseBooleanIssue<TInput>> | undefined =
    undefined,
> extends BaseTransformation<TInput, boolean, ParseBooleanIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'parse_boolean';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof parseBoolean;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: string;
  /**
   * The parse boolean config.
   */
  readonly config: TConfig;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Lowercase strings without trimming and compare captured lists with native includes; truthy wins overlaps, while unmatched values produce private issues. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {ParseBooleanAction<TInput, undefined, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function parseBoolean<TInput>(): ParseBooleanAction<
  TInput,
  undefined,
  undefined
>;

/** Lowercase strings without trimming and compare captured lists with native includes; truthy wins overlaps, while unmatched values produce private issues. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TConfig} config - Optional borrowed conversion/reviver/replacer policy; trusted native hooks can run and this action adds no independent input/output byte deadline.
 * @returns {ParseBooleanAction<TInput, TConfig, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function parseBoolean<
  TInput,
  const TConfig extends ParseBooleanConfig | undefined,
>(config: TConfig): ParseBooleanAction<TInput, TConfig, undefined>;

/** Lowercase strings without trimming and compare captured lists with native includes; truthy wins overlaps, while unmatched values produce private issues. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TConfig} config - Optional borrowed conversion/reviver/replacer policy; trusted native hooks can run and this action adds no independent input/output byte deadline.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ParseBooleanAction<TInput, TConfig, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function parseBoolean<
  TInput,
  const TConfig extends ParseBooleanConfig | undefined,
  const TMessage extends ErrorMessage<ParseBooleanIssue<TInput>> | undefined,
>(
  config: TConfig,
  message: TMessage
): ParseBooleanAction<TInput, TConfig, TMessage>;

/** Lowercase strings without trimming and compare captured lists with native includes; truthy wins overlaps, while unmatched values produce private issues. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ParseBooleanConfig} config - Optional borrowed conversion/reviver/replacer policy; trusted native hooks can run and this action adds no independent input/output byte deadline.
 * @param {ErrorMessage<ParseBooleanIssue<unknown>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ParseBooleanAction<unknown, ParseBooleanConfig | undefined, ErrorMessage<ParseBooleanIssue<unknown>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function parseBoolean(
  config?: ParseBooleanConfig,
  message?: ErrorMessage<ParseBooleanIssue<unknown>>
): ParseBooleanAction<
  unknown,
  ParseBooleanConfig | undefined,
  ErrorMessage<ParseBooleanIssue<unknown>> | undefined
> {
  /** Normalize only string casing, preserving primitive/object identities otherwise.
   * @param {unknown} v - Private conversion candidate or configured token.
   * @returns {unknown} Lowercase string or unchanged non-string value; no trimming, parsing or source evaluation. */
  const normalize = (v: unknown) =>
    typeof v === 'string' ? v.toLowerCase() : v;
  /** Borrowed original truthy tokens retained only to construct the private expectation diagnostic. */
  const truthyRaw = config?.truthy ?? TRUTHY;
  /** Borrowed original falsy tokens retained only to construct the private expectation diagnostic. */
  const falsyRaw = config?.falsy ?? FALSY;
  /** Captured normalized truthy tokens; custom array entries are mapped once during construction. */
  const truthy = config?.truthy ? config.truthy.map(normalize) : TRUTHY;
  /** Captured normalized falsy tokens; custom array entries are mapped once during construction. */
  const falsy = config?.falsy ? config.falsy.map(normalize) : FALSY;
  return {
    kind: 'transformation',
    type: 'parse_boolean',
    reference: parseBoolean,
    expects: _joinExpects([...truthyRaw, ...falsyRaw].map(_stringify), '|'),
    config,
    message,
    async: false,
    /** Lowercase strings without trimming and compare captured lists with native includes; truthy wins overlaps, while unmatched values produce private issues. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      /** Normalized private candidate compared without trimming or numeric coercion. */
      const input = normalize(dataset.value);
      if (truthy.includes(input)) {
        dataset.value = true;
      } else if (falsy.includes(input)) {
        dataset.value = false;
      } else {
        _addIssue(this, 'boolean', dataset, config);
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = false;
      }
      return dataset as OutputDataset<boolean, ParseBooleanIssue<unknown>>;
    },
  };
}
