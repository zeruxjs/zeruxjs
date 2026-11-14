import {
  type LooseObjectIssue,
  type LooseObjectSchemaAsync,
  type ObjectIssue,
  type ObjectSchemaAsync,
  type ObjectWithRestIssue,
  type ObjectWithRestSchemaAsync,
  optionalAsync,
  type OptionalSchemaAsync,
  type StrictObjectIssue,
  type StrictObjectSchemaAsync,
} from '../schemas/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  Config,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferObjectInput,
  InferObjectOutput,
  InferOutput,
  ObjectEntriesAsync,
  ObjectKeys,
  OutputDataset,
  SchemaWithoutPipe,
  StandardProps,
  UnknownDataset,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';

/**
 * Schema type.
 */
type Schema = SchemaWithoutPipe<
  | LooseObjectSchemaAsync<
      ObjectEntriesAsync,
      ErrorMessage<LooseObjectIssue> | undefined
    >
  | ObjectSchemaAsync<ObjectEntriesAsync, ErrorMessage<ObjectIssue> | undefined>
  | ObjectWithRestSchemaAsync<
      ObjectEntriesAsync,
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
      ErrorMessage<ObjectWithRestIssue> | undefined
    >
  | StrictObjectSchemaAsync<
      ObjectEntriesAsync,
      ErrorMessage<StrictObjectIssue> | undefined
    >
>;

/**
 * Partial entries type.
 */
type PartialEntries<
  TEntries extends ObjectEntriesAsync,
  TKeys extends readonly (keyof TEntries)[] | undefined,
> = {
  [TKey in keyof TEntries]: TKeys extends readonly (keyof TEntries)[]
    ? TKey extends TKeys[number]
      ? OptionalSchemaAsync<TEntries[TKey], undefined>
      : TEntries[TKey]
    : OptionalSchemaAsync<TEntries[TKey], undefined>;
};

/**
 * Schema with partial type.
 */
export type SchemaWithPartialAsync<
  TSchema extends Schema,
  TKeys extends ObjectKeys<TSchema> | undefined,
> = TSchema extends
  | ObjectSchemaAsync<infer TEntries, ErrorMessage<ObjectIssue> | undefined>
  | StrictObjectSchemaAsync<
      infer TEntries,
      ErrorMessage<StrictObjectIssue> | undefined
    >
  ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
      /**
       * Fresh mapped entry dictionary; unselected children retain their borrowed identity.
       */
      readonly entries: PartialEntries<TEntries, TKeys>;
      /**
       * Adapter metadata for the copied entry shape, not a separate validator.
       *
       * @internal
       */
      readonly '~standard': StandardProps<
        InferObjectInput<PartialEntries<TEntries, TKeys>>,
        InferObjectOutput<PartialEntries<TEntries, TKeys>>
      >;
      /** Run the copied structural schema under the shared root context.
       * @param {UnknownDataset} dataset - Private candidate dataset; validation does not grant tenant permissions.
       * @param {Config<BaseIssue<unknown>>} config - Shared root work/issue budgets, abort flags and private diagnostic policy.
       * @returns {Promise<OutputDataset<InferObjectOutput<PartialEntries<TEntries, TKeys>>, InferIssue<TSchema>>>} Declared output or private issues; execution exceptions and budget failures propagate.
       * @internal
       */
      readonly '~run': (
        dataset: UnknownDataset,
        config: Config<BaseIssue<unknown>>
      ) => Promise<
        OutputDataset<
          InferObjectOutput<PartialEntries<TEntries, TKeys>>,
          InferIssue<TSchema>
        >
      >;
      /**
       * The input, output and issue type.
       *
       * @internal
       */
      readonly '~types'?:
        | {
            /** Type-only accepted object fields after selected wrappers are applied. */
            readonly input: InferObjectInput<PartialEntries<TEntries, TKeys>>;
            /** Type-only child output fields; runtime transforms remain schema-owned. */
            readonly output: InferObjectOutput<PartialEntries<TEntries, TKeys>>;
            /** Type-only private child/undefined issue union. */
            readonly issue: InferIssue<TSchema>;
          }
        | undefined;
    }
  : TSchema extends LooseObjectSchemaAsync<
        infer TEntries,
        ErrorMessage<LooseObjectIssue> | undefined
      >
    ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
        /**
         * Fresh mapped entry dictionary; unselected children retain their borrowed identity.
         */
        readonly entries: PartialEntries<TEntries, TKeys>;
        /**
         * Adapter metadata for the copied entry shape, not a separate validator.
         *
         * @internal
         */
        readonly '~standard': StandardProps<
          InferObjectInput<PartialEntries<TEntries, TKeys>> & {
            [key: string]: unknown;
          },
          InferObjectOutput<PartialEntries<TEntries, TKeys>> & {
            [key: string]: unknown;
          }
        >;
        /** Run the copied structural schema under the shared root context.
         * @param {UnknownDataset} dataset - Private candidate dataset; validation does not grant tenant permissions.
         * @param {Config<BaseIssue<unknown>>} config - Shared root work/issue budgets, abort flags and private diagnostic policy.
         * @returns {Promise<OutputDataset<InferObjectOutput<PartialEntries<TEntries, TKeys>> & { [key: string]: unknown; }, InferIssue<TSchema>>>} Declared output or private issues; execution exceptions and budget failures propagate.
         * @internal
         */
        readonly '~run': (
          dataset: UnknownDataset,
          config: Config<BaseIssue<unknown>>
        ) => Promise<
          OutputDataset<
            InferObjectOutput<PartialEntries<TEntries, TKeys>> & {
              [key: string]: unknown;
            },
            InferIssue<TSchema>
          >
        >;
        /**
         * The input, output and issue type.
         *
         * @internal
         */
        readonly '~types'?:
          | {
              /** Type-only accepted object fields after selected wrappers are applied. */
              readonly input: InferObjectInput<
                PartialEntries<TEntries, TKeys>
              > & {
                [key: string]: unknown;
              };
              /** Type-only child output fields; runtime transforms remain schema-owned. */
              readonly output: InferObjectOutput<
                PartialEntries<TEntries, TKeys>
              > & {
                [key: string]: unknown;
              };
              /** Type-only private child/undefined issue union. */
              readonly issue: InferIssue<TSchema>;
            }
          | undefined;
      }
    : TSchema extends ObjectWithRestSchemaAsync<
          infer TEntries,
          infer TRest,
          ErrorMessage<ObjectWithRestIssue> | undefined
        >
      ? Omit<TSchema, 'entries' | '~standard' | '~run' | '~types'> & {
          /**
           * Fresh mapped entry dictionary; unselected children retain their borrowed identity.
           */
          readonly entries: PartialEntries<TEntries, TKeys>;
          /**
           * Adapter metadata for the copied entry shape, not a separate validator.
           *
           * @internal
           */
          readonly '~standard': StandardProps<
            InferObjectInput<PartialEntries<TEntries, TKeys>> & {
              [key: string]: InferInput<TRest>;
            },
            InferObjectOutput<PartialEntries<TEntries, TKeys>> & {
              [key: string]: InferOutput<TRest>;
            }
          >;
          /** Run the copied structural schema under the shared root context.
           * @param {UnknownDataset} dataset - Private candidate dataset; validation does not grant tenant permissions.
           * @param {Config<BaseIssue<unknown>>} config - Shared root work/issue budgets, abort flags and private diagnostic policy.
           * @returns {Promise<OutputDataset<InferObjectOutput<PartialEntries<TEntries, TKeys>> & { [key: string]: InferOutput<TRest>; }, InferIssue<TSchema>>>} Declared output or private issues; execution exceptions and budget failures propagate.
           * @internal
           */
          readonly '~run': (
            dataset: UnknownDataset,
            config: Config<BaseIssue<unknown>>
          ) => Promise<
            OutputDataset<
              InferObjectOutput<PartialEntries<TEntries, TKeys>> & {
                [key: string]: InferOutput<TRest>;
              },
              InferIssue<TSchema>
            >
          >;
          /**
           * The input, output and issue type.
           *
           * @internal
           */
          readonly '~types'?:
            | {
                /** Type-only accepted object fields after selected wrappers are applied. */
                readonly input: InferObjectInput<
                  PartialEntries<TEntries, TKeys>
                > & {
                  [key: string]: InferInput<TRest>;
                };
                /** Type-only child output fields; runtime transforms remain schema-owned. */
                readonly output: InferObjectOutput<
                  PartialEntries<TEntries, TKeys>
                > & { [key: string]: InferOutput<TRest> };
                /** Type-only private child/undefined issue union. */
                readonly issue: InferIssue<TSchema>;
              }
            | undefined;
        }
      : never;

/** Create a shallow structural schema copy with selected entries wrapped to accept undefined. Child schemas and unselected references remain borrowed.
 * @param {TSchema} schema - Borrowed supported structural schema without a pipeline; no input is parsed by this operation.
 * @returns {SchemaWithPartialAsync<TSchema, undefined>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
export function partialAsync<const TSchema extends Schema>(
  schema: TSchema
): SchemaWithPartialAsync<TSchema, undefined>;

/** Create a shallow structural schema copy with selected entries wrapped to accept undefined. Child schemas and unselected references remain borrowed.
 * @param {TSchema} schema - Borrowed supported structural schema without a pipeline; no input is parsed by this operation.
 * @param {TKeys} keys - Optional selected declared entry keys; omission selects every entry.
 * @returns {SchemaWithPartialAsync<TSchema, TKeys>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
export function partialAsync<
  const TSchema extends Schema,
  const TKeys extends ObjectKeys<TSchema>,
>(schema: TSchema, keys: TKeys): SchemaWithPartialAsync<TSchema, TKeys>;

/** Create a shallow structural schema copy with selected entries wrapped to accept undefined. Child schemas and unselected references remain borrowed.
 * @param {Schema} schema - Borrowed supported structural schema without a pipeline; no input is parsed by this operation.
 * @param {ObjectKeys<Schema>} keys - Optional selected declared entry keys; omission selects every entry.
 * @returns {SchemaWithPartialAsync<Schema, ObjectKeys<Schema> | undefined>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
// @__NO_SIDE_EFFECTS__
export function partialAsync(
  schema: Schema,
  keys?: ObjectKeys<Schema>
): SchemaWithPartialAsync<Schema, ObjectKeys<Schema> | undefined> {
  // Create modified object entries
  /** Fresh schema dictionary receiving wrappers only for selected declared keys. */
  const entries: PartialEntries<ObjectEntriesAsync, ObjectKeys<Schema>> = {};
  // Enumerated entries belong to the trusted schema dictionary, whose values are schemas.
  for (const key in schema.entries) {
    // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
    entries[key] =
      !keys || keys.includes(key)
        ? optionalAsync(schema.entries[key]!)
        : schema.entries[key]!;
  }

  // Return modified copy of schema
  return {
    ...schema,
    entries,
    /** Adapt the fresh copied schema to the same bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
  };
}
