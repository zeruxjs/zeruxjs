import type {
  BaseIssue,
  BaseTransformation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Guard function type.
 *
 * @beta
 */
export type GuardFunction<TInput> = (input: TInput) => input is any;

/**
 * Infer guard output type.
 *
 * @beta
 */

export type InferGuardOutput<TGuard extends GuardFunction<any>> =
  TGuard extends (input: any) => input is infer TOutput ? TOutput : unknown;

/**
 * Guard issue interface.
 *
 * @beta
 */
export interface GuardIssue<
  TInput,
  TGuard extends GuardFunction<TInput>,
> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'transformation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'guard';
  /**
   * The guard function.
   */
  readonly requirement: TGuard;
}

/**
 * Guard action interface.
 *
 * @beta
 */
export interface GuardAction<
  TInput,
  TGuard extends GuardFunction<TInput>,
  TMessage extends ErrorMessage<GuardIssue<TInput, TGuard>> | undefined,
> extends BaseTransformation<
  TInput,
  // intersect in case guard is actually wider
  TInput & InferGuardOutput<TGuard>,
  GuardIssue<TInput, TGuard>
> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'guard';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof guard;
  /**
   * The guard function.
   */
  readonly requirement: TGuard;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Apply an explicit trusted synchronous type guard; false adds a private issue and clears typed status without granting permissions. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TGuard} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @returns {GuardAction<TInput, TGuard, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
// known input from pipe
export function guard<TInput, const TGuard extends GuardFunction<TInput>>(
  requirement: TGuard
): GuardAction<TInput, TGuard, undefined>;

/** Apply an explicit trusted synchronous type guard; false adds a private issue and clears typed status without granting permissions. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TGuard} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @returns {GuardAction<Parameters<TGuard>[0], TGuard, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
// unknown input, e.g. standalone

export function guard<const TGuard extends GuardFunction<any>>(
  requirement: TGuard
): GuardAction<Parameters<TGuard>[0], TGuard, undefined>;

/** Apply an explicit trusted synchronous type guard; false adds a private issue and clears typed status without granting permissions. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TGuard} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {GuardAction<TInput, TGuard, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
// known input from pipe
export function guard<
  TInput,
  const TGuard extends GuardFunction<TInput>,
  const TMessage extends ErrorMessage<GuardIssue<TInput, TGuard>> | undefined,
>(
  requirement: TGuard,
  message: TMessage
): GuardAction<TInput, TGuard, TMessage>;

/** Apply an explicit trusted synchronous type guard; false adds a private issue and clears typed status without granting permissions. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TGuard} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {GuardAction<Parameters<TGuard>[0], TGuard, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
// unknown input, e.g. standalone
export function guard<
  const TGuard extends GuardFunction<any>,
  const TMessage extends
    | ErrorMessage<GuardIssue<Parameters<TGuard>[0], TGuard>>
    | undefined,
>(
  requirement: TGuard,
  message: TMessage
): GuardAction<Parameters<TGuard>[0], TGuard, TMessage>;

/** Apply an explicit trusted synchronous type guard; false adds a private issue and clears typed status without granting permissions. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {GuardFunction<unknown>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {ErrorMessage<GuardIssue<unknown, GuardFunction<unknown>>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {GuardAction<unknown, GuardFunction<unknown>, ErrorMessage<GuardIssue<unknown, GuardFunction<unknown>>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function guard(
  requirement: GuardFunction<unknown>,
  message?: ErrorMessage<GuardIssue<unknown, GuardFunction<unknown>>>
): GuardAction<
  unknown,
  GuardFunction<unknown>,
  ErrorMessage<GuardIssue<unknown, GuardFunction<unknown>>> | undefined
> {
  return {
    kind: 'transformation',
    type: 'guard',
    reference: guard,
    async: false,
    requirement,
    message,
    /** Apply an explicit trusted synchronous type guard; false adds a private issue and clears typed status without granting permissions. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement(dataset.value)) {
        _addIssue(this, 'input', dataset, config);
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = false;
      }
      return dataset;
    },
  };
}
