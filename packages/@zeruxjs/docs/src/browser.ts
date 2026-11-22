/** Optional DOM enhancement; importing this entry never reads window/document or starts work. */
export interface DocumentationEnhancementOptions {
  /** Host clipboard boundary; defaults to the current document's native clipboard API. */
  writeText?: (text: string) => Promise<void>;
  /** Finite enhancement ceiling, default 100 and maximum 200 blocks. */
  maxCodeBlocks?: number;
  /** Optional owner cancellation; abort removes controls and event listeners. */
  signal?: AbortSignal;
}
/** Enhance native code blocks with owned copy controls and explicit failure feedback.
 * @param {HTMLElement} root - Explicit mounted documentation container.
 * @param {DocumentationEnhancementOptions} [options] - Clipboard, block budget and optional owner signal.
 * @returns {{destroy:()=>void;readonly pending:boolean}} Idempotent teardown and current cooperative clipboard state.
 */
export function enhanceDocumentation(
  root: HTMLElement,
  options: DocumentationEnhancementOptions = {}
) {
  if (
    !root?.ownerDocument?.defaultView ||
    !(root instanceof root.ownerDocument.defaultView.HTMLElement)
  ) {
    throw new TypeError(
      'Documentation enhancement requires a mounted DOM element'
    );
  }
  options.signal?.throwIfAborted();
  /** Bound enhancement work before changing any authored DOM. */
  const maximum = options.maxCodeBlocks ?? 100;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 200) {
    throw new RangeError('Invalid code-block enhancement limit');
  }
  if (
    options.writeText !== undefined &&
    typeof options.writeText !== 'function'
  ) {
    throw new TypeError('Invalid clipboard adapter');
  }
  if (root.querySelector('[data-docs-copy-control]')) {
    throw new Error('Documentation copy controls already mounted');
  }
  /** Candidate inventory is fixed before controls are attached. */
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('pre[data-docs-code]')
  );
  if (blocks.length > maximum) {
    throw new RangeError('Documentation code-block limit');
  }
  /** The borrowed document owns native clipboard availability and permission checks. */
  const document = root.ownerDocument;
  /** No read access to the clipboard is used. */
  const native = document.defaultView!.navigator.clipboard;
  /** Clipboard writes happen only in the button click handler, never on mount or restore. */
  const write =
    options.writeText ??
    (native?.writeText ? (text: string) => native.writeText(text) : undefined);
  /** Only fixed operational text enters this live status, never copied source content. */
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.className = 'zerux-docs-copy-status';
  /** This scope owns only the nodes/listeners it creates. */
  const controls: { button: HTMLButtonElement; click: () => void }[] = [];
  let disposed = false;
  let pending = false;
  for (const block of blocks) {
    /** Native buttons retain keyboard activation; no custom tabindex/order is created. */
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Copy code';
    button.setAttribute('data-docs-copy-control', '');
    button.disabled = !write;
    if (!write) {
      button.title = 'Clipboard unavailable';
    }
    /** Copy a bounded text snapshot; code is never evaluated or sent to a service.
     * @returns {void} Starts one cooperative clipboard write, with fixed status feedback.
     */
    const click = () => {
      if (disposed || pending || !write) {
        return;
      }
      /** textContent excludes HTML execution and never reads unrelated document text. */
      const text = block.querySelector('code')?.textContent ?? '';
      if (text.length > 1_048_576) {
        status.textContent = 'Code block exceeds the copy limit.';
        return;
      }
      pending = true;
      button.disabled = true;
      // Invoke within the click itself so native transient user activation is retained where supported.
      let task: Promise<void>;
      try {
        task = Promise.resolve(write(text));
      } catch (error) {
        task = Promise.reject(error);
      }
      void task
        .then(() => {
          if (!disposed) {
            return write(text);
          }
        })
        .then(
          () => {
            if (!disposed) {
              status.textContent = 'Code copied.';
            }
          },
          () => {
            if (!disposed) {
              status.textContent =
                'Copy failed. Select the code and copy it manually.';
            }
          }
        )
        .finally(() => {
          pending = false;
          if (!disposed) {
            button.disabled = false;
          }
        });
    };
    button.addEventListener('click', click);
    block.insertAdjacentElement('afterend', button);
    controls.push({ button, click });
  }
  if (controls.length) {
    root.append(status);
  }
  /** Remove only owned resources; native clipboard work cannot be force-cancelled.
   * @returns {void} Idempotent listener/node disposal; authored nodes/attributes remain unchanged.
   */
  const destroy = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    options.signal?.removeEventListener('abort', destroy);
    for (const { button, click } of controls) {
      button.removeEventListener('click', click);
      button.remove();
    }
    status.remove();
  };
  options.signal?.addEventListener('abort', destroy, { once: true });
  if (options.signal?.aborted) {
    destroy();
  }
  return {
    destroy,
    get pending() {
      return pending;
    },
  };
}
