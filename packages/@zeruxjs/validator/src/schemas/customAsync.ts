import type { ValidationContext } from '../types/runtime.js';
import type {
  BaseSchemaAsync,
  ErrorMessage,
  MaybePromise,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { custom } from './custom.js';
import type { CustomIssue } from './types/custom.js';

/**
 * Trusted cooperative custom predicate; the root owns scheduling but cannot force-stop arbitrary JavaScript.
 * @param {unknown} input - Private candidate admitted by the root input budgets.
 * @param {ValidationContext} context - Root signal for cooperative cancellation; callback owns its external work.
 * @returns {MaybePromise<boolean>} Host type assertion result; operational rejection propagates unchanged.
 */
type CheckAsync = (
  input: unknown,
  context: ValidationContext
) => MaybePromise<boolean>;

/**
 * Custom schema async interface.
 */
export interface CustomSchemaAsync<
  TInput,
  TMessage extends ErrorMessage<CustomIssue> | undefined,
> extends BaseSchemaAsync<TInput, TInput, CustomIssue> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'custom';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof custom | typeof customAsync;
  /**
   * Private diagnostic expectation; never sanitized output or a permission grant.
   */
  readonly expects: 'unknown';
  /**
   * Borrowed trusted predicate; returning true asserts the host-selected TInput without a runtime proof of that generic type.
   */
  readonly check: CheckAsync;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Await an explicitly registered trusted predicate with the root cooperative signal; no source text is evaluated. Construction does not parse input or authorize its source.
 * @param {CheckAsync} check - Borrowed trusted predicate function; it is neither parsed source nor an authorization policy.
 * @returns {CustomSchemaAsync<TInput, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function customAsync<TInput>(
  check: CheckAsync
): CustomSchemaAsync<TInput, undefined>;

/** Await an explicitly registered trusted predicate with the root cooperative signal; no source text is evaluated. Construction does not parse input or authorize its source.
 * @param {CheckAsync} check - Borrowed trusted predicate function; it is neither parsed source nor an authorization policy.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {CustomSchemaAsync<TInput, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function customAsync<
  TInput,
  const TMessage extends ErrorMessage<CustomIssue> | undefined =
    | ErrorMessage<CustomIssue>
    | undefined,
>(check: CheckAsync, message: TMessage): CustomSchemaAsync<TInput, TMessage>;

/** Await an explicitly registered trusted predicate with the root cooperative signal; no source text is evaluated. Construction does not parse input or authorize its source.
 * @param {CheckAsync} check - Borrowed trusted predicate function; it is neither parsed source nor an authorization policy.
 * @param {ErrorMessage<CustomIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {CustomSchemaAsync<TInput, ErrorMessage<CustomIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function customAsync<TInput>(
  check: CheckAsync,
  message?: ErrorMessage<CustomIssue>
): CustomSchemaAsync<TInput, ErrorMessage<CustomIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'custom',
    reference: customAsync,
    expects: 'unknown',
    async: true,
    check,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Await an explicitly registered trusted predicate with the root cooperative signal; no source text is evaluated. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {Promise<import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    async '~run'(dataset, config) {
      if (await this.check(dataset.value, { signal: config.signal })) {
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
