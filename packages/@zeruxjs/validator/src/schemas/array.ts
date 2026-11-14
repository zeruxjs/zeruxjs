import { _runSchema } from '../utils/_run.js';
import type {
  ArrayPathItem,
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferOutput,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { ArrayIssue } from './types/array.js';

/**
 * Array schema interface.
 */
export interface ArraySchema<
  TItem extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<ArrayIssue> | undefined,
> extends BaseSchema<
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
  readonly reference: typeof array;
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

/** Parse each array position in source order; missing sparse positions are delegated to the child as undefined. Construction does not parse input or authorize its source.
 * @param {TItem} item - Borrowed explicit child schema; parsing shares root work/issue budgets.
 * @returns {ArraySchema<TItem, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function array<
  const TItem extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(item: TItem): ArraySchema<TItem, undefined>;

/** Parse each array position in source order; missing sparse positions are delegated to the child as undefined. Construction does not parse input or authorize its source.
 * @param {TItem} item - Borrowed explicit child schema; parsing shares root work/issue budgets.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {ArraySchema<TItem, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function array<
  const TItem extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<ArrayIssue> | undefined,
>(item: TItem, message: TMessage): ArraySchema<TItem, TMessage>;

/** Parse each array position in source order; missing sparse positions are delegated to the child as undefined. Construction does not parse input or authorize its source.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>>} item - Borrowed explicit child schema; parsing shares root work/issue budgets.
 * @param {ErrorMessage<ArrayIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {ArraySchema<BaseSchema<unknown, unknown, BaseIssue<unknown>>, ErrorMessage<ArrayIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function array(
  item: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<ArrayIssue>
): ArraySchema<
  BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<ArrayIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'array',
    reference: array,
    expects: 'Array',
    async: false,
    item,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Parse each array position in source order; missing sparse positions are delegated to the child as undefined. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {OutputDataset<unknown, BaseIssue<unknown>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    '~run'(dataset, config) {
      // Get input value from dataset
      /** Borrowed candidate retained for child reads and private issue paths. */
      const input = dataset.value;

      // If root type is valid, check nested types
      if (Array.isArray(input)) {
        // Set typed to `true` and value to empty array
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = [];

        // Parse schema of each array item
        for (let key = 0; key < input.length; key++) {
          /** Current array position, including undefined for a sparse hole; child schema validation remains authoritative. */
          const value = input[key];
          /** Current positional child result; its own schema determines typing, output identity and private issues. */
          const itemDataset = _runSchema(this.item, { value }, config);

          // If there are issues, capture them
          if (itemDataset.issues) {
            // Create array path item
            /** Private parent path segment retaining original input/value; sanitize before client exposure. */
            const pathItem: ArrayPathItem = {
              type: 'array',
              origin: 'value',
              input,
              key,
              value,
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
