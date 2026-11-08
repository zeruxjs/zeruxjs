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
   * The schema type.
   */
  readonly type: 'object_with_rest';
  /**
   * The schema reference.
   */
  readonly reference: typeof objectWithRest;
  /**
   * The expected property.
   */
  readonly expects: 'Object';
  /**
   * The entries schema.
   */
  readonly entries: TEntries;
  /**
   * The rest schema.
   */
  readonly rest: TRest;
  /**
   * The error message.
   */
  readonly message: TMessage;
}

/**
 * Creates an object with rest schema.
 *
 * @param entries The entries schema.
 * @param rest The rest schema.
 *
 * @returns An object with rest schema.
 */
export function objectWithRest<
  const TEntries extends ObjectEntries,
  const TRest extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(
  entries: TEntries,
  rest: TRest
): ObjectWithRestSchema<TEntries, TRest, undefined>;

/**
 * Creates an object with rest schema.
 *
 * @param entries The entries schema.
 * @param rest The rest schema.
 * @param message The error message.
 *
 * @returns An object with rest schema.
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
    get '~standard'() {
      return _getStandardProps(this);
    },
    '~run'(dataset, config) {
      // Get input value from dataset
      const input = dataset.value;

      // If root type is valid, check nested types
      if (input && typeof input === 'object' && !Array.isArray(input)) {
        // Set typed to `true` and value to blank object
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = {};

        // Process each object entry of schema
        for (const key of Object.keys(this.entries)) {
          if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Unsafe object schema key');
          const valueSchema = this.entries[key];

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
            const value: unknown =
              Object.hasOwn(input, key)
                ? // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                input[key]
                : undefined;
            const valueDataset = _runSchema(valueSchema, { value }, config);

            // If there are issues, capture them
            if (valueDataset.issues) {
              // Create object path item
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
            if (_isValidObjectKey(input, key) && !(Object.hasOwn(this.entries, key))) {
              const valueDataset = _runSchema(this.rest,
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                { value: input[key] },
                config
              );

              // If there are issues, capture them
              if (valueDataset.issues) {
                // Create object path item
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
