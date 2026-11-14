import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * URL issue interface.
 */
export interface UrlIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'url';
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
 * URL action interface.
 */
export interface UrlAction<
  TInput extends string,
  TMessage extends ErrorMessage<UrlIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, UrlIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'url';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof url;
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

/** Accept native absolute URL parsing, including schemes the host may later deny; this is not an SSRF, origin or redirect policy. This action neither establishes the input schema nor grants permissions.
 * @returns {UrlAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function url<TInput extends string>(): UrlAction<TInput, undefined>;

/** Accept native absolute URL parsing, including schemes the host may later deny; this is not an SSRF, origin or redirect policy. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {UrlAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function url<
  TInput extends string,
  const TMessage extends ErrorMessage<UrlIssue<TInput>> | undefined,
>(message: TMessage): UrlAction<TInput, TMessage>;

/** Accept native absolute URL parsing, including schemes the host may later deny; this is not an SSRF, origin or redirect policy. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<UrlIssue<string>> | undefined} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {UrlAction<string, ErrorMessage<UrlIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function url(
  message?: ErrorMessage<UrlIssue<string>> | undefined
): UrlAction<string, ErrorMessage<UrlIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'url',
    reference: url,
    async: false,
    expects: null,
    /** Probe native URL parsing only; no scheme, destination, DNS or permission check is performed.
     * @param {string} input - Candidate absolute URL text, never fetched or executed.
     * @returns {boolean} Whether the native constructor accepts this text; parsing errors are ordinary false results.
     */
    requirement(input) {
      try {
        new URL(input);
        return true;
      } catch {
        return false;
      }
    },
    message,
    /** Accept native absolute URL parsing, including schemes the host may later deny; this is not an SSRF, origin or redirect policy. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement(dataset.value)) {
        _addIssue(this, 'URL', dataset, config);
      }
      return dataset;
    },
  };
}
