import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import { _isIsbn10 } from './_isIsbn10.js';
import { _isIsbn13 } from './_isIsbn13.js';

/**
 * ISBN issue interface.
 */
export interface IsbnIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'isbn';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * Native numeric predicate identity; not an executable function string.
   */
  readonly requirement: (input: string) => boolean;
}

/**
 * ISBN action interface.
 */
export interface IsbnAction<
  TInput extends string,
  TMessage extends ErrorMessage<IsbnIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, IsbnIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'isbn';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof isbn;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * Native numeric predicate identity; not an executable function string.
   */
  readonly requirement: (input: string) => boolean;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/**
 * ISBN separator regex.
 */
const ISBN_SEPARATOR_REGEX = /[- ]/gu;

/**
 * ISBN-10 detection regex.
 */
const ISBN_10_DETECTION_REGEX = /^\d{9}[\dX]$/u;

/**
 * ISBN-13 detection regex.
 */
const ISBN_13_DETECTION_REGEX = /^\d{13}$/u;

/** Strip supported spaces/hyphens and check ISBN-10/13 digit shape/checksum; book registration or ownership is not established. This action neither establishes the input schema nor grants permissions.
 * @returns {IsbnAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function isbn<TInput extends string>(): IsbnAction<TInput, undefined>;

/** Strip supported spaces/hyphens and check ISBN-10/13 digit shape/checksum; book registration or ownership is not established. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsbnAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function isbn<
  TInput extends string,
  const TMessage extends ErrorMessage<IsbnIssue<TInput>> | undefined,
>(message: TMessage): IsbnAction<TInput, TMessage>;

/** Strip supported spaces/hyphens and check ISBN-10/13 digit shape/checksum; book registration or ownership is not established. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<IsbnIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsbnAction<string, ErrorMessage<IsbnIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function isbn(
  message?: ErrorMessage<IsbnIssue<string>>
): IsbnAction<string, ErrorMessage<IsbnIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'isbn',
    reference: isbn,
    async: false,
    expects: null,
    /** Apply retained presentation/checksum rules to local text without any provider or registry request.
     * @param {string} input - Private candidate string; text is never treated as executable source.
     * @returns {boolean} Whether the retained syntax/checksum predicate accepts it; no issuance, ownership or permission follows.
     */
    requirement(input) {
      /** Local separator-free ISBN text; original input and public parse output are unchanged. */
      const replacedInput = input.replace(ISBN_SEPARATOR_REGEX, '');
      if (ISBN_10_DETECTION_REGEX.test(replacedInput)) {
        return _isIsbn10(replacedInput);
      } else if (ISBN_13_DETECTION_REGEX.test(replacedInput)) {
        return _isIsbn13(replacedInput);
      }
      return false;
    },
    message,
    /** Strip supported spaces/hyphens and check ISBN-10/13 digit shape/checksum; book registration or ownership is not established. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement(dataset.value)) {
        _addIssue(this, 'ISBN', dataset, config);
      }
      return dataset;
    },
  };
}
