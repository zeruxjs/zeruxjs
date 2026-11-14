import { safeCode, type ClientIssue } from './client.js';
/** The host owns field lookup and stable ARIA description IDs; no selectors are built. */
export interface FeedbackTarget {
  /** Borrowed explicit host-resolved control; no input value is read. */
  control: Element;
  /** Borrowed host description element with a stable whitespace-free ID. */
  description: HTMLElement;
}
export interface FormFeedbackOptions {
  /** Trusted synchronous mapping from known paths to elements; never a selector generated from input. */
  resolveField: (path: string) => FeedbackTarget | undefined;
  /** Safe notification only: no field values, issue messages, paths or file contents. */
  onIssue?: (event: {
    /** Sanitized public issue category only, without values, messages, paths or file contents. */
    readonly code: string;
  }) => void;
}

/** Create opt-in browser feedback with explicit host field lookup and captured-original ARIA/text ownership. No DOM, listeners or background validation starts on import; do not assign competing attribute owners while active.
 * @param {FormFeedbackOptions} options - Trusted synchronous field resolver and optional value-free notification callback.
 * @returns {object} Owned update/clear/destroy scope; destroy restores original attributes/text and rejects later updates.
 */
export function createFormFeedback(options: FormFeedbackOptions) {
  if (
    !options ||
    typeof options.resolveField !== 'function' ||
    (options.onIssue !== undefined && typeof options.onIssue !== 'function')
  ) {
    throw new TypeError('Expected feedback callbacks');
  }
  /** Owned snapshots for explicit borrowed controls; clear/destroy restores them before releasing references. */
  const originals = new Map<
    Element,
    {
      /** Borrowed element pair whose original attributes/text are captured before mutation. */
      target: FeedbackTarget;
      /** Captured original aria-invalid attribute, including absence. */
      invalid: string | null;
      /** Captured original aria-describedby attribute, including absence. */
      describedBy: string | null;
      /** Captured original description text, including null. */
      text: string | null;
    }
  >();
  let destroyed = false;
  /** Restore an original attribute value, preserving complete absence.
   * @param {Element} element - Borrowed explicitly resolved control.
   * @param {string} name - Fixed owned ARIA attribute name.
   * @param {string | null} value - Captured original value; null means remove the attribute.
   * @returns {void} Restores the host-authored original attribute state.
   */
  const restore = (element: Element, name: string, value: string | null) =>
    value === null
      ? element.removeAttribute(name)
      : element.setAttribute(name, value);
  /** Restore every captured ARIA attribute and description text exactly, then release the owned snapshots.
   * @returns {void} Completes without reading any input value or file content.
   */
  function clear() {
    // Restore every owned element before releasing snapshots, preserving unrelated relationships.
    for (const [element, prior] of originals) {
      restore(element, 'aria-invalid', prior.invalid);
      restore(element, 'aria-describedby', prior.describedBy);
      prior.target.description.textContent = prior.text;
    }
    originals.clear();
  }
  return {
    /** Replace feedback for at most twenty bounded public issues using explicit field resolution. Resolver/notification failures roll back this update; arbitrary custom messages are never inserted.
     * @param {readonly ClientIssue[]} issues - Bounded client-safe issues; paths select only host-registered elements, never interpolated selectors.
     * @returns {void} Updates owned attributes/text synchronously or restores them before propagating callback failure.
     */
    update(issues: readonly ClientIssue[]) {
      if (destroyed) {
        throw new Error('Form feedback is destroyed');
      }
      if (
        !Array.isArray(issues) ||
        issues.length > 20 ||
        issues.some(
          (issue) =>
            !issue || typeof issue.path !== 'string' || issue.path.length > 300
        )
      ) {
        throw new TypeError('Expected at most 20 client issues');
      }
      clear();
      try {
        // Only explicit host-resolved fields receive inert generic feedback.
        for (const issue of issues) {
          /** Synchronous trusted field lookup result; thenable misuse is observed and rejected. */
          const target = options.resolveField(issue.path);
          if (
            target &&
            typeof (target as unknown as PromiseLike<unknown>).then ===
              'function'
          ) {
            void Promise.resolve(target).catch(() => {});
            throw new TypeError('Field resolvers must be synchronous');
          }
          if (!target || originals.has(target.control)) {
            continue;
          }
          /** Host-authored stable description ID; no guessed labels or selectors. */
          const id = target.description.getAttribute('id');
          if (!id || /\s/.test(id)) {
            throw new TypeError(
              'Each feedback description needs a stable, whitespace-free ID'
            );
          }
          /** Original aria-invalid attribute captured before the first owned mutation. */
          const invalid = target.control.getAttribute('aria-invalid');
          /** Original description relationships retained while adding the explicit error ID. */
          const describedBy = target.control.getAttribute('aria-describedby');
          originals.set(target.control, {
            target,
            invalid,
            describedBy,
            text: target.description.textContent,
          });
          target.control.setAttribute('aria-invalid', 'true');
          target.control.setAttribute(
            'aria-describedby',
            [
              ...new Set([
                ...(describedBy?.split(/\s+/).filter(Boolean) ?? []),
                id,
              ]),
            ].join(' ')
          );
          target.description.textContent = 'Invalid input';
          /** Optional value-free synchronous callback result; thenable rejection is observed before rollback. */
          const notification = options.onIssue?.({
            code: safeCode(issue.code),
          });
          // Async callbacks are deliberately unsupported; observe misuse rejections.
          if (
            notification &&
            typeof (notification as PromiseLike<unknown>).then === 'function'
          ) {
            void Promise.resolve(notification).catch(() => {});
            throw new TypeError('Feedback notifications must be synchronous');
          }
        }
      } catch (error) {
        clear();
        throw error;
      }
    },
    clear,
    /** Restore captured element state and permanently reject future updates; the host still owns the DOM nodes.
     * @returns {void} Idempotent synchronous cleanup without listener or network teardown.
     */
    destroy() {
      clear();
      destroyed = true;
    },
  };
}
