import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Trusted newable constructor type. This API never resolves a class name from untrusted data or instantiates the constructor.
 */

export type Class = new (...args: any[]) => any;

/**
 * Instance issue interface.
 */
export interface InstanceIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw candidate objects/messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable instance-check discriminator for structured issue codes.
   */
  readonly type: 'instance';
  /**
   * Private constructor-name diagnostic, not a structural validation or permission grant.
   */
  readonly expected: string;
}

/**
 * Instance schema interface.
 */
export interface InstanceSchema<
  TClass extends Class,
  TMessage extends ErrorMessage<InstanceIssue> | undefined,
> extends BaseSchema<
  InstanceType<TClass>,
  InstanceType<TClass>,
  InstanceIssue
> {
  /**
   * Fixed instance discriminator; native instanceof semantics remain authoritative.
   */
  readonly type: 'instance';
  /**
   * Authored schema constructor reference, never an executable module path from input.
   */
  readonly reference: typeof instance;
  /**
   * Borrowed trusted constructor; custom Symbol.hasInstance behavior remains host code.
   */
  readonly class: TClass;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/**
 * Check an explicitly trusted constructor with instanceof without instantiating it or evaluating source. Custom constructor metadata/has-instance hooks are not sandboxed.
 *
 * @param {TClass} class_ - Explicit borrowed newable constructor; never a caller-supplied class/module name string.
 *
 * @returns {InstanceSchema<TClass, undefined>} Inert identity check; no field validation, cloning or authorization is inferred.
 */
export function instance<TClass extends Class>(
  class_: TClass
): InstanceSchema<TClass, undefined>;

/**
 * Check an explicitly trusted constructor with instanceof without instantiating it or evaluating source. Custom constructor metadata/has-instance hooks are not sandboxed.
 *
 * @param {TClass} class_ - Explicit borrowed newable constructor; never a caller-supplied class/module name string.
 * @param {TMessage} message - Optional trusted private diagnostic policy.
 *
 * @returns {InstanceSchema<TClass, TMessage>} Inert wrapper retaining trusted constructor/message references.
 */
export function instance<
  TClass extends Class,
  const TMessage extends ErrorMessage<InstanceIssue> | undefined,
>(class_: TClass, message: TMessage): InstanceSchema<TClass, TMessage>;

/** Capture an explicit trusted constructor and its diagnostic name without instantiating it.
 * @param {Class} class_ - Borrowed newable constructor; metadata and Symbol.hasInstance hooks remain trusted code.
 * @param {ErrorMessage<InstanceIssue>} message - Optional private diagnostic policy.
 * @returns {InstanceSchema<Class, ErrorMessage<InstanceIssue> | undefined>} Inert instanceof schema without source/module discovery.
 */
// @__NO_SIDE_EFFECTS__
export function instance(
  class_: Class,
  message?: ErrorMessage<InstanceIssue>
): InstanceSchema<Class, ErrorMessage<InstanceIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'instance',
    reference: instance,
    expects: class_.name,
    async: false,
    class: class_,
    message,
    /** Adapt explicit validation to the bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Apply trusted constructor instanceof semantics; accepted input retains its identity.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private candidate instance.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Root budgets and private message policy.
     * @returns {OutputDataset<InstanceType<Class>, InstanceIssue>} Declared instance dataset, not a deep structural or authorization check.
     */
    '~run'(dataset, config) {
      if (dataset.value instanceof this.class) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<InstanceType<Class>, InstanceIssue>;
    },
  };
}
