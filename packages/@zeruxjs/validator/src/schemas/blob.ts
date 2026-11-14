import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Blob issue interface.
 */
export interface BlobIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw objects and messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable native-object discriminator for structured issue codes.
   */
  readonly type: 'blob';
  /**
   * Fixed private diagnostic expectation, not a content, URL or authorization policy.
   */
  readonly expected: 'Blob';
}

/**
 * Blob schema interface.
 */
export interface BlobSchema<
  TMessage extends ErrorMessage<BlobIssue> | undefined,
> extends BaseSchema<Blob, Blob, BlobIssue> {
  /**
   * Fixed blob discriminator; accepted objects retain borrowed identity.
   */
  readonly type: 'blob';
  /**
   * Authored constructor reference; no native object is created on import.
   */
  readonly reference: typeof blob;
  /**
   * Fixed private diagnostic expectation, not a content, URL or authorization policy.
   */
  readonly expects: 'Blob';
  /**
   * Optional borrowed trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/**
 * Validate instances of the runtime Blob class without reading contents or enforcing MIME/byte policy. The required runtime class is accessed only during explicit validation.
 *
 * @returns {BlobSchema<undefined>} Inert native-object schema; no content read, cloning or ownership transfer.
 */
export function blob(): BlobSchema<undefined>;

/**
 * Validate instances of the runtime Blob class without reading contents or enforcing MIME/byte policy. The required runtime class is accessed only during explicit validation.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy.
 *
 * @returns {BlobSchema<TMessage>} Inert schema retaining the supplied private diagnostic policy.
 */
export function blob<
  const TMessage extends ErrorMessage<BlobIssue> | undefined,
>(message: TMessage): BlobSchema<TMessage>;

/** Build an explicit runtime-class check without creating, reading or storing binary/date objects.
 * @param {ErrorMessage<BlobIssue>} message - Optional trusted private diagnostic text/callback.
 * @returns {BlobSchema<ErrorMessage<BlobIssue> | undefined>} Inert schema validating instances of the runtime Blob class without reading contents or enforcing MIME/byte policy.
 */
// @__NO_SIDE_EFFECTS__
export function blob(
  message?: ErrorMessage<BlobIssue>
): BlobSchema<ErrorMessage<BlobIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'blob',
    reference: blob,
    expects: 'Blob',
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
     * @returns {OutputDataset<Blob, BlobIssue>} Declared native-object dataset; host still owns content validation and lifetime.
     */
    '~run'(dataset, config) {
      if (dataset.value instanceof Blob) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<Blob, BlobIssue>;
    },
  };
}
