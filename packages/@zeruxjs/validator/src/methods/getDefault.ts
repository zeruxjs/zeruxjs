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
  ? TSchema['default'] extends (...args: any) => any
    ? ReturnType<TSchema['default']>
    : TSchema['default']
  : undefined;

/**
 * Read a declared default literal or invoke its trusted factory. Synchronous wrappers reject native async factories before invocation and thenable results after return; wrapper code owns sentinel handling and revalidation.
 *
 * @param {TSchema} schema - Trusted declared wrapper; default factories are application code, not source text.
 * @param {UnknownDataset} dataset - Optional current private input dataset passed to the factory.
 * @param {Config<InferIssue<TSchema>>} config - Optional current root budgets/signal; factories own additional work they create.
 *
 * @returns {InferDefault<TSchema>} Borrowed literal or actual factory result; this helper does not deep-clone or revalidate it.
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
  if (
    !schema.async &&
    'default' in schema &&
    typeof schema.default === 'function' &&
    schema.default.constructor.name === 'AsyncFunction'
  ) {
    throw new AsyncValidationError();
  }
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  if (typeof schema.default === 'function') {
    if (schema.async) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return schema.default(dataset, config);
    }
    // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
    return syncValue(schema.default(dataset, config));
  }
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  return schema.default;
}
