import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  DefaultAsync,
  InferInput,
  InferIssue,
  InferOutput,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';
import type { exactOptional } from './exactOptional.js';

/**
 * Exact optional schema async interface.
 */
export interface ExactOptionalSchemaAsync<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TDefault extends DefaultAsync<TWrapped, never>,
> extends BaseSchemaAsync<
  InferInput<TWrapped>,
  InferOutput<TWrapped>,
  InferIssue<TWrapped>
> {
  /**
   * Exact-optional presence discriminator; direct supplied values still delegate unchanged to the wrapped schema.
   */
  readonly type: 'exact_optional';
  /**
   * Authored constructor reference, never discovered or loaded from input data.
   */
  readonly reference: typeof exactOptional | typeof exactOptionalAsync;
  /**
   * Wrapped expectation unchanged; this wrapper does not automatically accept an explicit undefined.
   */
  readonly expects: TWrapped['expects'];
  /**
   * Borrowed schema validating every directly supplied value under shared root execution.
   */
  readonly wrapped: TWrapped;
  /**
   * Retained trusted default metadata for introspection; this wrapper does not itself apply it.
   */
  readonly default: TDefault;
}

/**
 * Mark exact optional presence metadata while delegating supplied values directly to the wrapped schema. Stored defaults are metadata here, not an implemented wrapper replacement branch.
 *
 * @param {TWrapped} wrapped - Borrowed declared schema; explicit undefined must satisfy that schema.
 *
 * @returns {ExactOptionalSchemaAsync<TWrapped, undefined>} Inert presence wrapper; object containers handle omission separately.
 */
export function exactOptionalAsync<
  const TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(wrapped: TWrapped): ExactOptionalSchemaAsync<TWrapped, undefined>;

/**
 * Mark exact optional presence metadata while delegating supplied values directly to the wrapped schema. Stored defaults are metadata here, not an implemented wrapper replacement branch.
 *
 * @param {TWrapped} wrapped - Borrowed declared schema; explicit undefined must satisfy that schema.
 * @param {TDefault} default_ - Trusted retained default metadata; this direct wrapper does not invoke it.
 *
 * @returns {ExactOptionalSchemaAsync<TWrapped, TDefault>} Inert wrapper retaining metadata without inventing default-application behavior.
 */
export function exactOptionalAsync<
  const TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  const TDefault extends DefaultAsync<TWrapped, never>,
>(
  wrapped: TWrapped,
  default_: TDefault
): ExactOptionalSchemaAsync<TWrapped, TDefault>;

/** Build exact-optional metadata without changing wrapped input acceptance.
 * @param {object} wrapped - Borrowed trusted schema; callbacks execute only during explicit parsing.
 * @param {unknown} default_ - Retained literal/factory metadata, not applied by this wrapper’s run method.
 * @returns {object} Inert presence wrapper delegating every supplied value under root budgets.
 */
// @__NO_SIDE_EFFECTS__
export function exactOptionalAsync(
  wrapped:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  default_?: unknown
): ExactOptionalSchemaAsync<
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  unknown
> {
  return {
    kind: 'schema',
    type: 'exact_optional',
    reference: exactOptionalAsync,
    expects: wrapped.expects,
    async: true,
    wrapped,
    default: default_,
    /** Adapt explicit validation to the shared bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Delegate unchanged input; this method has no sentinel/default replacement branch.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private input dataset.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root execution context.
     * @returns {unknown} Declared wrapped result or actual async settlement; operational errors propagate.
     */
    async '~run'(dataset, config) {
      return _runSchema(this.wrapped, dataset, config);
    },
  };
}
