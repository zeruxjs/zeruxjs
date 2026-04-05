import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
} from '../types/index.js';
import { ValidationError } from './ValidationError.js';
import { toJsonSchema, type JsonSchema, type ToJsonSchemaOptions } from './jsonSchema.js';

export interface AjvIssue {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Record<string, unknown>;
}

export interface AjvSafeParseSuccess<TData> {
  readonly success: true;
  readonly data: TData;
  readonly schema: JsonSchema;
}

export interface AjvSafeParseFailure {
  readonly success: false;
  readonly error: ValidationError<any>;
  readonly issues: AjvIssue[];
  readonly schema: JsonSchema;
}

type AjvSafeParseResult<TData> = AjvSafeParseSuccess<TData> | AjvSafeParseFailure;

function pointer(path: Array<string | number>) {
  return path.length ? `/${path.join('/')}` : '';
}

function emailLike(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function validateJsonSchema(
  schema: JsonSchema,
  input: unknown,
  path: Array<string | number> = []
): AjvIssue[] {
  const issues: AjvIssue[] = [];

  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.some((option) => validateJsonSchema(option as JsonSchema, input, path).length === 0);
    if (!matches) {
      issues.push({
        instancePath: pointer(path),
        keyword: 'anyOf',
        message: 'must match at least one allowed schema',
        params: {},
      });
    }
    return issues;
  }

  if ('const' in schema && input !== schema.const) {
    issues.push({
      instancePath: pointer(path),
      keyword: 'const',
      message: 'must be equal to the allowed constant',
      params: { allowedValue: schema.const },
    });
    return issues;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(input)) {
    issues.push({
      instancePath: pointer(path),
      keyword: 'enum',
      message: 'must be equal to one of the allowed values',
      params: { allowedValues: schema.enum },
    });
    return issues;
  }

  switch (schema.type) {
    case 'string':
      if (typeof input !== 'string') {
        issues.push({
          instancePath: pointer(path),
          keyword: 'type',
          message: 'must be string',
          params: { type: 'string' },
        });
        return issues;
      }
      if (typeof schema.minLength === 'number' && input.length < schema.minLength) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'minLength',
          message: `must NOT have fewer than ${schema.minLength} characters`,
          params: { limit: schema.minLength },
        });
      }
      if (typeof schema.maxLength === 'number' && input.length > schema.maxLength) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'maxLength',
          message: `must NOT have more than ${schema.maxLength} characters`,
          params: { limit: schema.maxLength },
        });
      }
      if (schema.format === 'email' && !emailLike(input)) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'format',
          message: 'must match format "email"',
          params: { format: 'email' },
        });
      }
      return issues;
    case 'number':
    case 'integer':
      if (typeof input !== 'number' || Number.isNaN(input)) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'type',
          message: `must be ${schema.type}`,
          params: { type: schema.type },
        });
        return issues;
      }
      if (schema.type === 'integer' && !Number.isInteger(input)) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'type',
          message: 'must be integer',
          params: { type: 'integer' },
        });
      }
      if (typeof schema.minimum === 'number' && input < schema.minimum) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'minimum',
          message: `must be >= ${schema.minimum}`,
          params: { limit: schema.minimum },
        });
      }
      if (typeof schema.maximum === 'number' && input > schema.maximum) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'maximum',
          message: `must be <= ${schema.maximum}`,
          params: { limit: schema.maximum },
        });
      }
      return issues;
    case 'boolean':
      if (typeof input !== 'boolean') {
        issues.push({
          instancePath: pointer(path),
          keyword: 'type',
          message: 'must be boolean',
          params: { type: 'boolean' },
        });
      }
      return issues;
    case 'null':
      if (input !== null) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'type',
          message: 'must be null',
          params: { type: 'null' },
        });
      }
      return issues;
    case 'array':
      if (!Array.isArray(input)) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'type',
          message: 'must be array',
          params: { type: 'array' },
        });
        return issues;
      }
      if (schema.items) {
        input.forEach((item, index) => {
          issues.push(...validateJsonSchema(schema.items as JsonSchema, item, [...path, index]));
        });
      }
      return issues;
    case 'object': {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'type',
          message: 'must be object',
          params: { type: 'object' },
        });
        return issues;
      }

      const objectInput = input as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];

      for (const key of required) {
        if (!(key in objectInput)) {
          issues.push({
            instancePath: pointer(path),
            keyword: 'required',
            message: `must have required property '${key}'`,
            params: { missingProperty: key },
          });
        }
      }

      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in objectInput) {
          issues.push(...validateJsonSchema(childSchema, objectInput[key], [...path, key]));
        }
      }

      if (schema.additionalProperties === false) {
        for (const key of Object.keys(objectInput)) {
          if (!(key in properties)) {
            issues.push({
              instancePath: pointer([...path, key]),
              keyword: 'additionalProperties',
              message: 'must NOT have additional properties',
              params: { additionalProperty: key },
            });
          }
        }
      }

      return issues;
    }
    default:
      return issues;
  }
}

function toValidationError(issues: AjvIssue[]): ValidationError<any> {
  const normalized = issues.map((issue) => ({
    kind: 'validation' as const,
    type: `ajv_${issue.keyword}`,
    input: issue.instancePath,
    expected: null,
    received: issue.instancePath || '<root>',
    message: issue.message,
    requirement: issue.params,
    path: issue.instancePath
      ? issue.instancePath
          .split('/')
          .filter(Boolean)
          .map((segment) => ({
            type: 'unknown' as const,
            origin: 'value' as const,
            input: undefined,
            key: /^\d+$/.test(segment) ? Number(segment) : segment,
            value: undefined,
          }))
      : undefined,
    issues: undefined,
  })) as [any, ...any[]];

  return new ValidationError(normalized);
}

export async function ajvSafeParse<TData = unknown>(
  schema:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
    | { schema: BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>> },
  input: unknown,
  options?: ToJsonSchemaOptions
): Promise<AjvSafeParseResult<TData>> {
  const jsonSchema = toJsonSchema(schema as any, options);
  const issues = validateJsonSchema(jsonSchema, input);

  if (issues.length === 0) {
    return { success: true, data: input as TData, schema: jsonSchema };
  }

  return {
    success: false,
    issues,
    error: toValidationError(issues),
    schema: jsonSchema,
  };
}
