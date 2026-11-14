import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  InferIssue,
  OutputDataset,
  SetPathItem,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { set } from './set.js';
import type { InferSetInput, InferSetOutput, SetIssue } from './types/set.js';

/**
 * Set schema async interface.
 */
export interface SetSchemaAsync<
  TValue extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<SetIssue> | undefined,
> extends BaseSchemaAsync<
  InferSetInput<TValue>,
  InferSetOutput<TValue>,
  SetIssue | InferIssue<TValue>
> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'set';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof set | typeof setAsync;
  /**
   * Private native-type diagnostic, not a permission or coercion policy.
   */
  readonly expects: 'Set';
  /**
   * Borrowed explicit Set value schema; transformed duplicates use native equality.
   */
  readonly value: TValue;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Start native Set value validation concurrently, then collect results in insertion order into a fresh Set. Construction does not parse input or authorize its source.
 * @param {TValue} value - Borrowed explicit value schema; accepted nested objects may retain caller-owned identity.
 * @returns {SetSchemaAsync<TValue, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function setAsync<
  const TValue extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(value: TValue): SetSchemaAsync<TValue, undefined>;

/** Start native Set value validation concurrently, then collect results in insertion order into a fresh Set. Construction does not parse input or authorize its source.
 * @param {TValue} value - Borrowed explicit value schema; accepted nested objects may retain caller-owned identity.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {SetSchemaAsync<TValue, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function setAsync<
  const TValue extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<SetIssue> | undefined,
>(value: TValue, message: TMessage): SetSchemaAsync<TValue, TMessage>;

/** Start native Set value validation concurrently, then collect results in insertion order into a fresh Set. Construction does not parse input or authorize its source.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>} value - Borrowed explicit value schema; accepted nested objects may retain caller-owned identity.
 * @param {ErrorMessage<SetIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {SetSchemaAsync<BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>, ErrorMessage<SetIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function setAsync(
  value:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<SetIssue>
): SetSchemaAsync<
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<SetIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'set',
    reference: setAsync,
    expects: 'Set',
    async: true,
    value,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Start native Set value validation concurrently, then collect results in insertion order into a fresh Set. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {Promise<OutputDataset<unknown, BaseIssue<unknown>>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    async '~run'(dataset, config) {
      // Get input value from dataset
      /** Borrowed candidate retained for child reads and private issue paths. */
      const input = dataset.value;

      // If root type is valid, check nested types
      if (input instanceof Set) {
        // Set typed to `true` and value to empty set
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = new Set();

        // Parse schema of each set value
        /** Set child results started concurrently but retained in source insertion order. */
        const valueDatasets = await Promise.all(
          [...input].map(
            async (inputValue) =>
              [
                inputValue,
                await _runSchema(this.value, { value: inputValue }, config),
              ] as const
          )
        );

        // Process dataset of each set value
        for (const [inputValue, valueDataset] of valueDatasets) {
          // If there are issues, capture them
          if (valueDataset.issues) {
            // Create set path item
            /** Private parent path segment retaining original input/value; sanitize before client exposure. */
            const pathItem: SetPathItem = {
              type: 'set',
              origin: 'value',
              input,
              key: null,
              value: inputValue,
            };

            // Add modified item dataset issues to issues
            for (const issue of valueDataset.issues) {
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
              dataset.issues = valueDataset.issues;
            }

            // If necessary, abort early
            if (config.abortEarly) {
              dataset.typed = false;
              break;
            }
          }

          // If not typed, set typed to `false`
          if (!valueDataset.typed) {
            dataset.typed = false;
          }

          // Add value to dataset
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          dataset.value.add(valueDataset.value);
        }

        // Otherwise, add set issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        Set<unknown>,
        SetIssue | BaseIssue<unknown>
      >;
    },
  };
}
