import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Hash lengths object.
 */
const HASH_LENGTHS = {
  md4: 32,
  md5: 32,
  sha1: 40,
  sha256: 64,
  sha384: 96,
  sha512: 128,
  ripemd128: 32,
  ripemd160: 40,
  tiger128: 32,
  tiger160: 40,
  tiger192: 48,
  crc32: 8,
  crc32b: 8,
  adler32: 8,
} as const;

/**
 * Hash type type.
 */
export type HashType = keyof typeof HASH_LENGTHS;

/**
 * Hash issue interface.
 */
export interface HashIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'hash';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The hash regex.
   */
  readonly requirement: RegExp;
}

/**
 * Hash action interface.
 */
export interface HashAction<
  TInput extends string,
  TMessage extends ErrorMessage<HashIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, HashIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'hash';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof hash;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The hash regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check hexadecimal text length against explicitly selected legacy algorithm labels; no digest is computed and no integrity, authorship or algorithm security is proven. This action neither establishes the input schema nor grants permissions.
 * @param {[ HashType, ...HashType[] ]} types - Trusted nonempty algorithm-label selection from HashType; this type list is not a cryptographic algorithm recommendation.
 * @returns {HashAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function hash<TInput extends string>(
  types: [HashType, ...HashType[]]
): HashAction<TInput, undefined>;

/** Check hexadecimal text length against explicitly selected legacy algorithm labels; no digest is computed and no integrity, authorship or algorithm security is proven. This action neither establishes the input schema nor grants permissions.
 * @param {[ HashType, ...HashType[] ]} types - Trusted nonempty algorithm-label selection from HashType; this type list is not a cryptographic algorithm recommendation.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {HashAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function hash<
  TInput extends string,
  const TMessage extends ErrorMessage<HashIssue<TInput>> | undefined,
>(
  types: [HashType, ...HashType[]],
  message: TMessage
): HashAction<TInput, TMessage>;

/** Check hexadecimal text length against explicitly selected legacy algorithm labels; no digest is computed and no integrity, authorship or algorithm security is proven. This action neither establishes the input schema nor grants permissions.
 * @param {[ HashType, ...HashType[] ]} types - Trusted nonempty algorithm-label selection from HashType; this type list is not a cryptographic algorithm recommendation.
 * @param {ErrorMessage<HashIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {HashAction<string, ErrorMessage<HashIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function hash(
  types: [HashType, ...HashType[]],
  message?: ErrorMessage<HashIssue<string>>
): HashAction<string, ErrorMessage<HashIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'hash',
    reference: hash,
    expects: null,
    async: false,
    requirement: RegExp(
      types.map((type) => `^[a-fA-F0-9]{${HASH_LENGTHS[type]}}$`).join('|'),
      'u'
    ),
    message,
    /** Check hexadecimal text length against explicitly selected legacy algorithm labels; no digest is computed and no integrity, authorship or algorithm security is proven. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'hash', dataset, config);
      }
      return dataset;
    },
  };
}
