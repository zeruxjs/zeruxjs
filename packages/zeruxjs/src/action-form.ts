import {
  createFormFeedback,
  type FormFeedbackOptions,
  type ClientIssue,
} from '@zeruxjs/validator/browser';
export interface ActionFormOptions {
  /** Optional injected transport; action destination remains same-origin validated. */
  fetch?: typeof fetch;
  /** Host-owned field-to-control lookup used by validator feedback. */
  resolveField?: FormFeedbackOptions['resolveField'];
  /** Explicit synchronous host view callbacks; never automatic mutation replay. */
  optimistic?: {
    /** Apply the host-authored optimistic view change synchronously.
     * @returns {void} Optimistic mutation completion; no server persistence guarantee.
     */
    apply(): void; /** Restore the optimistic view after an unconfirmed attempt.
     * @returns {void} Synchronous view rollback completion.
     */
    rollback(): void; /** Keep the optimistic view only after an explicit committed response.
     * @returns {void} Synchronous committed-view confirmation.
     */
    commit?(): void;
  };
  /** Optional trusted same-origin navigation callback after confirmed persistence. */
  navigate?: (url: string) => void | Promise<void>;
  /** Request wait/cancellation deadline from 10 through 60000 milliseconds. */
  timeoutMs?: number;
  /** URL-encoded form-body limit from 128 through 131072 bytes. */
  maxBytes?: number;
}
/** Weak form ownership fence preventing duplicate enhancement of the same element. */
const owners = new WeakSet<HTMLFormElement>();
/** Enhance an authored POST form without embedding server action functions; ordinary browser submission remains available without this binding.
 * @param {HTMLFormElement} form - Host-owned same-origin URL-encoded POST form with server-issued action fields.
 * @param {ActionFormOptions} options - Explicit transport, feedback and synchronous optimistic callbacks.
 * @returns {object} Owned form enhancement; await close before removing its host resources.
 */
export function enhanceActionForm(
  form: HTMLFormElement,
  options: ActionFormOptions = {}
) {
  /** Owner-document window; missing DOM is rejected only when enhancement is invoked. */
  const win = form?.ownerDocument?.defaultView;
  if (
    !win ||
    form.tagName !== 'FORM' ||
    owners.has(form) ||
    form.method.toLowerCase() !== 'post' ||
    form.enctype !== 'application/x-www-form-urlencoded' ||
    !/^https?:$/.test(new URL(form.action).protocol) ||
    new URL(form.action).origin !== win.location.origin ||
    !form.querySelector('[name="_action_key"]') ||
    !form.querySelector('[name="_action_csrf"]') ||
    (options.fetch !== undefined && typeof options.fetch !== 'function') ||
    (options.resolveField !== undefined &&
      typeof options.resolveField !== 'function') ||
    (options.navigate !== undefined &&
      typeof options.navigate !== 'function') ||
    (options.optimistic &&
      (['apply', 'rollback'] as const).some(
        (key) => typeof options.optimistic![key] !== 'function'
      )) ||
    (options.optimistic?.commit !== undefined &&
      typeof options.optimistic.commit !== 'function')
  ) {
    throw new TypeError('Invalid action form');
  }
  if (
    options.optimistic &&
    [
      options.optimistic.apply,
      options.optimistic.rollback,
      options.optimistic.commit,
    ].some((fn) => fn?.constructor.name === 'AsyncFunction')
  ) {
    throw new TypeError('Optimistic callbacks must be synchronous');
  }
  options = {
    ...options,
    optimistic: options.optimistic
      ? {
          apply: options.optimistic.apply.bind(options.optimistic),
          rollback: options.optimistic.rollback.bind(options.optimistic),
          commit: options.optimistic.commit?.bind(options.optimistic),
        }
      : undefined,
  };
  /** Invoke an optimistic callback while rejecting asynchronous ownership ambiguity.
   * @param {Function} run - Trusted synchronous optimistic callback.
   * @returns {void} Callback completion; thenables reject without replaying the callback.
   */
  const synchronous = (run: () => void) => {
    /** Optimistic callback return inspected only to reject unexpected asynchronous work. */
    const value = run() as unknown;
    if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(value).catch(() => {});
      throw new TypeError('Expected synchronous callback');
    }
  };
  /** Explicit injected Fetch or borrowed owner-window Fetch, never an automatic cross-origin transport. */
  const transport = options.fetch ?? win.fetch?.bind(win);
  /** Validated request deadline in milliseconds. */
  const timeout = options.timeoutMs ?? 10000;
  /** Validated encoded form-body budget; server limits remain independently authoritative. */
  const maxBytes = options.maxBytes ?? 32768;
  if (
    !transport ||
    !Number.isSafeInteger(timeout) ||
    timeout < 10 ||
    timeout > 60000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 128 ||
    maxBytes > 131072
  ) {
    throw new TypeError('Invalid form limits');
  }
  /** Owned validator feedback binding disposed after the pending request settles. */
  const feedback = createFormFeedback({
    resolveField: options.resolveField ?? (() => undefined),
  });
  /** Owned focusable alert paragraph; private server issue values are never inserted. */
  const status = form.ownerDocument.createElement('p');
  status.setAttribute('role', 'alert');
  status.tabIndex = -1;
  form.append(status);
  let closed = false,
    busy = false,
    pending: Promise<void> | undefined,
    controller: AbortController | undefined,
    closing: Promise<void> | undefined;
  /** Intercept only eligible same-origin POST submissions and retain actual work until cleanup.
   * @param {SubmitEvent} event - Borrowed native form submission event.
   * @returns {void} Bounded request scheduling; duplicate UI submissions do not create server idempotence.
   */
  const submit = (event: SubmitEvent) => {
    if (closed || event.defaultPrevented) {
      return;
    }
    /** Native triggering control; authored form overrides defer to ordinary browser submission. */
    const submitter = event.submitter as HTMLElement | null;
    if (
      (form.target && form.target !== '_self') ||
      (submitter &&
        ['formaction', 'formmethod', 'formenctype', 'formtarget'].some((name) =>
          submitter.hasAttribute(name)
        ))
    ) {
      return;
    }
    event.preventDefault();
    if (busy) {
      return;
    }
    busy = true;
    status.textContent = '';
    feedback.clear();
    /** Original submit-control disabled states restored after this attempt settles. */
    const disabled = [...form.elements]
      .filter((element) =>
        ['submit', 'image'].includes((element as HTMLInputElement).type)
      )
      .map((element) => ({
        element: element as HTMLButtonElement,
        disabled: (element as HTMLButtonElement).disabled,
      }));
    /** Authored busy attribute restored after the attempt rather than unconditionally removed. */
    const priorBusy = form.getAttribute('aria-busy');
    /** Per-attempt cancellation owner retained until actual Fetch/reader settlement. */
    const requestController = new AbortController();
    controller = requestController;
    /** Per-attempt cancellation shared by Fetch and response reader cleanup. */
    const signal = requestController.signal;
    /** Owned request-deadline timer cleared on every terminal path. */
    const timer = setTimeout(() => requestController.abort(), timeout);
    let applied = false,
      confirmed = false;
    pending = (async () => {
      try {
        /** Native successful form controls including the selected submitter. */
        const data = new win.FormData(
          form,
          submitter as HTMLButtonElement | null
        );
        /** URL-encoded string fields; files and excessive fields reject before transport. */
        const body = new URLSearchParams();
        let fields = 0;
        for (const [name, value] of data) {
          if (++fields > 200 || typeof value !== 'string') {
            throw Error('Unsupported form');
          }
          body.append(name, value);
        }
        if (new TextEncoder().encode(body.toString()).length > maxBytes) {
          throw Error('Form limit');
        }
        for (const item of disabled) {
          item.element.disabled = true;
        }
        form.setAttribute('aria-busy', 'true');
        if (options.optimistic) {
          applied = true;
          synchronous(options.optimistic.apply);
        }
        /** Single non-replayed action response; redirects reject at the transport boundary. */
        const response = await transport(form.action, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          body,
          signal,
          redirect: 'error',
        });
        let size = 0,
          text = '';
        /** Owned response reader cancelled and unlocked before feedback or navigation. */
        const reader = response.body?.getReader();
        /** Streaming UTF-8 decoder preserving fragmented response code points. */
        const decoder = new TextDecoder();
        /** Cancel the active reader when request cancellation is observed.
         * @returns {void} Reader cancellation scheduling completion.
         */
        const abort = () => void reader?.cancel().catch(() => {});
        signal.addEventListener('abort', abort, { once: true });
        try {
          if (reader) {
            while (true) {
              signal.throwIfAborted();
              /** One bounded response chunk inspected before decoding. */
              const item = await reader.read();
              signal.throwIfAborted();
              if (item.done) {
                break;
              }
              size += item.value.byteLength;
              if (size > 32768) {
                throw Error('Response limit');
              }
              text += decoder.decode(item.value, { stream: true });
            }
          }
          text += decoder.decode();
        } finally {
          await reader?.cancel().catch(() => {});
          reader?.releaseLock();
          signal.removeEventListener('abort', abort);
        }
        if (closed || signal.aborted) {
          throw Error('Cancelled');
        }
        /** Untrusted JSON action result; only bounded expected feedback fields are projected. */
        const payload = JSON.parse(text);
        if (
          response.ok &&
          payload?.ok === true &&
          typeof payload.redirect === 'string'
        ) {
          /** Validated same-origin success redirect resolved against the authored form action. */
          const destination = new URL(payload.redirect, form.action);
          if (
            destination.origin !== win.location.origin ||
            !/^https?:$/.test(destination.protocol)
          ) {
            throw Error('Invalid redirect');
          }
          confirmed = true;
          if (options.optimistic?.commit) {
            synchronous(options.optimistic.commit);
          }
          /** Host navigation settlement observed separately from the already committed action. */
          const navigation = (
            options.navigate ??
            /** Navigate through the owner window only after same-origin validation.
             * @param {string} url - Validated destination URL.
             * @returns {void} Native navigation request completion.
             */
            ((url) => win.location.assign(url))
          )(destination.href);
          if (navigation && typeof navigation.then === 'function') {
            void navigation.catch(() => {
              if (!closed) {
                status.textContent =
                  'Saved, but the page could not be updated.';
                status.focus();
              }
            });
          }
          return;
        }
        if (payload?.outcome === 'committed' && response.status === 503) {
          confirmed = true;
          if (options.optimistic?.commit) {
            synchronous(options.optimistic.commit);
          }
          status.textContent = 'Saved, but refresh is required.';
          status.focus();
          return;
        }
        if (response.ok) {
          throw Error('Invalid action response');
        }
        /** Bounded path/code projection; server-provided messages and input values are excluded. */
        const issues: ClientIssue[] = Array.isArray(payload?.issues)
          ? payload.issues
              .slice(0, 20)
              .filter(
                (issue: any) =>
                  issue &&
                  typeof issue.path === 'string' &&
                  issue.path.length <= 300
              )
              .map((issue: any) => ({
                path: issue.path,
                code:
                  typeof issue.code === 'string' ? issue.code : 'validation',
                message: 'Invalid input',
              }))
          : [];
        feedback.update(issues);
        if (response.status === 422) {
          status.textContent = 'Correct the highlighted fields.';
        } else if (response.status === 409) {
          status.textContent =
            'This submission is already pending, expired or conflicts with an earlier submission.';
        } else if (response.status >= 500) {
          status.textContent =
            'Submission outcome is unknown. Check before trying again.';
        } else {
          status.textContent = 'Form was not submitted.';
        }
        /** Host-resolved invalid control used for focus, otherwise the owned alert receives focus. */
        const target = issues[0]
          ? options.resolveField?.(issues[0].path)?.control
          : undefined;
        if (target && 'focus' in target && typeof target.focus === 'function') {
          target.focus();
        } else {
          status.focus();
        }
      } catch {
        if (!closed) {
          status.textContent = confirmed
            ? 'Saved, but the page could not be updated.'
            : 'Submission outcome is unknown. Check before trying again.';
          status.focus();
        }
      } finally {
        clearTimeout(timer);
        if (applied && !confirmed) {
          try {
            synchronous(options.optimistic!.rollback);
          } catch {
            if (!closed) {
              status.textContent =
                'The view could not be restored. Reload to check the result.';
            }
          }
        }
        for (const item of disabled) {
          item.element.disabled = item.disabled;
        }
        if (priorBusy === null) {
          form.removeAttribute('aria-busy');
        } else {
          form.setAttribute('aria-busy', priorBusy);
        }
        busy = false;
      }
    })();
  };
  form.addEventListener('submit', submit);
  owners.add(form);
  return {
    /** Whether this enhancement currently owns an unsettled submission.
     * @returns {boolean} UI pending state, never a server idempotency claim.
     */
    get pending() {
      return busy;
    },
    /** Observe the current attempt without starting or replaying a mutation.
     * @returns {Promise<void>} Current attempt settlement, or an already resolved promise.
     */
    get settled() {
      return pending ?? Promise.resolve();
    },
    /** Abort observation, stop new submissions and await pending transport/rollback before removing owned feedback.
     * @returns {Promise<void>} Idempotent actual enhancement cleanup settlement.
     */
    close() {
      return (closing ??= (async () => {
        closed = true;
        controller?.abort();
        form.removeEventListener('submit', submit);
        await pending;
        feedback.destroy();
        status.remove();
        owners.delete(form);
      })());
    },
  };
}
