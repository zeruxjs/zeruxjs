import { safeCode, type ClientIssue } from './client.js';
/** The host owns field lookup and stable ARIA description IDs; no selectors are built. */
export interface FeedbackTarget { control: Element; description: HTMLElement }
export interface FormFeedbackOptions {
  resolveField: (path: string) => FeedbackTarget | undefined;
  /** Safe notification only: no field values, issue messages, paths or file contents. */
  onIssue?: (event: { readonly code: string }) => void;
}

/** Opt-in browser feedback. No DOM access on import and no framework/listener runtime.
 * clear/destroy restore owned ARIA attributes and description text exactly.
 */
export function createFormFeedback(options: FormFeedbackOptions) {
  if (!options || typeof options.resolveField !== 'function' || (options.onIssue !== undefined && typeof options.onIssue !== 'function')) throw new TypeError('Expected feedback callbacks');
  const originals = new Map<Element, { target: FeedbackTarget; invalid: string | null; describedBy: string | null; text: string | null }>();
  let destroyed = false;
  const restore = (element: Element, name: string, value: string | null) => value === null ? element.removeAttribute(name) : element.setAttribute(name, value);
  function clear() {
    for (const [element, prior] of originals) {
      restore(element, 'aria-invalid', prior.invalid);
      restore(element, 'aria-describedby', prior.describedBy);
      prior.target.description.textContent = prior.text;
    }
    originals.clear();
  }
  return {
    update(issues: readonly ClientIssue[]) {
      if (destroyed) throw new Error('Form feedback is destroyed');
      if (!Array.isArray(issues) || issues.length > 20 || issues.some(issue => !issue || typeof issue.path !== 'string' || issue.path.length > 300)) throw new TypeError('Expected at most 20 client issues');
      clear();
      try {
        for (const issue of issues) {
          const target = options.resolveField(issue.path);
          if (target && typeof (target as unknown as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(target).catch(() => {});
            throw new TypeError('Field resolvers must be synchronous');
          }
          if (!target || originals.has(target.control)) continue;
          const id = target.description.getAttribute('id');
          if (!id || /\s/.test(id)) throw new TypeError('Each feedback description needs a stable, whitespace-free ID');
          const invalid = target.control.getAttribute('aria-invalid');
          const describedBy = target.control.getAttribute('aria-describedby');
          originals.set(target.control, { target, invalid, describedBy, text: target.description.textContent });
          target.control.setAttribute('aria-invalid', 'true');
          target.control.setAttribute('aria-describedby', [...new Set([...(describedBy?.split(/\s+/).filter(Boolean) ?? []), id])].join(' '));
          target.description.textContent = 'Invalid input';
          const notification = options.onIssue?.({ code: safeCode(issue.code) });
          // Async callbacks are deliberately unsupported; observe misuse rejections.
          if (notification && typeof (notification as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(notification).catch(() => {});
            throw new TypeError('Feedback notifications must be synchronous');
          }
        }
      } catch (error) { clear(); throw error; }
    },
    clear,
    destroy() { clear(); destroyed = true; }
  };
}
