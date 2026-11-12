import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  Config,
  FirstTupleItem,
  InferInput,
  InferIssue,
  InferOutput,
  LastTupleItem,
  OutputDataset,
  PipeAction,
  PipeItem,
  StandardProps,
  UnknownDataset,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';

/**
 * Schema with pipe type.
 */
export type SchemaWithPipe<
  TPipe extends readonly [
    BaseSchema<unknown, unknown, BaseIssue<unknown>>,

    ...PipeItem<any, unknown, BaseIssue<unknown>>[],
  ],
> = Omit<FirstTupleItem<TPipe>, 'pipe' | '~standard' | '~run' | '~types'> & {
  /**
   * Root schema plus ordered trusted items; the captured tuple is fresh but item references remain borrowed.
   */
  readonly pipe: TPipe;
  /**
   * Inert Standard Schema V1 adapter using the same bounded root execution path.
   *
   * @internal
   */
  readonly '~standard': StandardProps<
    InferInput<FirstTupleItem<TPipe>>,
    InferOutput<LastTupleItem<TPipe>>
  >;
  /**
   * Parses unknown input values.
   *
   * @param {UnknownDataset} dataset - Current private input dataset.
   * @param {Config<BaseIssue<unknown>>} config - Root-derived shared budgets and cooperative signal.
   *
   * @returns {OutputDataset<InferOutput<LastTupleItem<TPipe>>, InferIssue<TPipe[number]>>} Declared private dataset; callbacks are trusted and operational failures propagate.
   *
   * @internal
   */
  readonly '~run': (
    dataset: UnknownDataset,
    config: Config<BaseIssue<unknown>>
  ) => OutputDataset<
    InferOutput<LastTupleItem<TPipe>>,
    InferIssue<TPipe[number]>
  >;
  /**
   * Type-only root input/final output/combined issue inference; no runtime values or validators are stored here.
   *
   * @internal
   */
  readonly '~types'?:
    | {
        /** Compile-time root input inference, not submitted runtime data. */
        readonly input: InferInput<FirstTupleItem<TPipe>>;
        /** Compile-time final-stage output inference, not a deep-clone guarantee. */
        readonly output: InferOutput<LastTupleItem<TPipe>>;
        /** Compile-time union of declared stage issue types; raw issue values remain private. */
        readonly issue: InferIssue<TPipe[number]>;
      }
    | undefined;
};

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>
): SchemaWithPipe<readonly [TSchema, TItem1]>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>
): SchemaWithPipe<readonly [TSchema, TItem1, TItem2]>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>
): SchemaWithPipe<readonly [TSchema, TItem1, TItem2, TItem3]>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>
): SchemaWithPipe<readonly [TSchema, TItem1, TItem2, TItem3, TItem4]>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>
): SchemaWithPipe<readonly [TSchema, TItem1, TItem2, TItem3, TItem4, TItem5]>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>
): SchemaWithPipe<
  readonly [TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>
): SchemaWithPipe<
  readonly [TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem11 | PipeAction<InferOutput<TItem10>, InferOutput<TItem11>, InferIssue<TItem11>>} item11 - Trusted stage 11 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10, TItem11 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem11 extends PipeItem<
    InferOutput<TItem10>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<
        InferOutput<TItem9>,
        InferOutput<TItem10>,
        InferIssue<TItem10>
      >,
  item11:
    | TItem11
    | PipeAction<
        InferOutput<TItem10>,
        InferOutput<TItem11>,
        InferIssue<TItem11>
      >
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
    TItem11,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem11 | PipeAction<InferOutput<TItem10>, InferOutput<TItem11>, InferIssue<TItem11>>} item11 - Trusted stage 11 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem12 | PipeAction<InferOutput<TItem11>, InferOutput<TItem12>, InferIssue<TItem12>>} item12 - Trusted stage 12 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10, TItem11, TItem12 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem11 extends PipeItem<
    InferOutput<TItem10>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem12 extends PipeItem<
    InferOutput<TItem11>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<
        InferOutput<TItem9>,
        InferOutput<TItem10>,
        InferIssue<TItem10>
      >,
  item11:
    | TItem11
    | PipeAction<
        InferOutput<TItem10>,
        InferOutput<TItem11>,
        InferIssue<TItem11>
      >,
  item12:
    | TItem12
    | PipeAction<
        InferOutput<TItem11>,
        InferOutput<TItem12>,
        InferIssue<TItem12>
      >
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
    TItem11,
    TItem12,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem11 | PipeAction<InferOutput<TItem10>, InferOutput<TItem11>, InferIssue<TItem11>>} item11 - Trusted stage 11 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem12 | PipeAction<InferOutput<TItem11>, InferOutput<TItem12>, InferIssue<TItem12>>} item12 - Trusted stage 12 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem13 | PipeAction<InferOutput<TItem12>, InferOutput<TItem13>, InferIssue<TItem13>>} item13 - Trusted stage 13 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10, TItem11, TItem12, TItem13 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem11 extends PipeItem<
    InferOutput<TItem10>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem12 extends PipeItem<
    InferOutput<TItem11>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem13 extends PipeItem<
    InferOutput<TItem12>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<
        InferOutput<TItem9>,
        InferOutput<TItem10>,
        InferIssue<TItem10>
      >,
  item11:
    | TItem11
    | PipeAction<
        InferOutput<TItem10>,
        InferOutput<TItem11>,
        InferIssue<TItem11>
      >,
  item12:
    | TItem12
    | PipeAction<
        InferOutput<TItem11>,
        InferOutput<TItem12>,
        InferIssue<TItem12>
      >,
  item13:
    | TItem13
    | PipeAction<
        InferOutput<TItem12>,
        InferOutput<TItem13>,
        InferIssue<TItem13>
      >
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
    TItem11,
    TItem12,
    TItem13,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem11 | PipeAction<InferOutput<TItem10>, InferOutput<TItem11>, InferIssue<TItem11>>} item11 - Trusted stage 11 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem12 | PipeAction<InferOutput<TItem11>, InferOutput<TItem12>, InferIssue<TItem12>>} item12 - Trusted stage 12 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem13 | PipeAction<InferOutput<TItem12>, InferOutput<TItem13>, InferIssue<TItem13>>} item13 - Trusted stage 13 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem14 | PipeAction<InferOutput<TItem13>, InferOutput<TItem14>, InferIssue<TItem14>>} item14 - Trusted stage 14 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10, TItem11, TItem12, TItem13, TItem14 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem11 extends PipeItem<
    InferOutput<TItem10>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem12 extends PipeItem<
    InferOutput<TItem11>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem13 extends PipeItem<
    InferOutput<TItem12>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem14 extends PipeItem<
    InferOutput<TItem13>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<
        InferOutput<TItem9>,
        InferOutput<TItem10>,
        InferIssue<TItem10>
      >,
  item11:
    | TItem11
    | PipeAction<
        InferOutput<TItem10>,
        InferOutput<TItem11>,
        InferIssue<TItem11>
      >,
  item12:
    | TItem12
    | PipeAction<
        InferOutput<TItem11>,
        InferOutput<TItem12>,
        InferIssue<TItem12>
      >,
  item13:
    | TItem13
    | PipeAction<
        InferOutput<TItem12>,
        InferOutput<TItem13>,
        InferIssue<TItem13>
      >,
  item14:
    | TItem14
    | PipeAction<
        InferOutput<TItem13>,
        InferOutput<TItem14>,
        InferIssue<TItem14>
      >
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
    TItem11,
    TItem12,
    TItem13,
    TItem14,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem11 | PipeAction<InferOutput<TItem10>, InferOutput<TItem11>, InferIssue<TItem11>>} item11 - Trusted stage 11 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem12 | PipeAction<InferOutput<TItem11>, InferOutput<TItem12>, InferIssue<TItem12>>} item12 - Trusted stage 12 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem13 | PipeAction<InferOutput<TItem12>, InferOutput<TItem13>, InferIssue<TItem13>>} item13 - Trusted stage 13 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem14 | PipeAction<InferOutput<TItem13>, InferOutput<TItem14>, InferIssue<TItem14>>} item14 - Trusted stage 14 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem15 | PipeAction<InferOutput<TItem14>, InferOutput<TItem15>, InferIssue<TItem15>>} item15 - Trusted stage 15 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10, TItem11, TItem12, TItem13, TItem14, TItem15 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem11 extends PipeItem<
    InferOutput<TItem10>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem12 extends PipeItem<
    InferOutput<TItem11>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem13 extends PipeItem<
    InferOutput<TItem12>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem14 extends PipeItem<
    InferOutput<TItem13>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem15 extends PipeItem<
    InferOutput<TItem14>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<
        InferOutput<TItem9>,
        InferOutput<TItem10>,
        InferIssue<TItem10>
      >,
  item11:
    | TItem11
    | PipeAction<
        InferOutput<TItem10>,
        InferOutput<TItem11>,
        InferIssue<TItem11>
      >,
  item12:
    | TItem12
    | PipeAction<
        InferOutput<TItem11>,
        InferOutput<TItem12>,
        InferIssue<TItem12>
      >,
  item13:
    | TItem13
    | PipeAction<
        InferOutput<TItem12>,
        InferOutput<TItem13>,
        InferIssue<TItem13>
      >,
  item14:
    | TItem14
    | PipeAction<
        InferOutput<TItem13>,
        InferOutput<TItem14>,
        InferIssue<TItem14>
      >,
  item15:
    | TItem15
    | PipeAction<
        InferOutput<TItem14>,
        InferOutput<TItem15>,
        InferIssue<TItem15>
      >
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
    TItem11,
    TItem12,
    TItem13,
    TItem14,
    TItem15,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem11 | PipeAction<InferOutput<TItem10>, InferOutput<TItem11>, InferIssue<TItem11>>} item11 - Trusted stage 11 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem12 | PipeAction<InferOutput<TItem11>, InferOutput<TItem12>, InferIssue<TItem12>>} item12 - Trusted stage 12 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem13 | PipeAction<InferOutput<TItem12>, InferOutput<TItem13>, InferIssue<TItem13>>} item13 - Trusted stage 13 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem14 | PipeAction<InferOutput<TItem13>, InferOutput<TItem14>, InferIssue<TItem14>>} item14 - Trusted stage 14 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem15 | PipeAction<InferOutput<TItem14>, InferOutput<TItem15>, InferIssue<TItem15>>} item15 - Trusted stage 15 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem16 | PipeAction<InferOutput<TItem15>, InferOutput<TItem16>, InferIssue<TItem16>>} item16 - Trusted stage 16 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10, TItem11, TItem12, TItem13, TItem14, TItem15, TItem16 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem11 extends PipeItem<
    InferOutput<TItem10>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem12 extends PipeItem<
    InferOutput<TItem11>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem13 extends PipeItem<
    InferOutput<TItem12>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem14 extends PipeItem<
    InferOutput<TItem13>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem15 extends PipeItem<
    InferOutput<TItem14>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem16 extends PipeItem<
    InferOutput<TItem15>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<
        InferOutput<TItem9>,
        InferOutput<TItem10>,
        InferIssue<TItem10>
      >,
  item11:
    | TItem11
    | PipeAction<
        InferOutput<TItem10>,
        InferOutput<TItem11>,
        InferIssue<TItem11>
      >,
  item12:
    | TItem12
    | PipeAction<
        InferOutput<TItem11>,
        InferOutput<TItem12>,
        InferIssue<TItem12>
      >,
  item13:
    | TItem13
    | PipeAction<
        InferOutput<TItem12>,
        InferOutput<TItem13>,
        InferIssue<TItem13>
      >,
  item14:
    | TItem14
    | PipeAction<
        InferOutput<TItem13>,
        InferOutput<TItem14>,
        InferIssue<TItem14>
      >,
  item15:
    | TItem15
    | PipeAction<
        InferOutput<TItem14>,
        InferOutput<TItem15>,
        InferIssue<TItem15>
      >,
  item16:
    | TItem16
    | PipeAction<
        InferOutput<TItem15>,
        InferOutput<TItem16>,
        InferIssue<TItem16>
      >
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
    TItem11,
    TItem12,
    TItem13,
    TItem14,
    TItem15,
    TItem16,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem11 | PipeAction<InferOutput<TItem10>, InferOutput<TItem11>, InferIssue<TItem11>>} item11 - Trusted stage 11 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem12 | PipeAction<InferOutput<TItem11>, InferOutput<TItem12>, InferIssue<TItem12>>} item12 - Trusted stage 12 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem13 | PipeAction<InferOutput<TItem12>, InferOutput<TItem13>, InferIssue<TItem13>>} item13 - Trusted stage 13 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem14 | PipeAction<InferOutput<TItem13>, InferOutput<TItem14>, InferIssue<TItem14>>} item14 - Trusted stage 14 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem15 | PipeAction<InferOutput<TItem14>, InferOutput<TItem15>, InferIssue<TItem15>>} item15 - Trusted stage 15 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem16 | PipeAction<InferOutput<TItem15>, InferOutput<TItem16>, InferIssue<TItem16>>} item16 - Trusted stage 16 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10, TItem11, TItem12, TItem13, TItem14, TItem15, TItem16 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem11 extends PipeItem<
    InferOutput<TItem10>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem12 extends PipeItem<
    InferOutput<TItem11>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem13 extends PipeItem<
    InferOutput<TItem12>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem14 extends PipeItem<
    InferOutput<TItem13>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem15 extends PipeItem<
    InferOutput<TItem14>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem16 extends PipeItem<
    InferOutput<TItem15>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<
        InferOutput<TItem9>,
        InferOutput<TItem10>,
        InferIssue<TItem10>
      >,
  item11:
    | TItem11
    | PipeAction<
        InferOutput<TItem10>,
        InferOutput<TItem11>,
        InferIssue<TItem11>
      >,
  item12:
    | TItem12
    | PipeAction<
        InferOutput<TItem11>,
        InferOutput<TItem12>,
        InferIssue<TItem12>
      >,
  item13:
    | TItem13
    | PipeAction<
        InferOutput<TItem12>,
        InferOutput<TItem13>,
        InferIssue<TItem13>
      >,
  item14:
    | TItem14
    | PipeAction<
        InferOutput<TItem13>,
        InferOutput<TItem14>,
        InferIssue<TItem14>
      >,
  item15:
    | TItem15
    | PipeAction<
        InferOutput<TItem14>,
        InferOutput<TItem15>,
        InferIssue<TItem15>
      >,
  item16:
    | TItem16
    | PipeAction<
        InferOutput<TItem15>,
        InferOutput<TItem16>,
        InferIssue<TItem16>
      >
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
    TItem11,
    TItem12,
    TItem13,
    TItem14,
    TItem15,
    TItem16,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem11 | PipeAction<InferOutput<TItem10>, InferOutput<TItem11>, InferIssue<TItem11>>} item11 - Trusted stage 11 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem12 | PipeAction<InferOutput<TItem11>, InferOutput<TItem12>, InferIssue<TItem12>>} item12 - Trusted stage 12 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem13 | PipeAction<InferOutput<TItem12>, InferOutput<TItem13>, InferIssue<TItem13>>} item13 - Trusted stage 13 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem14 | PipeAction<InferOutput<TItem13>, InferOutput<TItem14>, InferIssue<TItem14>>} item14 - Trusted stage 14 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem15 | PipeAction<InferOutput<TItem14>, InferOutput<TItem15>, InferIssue<TItem15>>} item15 - Trusted stage 15 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem16 | PipeAction<InferOutput<TItem15>, InferOutput<TItem16>, InferIssue<TItem16>>} item16 - Trusted stage 16 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem17 | PipeAction<InferOutput<TItem16>, InferOutput<TItem17>, InferIssue<TItem17>>} item17 - Trusted stage 17 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10, TItem11, TItem12, TItem13, TItem14, TItem15, TItem16, TItem17 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem11 extends PipeItem<
    InferOutput<TItem10>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem12 extends PipeItem<
    InferOutput<TItem11>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem13 extends PipeItem<
    InferOutput<TItem12>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem14 extends PipeItem<
    InferOutput<TItem13>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem15 extends PipeItem<
    InferOutput<TItem14>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem16 extends PipeItem<
    InferOutput<TItem15>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem17 extends PipeItem<
    InferOutput<TItem16>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<
        InferOutput<TItem9>,
        InferOutput<TItem10>,
        InferIssue<TItem10>
      >,
  item11:
    | TItem11
    | PipeAction<
        InferOutput<TItem10>,
        InferOutput<TItem11>,
        InferIssue<TItem11>
      >,
  item12:
    | TItem12
    | PipeAction<
        InferOutput<TItem11>,
        InferOutput<TItem12>,
        InferIssue<TItem12>
      >,
  item13:
    | TItem13
    | PipeAction<
        InferOutput<TItem12>,
        InferOutput<TItem13>,
        InferIssue<TItem13>
      >,
  item14:
    | TItem14
    | PipeAction<
        InferOutput<TItem13>,
        InferOutput<TItem14>,
        InferIssue<TItem14>
      >,
  item15:
    | TItem15
    | PipeAction<
        InferOutput<TItem14>,
        InferOutput<TItem15>,
        InferIssue<TItem15>
      >,
  item16:
    | TItem16
    | PipeAction<
        InferOutput<TItem15>,
        InferOutput<TItem16>,
        InferIssue<TItem16>
      >,
  item17:
    | TItem17
    | PipeAction<
        InferOutput<TItem16>,
        InferOutput<TItem17>,
        InferIssue<TItem17>
      >
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
    TItem11,
    TItem12,
    TItem13,
    TItem14,
    TItem15,
    TItem16,
    TItem17,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem11 | PipeAction<InferOutput<TItem10>, InferOutput<TItem11>, InferIssue<TItem11>>} item11 - Trusted stage 11 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem12 | PipeAction<InferOutput<TItem11>, InferOutput<TItem12>, InferIssue<TItem12>>} item12 - Trusted stage 12 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem13 | PipeAction<InferOutput<TItem12>, InferOutput<TItem13>, InferIssue<TItem13>>} item13 - Trusted stage 13 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem14 | PipeAction<InferOutput<TItem13>, InferOutput<TItem14>, InferIssue<TItem14>>} item14 - Trusted stage 14 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem15 | PipeAction<InferOutput<TItem14>, InferOutput<TItem15>, InferIssue<TItem15>>} item15 - Trusted stage 15 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem16 | PipeAction<InferOutput<TItem15>, InferOutput<TItem16>, InferIssue<TItem16>>} item16 - Trusted stage 16 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem17 | PipeAction<InferOutput<TItem16>, InferOutput<TItem17>, InferIssue<TItem17>>} item17 - Trusted stage 17 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem18 | PipeAction<InferOutput<TItem17>, InferOutput<TItem18>, InferIssue<TItem18>>} item18 - Trusted stage 18 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10, TItem11, TItem12, TItem13, TItem14, TItem15, TItem16, TItem17, TItem18 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem11 extends PipeItem<
    InferOutput<TItem10>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem12 extends PipeItem<
    InferOutput<TItem11>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem13 extends PipeItem<
    InferOutput<TItem12>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem14 extends PipeItem<
    InferOutput<TItem13>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem15 extends PipeItem<
    InferOutput<TItem14>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem16 extends PipeItem<
    InferOutput<TItem15>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem17 extends PipeItem<
    InferOutput<TItem16>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem18 extends PipeItem<
    InferOutput<TItem17>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<
        InferOutput<TItem9>,
        InferOutput<TItem10>,
        InferIssue<TItem10>
      >,
  item11:
    | TItem11
    | PipeAction<
        InferOutput<TItem10>,
        InferOutput<TItem11>,
        InferIssue<TItem11>
      >,
  item12:
    | TItem12
    | PipeAction<
        InferOutput<TItem11>,
        InferOutput<TItem12>,
        InferIssue<TItem12>
      >,
  item13:
    | TItem13
    | PipeAction<
        InferOutput<TItem12>,
        InferOutput<TItem13>,
        InferIssue<TItem13>
      >,
  item14:
    | TItem14
    | PipeAction<
        InferOutput<TItem13>,
        InferOutput<TItem14>,
        InferIssue<TItem14>
      >,
  item15:
    | TItem15
    | PipeAction<
        InferOutput<TItem14>,
        InferOutput<TItem15>,
        InferIssue<TItem15>
      >,
  item16:
    | TItem16
    | PipeAction<
        InferOutput<TItem15>,
        InferOutput<TItem16>,
        InferIssue<TItem16>
      >,
  item17:
    | TItem17
    | PipeAction<
        InferOutput<TItem16>,
        InferOutput<TItem17>,
        InferIssue<TItem17>
      >,
  item18:
    | TItem18
    | PipeAction<
        InferOutput<TItem17>,
        InferOutput<TItem18>,
        InferIssue<TItem18>
      >
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
    TItem11,
    TItem12,
    TItem13,
    TItem14,
    TItem15,
    TItem16,
    TItem17,
    TItem18,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItem1 | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>} item1 - Trusted stage 1 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem2 | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>} item2 - Trusted stage 2 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem3 | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>} item3 - Trusted stage 3 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem4 | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>} item4 - Trusted stage 4 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem5 | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>} item5 - Trusted stage 5 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem6 | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>} item6 - Trusted stage 6 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem7 | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>} item7 - Trusted stage 7 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem8 | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>} item8 - Trusted stage 8 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem9 | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>} item9 - Trusted stage 9 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem10 | PipeAction<InferOutput<TItem9>, InferOutput<TItem10>, InferIssue<TItem10>>} item10 - Trusted stage 10 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem11 | PipeAction<InferOutput<TItem10>, InferOutput<TItem11>, InferIssue<TItem11>>} item11 - Trusted stage 11 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem12 | PipeAction<InferOutput<TItem11>, InferOutput<TItem12>, InferIssue<TItem12>>} item12 - Trusted stage 12 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem13 | PipeAction<InferOutput<TItem12>, InferOutput<TItem13>, InferIssue<TItem13>>} item13 - Trusted stage 13 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem14 | PipeAction<InferOutput<TItem13>, InferOutput<TItem14>, InferIssue<TItem14>>} item14 - Trusted stage 14 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem15 | PipeAction<InferOutput<TItem14>, InferOutput<TItem15>, InferIssue<TItem15>>} item15 - Trusted stage 15 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem16 | PipeAction<InferOutput<TItem15>, InferOutput<TItem16>, InferIssue<TItem16>>} item16 - Trusted stage 16 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem17 | PipeAction<InferOutput<TItem16>, InferOutput<TItem17>, InferIssue<TItem17>>} item17 - Trusted stage 17 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem18 | PipeAction<InferOutput<TItem17>, InferOutput<TItem18>, InferIssue<TItem18>>} item18 - Trusted stage 18 whose input follows the previous declared output; never untrusted source text.
 * @param {TItem19 | PipeAction<InferOutput<TItem18>, InferOutput<TItem19>, InferIssue<TItem19>>} item19 - Trusted stage 19 whose input follows the previous declared output; never untrusted source text.
 * @returns {SchemaWithPipe<readonly [ TSchema, TItem1, TItem2, TItem3, TItem4, TItem5, TItem6, TItem7, TItem8, TItem9, TItem10, TItem11, TItem12, TItem13, TItem14, TItem15, TItem16, TItem17, TItem18, TItem19 ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItem1 extends PipeItem<
    InferOutput<TSchema>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem2 extends PipeItem<
    InferOutput<TItem1>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem3 extends PipeItem<
    InferOutput<TItem2>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem4 extends PipeItem<
    InferOutput<TItem3>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem5 extends PipeItem<
    InferOutput<TItem4>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem6 extends PipeItem<
    InferOutput<TItem5>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem7 extends PipeItem<
    InferOutput<TItem6>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem8 extends PipeItem<
    InferOutput<TItem7>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem9 extends PipeItem<
    InferOutput<TItem8>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem10 extends PipeItem<
    InferOutput<TItem9>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem11 extends PipeItem<
    InferOutput<TItem10>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem12 extends PipeItem<
    InferOutput<TItem11>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem13 extends PipeItem<
    InferOutput<TItem12>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem14 extends PipeItem<
    InferOutput<TItem13>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem15 extends PipeItem<
    InferOutput<TItem14>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem16 extends PipeItem<
    InferOutput<TItem15>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem17 extends PipeItem<
    InferOutput<TItem16>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem18 extends PipeItem<
    InferOutput<TItem17>,
    unknown,
    BaseIssue<unknown>
  >,
  const TItem19 extends PipeItem<
    InferOutput<TItem18>,
    unknown,
    BaseIssue<unknown>
  >,
>(
  schema: TSchema,
  item1:
    | TItem1
    | PipeAction<InferOutput<TSchema>, InferOutput<TItem1>, InferIssue<TItem1>>,
  item2:
    | TItem2
    | PipeAction<InferOutput<TItem1>, InferOutput<TItem2>, InferIssue<TItem2>>,
  item3:
    | TItem3
    | PipeAction<InferOutput<TItem2>, InferOutput<TItem3>, InferIssue<TItem3>>,
  item4:
    | TItem4
    | PipeAction<InferOutput<TItem3>, InferOutput<TItem4>, InferIssue<TItem4>>,
  item5:
    | TItem5
    | PipeAction<InferOutput<TItem4>, InferOutput<TItem5>, InferIssue<TItem5>>,
  item6:
    | TItem6
    | PipeAction<InferOutput<TItem5>, InferOutput<TItem6>, InferIssue<TItem6>>,
  item7:
    | TItem7
    | PipeAction<InferOutput<TItem6>, InferOutput<TItem7>, InferIssue<TItem7>>,
  item8:
    | TItem8
    | PipeAction<InferOutput<TItem7>, InferOutput<TItem8>, InferIssue<TItem8>>,
  item9:
    | TItem9
    | PipeAction<InferOutput<TItem8>, InferOutput<TItem9>, InferIssue<TItem9>>,
  item10:
    | TItem10
    | PipeAction<
        InferOutput<TItem9>,
        InferOutput<TItem10>,
        InferIssue<TItem10>
      >,
  item11:
    | TItem11
    | PipeAction<
        InferOutput<TItem10>,
        InferOutput<TItem11>,
        InferIssue<TItem11>
      >,
  item12:
    | TItem12
    | PipeAction<
        InferOutput<TItem11>,
        InferOutput<TItem12>,
        InferIssue<TItem12>
      >,
  item13:
    | TItem13
    | PipeAction<
        InferOutput<TItem12>,
        InferOutput<TItem13>,
        InferIssue<TItem13>
      >,
  item14:
    | TItem14
    | PipeAction<
        InferOutput<TItem13>,
        InferOutput<TItem14>,
        InferIssue<TItem14>
      >,
  item15:
    | TItem15
    | PipeAction<
        InferOutput<TItem14>,
        InferOutput<TItem15>,
        InferIssue<TItem15>
      >,
  item16:
    | TItem16
    | PipeAction<
        InferOutput<TItem15>,
        InferOutput<TItem16>,
        InferIssue<TItem16>
      >,
  item17:
    | TItem17
    | PipeAction<
        InferOutput<TItem16>,
        InferOutput<TItem17>,
        InferIssue<TItem17>
      >,
  item18:
    | TItem18
    | PipeAction<
        InferOutput<TItem17>,
        InferOutput<TItem18>,
        InferIssue<TItem18>
      >,
  item19:
    | TItem19
    | PipeAction<
        InferOutput<TItem18>,
        InferOutput<TItem19>,
        InferIssue<TItem19>
      >
): SchemaWithPipe<
  readonly [
    TSchema,
    TItem1,
    TItem2,
    TItem3,
    TItem4,
    TItem5,
    TItem6,
    TItem7,
    TItem8,
    TItem9,
    TItem10,
    TItem11,
    TItem12,
    TItem13,
    TItem14,
    TItem15,
    TItem16,
    TItem17,
    TItem18,
    TItem19,
  ]
>;

/** Compose declared schema/actions in order without executing them. Stage-specific overloads intentionally preserve input/output/issue inference; use explicit async composition for asynchronous items.
 * @param {TSchema} schema - Borrowed trusted root schema; construction does not parse or authorize input.
 * @param {TItems} items - Explicit ordered trusted stages under the declared variadic overload contract.
 * @returns {SchemaWithPipe<readonly [ TSchema, ...TItems ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItems extends readonly PipeItem<
    InferOutput<TSchema>,
    InferOutput<TSchema>,
    BaseIssue<unknown>
  >[],
>(
  schema: TSchema,
  ...items: TItems
): SchemaWithPipe<readonly [TSchema, ...TItems]>;

/** Capture a fresh pipeline tuple over borrowed trusted items. Runtime execution remains one shared sequential implementation; public overloads retain per-stage inference.
 * @param {[ TSchema, ...TItems ]} pipe - Fresh root-plus-items tuple; item objects/callbacks remain borrowed and are not frozen.
 * @returns {SchemaWithPipe<readonly [ TSchema, ...TItems ]>} Inert pipeline schema; every explicit parse owns its budgets, cooperative cancellation and actual cleanup.
 */
// @__NO_SIDE_EFFECTS__
export function pipe<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TItems extends readonly PipeItem<
    unknown,
    unknown,
    BaseIssue<unknown>
  >[],
>(
  ...pipe: [TSchema, ...TItems]
): SchemaWithPipe<readonly [TSchema, ...TItems]> {
  return {
    ...pipe[0],
    pipe,
    /** Adapt explicit validation to the shared root budgets and cleanup.
     * @returns {StandardProps<unknown, unknown>} Inert V1 adapter; construction performs no validation.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Run executable stages in order, skipping metadata and stopping schemas/transforms after issues. Remaining refinements may accumulate only when abort policy permits.
     * @param {UnknownDataset} dataset - Current private candidate input.
     * @param {Config<BaseIssue<unknown>>} config - Shared root budgets, cancellation and private message policy.
     * @returns {OutputDataset<unknown, BaseIssue<unknown>>} Actual declared pipeline dataset; started callback effects cannot be rolled back by validation.
     */
    '~run'(dataset, config) {
      // Preserve declared order; explicit async pipelines await each executable stage.
      for (const item of pipe) {
        // Exclude metadata items from execution
        if (item.kind !== 'metadata') {
          // A failed result must not flow into another schema or transform; refinements have their own typed guards.
          if (
            dataset.issues &&
            (item.kind === 'schema' || item.kind === 'transformation')
          ) {
            dataset.typed = false;
            break;
          }

          // Continue pipe execution if there is no reason to abort early
          if (
            !dataset.issues ||
            (!config.abortEarly && !config.abortPipeEarly)
          ) {
            dataset = _runSchema(item, dataset, config);
          }
        }
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<unknown, BaseIssue<unknown>>;
    },
  };
}
