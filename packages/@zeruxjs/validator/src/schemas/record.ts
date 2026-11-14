import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  InferIssue,
  ObjectPathItem,
  OutputDataset,
} from '../types/index.js';
import {
  _addIssue,
  _getStandardProps,
  _isValidObjectKey,
} from '../utils/index.js';
import type {
  InferRecordInput,
  InferRecordOutput,
  RecordIssue,
} from './types/record.js';

/**
 * Record schema interface.
 */
export interface RecordSchema<
  TKey extends BaseSchema<string, string | number | symbol, BaseIssue<unknown>>,
  TValue extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<RecordIssue> | undefined,
> extends BaseSchema<
  InferRecordInput<TKey, TValue>,
  InferRecordOutput<TKey, TValue>,
  RecordIssue | InferIssue<TKey> | InferIssue<TValue>
> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'record';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof record;
  /**
   * Private native-type diagnostic, not a permission or coercion policy.
   */
  readonly expects: 'Object';
  /**
   * Borrowed explicit key schema; transformed names are not automatically reauthorized.
   */
  readonly key: TKey;
  /**
   * Borrowed explicit value schema; this does not deep-clone or sanitize accepted objects.
   */
  readonly value: TValue;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Validate safe own enumerable string keys before their values into a fresh record; transformed-key collisions use ordinary property assignment. Construction does not parse input or authorize its source.
 * @param {TKey} key - Borrowed explicit string-key schema; trusted transforms must preserve the host key policy.
 * @param {TValue} value - Borrowed explicit value schema; accepted nested objects may retain caller-owned identity.
 * @returns {RecordSchema<TKey, TValue, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function record<
  const TKey extends BaseSchema<
    string,
    string | number | symbol,
    BaseIssue<unknown>
  >,
  const TValue extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(key: TKey, value: TValue): RecordSchema<TKey, TValue, undefined>;

/** Validate safe own enumerable string keys before their values into a fresh record; transformed-key collisions use ordinary property assignment. Construction does not parse input or authorize its source.
 * @param {TKey} key - Borrowed explicit string-key schema; trusted transforms must preserve the host key policy.
 * @param {TValue} value - Borrowed explicit value schema; accepted nested objects may retain caller-owned identity.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {RecordSchema<TKey, TValue, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function record<
  const TKey extends BaseSchema<
    string,
    string | number | symbol,
    BaseIssue<unknown>
  >,
  const TValue extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<RecordIssue> | undefined,
>(
  key: TKey,
  value: TValue,
  message: TMessage
): RecordSchema<TKey, TValue, TMessage>;

/** Validate safe own enumerable string keys before their values into a fresh record; transformed-key collisions use ordinary property assignment. Construction does not parse input or authorize its source.
 * @param {BaseSchema<string, string | number | symbol, BaseIssue<unknown>>} key - Borrowed explicit string-key schema; trusted transforms must preserve the host key policy.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>>} value - Borrowed explicit value schema; accepted nested objects may retain caller-owned identity.
 * @param {ErrorMessage<RecordIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {RecordSchema<BaseSchema<string, string | number | symbol, BaseIssue<unknown>>, BaseSchema<unknown, unknown, BaseIssue<unknown>>, ErrorMessage<RecordIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function record(
  key: BaseSchema<string, string | number | symbol, BaseIssue<unknown>>,
  value: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<RecordIssue>
): RecordSchema<
  BaseSchema<string, string | number | symbol, BaseIssue<unknown>>,
  BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<RecordIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'record',
    reference: record,
    expects: 'Object',
    async: false,
    key,
    value,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Validate safe own enumerable string keys before their values into a fresh record; transformed-key collisions use ordinary property assignment. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {OutputDataset<unknown, BaseIssue<unknown>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    '~run'(dataset, config) {
      // Get input value from dataset
      /** Borrowed candidate retained for child reads and private issue paths. */
      const input = dataset.value;

      // If root type is valid, check nested types
      if (input && typeof input === 'object') {
        // Set typed to `true` and value to empty object
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = {};

        // Parse schema of each record entry
        // Hint: for...in loop always returns keys as strings
        // Hint: We exclude specific keys for security reasons
        for (const entryKey in input) {
          if (_isValidObjectKey(input, entryKey)) {
            // Get value of record entry
            /** Current own enumerable field value; raw values remain private and are delegated to the explicit child schema. */
            const entryValue: unknown = input[entryKey as keyof typeof input];

            // Get dataset of key schema
            /** Current Map key result; transformed keys, not source keys, determine output identity. */
            const keyDataset = _runSchema(
              this.key,
              { value: entryKey },
              config
            );

            // If there are issues, capture them
            if (keyDataset.issues) {
              // Create record path item
              /** Private parent path segment retaining original input/value; sanitize before client exposure. */
              const pathItem: ObjectPathItem = {
                type: 'object',
                origin: 'key',
                input: input as Record<string, unknown>,
                key: entryKey,
                value: entryValue,
              };

              // Add modified item dataset issues to issues
              for (const issue of keyDataset.issues) {
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                issue.path = [pathItem];
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) {
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                dataset.issues = keyDataset.issues;
              }

              // If necessary, abort early
              if (config.abortEarly) {
                dataset.typed = false;
                break;
              }
            }

            // Get dataset of value schema
            /** Current child value result sharing the root execution policy; raw issues remain private. */
            const valueDataset = _runSchema(
              this.value,
              { value: entryValue },
              config
            );

            // If there are issues, capture them
            if (valueDataset.issues) {
              // Create record path item
              /** Private parent path segment retaining original input/value; sanitize before client exposure. */
              const pathItem: ObjectPathItem = {
                type: 'object',
                origin: 'value',
                input: input as Record<string, unknown>,
                key: entryKey,
                value: entryValue,
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
            if (!keyDataset.typed || !valueDataset.typed) {
              dataset.typed = false;
            }

            // If key is typed, add entry to dataset
            if (keyDataset.typed) {
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              dataset.value[keyDataset.value] = valueDataset.value;
            }
          }
        }

        // Otherwise, add record issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        Record<string | number | symbol, unknown>,
        RecordIssue | BaseIssue<unknown>
      >;
    },
  };
}
