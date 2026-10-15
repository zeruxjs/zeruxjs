import {
  array,
  boolean,
  check,
  email,
  integer,
  intersect,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  nonNullable,
  null_,
  nullable,
  nullish,
  number,
  object,
  optional,
  parse,
  parseAsync,
  pipe,
  safeParse,
  safeParseAsync,
  string,
  toLowerCase,
  transform,
  trim,
  union,
} from '../index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  Config,
  InferIssue,
  InferOutput,
} from '../types/index.js';
import { ValidationError } from './ValidationError.js';
import { ajvSafeParse } from './ajv.js';
import { toJsonSchema } from './jsonSchema.js';

type AnySchema =
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>;

type SafeParseLike<TSchema extends AnySchema> =
  | { readonly success: true; readonly data: InferOutput<TSchema> }
  | { readonly success: false; readonly error: ValidationError<TSchema> };

function applyPipe(schema: AnySchema, ...items: unknown[]): AnySchema {
  return pipe(
    schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
    ...(items as never[])
  ) as unknown as AnySchema;
}

function toValidationError<TSchema extends AnySchema>(
  result: ReturnType<typeof safeParse> | Awaited<ReturnType<typeof safeParseAsync>>
): ValidationError<TSchema> {
  return new ValidationError(result.issues as [InferIssue<TSchema>, ...InferIssue<TSchema>[]]);
}

export class ChainSchema<TSchema extends AnySchema> {
  public readonly schema: TSchema;

  constructor(schema: TSchema) {
    this.schema = schema;
  }

  unwrap(): TSchema {
    return this.schema;
  }

  parse(input: unknown, config?: Config<InferIssue<TSchema>>): InferOutput<TSchema> {
    return parse(this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, input, config as any) as InferOutput<TSchema>;
  }

  async parseAsync(input: unknown, config?: Config<InferIssue<TSchema>>): Promise<InferOutput<TSchema>> {
    if (this.schema.async) {
      return parseAsync(this.schema as BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>, input, config as any) as Promise<InferOutput<TSchema>>;
    }
    return this.parse(input, config);
  }

  safeParse(input: unknown, config?: Config<InferIssue<TSchema>>): SafeParseLike<TSchema> {
    const result = safeParse(this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, input, config as any);
    return result.success
      ? { success: true, data: result.output as InferOutput<TSchema> }
      : { success: false, error: toValidationError<TSchema>(result) };
  }

  async safeParseAsync(input: unknown, config?: Config<InferIssue<TSchema>>): Promise<SafeParseLike<TSchema>> {
    const result = this.schema.async
      ? await safeParseAsync(this.schema as BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>, input, config as any)
      : safeParse(this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, input, config as any);
    return result.success
      ? { success: true, data: result.output as InferOutput<TSchema> }
      : { success: false, error: toValidationError<TSchema>(result) };
  }

  optional(defaultValue?: unknown): ChainSchema<any> {
    return wrap(optional(this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, defaultValue as never));
  }

  nullable(defaultValue?: unknown): ChainSchema<any> {
    return wrap(nullable(this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, defaultValue as never));
  }

  nullish(defaultValue?: unknown): ChainSchema<any> {
    return wrap(nullish(this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, defaultValue as never));
  }

  array(messageOrActions?: unknown): ChainSchema<any> {
    return wrap(array(this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, messageOrActions as never));
  }

  or(other: ChainSchema<AnySchema> | AnySchema): ChainSchema<any> {
    return wrap(union([this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, unwrap(other) as BaseSchema<unknown, unknown, BaseIssue<unknown>>]));
  }

  and(other: ChainSchema<AnySchema> | AnySchema): ChainSchema<any> {
    return wrap(intersect([this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, unwrap(other) as BaseSchema<unknown, unknown, BaseIssue<unknown>>]));
  }

  refine(requirement: (input: InferOutput<TSchema>) => boolean, message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, check(requirement as (input: unknown) => boolean, message)));
  }

  transform<TOutput>(operation: (input: InferOutput<TSchema>) => TOutput): ChainSchema<any> {
    return wrap(applyPipe(this.schema, transform(operation as (input: unknown) => TOutput)));
  }

  pipe(...items: unknown[]): ChainSchema<any> {
    return wrap(applyPipe(this.schema, ...items));
  }

  nonNullable(message?: string): ChainSchema<any> {
    return wrap(nonNullable(this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, message));
  }

  toJSONSchema() {
    return toJsonSchema(this.schema);
  }

  ajvSafeParse(input: unknown) {
    return ajvSafeParse(this.schema, input);
  }
}

export class StringChainSchema<TSchema extends AnySchema> extends ChainSchema<TSchema> {
  min(length: number, message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, minLength(length, message) as any));
  }

  max(length: number, message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, maxLength(length, message) as any));
  }

  email(message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, email(message) as any));
  }

  trim(): ChainSchema<any> {
    return wrap(applyPipe(this.schema, trim() as any));
  }

  toLowerCase(): ChainSchema<any> {
    return wrap(applyPipe(this.schema, toLowerCase() as any));
  }
}

export class NumberChainSchema<TSchema extends AnySchema> extends ChainSchema<TSchema> {
  min(value: number, message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, minValue(value, message) as any));
  }

  max(value: number, message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, maxValue(value, message) as any));
  }

  int(message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, integer(message) as any));
  }
}

function unwrap(input: ChainSchema<AnySchema> | AnySchema): AnySchema {
  return input instanceof ChainSchema ? input.schema : input;
}

function wrap<TSchema extends AnySchema>(schema: TSchema): ChainSchema<any> {
  switch ((schema as unknown as Record<string, unknown>).type) {
    case 'string':
      return new StringChainSchema(schema);
    case 'number':
      return new NumberChainSchema(schema);
    default:
      return new ChainSchema(schema);
  }
}

export const z = {
  string: () => new StringChainSchema(string()),
  number: () => new NumberChainSchema(number()),
  boolean: () => new ChainSchema(boolean()),
  literal: <TLiteral extends string | number | boolean | null>(value: TLiteral) => new ChainSchema(literal(value as never)),
  object: <TEntries extends Record<string, AnySchema | ChainSchema<AnySchema>>>(entries: TEntries) =>
    new ChainSchema(
      object(
        Object.fromEntries(
          Object.entries(entries).map(([key, value]) => [key, unwrap(value as AnySchema | ChainSchema<AnySchema>)])
        ) as Record<string, BaseSchema<unknown, unknown, BaseIssue<unknown>>>
      )
    ),
  array: (item: ChainSchema<AnySchema> | AnySchema) => new ChainSchema(array(unwrap(item) as BaseSchema<unknown, unknown, BaseIssue<unknown>>)),
  union: (options: Array<ChainSchema<AnySchema> | AnySchema>) =>
    new ChainSchema(union(options.map((option) => unwrap(option) as BaseSchema<unknown, unknown, BaseIssue<unknown>>))),
  nullable: (input: ChainSchema<AnySchema> | AnySchema) =>
    wrap(nullable(unwrap(input) as BaseSchema<unknown, unknown, BaseIssue<unknown>>)),
  optional: (input: ChainSchema<AnySchema> | AnySchema) =>
    wrap(optional(unwrap(input) as BaseSchema<unknown, unknown, BaseIssue<unknown>>)),
  nullish: (input: ChainSchema<AnySchema> | AnySchema) =>
    wrap(nullish(unwrap(input) as BaseSchema<unknown, unknown, BaseIssue<unknown>>)),
  from: <TSchema extends AnySchema>(schema: TSchema) => wrap(schema),
};

export function chain<TSchema extends AnySchema>(schema: TSchema): ChainSchema<any> {
  return wrap(schema);
}
