import type { ValidationContext } from '../types/runtime.js';
import type {
  BaseValidationAsync,
  ErrorMessage,
  MaybePromise,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type {
  DeepPickN,
  PartialCheckIssue,
  PartialInput,
  Paths,
  RequiredPaths,
  ValidPaths,
} from './types/partialCheck.js';
import { _isPartiallyTyped } from './_isPartiallyTyped.js';

/**
 * Partial check action async interface.
 */
export interface PartialCheckActionAsync<
  TInput extends PartialInput,
  TPaths extends Paths,
  TSelection extends DeepPickN<TInput, TPaths>,
  TMessage extends ErrorMessage<PartialCheckIssue<TSelection>> | undefined,
> extends BaseValidationAsync<TInput, TInput, PartialCheckIssue<TSelection>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'partial_check';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof partialCheckAsync;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The selected paths.
   */
  readonly paths: TPaths;
  /**
   * The validation function.
   */
  readonly requirement: (
    input: TSelection,
    context: ValidationContext
  ) => MaybePromise<boolean>;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Gate refinement using declared paths, then await the trusted predicate on the original whole value with the root cooperative signal. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ValidPaths<TInput, TPaths>} paths - Borrowed declared issue-path selection for eligibility/inference; it is not data redaction, projection or authorization.
 * @param {(input: TSelection, context: ValidationContext) => MaybePromise<boolean>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @returns {PartialCheckActionAsync<TInput, TPaths, TSelection, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function partialCheckAsync<
  TInput extends PartialInput,
  const TPaths extends RequiredPaths,
  const TSelection extends DeepPickN<TInput, TPaths>,
>(
  paths: ValidPaths<TInput, TPaths>,
  requirement: (
    input: TSelection,
    context: ValidationContext
  ) => MaybePromise<boolean>
): PartialCheckActionAsync<TInput, TPaths, TSelection, undefined>;

/** Gate refinement using declared paths, then await the trusted predicate on the original whole value with the root cooperative signal. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ValidPaths<TInput, TPaths>} paths - Borrowed declared issue-path selection for eligibility/inference; it is not data redaction, projection or authorization.
 * @param {(input: TSelection, context: ValidationContext) => MaybePromise<boolean>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {PartialCheckActionAsync<TInput, TPaths, TSelection, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function partialCheckAsync<
  TInput extends PartialInput,
  const TPaths extends RequiredPaths,
  const TSelection extends DeepPickN<TInput, TPaths>,
  const TMessage extends
    | ErrorMessage<PartialCheckIssue<TSelection>>
    | undefined,
>(
  paths: ValidPaths<TInput, TPaths>,
  requirement: (
    input: TSelection,
    context: ValidationContext
  ) => MaybePromise<boolean>,
  message: TMessage
): PartialCheckActionAsync<TInput, TPaths, TSelection, TMessage>;

/** Gate refinement using declared paths, then await the trusted predicate on the original whole value with the root cooperative signal. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {Paths} paths - Borrowed declared issue-path selection for eligibility/inference; it is not data redaction, projection or authorization.
 * @param {(input: PartialInput, context: ValidationContext) => MaybePromise<boolean>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {ErrorMessage<PartialCheckIssue<PartialInput>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {PartialCheckActionAsync<PartialInput, Paths, PartialInput, ErrorMessage<PartialCheckIssue<PartialInput>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function partialCheckAsync(
  paths: Paths,
  requirement: (
    input: PartialInput,
    context: ValidationContext
  ) => MaybePromise<boolean>,
  message?: ErrorMessage<PartialCheckIssue<PartialInput>>
): PartialCheckActionAsync<
  PartialInput,
  Paths,
  PartialInput,
  ErrorMessage<PartialCheckIssue<PartialInput>> | undefined
> {
  return {
    kind: 'validation',
    type: 'partial_check',
    reference: partialCheckAsync,
    async: true,
    expects: null,
    paths,
    requirement,
    message,
    /** Gate refinement using declared paths, then await the trusted predicate on the original whole value with the root cooperative signal. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {Promise<import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    async '~run'(dataset, config) {
      if (
        (dataset.typed || _isPartiallyTyped(dataset, paths)) &&
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        !(await this.requirement(dataset.value, { signal: config.signal }))
      ) {
        _addIssue(this, 'input', dataset, config);
      }
      return dataset;
    },
  };
}
