import type {
  BaseIssue,
  BaseTransformation,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Stringify JSON config interface.
 *
 * @beta
 */
export interface StringifyJsonConfig {
  /** Optional trusted native replacer callback or property-name list. Native getters/toJSON hooks can run; no callback source is taken from candidate JSON. */
  replacer?:
    | ((this: any, key: string, value: any) => any)
    | (number | string)[];
  /** Native indentation width/string. This controls formatting, not an output byte limit or safe script embedding. */
  space?: string | number;
}

/**
 * Stringify JSON issue interface.
 *
 * @beta
 */
export interface StringifyJsonIssue<TInput> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'transformation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'stringify_json';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private mismatch diagnostic that may include submitted content.
   */
  readonly received: `"${string}"`;
}

/**
 * Stringify JSON action interface.
 *
 * @beta
 */
export interface StringifyJsonAction<
  TInput,
  TConfig extends StringifyJsonConfig | undefined,
  TMessage extends ErrorMessage<StringifyJsonIssue<TInput>> | undefined,
> extends BaseTransformation<TInput, string, StringifyJsonIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'stringify_json';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof stringifyJson;
  /**
   * The action config.
   */
  readonly config: TConfig;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Serialize with optional trusted replacer/toJSON hooks; undefined output or native Error failures add private issues, and result text is not a script/HTML encoder. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {StringifyJsonAction<TInput, undefined, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function stringifyJson<TInput>(): StringifyJsonAction<
  TInput,
  undefined,
  undefined
>;

/** Serialize with optional trusted replacer/toJSON hooks; undefined output or native Error failures add private issues, and result text is not a script/HTML encoder. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TConfig} config - Optional borrowed conversion/reviver/replacer policy; trusted native hooks can run and this action adds no independent input/output byte deadline.
 * @returns {StringifyJsonAction<TInput, TConfig, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function stringifyJson<
  TInput,
  const TConfig extends StringifyJsonConfig | undefined,
>(config: TConfig): StringifyJsonAction<TInput, TConfig, undefined>;

/** Serialize with optional trusted replacer/toJSON hooks; undefined output or native Error failures add private issues, and result text is not a script/HTML encoder. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TConfig} config - Optional borrowed conversion/reviver/replacer policy; trusted native hooks can run and this action adds no independent input/output byte deadline.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {StringifyJsonAction<TInput, TConfig, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function stringifyJson<
  TInput,
  const TConfig extends StringifyJsonConfig | undefined,
  const TMessage extends ErrorMessage<StringifyJsonIssue<TInput>> | undefined,
>(
  config: TConfig,
  message: TMessage
): StringifyJsonAction<TInput, TConfig, TMessage>;

/** Serialize with optional trusted replacer/toJSON hooks; undefined output or native Error failures add private issues, and result text is not a script/HTML encoder. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {StringifyJsonConfig} config - Optional borrowed conversion/reviver/replacer policy; trusted native hooks can run and this action adds no independent input/output byte deadline.
 * @param {ErrorMessage<StringifyJsonIssue<unknown>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {StringifyJsonAction<unknown, StringifyJsonConfig | undefined, ErrorMessage<StringifyJsonIssue<unknown>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function stringifyJson(
  config?: StringifyJsonConfig,
  message?: ErrorMessage<StringifyJsonIssue<unknown>>
): StringifyJsonAction<
  unknown,
  StringifyJsonConfig | undefined,
  ErrorMessage<StringifyJsonIssue<unknown>> | undefined
> {
  return {
    kind: 'transformation',
    type: 'stringify_json',
    reference: stringifyJson,
    message,
    config,
    async: false,
    /** Serialize with optional trusted replacer/toJSON hooks; undefined output or native Error failures add private issues, and result text is not a script/HTML encoder. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      try {
        /** Native JSON.stringify output captured once; undefined is recorded as an ordinary failure. */
        const output = JSON.stringify(
          dataset.value,
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          this.config?.replacer,
          this.config?.space
        );
        if (output === undefined) {
          _addIssue(this, 'JSON', dataset, config);
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          dataset.typed = false;
        }
        dataset.value = output;
      } catch (error) {
        if (error instanceof Error) {
          _addIssue(this, 'JSON', dataset, config, {
            received: `"${error.message}"`,
          });
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          dataset.typed = false;
        } else {
          throw error;
        }
      }
      return dataset as OutputDataset<string, StringifyJsonIssue<unknown>>;
    },
  };
}
