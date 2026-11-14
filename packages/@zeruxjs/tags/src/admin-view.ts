import type { TagAdminClient } from './admin-client.js';
import type { TagContainer } from './types.js';
export interface TagAdminViewOptions {
  /** Optional trusted host UI callbacks, never saved in container definitions. */
  slots?: {
    /** Optional synchronous toolbar augmentation; return its owned disposer. */
    toolbar?: (
      host: HTMLElement,
      actions: {
        /** Explicit reload action; no network operation occurs merely from mounting. */
        reload: () => Promise<void>;
      }
    ) => void | (() => void);
    /** Optional synchronous editor renderer over a cloned document; return its disposer. */
    editor?: (
      host: HTMLElement,
      document: Readonly<TagContainer>,
      change: (value: string) => void
    ) => void | (() => void);
  };
}
/** Optional scoped CSS text; host inserts it under its CSP and preserves contrast/visible focus. */
export const tagAdminStyles =
  '.zerux-tags-admin{--tags-gap:12px;--tags-border:#888;--tags-focus:#2563eb;display:grid;gap:var(--tags-gap)}.zerux-tags-admin textarea{box-sizing:border-box;width:100%;min-height:16rem;font:inherit;border:1px solid var(--tags-border)}.zerux-tags-admin button:focus-visible,.zerux-tags-admin textarea:focus-visible,.zerux-tags-admin input:focus-visible{outline:3px solid var(--tags-focus);outline-offset:3px}';
/** Mount an optional labeled DOM view over a borrowed headless client. No fetch occurs until an action/reload; the view owns only its subtree, listeners and cooperative signal.
 * @param {HTMLElement} host - Explicit live DOM container whose ownerDocument creates all nodes.
 * @param {TagAdminClient} client - Borrowed authorized admin client; destroying this view never closes it.
 * @param {TagAdminViewOptions} options - Optional trusted synchronous UI slots returning their own cleanup functions.
 * @returns {object} Reload, element and idempotent destroy handle; caller separately closes any client it owns.
 */
export function mountTagAdmin(
  host: HTMLElement,
  client: TagAdminClient,
  options: TagAdminViewOptions = {}
) {
  if (!host?.ownerDocument || typeof client?.load !== 'function') {
    throw new TypeError('DOM host and admin client required');
  }
  /** Borrowed host ownerDocument; no ambient global document is required at import. */
  const doc = host.ownerDocument;
  /** Owned labeled administration subtree removed on destroy. */
  const root = doc.createElement('section');
  root.className = 'zerux-tags-admin';
  root.setAttribute('aria-label', 'Tag container administration');
  host.append(root);
  /** Owned cooperative signal passed to client actions; it cannot force-cancel arbitrary host code. */
  const scope = new AbortController();
  /** Owned native listener and trusted slot disposers run during teardown. */
  const cleanups: Array<() => void> = [];
  let current: TagContainer | undefined,
    text = '',
    destroyed = false,
    busy = false,
    editorCleanup: (() => void) | undefined;
  /** Create one owned text-only child.
   * @param {string} tag - Trusted native element tag.
   * @param {string} label - Authored inert text label.
   * @returns {HTMLElement} Appended owned element, never parsed HTML.
   */
  const node = (tag: string, label: string) => {
    /** New owned native node whose label is assigned through textContent. */
    const el = doc.createElement(tag);
    el.textContent = label;
    root.append(el);
    return el;
  };
  node('h2', 'Tag container administration');
  /** Owned polite live-region status; server error bodies are never rendered. */
  const status = node('p', 'No draft loaded');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  /** Owned labeled action navigation container. */
  const toolbar = node('nav', '');
  /** Owned replaceable editor subtree; custom slots own their additional semantics. */
  const editor = node('div', '');
  toolbar.setAttribute('aria-label', 'Draft actions');
  /** Owned native action controls disabled only during a pending UI action. */
  const buttons: HTMLButtonElement[] = [];
  /** Update the visible live-region status while mounted.
   * @param {string} message - Fixed authored outcome message.
   * @returns {void} Completes without repainting a destroyed view.
   */
  const say = (message: string) => {
    if (!destroyed) {
      status.textContent = message;
    }
  };
  /** Replace only the owned editor subtree and run its previous cleanup. Stored names/definitions remain text or textarea values, never HTML.
   * @returns {void} Updates the active view unless destroyed or no draft is loaded.
   */
  function render() {
    if (destroyed || !current) {
      return;
    }
    editorCleanup?.();
    editorCleanup = undefined;
    editor.replaceChildren();
    text = JSON.stringify(current, null, 2);
    if (options.slots?.editor) {
      /** Trusted slot cleanup handle retained only when it is callable. */
      const cleanup = options.slots.editor(
        editor,
        structuredClone(current),
        (value) => {
          if (!destroyed) {
            text = value;
          }
        }
      );
      if (typeof cleanup === 'function') {
        editorCleanup = cleanup;
      }
    } else {
      /** Explicit native label wrapping its control; stored strings are never parsed as markup. */
      const label = doc.createElement('label');
      label.textContent = 'Draft container JSON';
      /** Owned draft textarea; inert text preserves user edits through conflict. */
      const area = doc.createElement('textarea');
      area.value = text;
      /** Copy current textarea text to the local edit buffer.
       * @returns {string} Updated buffer; nothing is parsed or executed by this listener.
       */
      const change = () => (text = area.value);
      area.addEventListener('input', change);
      editorCleanup = () => area.removeEventListener('input', change);
      label.append(area);
      editor.append(label);
    }
  }
  /** Check the explicit edit buffer before JSON parsing or server submission.
   * @returns {string} Current UTF-8 edit buffer at most 128 KiB; oversized input rejects.
   */
  function boundedText() {
    if (new TextEncoder().encode(text).byteLength > 131072) {
      throw new RangeError('Draft edit exceeds limit');
    }
    return text;
  }
  /** Serialize UI actions while preserving native focusable controls and unsaved text on conflict. Button disabling is not durable idempotency.
   * @param {() => Promise<void>} action - Trusted explicit asynchronous client action; server authorization remains mandatory.
   * @returns {Promise<void>} Action observation with redacted status; no automatic mutation retry occurs.
   */
  async function work(action: () => Promise<void>) {
    if (busy || destroyed) {
      return;
    }
    busy = true;
    buttons.forEach((b) => (b.disabled = true));
    try {
      await action();
    } catch (error) {
      /** Selected public client receipt fields used for fixed redacted status messages. */
      const e = error as {
        code?: string;
        committed?: boolean;
        uncertain?: boolean;
      };
      // Preserve edits and distinguish unknown/committed outcomes before offering any retry.
      if (e.uncertain) {
        say('Operation outcome unknown. Reload status before any retry.');
      } else if (e.committed) {
        say(
          'Operation committed; audit recording unavailable. Reload status; do not retry.'
        );
      } else if (e.code === 'conflict') {
        say(
          'Revision conflict. Your edits are retained; reload explicitly before reapplying.'
        );
      } else {
        say('Operation unavailable or denied. No automatic retry.');
      }
    } finally {
      busy = false;
      if (!destroyed) {
        buttons.forEach((b) => (b.disabled = false));
      }
    }
  }
  /** Explicitly load and render the authorized draft through serialized UI work.
   * @returns {Promise<void>} Observation result; no request starts before this call.
   */
  const reload = () =>
    work(async () => {
      /** Loaded draft returned by the authorized client; server remains schema authority. */
      const value = await client.load(scope.signal);
      if (destroyed) {
        return;
      }
      current = value;
      render();
      say('Draft revision ' + value.version + ' loaded');
    });
  /** Create a labeled native button and register its owned listener cleanup.
   * @param {string} label - Explicit authored visible label; never invented from arbitrary content.
   * @param {() => Promise<void>} action - Trusted host action invoked only by the button event.
   * @returns {void} Appends the owned button to the toolbar and tracks its listener.
   */
  function button(label: string, action: () => Promise<void>) {
    /** Owned native button; no positive tabindex or manufactured tab order. */
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    /** Invoke the trusted explicit native-button action.
     * @returns {void} Starts the declared observation; listener ownership remains with the view.
     */
    const click = () => {
      void action();
    };
    b.addEventListener('click', click);
    cleanups.push(() => b.removeEventListener('click', click));
    toolbar.append(b);
    buttons.push(b);
  }
  button('Reload draft', reload);
  button('Validate draft', () =>
    work(async () => {
      await client.validate(JSON.parse(boundedText()), scope.signal);
      say('Draft valid; not saved or published');
    })
  );
  button('Save draft', () =>
    work(async () => {
      if (!current) {
        throw Error('Load first');
      }
      /** Parsed bounded edit proposal with server governance removed and next optimistic revision. */
      const proposal = JSON.parse(boundedText()) as TagContainer;
      delete proposal.governance;
      proposal.version = current.version + 1;
      await client.save(proposal, scope.signal);
      if (destroyed) {
        return;
      }
      current = { ...proposal };
      render();
      say('Draft saved; publish is separate');
    })
  );
  button('Publish draft', () =>
    work(async () => {
      if (!current) {
        throw Error('Load first');
      }
      await client.publish(current.version, scope.signal);
      if (destroyed) {
        return;
      }
      current = await client.load(scope.signal);
      render();
      say('Draft published');
    })
  );
  /** Explicit native label wrapping its control; stored strings are never parsed as markup. */
  const label = node('label', 'Rollback release ID');
  /** Native numeric input for an explicitly selected retained release ID. */
  const release = doc.createElement('input');
  release.type = 'number';
  release.min = '1';
  label.append(release);
  button('Roll back live release', () =>
    work(async () => {
      /** Validated positive retained release identifier; no guessed publication mutation occurs. */
      const id = Number(release.value);
      if (!current || !Number.isSafeInteger(id) || id < 1) {
        throw Error('Select release');
      }
      await client.rollback(current.version, id, scope.signal);
      if (destroyed) {
        return;
      }
      current = await client.load(scope.signal);
      render();
      say('Live release rolled back; draft retained');
    })
  );
  try {
    /** Trusted slot cleanup handle retained only when it is callable. */
    const cleanup = options.slots?.toolbar?.(toolbar, { reload });
    if (typeof cleanup === 'function') {
      cleanups.push(cleanup);
    }
  } catch (error) {
    root.remove();
    throw error;
  }
  return {
    reload,
    element: root,
    /** Abort view-scoped observations and remove editor/slot/listener resources plus the owned subtree. The borrowed client remains host-owned.
     * @returns {void} Idempotent teardown; cleanup failures do not prevent remaining listeners/subtree removal.
     */
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      scope.abort();
      try {
        editorCleanup?.();
      } finally {
        // Release every owned listener/slot even when an individual disposer fails.
        for (const cleanup of cleanups.reverse()) {
          try {
            cleanup();
          } catch {
            /* Keep removing owned listeners. */
          }
        }
        root.remove();
      }
    },
  };
}
