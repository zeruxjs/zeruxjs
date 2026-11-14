import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * File issue interface.
 */
export interface FileIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw objects and messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable native-object discriminator for structured issue codes.
   */
  readonly type: 'file';
  /**
   * Fixed private diagnostic expectation, not a content, URL or authorization policy.
   */
  readonly expected: 'File';
}

/**
 * File schema interface.
 */
export interface FileSchema<
  TMessage extends ErrorMessage<FileIssue> | undefined,
> extends BaseSchema<File, File, FileIssue> {
  /**
   * Fixed file discriminator; accepted objects retain borrowed identity.
   */
  readonly type: 'file';
  /**
   * Authored constructor reference; no native object is created on import.
   */
  readonly reference: typeof file;
  /**
   * Fixed private diagnostic expectation, not a content, URL or authorization policy.
   */
  readonly expects: 'File';
  /**
   * Optional borrowed trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/**
 * Validate instances of the runtime File class without trusting filename, MIME, contents or storage permissions. The required runtime class is accessed only during explicit validation.
 *
 * @returns {FileSchema<undefined>} Inert native-object schema; no content read, cloning or ownership transfer.
 */
export function file(): FileSchema<undefined>;

/**
 * Validate instances of the runtime File class without trusting filename, MIME, contents or storage permissions. The required runtime class is accessed only during explicit validation.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy.
 *
 * @returns {FileSchema<TMessage>} Inert schema retaining the supplied private diagnostic policy.
 */
export function file<
  const TMessage extends ErrorMessage<FileIssue> | undefined,
>(message: TMessage): FileSchema<TMessage>;

/** Build an explicit runtime-class check without creating, reading or storing binary/date objects.
 * @param {ErrorMessage<FileIssue>} message - Optional trusted private diagnostic text/callback.
 * @returns {FileSchema<ErrorMessage<FileIssue> | undefined>} Inert schema validating instances of the runtime File class without trusting filename, MIME, contents or storage permissions.
 */
// @__NO_SIDE_EFFECTS__
export function file(
  message?: ErrorMessage<FileIssue>
): FileSchema<ErrorMessage<FileIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'file',
    reference: file,
    expects: 'File',
    async: false,
    message,
    /** Adapt explicit validation to shared root budgets and cleanup.
     * @returns {object} Inert Standard Schema V1 adapter; no DOM access occurs merely on import.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Perform the declared native-object check while preserving caller-owned identity.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private candidate object.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Root issue budget and private message policy.
     * @returns {OutputDataset<File, FileIssue>} Declared native-object dataset; host still owns content validation and lifetime.
     */
    '~run'(dataset, config) {
      if (dataset.value instanceof File) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<File, FileIssue>;
    },
  };
}
