import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  MaybeReadonly,
  OutputDataset,
} from '../types/index.js';
import {
  _addIssue,
  _getStandardProps,
  _joinExpects,
  _stringify,
} from '../utils/index.js';

/**
 * Picklist options type.
 */
export type PicklistOptions = MaybeReadonly<(string | number | bigint)[]>;

/**
 * Picklist issue interface.
 */
export interface PicklistIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema failure category; raw candidate values remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable discriminator for structured issue consumers.
   */
  readonly type: 'picklist';
  /**
   * Private diagnostic expectation; never sanitized output or a permission grant.
   */
  readonly expected: string;
}

/**
 * Picklist schema interface.
 */
export interface PicklistSchema<
  TOptions extends PicklistOptions,
  TMessage extends ErrorMessage<PicklistIssue> | undefined,
> extends BaseSchema<TOptions[number], TOptions[number], PicklistIssue> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'picklist';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof picklist;
  /**
   * Borrowed list whose runtime membership uses SameValueZero equality.
   */
  readonly options: TOptions;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Accept only native includes membership without coercion; SameValueZero comparison permits NaN and equates signed zero. Construction does not parse input or authorize its source.
 * @param {TOptions} options - Borrowed permitted primitive list; mutation changes membership but does not recompute the captured diagnostic expectation.
 * @returns {PicklistSchema<TOptions, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function picklist<const TOptions extends PicklistOptions>(
  options: TOptions
): PicklistSchema<TOptions, undefined>;

/** Accept only native includes membership without coercion; SameValueZero comparison permits NaN and equates signed zero. Construction does not parse input or authorize its source.
 * @param {TOptions} options - Borrowed permitted primitive list; mutation changes membership but does not recompute the captured diagnostic expectation.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {PicklistSchema<TOptions, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function picklist<
  const TOptions extends PicklistOptions,
  const TMessage extends ErrorMessage<PicklistIssue> | undefined,
>(options: TOptions, message: TMessage): PicklistSchema<TOptions, TMessage>;

/** Accept only native includes membership without coercion; SameValueZero comparison permits NaN and equates signed zero. Construction does not parse input or authorize its source.
 * @param {PicklistOptions} options - Borrowed permitted primitive list; mutation changes membership but does not recompute the captured diagnostic expectation.
 * @param {ErrorMessage<PicklistIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {PicklistSchema<PicklistOptions, ErrorMessage<PicklistIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function picklist(
  options: PicklistOptions,
  message?: ErrorMessage<PicklistIssue>
): PicklistSchema<PicklistOptions, ErrorMessage<PicklistIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'picklist',
    reference: picklist,
    expects: _joinExpects(options.map(_stringify), '|'),
    async: false,
    options,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Accept only native includes membership without coercion; SameValueZero comparison permits NaN and equates signed zero. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    '~run'(dataset, config) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      if (this.options.includes(dataset.value)) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<PicklistOptions[number], PicklistIssue>;
    },
  };
}
