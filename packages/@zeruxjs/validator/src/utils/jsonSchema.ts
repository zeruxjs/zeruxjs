import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
} from '../types/index.js';

export type JsonSchema = Record<string, unknown>;

export interface ToJsonSchemaOptions {
  readonly strict?: boolean | undefined;
}

function fail(message: string, options?: ToJsonSchemaOptions): never | JsonSchema {
  if (options?.strict) {
    throw new Error(message);
  }
  return {};
}

function cloneSchema(schema: JsonSchema): JsonSchema {
  return JSON.parse(JSON.stringify(schema)) as JsonSchema;
}

function applyPipeItem(
  schema: JsonSchema,
  item: { kind?: string; type?: string; requirement?: unknown; options?: unknown[] },
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
  | { schema: BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>> };

function unwrapSchema(input: AnySchema) {
  return 'schema' in input ? input.schema : input;
}

export function toJsonSchema(
  input: AnySchema,
  options?: ToJsonSchemaOptions
): JsonSchema {
  const schema = unwrapSchema(input) as Record<string, any>;

  if ('pipe' in schema && Array.isArray(schema.pipe)) {
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
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(schema.entries)) {
        properties[key] = toJsonSchema(value as AnySchema, options);
        if (!['optional', 'exact_optional', 'nullish'].includes((value as Record<string, any>).type)) {
          required.push(key);
        }
      }

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
      const jsonSchema = toJsonSchema({ ...schema, type: 'object' } as AnySchema, options);
      delete jsonSchema.additionalProperties;
      return jsonSchema;
    }
    case 'strict_object': {
      const jsonSchema = toJsonSchema({ ...schema, type: 'object' } as AnySchema, options);
      jsonSchema.additionalProperties = false;
      return jsonSchema;
    }
    case 'optional':
    case 'undefinedable':
      return toJsonSchema(schema.wrapped as AnySchema, options);
    case 'nullable': {
      const wrapped = cloneSchema(toJsonSchema(schema.wrapped as AnySchema, options));
      return { anyOf: [wrapped, { type: 'null' }] };
    }
    case 'nullish': {
      const wrapped = cloneSchema(toJsonSchema(schema.wrapped as AnySchema, options));
      return { anyOf: [wrapped, { type: 'null' }] };
    }
    case 'non_nullable':
    case 'non_nullish':
    case 'non_optional':
      return toJsonSchema(schema.wrapped as AnySchema, options);
    case 'union':
      return {
        anyOf: schema.options.map((option: AnySchema) => toJsonSchema(option, options)),
      };
    default:
      return fail(`JSON Schema conversion is not implemented for schema type "${schema.type}".`, options);
  }
}
