import type { BaseIssue, BaseSchema, BaseSchemaAsync } from '../types/index.js';
import { ValidationError } from './ValidationError.js';
import {
  toJsonSchema,
  type JsonSchema,
  type ToJsonSchemaOptions,
} from './jsonSchema.js';

export interface AjvIssue {
  /** Private legacy slash-joined path label; keys are not escaped as JSON Pointer segments. */
  readonly instancePath: string;
  /** Local supported-check discriminator, not a vendor feature/conformance assertion. */
  readonly keyword: string;
  /** Private diagnostic text; do not return it without a host redaction policy. */
  readonly message: string;
  /** Private rule parameters, which may retain allowed values or submitted key labels. */
  readonly params: Record<string, unknown>;
}

export interface AjvSafeParseSuccess<TData> {
  /** Ordinary local compatibility outcome; conversion/native dependency failures still throw/reject. */
  readonly success: true;
  /** Original borrowed input asserted as TData, without functional transforms or deep validation guarantees. */
  readonly data: TData;
  /** Generated local subset for inspection; no remote schema reference is fetched. */
  readonly schema: JsonSchema;
}

export interface AjvSafeParseFailure {
  /** Ordinary local compatibility outcome; conversion/native dependency failures still throw/reject. */
  readonly success: false;
  /** Private ValidationError wrapper; not a sanitized HTTP response. */
  readonly error: ValidationError<any>;
  /** Private compatibility issues; no implicit issue-count or payload redaction budget. */
  readonly issues: AjvIssue[];
  /** Generated local subset for inspection; no remote schema reference is fetched. */
  readonly schema: JsonSchema;
}

type AjvSafeParseResult<TData> =
  | AjvSafeParseSuccess<TData>
  | AjvSafeParseFailure;

/** Build a legacy slash-joined private diagnostic label without JSON Pointer segment escaping.
 * @param {Array<string | number>} path - Private current diagnostic segments; labels may contain submitted keys and are not routing addresses.
 * @returns {string} Unescaped private slash label or the empty root label.
 */
function pointer(path: Array<string | number>) {
  return path.length ? `/${path.join('/')}` : '';
}

/** Check the local email-format compatibility subset using simple separator/whitespace checks; no mailbox/DNS verification occurs.
 * @param {string} value - Private string candidate, never sent to a provider.
 * @returns {boolean} Whether this limited local spelling check accepts the string.
 */
function emailLike(value: string) {
  /** First at-sign position for the retained local email separator check. */
  const at = value.indexOf('@');
  /** Last dot position for the retained local email separator check. */
  const dot = value.lastIndexOf('.');
  return (
    at > 0 &&
    at === value.lastIndexOf('@') &&
    dot > at + 1 &&
    dot < value.length - 1 &&
    !/\s/u.test(value)
  );
}

/** Run the limited local JSON Schema checker, not the AJV engine. Unknown keywords are ignored, object presence uses in, and no independent depth/node/issue budget or cancellation is imposed.
 * @param {JsonSchema} schema - Borrowed trusted declared/generated schema; no untrusted remote schema loading occurs.
 * @param {unknown} input - Private candidate data or explicit chain/schema wrapper; caller owns independent size/authorization policy.
 * @param {Array<string | number>} path - Private current diagnostic segments; labels may contain submitted keys and are not routing addresses.
 * @returns {AjvIssue[]} Private ordinary mismatches; ignored keywords never become proof of complete validation.
 */
function validateJsonSchema(
  schema: JsonSchema,
  input: unknown,
  path: Array<string | number> = []
): AjvIssue[] {
  /** Local private mismatch accumulator; not independently bounded by the functional root parser. */
  const issues: AjvIssue[] = [];

  if (Array.isArray(schema.anyOf)) {
    /** Whether any local anyOf branch reports no supported-subset issues; unsupported keywords remain ignored. */
    const matches = schema.anyOf.some(
      (option) =>
        validateJsonSchema(option as JsonSchema, input, path).length === 0
    );
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
      if (
        typeof schema.minLength === 'number' &&
        input.length < schema.minLength
      ) {
        issues.push({
          instancePath: pointer(path),
          keyword: 'minLength',
          message: `must NOT have fewer than ${schema.minLength} characters`,
          params: { limit: schema.minLength },
        });
      }
      if (
        typeof schema.maxLength === 'number' &&
        input.length > schema.maxLength
      ) {
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
          issues.push(
            ...validateJsonSchema(schema.items as JsonSchema, item, [
              ...path,
              index,
            ])
          );
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

      /** Borrowed native object candidate; the retained compatibility checker uses in rather than functional own-field semantics. */
      const objectInput = input as Record<string, unknown>;
      /** Borrowed generated property schemas, or a fresh empty dictionary when absent. */
      const properties = (schema.properties ?? {}) as Record<
        string,
        JsonSchema
      >;
      /** Generated required-key list; runtime presence uses legacy in semantics. */
      const required = Array.isArray(schema.required)
        ? (schema.required as string[])
        : [];

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
          issues.push(
            ...validateJsonSchema(childSchema, objectInput[key], [...path, key])
          );
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

/** Wrap local compatibility issues in the package private ValidationError representation; slash labels are split without a lossless pointer codec.
 * @param {AjvIssue[]} issues - Private structured compatibility issues retaining policy/path values.
 * @returns {ValidationError<any>} Declared local compatibility result; native/configuration failures propagate and no authorization is implied.
 */
function toValidationError(issues: AjvIssue[]): ValidationError<any> {
  /** Private wrapper records derived from compatibility issues; no submitted body is included intentionally but labels/policy values remain private. */
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

/** Convert then check the local subset without executing the original schema or transforms; TData is a caller assertion and successful data preserves the original input reference.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>> | { schema: BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>; }} schema - Borrowed trusted declared/generated schema; no untrusted remote schema loading occurs.
 * @param {unknown} input - Private candidate data or explicit chain/schema wrapper; caller owns independent size/authorization policy.
 * @param {ToJsonSchemaOptions} options - Optional strict converter policy; this does not make ignored keywords/transformations fully supported.
 * @returns {Promise<AjvSafeParseResult<TData>>} Declared local compatibility result; native/configuration failures propagate and no authorization is implied.
 */
export async function ajvSafeParse<TData = unknown>(
  schema:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
    | {
        /** Generated local subset for inspection; no remote schema reference is fetched. */
        schema:
          | BaseSchema<unknown, unknown, BaseIssue<unknown>>
          | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>;
      },
  input: unknown,
  options?: ToJsonSchemaOptions
): Promise<AjvSafeParseResult<TData>> {
  /** Generated local schema subset, not an external AJV compilation or complete validation capability. */
  const jsonSchema = toJsonSchema(schema as any, options);
  /** Local private mismatch accumulator; not independently bounded by the functional root parser. */
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
