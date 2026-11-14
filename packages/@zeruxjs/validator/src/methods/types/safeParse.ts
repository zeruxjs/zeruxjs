import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  InferIssue,
  InferOutput,
} from '../../types/index.js';

/**
 * Discriminated ordinary validation result; budget, cancellation and dependency failures still throw/reject.
 */
export type SafeParseResult<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> =
  | {
      /** Whether the schema established its declared output type; typed true can still carry refinement issues. */
      readonly typed: true;
      /** Whether there are no ordinary validation issues; operational failures do not create a success:false result. */
      readonly success: true;
      /** Private parsed/partial candidate; success:false output must not be treated as validated public data. */
      readonly output: InferOutput<TSchema>;
      /** Private nonempty ordinary issues on failure, undefined on success; select safe client fields explicitly. */
      readonly issues: undefined;
    }
  | {
      /** Whether the schema established its declared output type; typed true can still carry refinement issues. */
      readonly typed: true;
      /** Whether there are no ordinary validation issues; operational failures do not create a success:false result. */
      readonly success: false;
      /** Private parsed/partial candidate; success:false output must not be treated as validated public data. */
      readonly output: InferOutput<TSchema>;
      /** Private nonempty ordinary issues on failure, undefined on success; select safe client fields explicitly. */
      readonly issues: [InferIssue<TSchema>, ...InferIssue<TSchema>[]];
    }
  | {
      /** Whether the schema established its declared output type; typed true can still carry refinement issues. */
      readonly typed: false;
      /** Whether there are no ordinary validation issues; operational failures do not create a success:false result. */
      readonly success: false;
      /** Private parsed/partial candidate; success:false output must not be treated as validated public data. */
      readonly output: unknown;
      /** Private nonempty ordinary issues on failure, undefined on success; select safe client fields explicitly. */
      readonly issues: [InferIssue<TSchema>, ...InferIssue<TSchema>[]];
    };
