import { syncCallback } from '../utils/_run.js';
import type {
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { CustomIssue } from './types/custom.js';

/**
 * Trusted synchronous custom predicate; native async callbacks and thenable results reject through syncCallback.
 * @param {unknown} input - Private candidate admitted by the root input budgets.
 * @returns {boolean} Whether the host asserts this candidate has its declared generic input type.
 */
type Check = (input: unknown) => boolean;

/**
 * Custom schema interface.
 */
export interface CustomSchema<
  TInput,
  TMessage extends ErrorMessage<CustomIssue> | undefined,
> extends BaseSchema<TInput, TInput, CustomIssue> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'custom';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof custom;
  /**
   * Private diagnostic expectation; never sanitized output or a permission grant.
   */
  readonly expects: 'unknown';
  /**
   * Borrowed trusted predicate; returning true asserts the host-selected TInput without a runtime proof of that generic type.
   */
  readonly check: Check;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Validate with an explicitly registered trusted synchronous predicate; a true result asserts the host-declared input type. Construction does not parse input or authorize its source.
 * @param {Check} check - Borrowed trusted predicate function; it is neither parsed source nor an authorization policy.
 * @returns {CustomSchema<TInput, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function custom<TInput>(check: Check): CustomSchema<TInput, undefined>;

/** Validate with an explicitly registered trusted synchronous predicate; a true result asserts the host-declared input type. Construction does not parse input or authorize its source.
 * @param {Check} check - Borrowed trusted predicate function; it is neither parsed source nor an authorization policy.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {CustomSchema<TInput, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function custom<
  TInput,
  const TMessage extends ErrorMessage<CustomIssue> | undefined =
    | ErrorMessage<CustomIssue>
    | undefined,
>(check: Check, message: TMessage): CustomSchema<TInput, TMessage>;

/** Validate with an explicitly registered trusted synchronous predicate; a true result asserts the host-declared input type. Construction does not parse input or authorize its source.
 * @param {Check} check - Borrowed trusted predicate function; it is neither parsed source nor an authorization policy.
 * @param {ErrorMessage<CustomIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {CustomSchema<TInput, ErrorMessage<CustomIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function custom<TInput>(
  check: Check,
  message?: ErrorMessage<CustomIssue>
): CustomSchema<TInput, ErrorMessage<CustomIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'custom',
    reference: custom,
    expects: 'unknown',
    async: false,
    check,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Validate with an explicitly registered trusted synchronous predicate; a true result asserts the host-declared input type. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    '~run'(dataset, config) {
      if (syncCallback(this.check, dataset.value)) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<TInput, CustomIssue>;
    },
  };
}
