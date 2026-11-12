import { _runSchema } from '../utils/_run.js';
import { getFallback } from '../methods/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferObjectInput,
  InferObjectIssue,
  InferObjectOutput,
  InferOutput,
  ObjectEntriesAsync,
  ObjectPathItem,
  OutputDataset,
} from '../types/index.js';
import {
  _addIssue,
  _getStandardProps,
  _isValidObjectKey,
} from '../utils/index.js';
import type { objectWithRest } from './objectWithRest.js';
import type { ObjectWithRestIssue } from './types/objectWithRest.js';

/**
 * Object schema async interface.
 */
export interface ObjectWithRestSchemaAsync<
  TEntries extends ObjectEntriesAsync,
  TRest extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<ObjectWithRestIssue> | undefined,
> extends BaseSchemaAsync<
  InferObjectInput<TEntries> & { [key: string]: InferInput<TRest> },
  InferObjectOutput<TEntries> & { [key: string]: InferOutput<TRest> },
  ObjectWithRestIssue | InferObjectIssue<TEntries> | InferIssue<TRest>
> {
  /**
   * Stable structural discriminator for issue and metadata consumers.
   */
  readonly type: 'object_with_rest';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof objectWithRest | typeof objectWithRestAsync;
  /**
   * Private root-type diagnostic, not an authorization or escaping policy.
   */
  readonly expects: 'Object';
  /**
   * Borrowed declared child dictionary; mutation remains visible to subsequent parses.
   */
  readonly entries: TEntries;
  /**
   * Borrowed explicit schema for extra values; no implicit dynamic handler resolution.
   */
  readonly rest: TRest;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Validate declared own fields and validate safe extra own fields with the explicit rest schema. Construction captures trusted child references without parsing input.
 * @param {TEntries} entries - Borrowed trusted child dictionary; later caller mutation is not isolated.
 * @param {TRest} rest - Borrowed explicit schema used only for safe extra fields or trailing values; never resolved from input.
 * @returns {ObjectWithRestSchemaAsync<TEntries, TRest, undefined>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
export function objectWithRestAsync<
  const TEntries extends ObjectEntriesAsync,
  const TRest extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(
  entries: TEntries,
  rest: TRest
): ObjectWithRestSchemaAsync<TEntries, TRest, undefined>;

/** Validate declared own fields and validate safe extra own fields with the explicit rest schema. Construction captures trusted child references without parsing input.
 * @param {TEntries} entries - Borrowed trusted child dictionary; later caller mutation is not isolated.
 * @param {TRest} rest - Borrowed explicit schema used only for safe extra fields or trailing values; never resolved from input.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback, not sanitized client feedback.
 * @returns {ObjectWithRestSchemaAsync<TEntries, TRest, TMessage>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
export function objectWithRestAsync<
  const TEntries extends ObjectEntriesAsync,
  const TRest extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<ObjectWithRestIssue> | undefined,
>(
  entries: TEntries,
  rest: TRest,
  message: TMessage
): ObjectWithRestSchemaAsync<TEntries, TRest, TMessage>;

/** Validate declared own fields and validate safe extra own fields with the explicit rest schema. Construction captures trusted child references without parsing input.
 * @param {ObjectEntriesAsync} entries - Borrowed trusted child dictionary; later caller mutation is not isolated.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>} rest - Borrowed explicit schema used only for safe extra fields or trailing values; never resolved from input.
 * @param {ErrorMessage<ObjectWithRestIssue>} message - Optional trusted private diagnostic text/callback, not sanitized client feedback.
 * @returns {ObjectWithRestSchemaAsync<ObjectEntriesAsync, BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>, ErrorMessage<ObjectWithRestIssue> | undefined>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
// @__NO_SIDE_EFFECTS__
export function objectWithRestAsync(
  entries: ObjectEntriesAsync,
  rest:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<ObjectWithRestIssue>
): ObjectWithRestSchemaAsync<
  ObjectEntriesAsync,
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<ObjectWithRestIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'object_with_rest',
    reference: objectWithRestAsync,
    expects: 'Object',
    async: true,
    entries,
    rest,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Validate declared own fields and validate safe extra own fields with the explicit rest schema. Child parsing starts concurrently; abortEarly affects result accumulation after that work starts.
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

        // Parse each normal and rest entry
        /** Declared and extra child result groups started together; accumulation keeps normal values before rest values. */
        const [normalDatasets, restDatasets] = await Promise.all([
          // If key is present or its an optional schema with a default value,
          // parse input of key or default value asynchronously
          Promise.all(
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
          ),

          // Parse other entries with rest schema asynchronously
          // Hint: We exclude specific keys for security reasons
          Promise.all(
            Object.entries(input)
              .filter(
                ([key]) =>
                  _isValidObjectKey(input, key) &&
                  !Object.hasOwn(this.entries, key)
              )
              .map(
                async ([key, value]) =>
                  [
                    key,
                    value,
                    await _runSchema(this.rest, { value }, config),
                  ] as const
              )
          ),
        ]);

        // Process each normal object entry of schema
        for (const [key, value, valueSchema, valueDataset] of normalDatasets) {
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

        // Process each rest entry of schema if necessary
        if (!dataset.issues || !config.abortEarly) {
          for (const [key, value, valueDataset] of restDatasets) {
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
        | ObjectWithRestIssue
        | InferObjectIssue<ObjectEntriesAsync>
        | BaseIssue<unknown>
      >;
    },
  };
}
