import type {
  BaseIssue,
  BaseTransformation,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * To bigint issue interface.
 */
export interface ToBigintIssue<TInput> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'transformation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'to_bigint';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: null;
}

/**
 * To bigint action interface.
 */
export interface ToBigintAction<
  TInput,
  TMessage extends ErrorMessage<ToBigintIssue<TInput>> | undefined,
> extends BaseTransformation<TInput, bigint, ToBigintIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'to_bigint';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof toBigint;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Use native BigInt conversion, reporting conversion failures as private issues; already-lost Number precision cannot be recovered. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {ToBigintAction<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function toBigint<TInput>(): ToBigintAction<TInput, undefined>;

/** Use native BigInt conversion, reporting conversion failures as private issues; already-lost Number precision cannot be recovered. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ToBigintAction<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function toBigint<
  TInput,
  const TMessage extends ErrorMessage<ToBigintIssue<TInput>> | undefined,
>(message: TMessage): ToBigintAction<TInput, TMessage>;

/** Use native BigInt conversion, reporting conversion failures as private issues; already-lost Number precision cannot be recovered. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ErrorMessage<ToBigintIssue<unknown>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ToBigintAction<unknown, ErrorMessage<ToBigintIssue<unknown>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function toBigint(
  message?: ErrorMessage<ToBigintIssue<unknown>>
): ToBigintAction<unknown, ErrorMessage<ToBigintIssue<unknown>> | undefined> {
  return {
    kind: 'transformation',
    type: 'to_bigint',
    reference: toBigint,
    async: false,
    message,
    /** Use native BigInt conversion, reporting conversion failures as private issues; already-lost Number precision cannot be recovered. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      try {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.value = BigInt(dataset.value);
      } catch {
        _addIssue(this, 'bigint', dataset, config);
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = false;
      }
      return dataset as OutputDataset<bigint, ToBigintIssue<unknown>>;
    },
  };
}
