import {
  type LooseObjectIssue,
  type LooseObjectSchema,
  type ObjectIssue,
  type ObjectSchema,
  type ObjectWithRestIssue,
  type ObjectWithRestSchema,
  optional,
  type OptionalSchema,
  type StrictObjectIssue,
  type StrictObjectSchema,
} from '../schemas/index.js';
import type {
  BaseIssue,
  BaseSchema,
  Config,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferObjectInput,
  InferObjectOutput,
  InferOutput,
  ObjectEntries,
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
  | LooseObjectSchema<ObjectEntries, ErrorMessage<LooseObjectIssue> | undefined>
  | ObjectSchema<ObjectEntries, ErrorMessage<ObjectIssue> | undefined>
  | ObjectWithRestSchema<
      ObjectEntries,
      BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      ErrorMessage<ObjectWithRestIssue> | undefined
    >
  | StrictObjectSchema<
      ObjectEntries,
      ErrorMessage<StrictObjectIssue> | undefined
    >
>;

/**
 * Partial entries type.
 */
type PartialEntries<
  TEntries extends ObjectEntries,
  TKeys extends readonly (keyof TEntries)[] | undefined,
> = {
  [TKey in keyof TEntries]: TKeys extends readonly (keyof TEntries)[]
    ? TKey extends TKeys[number]
      ? OptionalSchema<TEntries[TKey], undefined>
      : TEntries[TKey]
    : OptionalSchema<TEntries[TKey], undefined>;
};

/**
 * Schema with partial type.
 */
export type SchemaWithPartial<
  TSchema extends Schema,
  TKeys extends ObjectKeys<TSchema> | undefined,
> = TSchema extends
  | ObjectSchema<infer TEntries, ErrorMessage<ObjectIssue> | undefined>
  | StrictObjectSchema<
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
       * @returns {OutputDataset<InferObjectOutput<PartialEntries<TEntries, TKeys>>, InferIssue<TSchema>>} Declared output or private issues; execution exceptions and budget failures propagate.
       * @internal
       */
      readonly '~run': (
        dataset: UnknownDataset,
        config: Config<BaseIssue<unknown>>
      ) => OutputDataset<
        InferObjectOutput<PartialEntries<TEntries, TKeys>>,
        InferIssue<TSchema>
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
  : TSchema extends LooseObjectSchema<
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
         * @returns {OutputDataset<InferObjectOutput<PartialEntries<TEntries, TKeys>> & { [key: string]: unknown; }, InferIssue<TSchema>>} Declared output or private issues; execution exceptions and budget failures propagate.
         * @internal
         */
        readonly '~run': (
          dataset: UnknownDataset,
          config: Config<BaseIssue<unknown>>
        ) => OutputDataset<
          InferObjectOutput<PartialEntries<TEntries, TKeys>> & {
            [key: string]: unknown;
          },
          InferIssue<TSchema>
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
    : TSchema extends ObjectWithRestSchema<
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
           * @returns {OutputDataset<InferObjectOutput<PartialEntries<TEntries, TKeys>> & { [key: string]: InferOutput<TRest>; }, InferIssue<TSchema>>} Declared output or private issues; execution exceptions and budget failures propagate.
           * @internal
           */
          readonly '~run': (
            dataset: UnknownDataset,
            config: Config<BaseIssue<unknown>>
          ) => OutputDataset<
            InferObjectOutput<PartialEntries<TEntries, TKeys>> & {
              [key: string]: InferOutput<TRest>;
            },
            InferIssue<TSchema>
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
 * @returns {SchemaWithPartial<TSchema, undefined>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
export function partial<const TSchema extends Schema>(
  schema: TSchema
): SchemaWithPartial<TSchema, undefined>;

/** Create a shallow structural schema copy with selected entries wrapped to accept undefined. Child schemas and unselected references remain borrowed.
 * @param {TSchema} schema - Borrowed supported structural schema without a pipeline; no input is parsed by this operation.
 * @param {TKeys} keys - Optional selected declared entry keys; omission selects every entry.
 * @returns {SchemaWithPartial<TSchema, TKeys>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
export function partial<
  const TSchema extends Schema,
  const TKeys extends ObjectKeys<TSchema>,
>(schema: TSchema, keys: TKeys): SchemaWithPartial<TSchema, TKeys>;

/** Create a shallow structural schema copy with selected entries wrapped to accept undefined. Child schemas and unselected references remain borrowed.
 * @param {Schema} schema - Borrowed supported structural schema without a pipeline; no input is parsed by this operation.
 * @param {ObjectKeys<Schema>} keys - Optional selected declared entry keys; omission selects every entry.
 * @returns {SchemaWithPartial<Schema, ObjectKeys<Schema> | undefined>} Fresh outer schema/entry dictionary with existing root behavior and Standard Schema adaptation; no disposer or deep isolation is introduced.
 */
// @__NO_SIDE_EFFECTS__
export function partial(
  schema: Schema,
  keys?: ObjectKeys<Schema>
): SchemaWithPartial<Schema, ObjectKeys<Schema> | undefined> {
  // Create modified object entries
  /** Fresh schema dictionary receiving wrappers only for selected declared keys. */
  const entries: PartialEntries<ObjectEntries, ObjectKeys<Schema>> = {};
  // Enumerated entries belong to the trusted schema dictionary, whose values are schemas.
  for (const key in schema.entries) {
    // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
    entries[key] =
      !keys || keys.includes(key)
        ? optional(schema.entries[key]!)
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
