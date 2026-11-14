import type { BaseValidation, ErrorMessage } from '../types/index.js';
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
 * Partial check action interface.
 */
export interface PartialCheckAction<
  TInput extends PartialInput,
  TPaths extends Paths,
  TSelection extends DeepPickN<TInput, TPaths>,
  TMessage extends ErrorMessage<PartialCheckIssue<TSelection>> | undefined,
> extends BaseValidation<TInput, TInput, PartialCheckIssue<TSelection>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'partial_check';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof partialCheck;
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
  readonly requirement: (input: TSelection) => boolean;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Use declared paths only to gate refinement eligibility/type inference; pass the original whole dataset value, not a projected object, to the trusted synchronous predicate. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ValidPaths<TInput, TPaths>} paths - Borrowed declared issue-path selection for eligibility/inference; it is not data redaction, projection or authorization.
 * @param {(input: TSelection) => boolean} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @returns {PartialCheckAction<TInput, TPaths, TSelection, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function partialCheck<
  TInput extends PartialInput,
  const TPaths extends RequiredPaths,
  const TSelection extends DeepPickN<TInput, TPaths>,
>(
  paths: ValidPaths<TInput, TPaths>,
  requirement: (input: TSelection) => boolean
): PartialCheckAction<TInput, TPaths, TSelection, undefined>;

/** Use declared paths only to gate refinement eligibility/type inference; pass the original whole dataset value, not a projected object, to the trusted synchronous predicate. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ValidPaths<TInput, TPaths>} paths - Borrowed declared issue-path selection for eligibility/inference; it is not data redaction, projection or authorization.
 * @param {(input: TSelection) => boolean} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {PartialCheckAction<TInput, TPaths, TSelection, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function partialCheck<
  TInput extends PartialInput,
  const TPaths extends RequiredPaths,
  const TSelection extends DeepPickN<TInput, TPaths>,
  const TMessage extends
    | ErrorMessage<PartialCheckIssue<TSelection>>
    | undefined,
>(
  paths: ValidPaths<TInput, TPaths>,
  requirement: (input: TSelection) => boolean,
  message: TMessage
): PartialCheckAction<TInput, TPaths, TSelection, TMessage>;

/** Use declared paths only to gate refinement eligibility/type inference; pass the original whole dataset value, not a projected object, to the trusted synchronous predicate. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {Paths} paths - Borrowed declared issue-path selection for eligibility/inference; it is not data redaction, projection or authorization.
 * @param {(input: PartialInput) => boolean} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {ErrorMessage<PartialCheckIssue<PartialInput>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {PartialCheckAction<PartialInput, Paths, PartialInput, ErrorMessage<PartialCheckIssue<PartialInput>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function partialCheck(
  paths: Paths,
  requirement: (input: PartialInput) => boolean,
  message?: ErrorMessage<PartialCheckIssue<PartialInput>>
): PartialCheckAction<
  PartialInput,
  Paths,
  PartialInput,
  ErrorMessage<PartialCheckIssue<PartialInput>> | undefined
> {
  return {
    kind: 'validation',
    type: 'partial_check',
    reference: partialCheck,
    async: false,
    expects: null,
    paths,
    requirement,
    message,
    /** Use declared paths only to gate refinement eligibility/type inference; pass the original whole dataset value, not a projected object, to the trusted synchronous predicate. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (
        (dataset.typed || _isPartiallyTyped(dataset, paths)) &&
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        !this.requirement(dataset.value)
      ) {
        _addIssue(this, 'input', dataset, config);
      }
      return dataset;
    },
  };
}
