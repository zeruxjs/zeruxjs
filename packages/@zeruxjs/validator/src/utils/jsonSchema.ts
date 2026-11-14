import type { BaseIssue, BaseSchema, BaseSchemaAsync } from '../types/index.js';

export type JsonSchema = Record<string, unknown>;

export interface ToJsonSchemaOptions {
  /** If true, throw only for explicitly unsupported converter branches; unknown refinements/transforms can still be ignored. */
  readonly strict?: boolean | undefined;
}

/** Handle an unsupported converter branch using the legacy permissive-empty or explicitly strict throwing policy.
 * @param {string} message - Private unsupported-branch diagnostic; not safe public error text.
 * @param {ToJsonSchemaOptions} options - Optional strict converter policy; this does not make ignored keywords/transformations fully supported.
 * @returns {never | JsonSchema} Declared local compatibility result; native/configuration failures propagate and no authorization is implied.
 */
function fail(
  message: string,
  options?: ToJsonSchemaOptions
): never | JsonSchema {
  if (options?.strict) {
    throw new Error(message);
  }
  return {};
}

/** Copy a generated JSON-compatible schema through native JSON serialization; getters/toJSON and serialization failures remain trusted host behavior.
 * @param {JsonSchema} schema - Borrowed trusted declared/generated schema; no untrusted remote schema loading occurs.
 * @returns {JsonSchema} Declared local compatibility result; native/configuration failures propagate and no authorization is implied.
 */
function cloneSchema(schema: JsonSchema): JsonSchema {
  return JSON.parse(JSON.stringify(schema)) as JsonSchema;
}

/** Apply only the implemented JSON Schema refinement subset; unrepresented transformations/unknown refinements remain ignored even when strict is selected.
 * @param {JsonSchema} schema - Borrowed trusted declared/generated schema; no untrusted remote schema loading occurs.
 * @param {{ kind?: string; type?: string; requirement?: unknown; options?: unknown[]; }} item - Explicit trusted pipeline descriptor; no source string is evaluated or imported.
 * @param {string} item.kind - Optional declared descriptor kind; trusted metadata, not source code.
 * @param {string} item.type - Optional declared descriptor type; trusted metadata, not source code.
 * @param {unknown} item.requirement - Optional declared descriptor requirement; trusted metadata, not source code.
 * @param {unknown[]} item.options - Optional declared descriptor options; trusted metadata, not source code.
 * @param {ToJsonSchemaOptions} options - Optional strict converter policy; this does not make ignored keywords/transformations fully supported.
 * @returns {JsonSchema} Declared local compatibility result; native/configuration failures propagate and no authorization is implied.
 */
function applyPipeItem(
  schema: JsonSchema,
  item: {
    kind?: string;
    type?: string;
    requirement?: unknown;
    options?: unknown[];
  },
  options?: ToJsonSchemaOptions
): JsonSchema {
  if (item.kind === 'schema') {
    return toJsonSchema(item as AnySchema, options);
  }

  if (item.kind !== 'validation') {
    return schema;
  }

  switch (item.type) {
    case 'min_length':
      schema.minLength = item.requirement;
      return schema;
    case 'max_length':
      schema.maxLength = item.requirement;
      return schema;
    case 'email':
      schema.format = 'email';
      return schema;
    case 'min_value':
      schema.minimum = item.requirement;
      return schema;
    case 'max_value':
      schema.maximum = item.requirement;
      return schema;
    case 'integer':
      schema.type = 'integer';
      return schema;
    case 'check':
    case 'raw_check':
      return fail(
        `Cannot express validation "${item.type}" as JSON Schema without a custom keyword.`,
        options
      );
    default:
      return schema;
  }
}

type AnySchema =
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | {
      /** Generated local subset for inspection; no remote schema reference is fetched. */
      schema:
        | BaseSchema<unknown, unknown, BaseIssue<unknown>>
        | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>;
    };

/** Read a borrowed explicit schema or chain wrapper without parsing input or invoking a validator.
 * @param {AnySchema} input - Private candidate data or explicit chain/schema wrapper; caller owns independent size/authorization policy.
 * @returns {BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>} Declared local compatibility result; native/configuration failures propagate and no authorization is implied.
 */
function unwrapSchema(input: AnySchema) {
  return 'schema' in input ? input.schema : input;
}

/** Convert the documented local subset without executing validation callbacks. This recursive converter is not a complete JSON Schema implementation or a standalone cycle/work budget.
 * @param {AnySchema} input - Private candidate data or explicit chain/schema wrapper; caller owns independent size/authorization policy.
 * @param {ToJsonSchemaOptions} options - Optional strict converter policy; this does not make ignored keywords/transformations fully supported.
 * @returns {JsonSchema} Declared local compatibility result; native/configuration failures propagate and no authorization is implied.
 */
export function toJsonSchema(
  input: AnySchema,
  options?: ToJsonSchemaOptions
): JsonSchema {
  /** Borrowed underlying runtime descriptor read for explicit subset conversion. */
  const schema = unwrapSchema(input) as Record<string, any>;

  if ('pipe' in schema && Array.isArray(schema.pipe)) {
    /** Borrowed pipeline root and remaining descriptors; conversion neither executes them nor certifies full representation. */
    const [root, ...rest] = schema.pipe as Array<Record<string, any>>;
    let jsonSchema = toJsonSchema(root as AnySchema, options);
    for (const item of rest) {
      jsonSchema = applyPipeItem(jsonSchema, item, options);
    }
    return jsonSchema;
  }

  switch (schema.type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'bigint':
      return { type: 'integer' };
    case 'null':
      return { type: 'null' };
    case 'literal':
      return { const: schema.literal };
    case 'picklist':
      return { enum: [...schema.options] };
    case 'enum':
      return { enum: Object.values(schema.enum) };
    case 'array':
      return {
        type: 'array',
        items: toJsonSchema(schema.item as AnySchema, options),
      };
    case 'object': {
      /** Borrowed generated property schemas, or a fresh empty dictionary when absent. */
      const properties: Record<string, unknown> = {};
      /** Generated required-key list; runtime presence uses legacy in semantics. */
      const required: string[] = [];

      for (const [key, value] of Object.entries(schema.entries)) {
        properties[key] = toJsonSchema(value as AnySchema, options);
        if (
          !['optional', 'exact_optional', 'nullish'].includes(
            (value as Record<string, any>).type
          )
        ) {
          required.push(key);
        }
      }

      /** Generated local schema subset, not an external AJV compilation or complete validation capability. */
      const jsonSchema: JsonSchema = {
        type: 'object',
        properties,
        additionalProperties: false,
      };

      if (required.length) {
        jsonSchema.required = required;
      }

      return jsonSchema;
    }
    case 'loose_object': {
      /** Generated local schema subset, not an external AJV compilation or complete validation capability. */
      const jsonSchema = toJsonSchema(
        { ...schema, type: 'object' } as AnySchema,
        options
      );
      delete jsonSchema.additionalProperties;
      return jsonSchema;
    }
    case 'strict_object': {
      /** Generated local schema subset, not an external AJV compilation or complete validation capability. */
      const jsonSchema = toJsonSchema(
        { ...schema, type: 'object' } as AnySchema,
        options
      );
      jsonSchema.additionalProperties = false;
      return jsonSchema;
    }
    case 'optional':
    case 'undefinedable':
      return toJsonSchema(schema.wrapped as AnySchema, options);
    case 'nullable': {
      /** Fresh native JSON clone of the converted child schema; serialization failures propagate. */
      const wrapped = cloneSchema(
        toJsonSchema(schema.wrapped as AnySchema, options)
      );
      return { anyOf: [wrapped, { type: 'null' }] };
    }
    case 'nullish': {
      /** Fresh native JSON clone of the converted child schema; serialization failures propagate. */
      const wrapped = cloneSchema(
        toJsonSchema(schema.wrapped as AnySchema, options)
      );
      return { anyOf: [wrapped, { type: 'null' }] };
    }
    case 'non_nullable':
    case 'non_nullish':
    case 'non_optional':
      return toJsonSchema(schema.wrapped as AnySchema, options);
    case 'union':
      return {
        anyOf: schema.options.map((option: AnySchema) =>
          toJsonSchema(option, options)
        ),
      };
    default:
      return fail(
        `JSON Schema conversion is not implemented for schema type "${schema.type}".`,
        options
      );
  }
}
