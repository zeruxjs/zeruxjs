import { _runSchema } from '../utils/_run.js';
import { getFallback } from '../methods/index.js';
import type {
  BaseSchemaAsync,
  ErrorMessage,
  InferObjectInput,
  InferObjectIssue,
  InferObjectOutput,
  ObjectEntriesAsync,
  ObjectPathItem,
  OutputDataset,
} from '../types/index.js';
import {
  _addIssue,
  _getStandardProps,
  _isValidObjectKey,
} from '../utils/index.js';
import type { looseObject } from './looseObject.js';
import type { LooseObjectIssue } from './types/looseObject.js';

/**
 * Object schema async interface.
 */
export interface LooseObjectSchemaAsync<
  TEntries extends ObjectEntriesAsync,
  TMessage extends ErrorMessage<LooseObjectIssue> | undefined,
> extends BaseSchemaAsync<
  InferObjectInput<TEntries> & { [key: string]: unknown },
  InferObjectOutput<TEntries> & { [key: string]: unknown },
  LooseObjectIssue | InferObjectIssue<TEntries>
> {
  /**
   * Stable structural discriminator for issue and metadata consumers.
   */
  readonly type: 'loose_object';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof looseObject | typeof looseObjectAsync;
  /**
   * Private root-type diagnostic, not an authorization or escaping policy.
   */
  readonly expects: 'Object';
  /**
   * Borrowed declared child dictionary; mutation remains visible to subsequent parses.
   */
  readonly entries: TEntries;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Validate declared own fields and retain safe extra own fields without validating their values. Construction captures trusted child references without parsing input.
 * @param {TEntries} entries - Borrowed trusted child dictionary; later caller mutation is not isolated.
 * @returns {LooseObjectSchemaAsync<TEntries, undefined>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
export function looseObjectAsync<const TEntries extends ObjectEntriesAsync>(
  entries: TEntries
): LooseObjectSchemaAsync<TEntries, undefined>;

/** Validate declared own fields and retain safe extra own fields without validating their values. Construction captures trusted child references without parsing input.
 * @param {TEntries} entries - Borrowed trusted child dictionary; later caller mutation is not isolated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback, not sanitized client feedback.
 * @returns {LooseObjectSchemaAsync<TEntries, TMessage>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
export function looseObjectAsync<
  const TEntries extends ObjectEntriesAsync,
  const TMessage extends ErrorMessage<LooseObjectIssue> | undefined,
>(
  entries: TEntries,
  message: TMessage
): LooseObjectSchemaAsync<TEntries, TMessage>;

/** Validate declared own fields and retain safe extra own fields without validating their values. Construction captures trusted child references without parsing input.
 * @param {ObjectEntriesAsync} entries - Borrowed trusted child dictionary; later caller mutation is not isolated.
 * @param {ErrorMessage<LooseObjectIssue>} message - Optional trusted private diagnostic text/callback, not sanitized client feedback.
 * @returns {LooseObjectSchemaAsync<ObjectEntriesAsync, ErrorMessage<LooseObjectIssue> | undefined>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
// @__NO_SIDE_EFFECTS__
export function looseObjectAsync(
  entries: ObjectEntriesAsync,
  message?: ErrorMessage<LooseObjectIssue>
): LooseObjectSchemaAsync<
  ObjectEntriesAsync,
  ErrorMessage<LooseObjectIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'loose_object',
    reference: looseObjectAsync,
    expects: 'Object',
    async: true,
    entries,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Validate declared own fields and retain safe extra own fields without validating their values. Child parsing starts concurrently; abortEarly affects result accumulation after that work starts.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private candidate structural input; raw child issues retain its original values/paths.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root budgets, cancellation and private diagnostic policy.
     * @returns {Promise<OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Declared structural output or private issues; root execution drains owned started callbacks on operational failure.
     */
    async '~run'(dataset, config) {
      // Get input value from dataset
      /** Borrowed structural input retained for own-field reads and private issue paths. */
      const input = dataset.value;

      // If root type is valid, check nested types
      if (input && typeof input === 'object' && !Array.isArray(input)) {
        // Set typed to `true` and value to blank object
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = {};

        // If key is present or its an optional schema with a default value,
        // parse input of key or default value asynchronously
        /** Concurrent child results in declared entry order; missing entries retain a null result sentinel. */
        const valueDatasets = await Promise.all(
          Object.entries(this.entries).map(async ([key, valueSchema]) => {
            if (
              Object.hasOwn(input, key) ||
              ((valueSchema.type === 'exact_optional' ||
                valueSchema.type === 'optional' ||
                valueSchema.type === 'nullish') &&
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                valueSchema.default !== undefined)
            ) {
              /** Original field/position value, or undefined for a missing optional/defaulted input. */
              const value: unknown = Object.hasOwn(input, key)
                ? // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                  input[key]
                : undefined;
              return [
                key,
                value,
                valueSchema,
                await _runSchema(valueSchema, { value }, config),
              ] as const;
            }
            return [
              key,
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              input[key] as unknown,
              valueSchema,
              null,
            ] as const;
          })
        );

        // Process each object entry of schema
        for (const [key, value, valueSchema, valueDataset] of valueDatasets) {
          // If key is present or its an optional schema with a default value,
          // process its value dataset
          if (valueDataset) {
            // If there are issues, capture them
            if (valueDataset.issues) {
              // Create object path item
              /** Private parent path segment retaining original input/value; public feedback must sanitize it. */
              const pathItem: ObjectPathItem = {
                type: 'object',
                origin: 'value',
                input: input as Record<string, unknown>,
                key,
                value,
              };

              // Add modified entry dataset issues to issues
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

            // Add entry to dataset
            // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
            dataset.value[key] = valueDataset.value;

            // Otherwise, if key is missing but has a fallback, use it
            // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          } else if (valueSchema.fallback !== undefined) {
            // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
            dataset.value[key] = await getFallback(valueSchema);

            // Otherwise, if key is missing and required, add issue
          } else if (
            valueSchema.type !== 'exact_optional' &&
            valueSchema.type !== 'optional' &&
            valueSchema.type !== 'nullish'
          ) {
            _addIssue(this, 'key', dataset, config, {
              input: undefined,
              expected: `"${key}"`,
              path: [
                {
                  type: 'object',
                  origin: 'key',
                  input: input as Record<string, unknown>,
                  key,
                  value,
                },
              ],
            });

            // If necessary, abort early
            if (config.abortEarly) {
              break;
            }
          }
        }

        // Add rest to dataset if necessary
        // Hint: We exclude specific keys for security reasons
        if (!dataset.issues || !config.abortEarly) {
          for (const key of Object.keys(input)) {
            if (
              _isValidObjectKey(input, key) &&
              !Object.hasOwn(this.entries, key)
            ) {
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              dataset.value[key] = input[key];
            }
          }
        }

        // Otherwise, add object issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        InferObjectOutput<ObjectEntriesAsync> & { [key: string]: unknown },
        LooseObjectIssue | InferObjectIssue<ObjectEntriesAsync>
      >;
    },
  };
}
