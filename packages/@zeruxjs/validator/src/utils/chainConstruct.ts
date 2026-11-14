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
} from '../core.js';
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
  | {
      /** Ordinary functional validation success discriminator; operational failures still throw/reject. */
      readonly success: true; /** Private declared parsed output on success, preserving child identity semantics. */
      readonly data: InferOutput<TSchema>;
    }
  | {
      /** Ordinary functional validation success discriminator; operational failures still throw/reject. */
      readonly success: false; /** Private ValidationError for ordinary issues; not a sanitized HTTP response. */
      readonly error: ValidationError<TSchema>;
    };

/** Bridge the legacy broad fluent arguments to synchronous functional pipe; this does not make unknown items safe or async.
 * @param {AnySchema} schema - Borrowed explicit functional schema; caller mutation and runtime validation ownership remain unchanged.
 * @param {unknown[]} items - Explicit trusted pipeline descriptors; broad fluent typing is not runtime validation of arbitrary descriptors.
 * @returns {AnySchema} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
 */
function applyPipe(schema: AnySchema, ...items: unknown[]): AnySchema {
  return pipe(
    schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
    ...(items as never[])
  ) as unknown as AnySchema;
}

/** Create a private ValidationError from ordinary functional issues; do not expose its input/message/cause data publicly.
 * @param {ReturnType<typeof safeParse> | Awaited<ReturnType<typeof safeParseAsync>>} result - Private ordinary safe-parse result whose issues are wrapped without redaction.
 * @returns {ValidationError<TSchema>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
 */
function toValidationError<TSchema extends AnySchema>(
  result:
    | ReturnType<typeof safeParse>
    | Awaited<ReturnType<typeof safeParseAsync>>
): ValidationError<TSchema> {
  return new ValidationError(
    result.issues as [InferIssue<TSchema>, ...InferIssue<TSchema>[]]
  );
}

/** Legacy fluent consumer of borrowed functional schemas. Methods deliberately retain broad compatibility types; this is not complete Zod parity and owns no external resources. */
export class ChainSchema<TSchema extends AnySchema> {
  /** Borrowed functional schema; readonly protects the reference only at type level and no deep freeze is applied. */
  public readonly schema: TSchema;

  /** Capture a borrowed functional schema in the legacy fluent convenience wrapper; construction does not parse input.
   * @param {TSchema} schema - Borrowed explicit functional schema; caller mutation and runtime validation ownership remain unchanged.
   */
  constructor(schema: TSchema) {
    this.schema = schema;
  }

  /** Return the borrowed functional schema without parsing, cloning or authorization.
   * @returns {TSchema} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  unwrap(): TSchema {
    return this.schema;
  }

  /** Run the functional synchronous root parser; issues/operational failures throw and no HTTP/public redaction is implied.
   * @param {unknown} input - Private candidate or explicit borrowed wrapper/schema; never a module name or source expression.
   * @param {Config<InferIssue<TSchema>>} config - Optional per-call root controls; synchronous and asynchronous execution retain their existing selection rules.
   * @returns {InferOutput<TSchema>} Declared functional output after root cleanup; failures retain the original private error semantics.
   */
  parse(
    input: unknown,
    config?: Config<InferIssue<TSchema>>
  ): InferOutput<TSchema> {
    return parse(
      this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      input,
      config as any
    ) as InferOutput<TSchema>;
  }

  /** Use the asynchronous root only when the schema is explicitly async; synchronous schemas retain synchronous root execution despite the Promise return.
   * @param {unknown} input - Private candidate or explicit borrowed wrapper/schema; never a module name or source expression.
   * @param {Config<InferIssue<TSchema>>} config - Optional per-call root controls; synchronous and asynchronous execution retain their existing selection rules.
   * @returns {Promise<InferOutput<TSchema>>} Declared functional output after root cleanup; failures retain the original private error semantics.
   */
  async parseAsync(
    input: unknown,
    config?: Config<InferIssue<TSchema>>
  ): Promise<InferOutput<TSchema>> {
    if (this.schema.async) {
      return parseAsync(
        this.schema as BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
        input,
        config as any
      ) as Promise<InferOutput<TSchema>>;
    }
    return this.parse(input, config);
  }

  /** Map ordinary functional parse results into the legacy data/error shape; budget/cancellation/dependency failures still throw.
   * @param {unknown} input - Private candidate or explicit borrowed wrapper/schema; never a module name or source expression.
   * @param {Config<InferIssue<TSchema>>} config - Optional per-call root controls; synchronous and asynchronous execution retain their existing selection rules.
   * @returns {SafeParseLike<TSchema>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  safeParse(
    input: unknown,
    config?: Config<InferIssue<TSchema>>
  ): SafeParseLike<TSchema> {
    /** Private ordinary parse result mapped to the retained legacy data/error shape; throws are not converted here. */
    const result = safeParse(
      this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      input,
      config as any
    );
    return result.success
      ? { success: true, data: result.output as InferOutput<TSchema> }
      : { success: false, error: toValidationError<TSchema>(result) };
  }

  /** Map the selected sync/async functional parse result into the legacy data/error shape; this is not a durable job or retry policy.
   * @param {unknown} input - Private candidate or explicit borrowed wrapper/schema; never a module name or source expression.
   * @param {Config<InferIssue<TSchema>>} config - Optional per-call root controls; synchronous and asynchronous execution retain their existing selection rules.
   * @returns {Promise<SafeParseLike<TSchema>>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  async safeParseAsync(
    input: unknown,
    config?: Config<InferIssue<TSchema>>
  ): Promise<SafeParseLike<TSchema>> {
    /** Private ordinary parse result mapped to the retained legacy data/error shape; throws are not converted here. */
    const result = this.schema.async
      ? await safeParseAsync(
          this.schema as BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
          input,
          config as any
        )
      : safeParse(
          this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
          input,
          config as any
        );
    return result.success
      ? { success: true, data: result.output as InferOutput<TSchema> }
      : { success: false, error: toValidationError<TSchema>(result) };
  }

  /** Create the existing synchronous optional wrapper with broad fluent typing; no asynchronous default support is inferred.
   * @param {unknown} defaultValue - Borrowed literal or trusted default factory; typed sentinel/default semantics remain child-schema-owned.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  optional(defaultValue?: unknown): ChainSchema<any> {
    return wrap(
      optional(
        this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        defaultValue as never
      )
    );
  }

  /** Create the existing synchronous nullable wrapper while retaining borrowed child/default references.
   * @param {unknown} defaultValue - Borrowed literal or trusted default factory; typed sentinel/default semantics remain child-schema-owned.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  nullable(defaultValue?: unknown): ChainSchema<any> {
    return wrap(
      nullable(
        this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        defaultValue as never
      )
    );
  }

  /** Create the existing synchronous nullish wrapper; use functional APIs when precise async/input/output inference is required.
   * @param {unknown} defaultValue - Borrowed literal or trusted default factory; typed sentinel/default semantics remain child-schema-owned.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  nullish(defaultValue?: unknown): ChainSchema<any> {
    return wrap(
      nullish(
        this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        defaultValue as never
      )
    );
  }

  /** Wrap the schema in the retained synchronous array convenience constructor; this is not full shorthand/framework parity.
   * @param {unknown} messageOrActions - Legacy constructor message/action-array argument; no unrestricted string evaluation occurs.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  array(messageOrActions?: unknown): ChainSchema<any> {
    return wrap(
      array(
        this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        messageOrActions as never
      )
    );
  }

  /** Construct a retained synchronous ordered union of explicit borrowed schemas/wrappers.
   * @param {ChainSchema<AnySchema> | AnySchema} other - Explicit borrowed schema or legacy wrapper, never resolved from untrusted package metadata.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  or(other: ChainSchema<AnySchema> | AnySchema): ChainSchema<any> {
    return wrap(
      union([
        this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        unwrap(other) as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      ])
    );
  }

  /** Construct a retained synchronous intersection; compatible output merging can mutate the first branch result.
   * @param {ChainSchema<AnySchema> | AnySchema} other - Explicit borrowed schema or legacy wrapper, never resolved from untrusted package metadata.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  and(other: ChainSchema<AnySchema> | AnySchema): ChainSchema<any> {
    return wrap(
      intersect([
        this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        unwrap(other) as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      ])
    );
  }

  /** Append an explicit trusted synchronous check callback; no candidate string is evaluated as code.
   * @param {(input: InferOutput<TSchema>) => boolean} requirement - Explicit trusted synchronous predicate; host code/side effects are not sandboxed.
   * @param {string} message - Optional trusted private diagnostic text, not safe rendered output.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  refine(
    requirement: (input: InferOutput<TSchema>) => boolean,
    message?: string
  ): ChainSchema<any> {
    return wrap(
      applyPipe(
        this.schema,
        check(requirement as (input: unknown) => boolean, message)
      )
    );
  }

  /** Append an explicit trusted synchronous transform with the legacy broad fluent return type.
   * @param {(input: InferOutput<TSchema>) => TOutput} operation - Explicit trusted synchronous transformation callback; only the selected functional API determines async support.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  transform<TOutput>(
    operation: (input: InferOutput<TSchema>) => TOutput
  ): ChainSchema<any> {
    return wrap(
      applyPipe(
        this.schema,
        transform(operation as (input: unknown) => TOutput)
      )
    );
  }

  /** Append explicit trusted functional items using the retained synchronous pipe compatibility cast.
   * @param {unknown[]} items - Explicit trusted pipeline descriptors; broad fluent typing is not runtime validation of arbitrary descriptors.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  pipe(...items: unknown[]): ChainSchema<any> {
    return wrap(applyPipe(this.schema, ...items));
  }

  /** Wrap the child with the existing synchronous null exclusion; this differs from rejecting both null and undefined.
   * @param {string} message - Optional trusted private diagnostic text, not safe rendered output.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  nonNullable(message?: string): ChainSchema<any> {
    return wrap(
      nonNullable(
        this.schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        message
      )
    );
  }

  /** Convert only the local JSON Schema subset, without executing functional transforms or claiming vendor conformance.
   * @returns {import('./jsonSchema.js').JsonSchema} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  toJSONSchema() {
    return toJsonSchema(this.schema);
  }

  /** Use the local AJV-shaped compatibility checker rather than the AJV engine; successful data is not functionally transformed.
   * @param {unknown} input - Private candidate or explicit borrowed wrapper/schema; never a module name or source expression.
   * @returns {ReturnType<typeof ajvSafeParse>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  ajvSafeParse(input: unknown) {
    return ajvSafeParse(this.schema, input);
  }
}

/** Legacy string-specialized wrapper adding native length/email/trim/case conveniences; returned fluent types remain deliberately broad. */
export class StringChainSchema<
  TSchema extends AnySchema,
> extends ChainSchema<TSchema> {
  /** Append native string-length or numeric lower-bound refinement according to this specialized wrapper.
   * @param {number} length - Configured native UTF-16/array-like length threshold; not bytes or grapheme count.
   * @param {string} message - Optional trusted private diagnostic text, not safe rendered output.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  min(length: number, message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, minLength(length, message) as any));
  }

  /** Append native string-length or numeric upper-bound refinement according to this specialized wrapper.
   * @param {number} length - Configured native UTF-16/array-like length threshold; not bytes or grapheme count.
   * @param {string} message - Optional trusted private diagnostic text, not safe rendered output.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  max(length: number, message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, maxLength(length, message) as any));
  }

  /** Append the retained email text-pattern check without mailbox/provider verification.
   * @param {string} message - Optional trusted private diagnostic text, not safe rendered output.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  email(message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, email(message) as any));
  }

  /** Append native whitespace trimming, without HTML escaping or Unicode normalization.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  trim(): ChainSchema<any> {
    return wrap(applyPipe(this.schema, trim() as any));
  }

  /** Append native locale-independent string lowercasing; no identity normalization policy is implied.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  toLowerCase(): ChainSchema<any> {
    return wrap(applyPipe(this.schema, toLowerCase() as any));
  }
}

/** Legacy number-specialized wrapper adding native inclusive bounds/integer checks; safe range and finite policy remain explicit actions. */
export class NumberChainSchema<
  TSchema extends AnySchema,
> extends ChainSchema<TSchema> {
  /** Append native string-length or numeric lower-bound refinement according to this specialized wrapper.
   * @param {number} value - Configured native number bound, or explicit literal for a constructor; no implicit permissions follow.
   * @param {string} message - Optional trusted private diagnostic text, not safe rendered output.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  min(value: number, message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, minValue(value, message) as any));
  }

  /** Append native string-length or numeric upper-bound refinement according to this specialized wrapper.
   * @param {number} value - Configured native number bound, or explicit literal for a constructor; no implicit permissions follow.
   * @param {string} message - Optional trusted private diagnostic text, not safe rendered output.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  max(value: number, message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, maxValue(value, message) as any));
  }

  /** Append native Number.isInteger refinement without a safe-range guarantee.
   * @param {string} message - Optional trusted private diagnostic text, not safe rendered output.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  int(message?: string): ChainSchema<any> {
    return wrap(applyPipe(this.schema, integer(message) as any));
  }
}

/** Return the borrowed functional schema without parsing, cloning or authorization.
 * @param {ChainSchema<AnySchema> | AnySchema} input - Private candidate or explicit borrowed wrapper/schema; never a module name or source expression.
 * @returns {AnySchema} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
 */
function unwrap(input: ChainSchema<AnySchema> | AnySchema): AnySchema {
  return input instanceof ChainSchema ? input.schema : input;
}

/** Choose a primitive-specialized legacy wrapper from trusted schema metadata without parsing or allocating a cleanup owner.
 * @param {TSchema} schema - Borrowed explicit functional schema; caller mutation and runtime validation ownership remain unchanged.
 * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
 */
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

/** Explicit legacy constructor namespace; factories use public functional APIs without package discovery, network work or complete Zod parity. */
export const z = {
  /** Construct a legacy string wrapper from explicit trusted functional APIs; no input is parsed on import.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  string: () => new StringChainSchema(string()),
  /** Construct a legacy number wrapper from explicit trusted functional APIs; no input is parsed on import.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  number: () => new NumberChainSchema(number()),
  /** Construct a legacy boolean wrapper from explicit trusted functional APIs; no input is parsed on import.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  boolean: () => new ChainSchema(boolean()),
  /** Construct a legacy literal wrapper from explicit trusted functional APIs; no input is parsed on import.
   * @param {TLiteral} value - Configured native number bound, or explicit literal for a constructor; no implicit permissions follow.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  literal: <TLiteral extends string | number | boolean | null>(
    value: TLiteral
  ) => new ChainSchema(literal(value as never)),
  /** Construct a legacy object wrapper from explicit trusted functional APIs; no input is parsed on import.
   * @param {TEntries} entries - Explicit trusted object entry schemas; wrapper conversion does not sanitize arbitrary JavaScript objects.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  object: <TEntries extends Record<string, AnySchema | ChainSchema<AnySchema>>>(
    entries: TEntries
  ) =>
    new ChainSchema(
      object(
        Object.fromEntries(
          Object.entries(entries).map(([key, value]) => [
            key,
            unwrap(value as AnySchema | ChainSchema<AnySchema>),
          ])
        ) as Record<string, BaseSchema<unknown, unknown, BaseIssue<unknown>>>
      )
    ),
  /** Wrap the schema in the retained synchronous array convenience constructor; this is not full shorthand/framework parity.
   * @param {ChainSchema<AnySchema> | AnySchema} item - Explicit borrowed child schema/wrapper for array construction.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  array: (item: ChainSchema<AnySchema> | AnySchema) =>
    new ChainSchema(
      array(unwrap(item) as BaseSchema<unknown, unknown, BaseIssue<unknown>>)
    ),
  /** Construct a legacy union wrapper from explicit trusted functional APIs; no input is parsed on import.
   * @param {Array<ChainSchema<AnySchema> | AnySchema>} options - Explicit ordered borrowed union branches; no external engine selection or fallback occurs.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  union: (options: Array<ChainSchema<AnySchema> | AnySchema>) =>
    new ChainSchema(
      union(
        options.map(
          (option) =>
            unwrap(option) as BaseSchema<unknown, unknown, BaseIssue<unknown>>
        )
      )
    ),
  /** Create the existing synchronous nullable wrapper while retaining borrowed child/default references.
   * @param {ChainSchema<AnySchema> | AnySchema} input - Private candidate or explicit borrowed wrapper/schema; never a module name or source expression.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  nullable: (input: ChainSchema<AnySchema> | AnySchema) =>
    wrap(
      nullable(
        unwrap(input) as BaseSchema<unknown, unknown, BaseIssue<unknown>>
      )
    ),
  /** Create the existing synchronous optional wrapper with broad fluent typing; no asynchronous default support is inferred.
   * @param {ChainSchema<AnySchema> | AnySchema} input - Private candidate or explicit borrowed wrapper/schema; never a module name or source expression.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  optional: (input: ChainSchema<AnySchema> | AnySchema) =>
    wrap(
      optional(
        unwrap(input) as BaseSchema<unknown, unknown, BaseIssue<unknown>>
      )
    ),
  /** Create the existing synchronous nullish wrapper; use functional APIs when precise async/input/output inference is required.
   * @param {ChainSchema<AnySchema> | AnySchema} input - Private candidate or explicit borrowed wrapper/schema; never a module name or source expression.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  nullish: (input: ChainSchema<AnySchema> | AnySchema) =>
    wrap(
      nullish(unwrap(input) as BaseSchema<unknown, unknown, BaseIssue<unknown>>)
    ),
  /** Construct a legacy from wrapper from explicit trusted functional APIs; no input is parsed on import.
   * @param {TSchema} schema - Borrowed explicit functional schema; caller mutation and runtime validation ownership remain unchanged.
   * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
   */
  from: <TSchema extends AnySchema>(schema: TSchema) => wrap(schema),
};

/** Create an explicit legacy fluent wrapper; use functional APIs for precise input/output typing and implemented async contracts.
 * @param {TSchema} schema - Borrowed explicit functional schema; caller mutation and runtime validation ownership remain unchanged.
 * @returns {ChainSchema<any>} Declared legacy result retaining borrowed schema/value references; no new disposal owner, complete vendor parity or authorization is introduced.
 */
export function chain<TSchema extends AnySchema>(
  schema: TSchema
): ChainSchema<any> {
  return wrap(schema);
}
