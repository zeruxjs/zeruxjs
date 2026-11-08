import { syncValue, AsyncValidationError } from '../utils/_run.js';
import type {
  ExactOptionalSchema,
  ExactOptionalSchemaAsync,
  NullableSchema,
  NullableSchemaAsync,
  NullishSchema,
  NullishSchemaAsync,
  OptionalSchema,
  OptionalSchemaAsync,
  UndefinedableSchema,
  UndefinedableSchemaAsync,
} from '../schemas/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  Config,
  InferIssue,
  UnknownDataset,
} from '../types/index.js';

/**
 * Schema with default type.
 */
type SchemaWithDefault =
  | ExactOptionalSchema<
    BaseSchema<unknown, unknown, BaseIssue<unknown>>,
    unknown
  >
  | NullableSchema<BaseSchema<unknown, unknown, BaseIssue<unknown>>, unknown>
  | NullishSchema<BaseSchema<unknown, unknown, BaseIssue<unknown>>, unknown>
  | OptionalSchema<BaseSchema<unknown, unknown, BaseIssue<unknown>>, unknown>
  | UndefinedableSchema<
    BaseSchema<unknown, unknown, BaseIssue<unknown>>,
    unknown
  >;

/**
 * Schema with default async type.
 */
type SchemaWithDefaultAsync =
  | ExactOptionalSchemaAsync<
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
    unknown
  >
  | NullableSchemaAsync<
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
  >
  | UndefinedableSchemaAsync<
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
    unknown
  >;

/**
 * Infer default type.
 */
export type InferDefault<
  TSchema extends
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | SchemaWithDefault
  | SchemaWithDefaultAsync,
> = TSchema extends SchemaWithDefault | SchemaWithDefaultAsync
  ?  
  TSchema['default'] extends (...args: any) => any
  ? ReturnType<TSchema['default']>
  : TSchema['default']
  : undefined;

/**
 * Returns the default value of the schema.
 *
 * @param schema The schema to get it from.
 * @param dataset The input dataset if available.
 * @param config The config if available.
 *
 * @returns The default value.
 */
// @__NO_SIDE_EFFECTS__
export function getDefault<
  const TSchema extends
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(
  schema: TSchema,
  dataset?: UnknownDataset,
  config?: Config<InferIssue<TSchema>>
): InferDefault<TSchema> {
  if (!schema.async && 'default' in schema && typeof schema.default === 'function' && schema.default.constructor.name === 'AsyncFunction') throw new AsyncValidationError();
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  return typeof schema.default === 'function'
    ? // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
    (schema.async ? schema.default(dataset, config) : syncValue(schema.default(dataset, config)))
    : // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
    schema.default;
}
