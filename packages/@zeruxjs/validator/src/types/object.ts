import type { ReadonlyAction } from '../actions/index.js';
import type {
  SchemaWithFallback,
  SchemaWithFallbackAsync,
  SchemaWithPipe,
  SchemaWithPipeAsync,
} from '../methods/index.js';
import type {
  ExactOptionalSchema,
  ExactOptionalSchemaAsync,
  LooseObjectIssue,
  LooseObjectSchema,
  LooseObjectSchemaAsync,
  NullishSchema,
  NullishSchemaAsync,
  ObjectIssue,
  ObjectSchema,
  ObjectSchemaAsync,
  ObjectWithRestIssue,
  ObjectWithRestSchema,
  ObjectWithRestSchemaAsync,
  OptionalSchema,
  OptionalSchemaAsync,
  StrictObjectIssue,
  StrictObjectSchema,
  StrictObjectSchemaAsync,
} from '../schemas/index.js';
import type { InferInput, InferIssue, InferOutput } from './infer.js';
import type { BaseIssue } from './issue.js';
import type { ErrorMessage } from './other.js';
import type { BaseSchema, BaseSchemaAsync } from './schema.js';
import type { MarkOptional, MaybeReadonly, Prettify } from './utils.js';

/** Synchronous wrappers that make declared object entries optional; undefinedable alone does not make a missing key optional. */
export type OptionalEntrySchema =
  | ExactOptionalSchema<
      BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      unknown
    >
  | NullishSchema<BaseSchema<unknown, unknown, BaseIssue<unknown>>, unknown>
  | OptionalSchema<BaseSchema<unknown, unknown, BaseIssue<unknown>>, unknown>;

/** Explicit asynchronous/synchronous optional-entry wrappers used only for object shape inference. */
export type OptionalEntrySchemaAsync =
  | ExactOptionalSchemaAsync<
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
      unknown
    >
  | NullishSchemaAsync<
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
      unknown
    >
  | OptionalSchemaAsync<
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
      unknown
    >;

/**
 * Object entries interface.
 */
export interface ObjectEntries {
  [key: string]:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | SchemaWithFallback<
        BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        unknown
      >
    | OptionalEntrySchema;
}

/**
 * Object entries async interface.
 */
export interface ObjectEntriesAsync {
  [key: string]:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
    | SchemaWithFallback<
        BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        unknown
      >
    | SchemaWithFallbackAsync<
        | BaseSchema<unknown, unknown, BaseIssue<unknown>>
        | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
        unknown
      >
    | OptionalEntrySchema
    | OptionalEntrySchemaAsync;
}

/** Nonempty selection of declared schema keys; runtime data keys and authorization remain separate. */
export type ObjectKeys<
  TSchema extends
    | LooseObjectSchema<
        ObjectEntries,
        ErrorMessage<LooseObjectIssue> | undefined
      >
    | LooseObjectSchemaAsync<
        ObjectEntriesAsync,
        ErrorMessage<LooseObjectIssue> | undefined
      >
    | ObjectSchema<ObjectEntries, ErrorMessage<ObjectIssue> | undefined>
    | ObjectSchemaAsync<
        ObjectEntriesAsync,
        ErrorMessage<ObjectIssue> | undefined
      >
    | ObjectWithRestSchema<
        ObjectEntries,
        BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        ErrorMessage<ObjectWithRestIssue> | undefined
      >
    | ObjectWithRestSchemaAsync<
        ObjectEntriesAsync,
        | BaseSchema<unknown, unknown, BaseIssue<unknown>>
        | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
        ErrorMessage<ObjectWithRestIssue> | undefined
      >
    | StrictObjectSchema<
        ObjectEntries,
        ErrorMessage<StrictObjectIssue> | undefined
      >
    | StrictObjectSchemaAsync<
        ObjectEntriesAsync,
        ErrorMessage<StrictObjectIssue> | undefined
      >,
> = MaybeReadonly<[keyof TSchema['entries'], ...(keyof TSchema['entries'])[]]>;

/** Map declared child input types while removing readonly type modifiers; child schemas remain borrowed at runtime. */
type InferEntriesInput<TEntries extends ObjectEntries | ObjectEntriesAsync> = {
  -readonly [TKey in keyof TEntries]: InferInput<TEntries[TKey]>;
};

/** Map child transformed output types without performing runtime cloning or conversion. */
type InferEntriesOutput<TEntries extends ObjectEntries | ObjectEntriesAsync> = {
  -readonly [TKey in keyof TEntries]: InferOutput<TEntries[TKey]>;
};

/** Select object keys whose declared wrappers permit omission at input. */
type OptionalInputKeys<TEntries extends ObjectEntries | ObjectEntriesAsync> = {
  [TKey in keyof TEntries]: TEntries[TKey] extends
    | OptionalEntrySchema
    | OptionalEntrySchemaAsync
    ? TKey
    : never;
}[keyof TEntries];

/** Select optional wrapper keys whose declared default permits undefined at output. */
type OptionalOutputKeys<TEntries extends ObjectEntries | ObjectEntriesAsync> = {
  [TKey in keyof TEntries]: TEntries[TKey] extends
    | OptionalEntrySchema
    | OptionalEntrySchemaAsync
    ? undefined extends TEntries[TKey]['default']
      ? TKey
      : never
    : never;
}[keyof TEntries];

/**
 * Input with question marks type.
 */
type InputWithQuestionMarks<
  TEntries extends ObjectEntries | ObjectEntriesAsync,
  TObject extends InferEntriesInput<TEntries>,
> = MarkOptional<TObject, OptionalInputKeys<TEntries>>;

/**
 * Output with question marks type.
 */
type OutputWithQuestionMarks<
  TEntries extends ObjectEntries | ObjectEntriesAsync,
  TObject extends InferEntriesOutput<TEntries>,
> = MarkOptional<TObject, OptionalOutputKeys<TEntries>>;

/** Identify a declared readonly pipeline action for type inference; the action does not freeze values. */
type ReadonlyOutputKeys<TEntries extends ObjectEntries | ObjectEntriesAsync> = {
  [TKey in keyof TEntries]: TEntries[TKey] extends
    | SchemaWithPipe<infer TPipe>
    | SchemaWithPipeAsync<infer TPipe>
    ? ReadonlyAction<any> extends TPipe[number]
      ? TKey
      : never
    : never;
}[keyof TEntries];

/** Apply declared readonly field modifiers to output inference without runtime mutation protection. */
type OutputWithReadonly<
  TEntries extends ObjectEntries | ObjectEntriesAsync,
  TObject extends OutputWithQuestionMarks<
    TEntries,
    InferEntriesOutput<TEntries>
  >,
> = Readonly<TObject> &
  Pick<TObject, Exclude<keyof TObject, ReadonlyOutputKeys<TEntries>>>;

/** Infer accepted object fields and optional keys from declared child schemas. */
export type InferObjectInput<
  TEntries extends ObjectEntries | ObjectEntriesAsync,
> = Prettify<InputWithQuestionMarks<TEntries, InferEntriesInput<TEntries>>>;

/** Infer transformed object fields with declared default/readonly modifiers, not runtime isolation. */
export type InferObjectOutput<
  TEntries extends ObjectEntries | ObjectEntriesAsync,
> = Prettify<
  OutputWithReadonly<
    TEntries,
    OutputWithQuestionMarks<TEntries, InferEntriesOutput<TEntries>>
  >
>;

/** Collect possible private child issue types across declared object keys. */
export type InferObjectIssue<
  TEntries extends ObjectEntries | ObjectEntriesAsync,
> = InferIssue<TEntries[keyof TEntries]>;
