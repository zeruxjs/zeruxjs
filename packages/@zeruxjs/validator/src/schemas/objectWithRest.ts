import { _runSchema } from '../utils/_run.js';
import { getFallback } from '../methods/index.js';
import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferObjectInput,
  InferObjectIssue,
  InferObjectOutput,
  InferOutput,
  ObjectEntries,
  ObjectPathItem,
  OutputDataset,
} from '../types/index.js';
import {
  _addIssue,
  _getStandardProps,
  _isValidObjectKey,
} from '../utils/index.js';
import type { ObjectWithRestIssue } from './types/objectWithRest.js';

/**
 * Object with rest schema interface.
 */
export interface ObjectWithRestSchema<
  TEntries extends ObjectEntries,
  TRest extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<ObjectWithRestIssue> | undefined,
> extends BaseSchema<
  InferObjectInput<TEntries> & { [key: string]: InferInput<TRest> },
  InferObjectOutput<TEntries> & { [key: string]: InferOutput<TRest> },
  ObjectWithRestIssue | InferObjectIssue<TEntries> | InferIssue<TRest>
> {
  /**
   * Fixed structural discriminator used by issue and metadata consumers.
   */
  readonly type: 'object_with_rest';
  /**
   * Authored constructor identity; no package discovery or source evaluation occurs.
   */
  readonly reference: typeof objectWithRest;
  /**
   * Private root-type diagnostic, not an authorization or escaping policy.
   */
  readonly expects: 'Object';
  /**
   * Borrowed trusted child dictionary; mutation is visible to subsequent parses.
   */
  readonly entries: TEntries;
  /**
   * Borrowed explicit child schema for accepted extra values.
   */
  readonly rest: TRest;
  /**
   * Optional trusted private diagnostic text/callback; raw issues can contain rejected values.
   */
  readonly message: TMessage;
}

/** Validate declared own fields and validate safe extra own fields against the explicit rest schema. Construction captures trusted references; root parsing owns execution limits.
 * @param {TEntries} entries - Borrowed trusted named child schemas; caller mutation after construction is not isolated.
 * @param {TRest} rest - Borrowed explicit child schema for extra values; it receives the same root budget and private issue policy.
 * @returns {ObjectWithRestSchema<TEntries, TRest, undefined>} Inert structured schema; no input is parsed, cloned or authorized during construction.
 */
export function objectWithRest<
  const TEntries extends ObjectEntries,
  const TRest extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(
  entries: TEntries,
  rest: TRest
): ObjectWithRestSchema<TEntries, TRest, undefined>;

/** Validate declared own fields and validate safe extra own fields against the explicit rest schema. Construction captures trusted references; root parsing owns execution limits.
 * @param {TEntries} entries - Borrowed trusted named child schemas; caller mutation after construction is not isolated.
 * @param {TRest} rest - Borrowed explicit child schema for extra values; it receives the same root budget and private issue policy.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; not client-safe HTML.
 * @returns {ObjectWithRestSchema<TEntries, TRest, TMessage>} Inert structured schema; no input is parsed, cloned or authorized during construction.
 */
export function objectWithRest<
  const TEntries extends ObjectEntries,
  const TRest extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<ObjectWithRestIssue> | undefined,
>(
  entries: TEntries,
  rest: TRest,
  message: TMessage
): ObjectWithRestSchema<TEntries, TRest, TMessage>;

/** Validate declared own fields and validate safe extra own fields against the explicit rest schema. Construction captures trusted references; root parsing owns execution limits.
 * @param {ObjectEntries} entries - Borrowed trusted named child schemas; caller mutation after construction is not isolated.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>>} rest - Borrowed explicit child schema for extra values; it receives the same root budget and private issue policy.
 * @param {ErrorMessage<ObjectWithRestIssue>} message - Optional trusted private diagnostic text/callback; not client-safe HTML.
 * @returns {ObjectWithRestSchema<ObjectEntries, BaseSchema<unknown, unknown, BaseIssue<unknown>>, ErrorMessage<ObjectWithRestIssue> | undefined>} Inert structured schema; no input is parsed, cloned or authorized during construction.
 */
// @__NO_SIDE_EFFECTS__
export function objectWithRest(
  entries: ObjectEntries,
  rest: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<ObjectWithRestIssue>
): ObjectWithRestSchema<
  ObjectEntries,
  BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<ObjectWithRestIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'object_with_rest',
    reference: objectWithRest,
    expects: 'Object',
    async: false,
    entries,
    rest,
    message,
    /** Adapt explicit validation to the shared bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Validate declared own fields and validate safe extra own fields against the explicit rest schema. Child transforms may return borrowed identities; output is not a deep clone.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; object keys are checked as own properties and tuple positions use array indices.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root work/issue budgets, abort flags and private message policy.
     * @returns {OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Declared structural output or private nested issues; exceptions and budget failures propagate.
     */
    '~run'(dataset, config) {
      // Get input value from dataset
      /** Borrowed current input retained for own-field checks and private issue paths. */
      const input = dataset.value;

      // If root type is valid, check nested types
      if (input && typeof input === 'object' && !Array.isArray(input)) {
        // Set typed to `true` and value to blank object
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = {};

        // Process each object entry of schema
        for (const key of Object.keys(this.entries)) {
          if (['__proto__', 'prototype', 'constructor'].includes(key)) {
            throw new TypeError('Unsafe object schema key');
          }
          // This key was enumerated from the trusted schema dictionary, not the submitted input.
          /** Child schema selected from the trusted enumerated dictionary, never from submitted data. */
          const valueSchema = this.entries[key]!;

          // If key is present or its an optional schema with a default value,
          // parse input of key or default value
          if (
            Object.hasOwn(input, key) ||
            ((valueSchema.type === 'exact_optional' ||
              valueSchema.type === 'optional' ||
              valueSchema.type === 'nullish') &&
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              valueSchema.default !== undefined)
          ) {
            /** Current own field or positional value; missing input is delegated as undefined. */
            const value: unknown = Object.hasOwn(input, key)
              ? // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                input[key]
              : undefined;
            /** Child result sharing root budgets; nested private issues are rebased before accumulation. */
            const valueDataset = _runSchema(valueSchema, { value }, config);

            // If there are issues, capture them
            if (valueDataset.issues) {
              // Create object path item
              /** Private parent path segment retaining original input/value; public HTTP responses sanitize it. */
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
            dataset.value[key] = getFallback(valueSchema);

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
                  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                  value: input[key],
                },
              ],
            });

            // If necessary, abort early
            if (config.abortEarly) {
              break;
            }
          }
        }

        // Parse schema of each rest entry if necessary
        // Hint: We exclude specific keys for security reasons
        if (!dataset.issues || !config.abortEarly) {
          for (const key of Object.keys(input)) {
            if (
              _isValidObjectKey(input, key) &&
              !Object.hasOwn(this.entries, key)
            ) {
              /** Child result sharing root budgets; nested private issues are rebased before accumulation. */
              const valueDataset = _runSchema(
                this.rest,
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                { value: input[key] },
                config
              );

              // If there are issues, capture them
              if (valueDataset.issues) {
                // Create object path item
                /** Private parent path segment retaining original input/value; public HTTP responses sanitize it. */
                const pathItem: ObjectPathItem = {
                  type: 'object',
                  origin: 'value',
                  input: input as Record<string, unknown>,
                  key,
                  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                  value: input[key],
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
        }

        // Otherwise, add object issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        InferObjectOutput<ObjectEntries> & { [key: string]: unknown },
        | ObjectWithRestIssue
        | InferObjectIssue<ObjectEntries>
        | BaseIssue<unknown>
      >;
    },
  };
}
