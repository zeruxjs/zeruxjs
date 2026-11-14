import { _runSchema } from '../utils/_run.js';
import type {
  ArrayPathItem,
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferOutput,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { array } from './array.js';
import type { ArrayIssue } from './types/array.js';

/**
 * Array schema interface.
 */
export interface ArraySchemaAsync<
  TItem extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<ArrayIssue> | undefined,
> extends BaseSchemaAsync<
  InferInput<TItem>[],
  InferOutput<TItem>[],
  ArrayIssue | InferIssue<TItem>
> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'array';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof array | typeof arrayAsync;
  /**
   * Private diagnostic expectation, not a coercion, escaping or authorization policy.
   */
  readonly expects: 'Array';
  /**
   * Borrowed child schema; root execution owns its work limits.
   */
  readonly item: TItem;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Parse dense array items concurrently under the shared root limiter, then accumulate results in input order. Construction does not parse input or authorize its source.
 * @param {TItem} item - Borrowed explicit child schema; parsing shares root work/issue budgets.
 * @returns {ArraySchemaAsync<TItem, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function arrayAsync<
  const TItem extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(item: TItem): ArraySchemaAsync<TItem, undefined>;

/** Parse dense array items concurrently under the shared root limiter, then accumulate results in input order. Construction does not parse input or authorize its source.
 * @param {TItem} item - Borrowed explicit child schema; parsing shares root work/issue budgets.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {ArraySchemaAsync<TItem, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function arrayAsync<
  const TItem extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<ArrayIssue> | undefined,
>(item: TItem, message: TMessage): ArraySchemaAsync<TItem, TMessage>;

/** Parse dense array items concurrently under the shared root limiter, then accumulate results in input order. Construction does not parse input or authorize its source.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>} item - Borrowed explicit child schema; parsing shares root work/issue budgets.
 * @param {ErrorMessage<ArrayIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {ArraySchemaAsync<BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>, ErrorMessage<ArrayIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function arrayAsync(
  item:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<ArrayIssue>
): ArraySchemaAsync<
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<ArrayIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'array',
    reference: arrayAsync,
    expects: 'Array',
    async: true,
    item,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Parse dense array items concurrently under the shared root limiter, then accumulate results in input order. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {Promise<OutputDataset<unknown, BaseIssue<unknown>>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    async '~run'(dataset, config) {
      // Get input value from dataset
      /** Borrowed candidate retained for child reads and private issue paths. */
      const input = dataset.value;

      // If root type is valid, check nested types
      if (Array.isArray(input)) {
        // Set typed to `true` and value to empty array
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = [];

        // Parse schema of each item async
        /** Child results for mapped positions; Promise.all rejection does not itself cancel already-started trusted callbacks. */
        const itemDatasets = await Promise.all(
          input.map((value) => _runSchema(this.item, { value }, config))
        );

        // Process each item dataset
        for (let key = 0; key < itemDatasets.length; key++) {
          // Get item dataset
          // Dense inputs yield one dataset per position; the legacy sparse-array path can still fail on an undefined dataset.
          /** Dense-array positional result; legacy sparse inputs can fail here rather than produce a validation issue. */
          const itemDataset = itemDatasets[key]!;

          // If there are issues, capture them
          if (itemDataset.issues) {
            // Create array path item
            /** Private parent path segment retaining original input/value; sanitize before client exposure. */
            const pathItem: ArrayPathItem = {
              type: 'array',
              origin: 'value',
              input,
              key,
              value: input[key],
            };

            // Add modified item dataset issues to issues
            for (const issue of itemDataset.issues) {
              if (issue.path) {
                issue.path.unshift(pathItem);
              } else {
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                issue.path = [pathItem];
              }
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              dataset.issues?.push(issue);
            }
            if (!dataset.issues) {
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              dataset.issues = itemDataset.issues;
            }

            // If necessary, abort early
            if (config.abortEarly) {
              dataset.typed = false;
              break;
            }
          }

          // If not typed, set typed to `false`
          if (!itemDataset.typed) {
            dataset.typed = false;
          }

          // Add item to dataset
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          dataset.value.push(itemDataset.value);
        }

        // Otherwise, add array issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        unknown[],
        ArrayIssue | BaseIssue<unknown>
      >;
    },
  };
}
