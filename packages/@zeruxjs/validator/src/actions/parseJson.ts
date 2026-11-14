import type {
  BaseIssue,
  BaseTransformation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Parse JSON config interface.
 *
 * @beta
 */
export interface ParseJsonConfig {
  /** Optional trusted native JSON.parse reviver. Native key/value/this arguments and callback side effects remain host-owned; returned data is not automatically revalidated. */
  reviver?: (this: any, key: string, value: any) => any;
}

/**
 * Parse JSON issue interface.
 *
 * @beta
 */
export interface ParseJsonIssue<
  TInput extends string,
> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'transformation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'parse_json';
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
 * Parse JSON action interface.
 *
 * @beta
 */
export interface ParseJsonAction<
  TInput extends string,
  TConfig extends ParseJsonConfig | undefined,
  TMessage extends ErrorMessage<ParseJsonIssue<TInput>> | undefined,
> extends BaseTransformation<TInput, unknown, ParseJsonIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'parse_json';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof parseJson;
  /**
   * The action config.
   */
  readonly config: TConfig;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Parse JSON data with an optional trusted reviver; native Error failures become private issues, non-Error throws propagate and no source text is evaluated. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {ParseJsonAction<TInput, undefined, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function parseJson<TInput extends string>(): ParseJsonAction<
  TInput,
  undefined,
  undefined
>;

/** Parse JSON data with an optional trusted reviver; native Error failures become private issues, non-Error throws propagate and no source text is evaluated. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TConfig} config - Optional borrowed conversion/reviver/replacer policy; trusted native hooks can run and this action adds no independent input/output byte deadline.
 * @returns {ParseJsonAction<TInput, TConfig, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function parseJson<
  TInput extends string,
  const TConfig extends ParseJsonConfig | undefined,
>(config: TConfig): ParseJsonAction<TInput, TConfig, undefined>;

/** Parse JSON data with an optional trusted reviver; native Error failures become private issues, non-Error throws propagate and no source text is evaluated. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TConfig} config - Optional borrowed conversion/reviver/replacer policy; trusted native hooks can run and this action adds no independent input/output byte deadline.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ParseJsonAction<TInput, TConfig, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function parseJson<
  TInput extends string,
  const TConfig extends ParseJsonConfig | undefined,
  const TMessage extends ErrorMessage<ParseJsonIssue<TInput>> | undefined,
>(
  config: TConfig,
  message: TMessage
): ParseJsonAction<TInput, TConfig, TMessage>;

/** Parse JSON data with an optional trusted reviver; native Error failures become private issues, non-Error throws propagate and no source text is evaluated. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ParseJsonConfig} config - Optional borrowed conversion/reviver/replacer policy; trusted native hooks can run and this action adds no independent input/output byte deadline.
 * @param {ErrorMessage<ParseJsonIssue<string>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ParseJsonAction<string, ParseJsonConfig | undefined, ErrorMessage<ParseJsonIssue<string>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function parseJson(
  config?: ParseJsonConfig,
  message?: ErrorMessage<ParseJsonIssue<string>>
): ParseJsonAction<
  string,
  ParseJsonConfig | undefined,
  ErrorMessage<ParseJsonIssue<string>> | undefined
> {
  return {
    kind: 'transformation',
    type: 'parse_json',
    reference: parseJson,
    config,
    message,
    async: false,
    /** Parse JSON data with an optional trusted reviver; native Error failures become private issues, non-Error throws propagate and no source text is evaluated. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      try {
        dataset.value = JSON.parse(dataset.value, this.config?.reviver);
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
      return dataset;
    },
  };
}
