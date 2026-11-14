import { createTagAdminClient } from '@zeruxjs/tags/admin-client';
import { mountTagAdmin } from '@zeruxjs/tags/admin-view';

/** Explicitly mount a browser UI with an owned client and view. Session token acquisition stays in the authenticated host flow; no network request occurs before load/action.
 * @param {HTMLElement} host - Explicit DOM mount owned by the calling application.
 * @param {(signal: AbortSignal) => Promise<string>} sessionToken - Trusted session-bound token resolver cooperating with the provided cancellation signal.
 * @returns {object} Explicit load and asynchronous destroy owner; destroy the view before draining the client.
 */
export function mountAdministration(
  host: HTMLElement,
  sessionToken: (signal: AbortSignal) => Promise<string>
) {
  /** Owned credentialed headless client; drain it after destroying the view. */
  const client = createTagAdminClient({
    apiBaseUrl: 'https://api.example.com/control/tags',
    csrfToken: sessionToken,
  }); // host obtains the token through its authenticated session flow
  /** Owned subtree/listeners borrowing the client; mounting does not automatically fetch. */
  const view = mountTagAdmin(host, client, {
    slots: {
      toolbar(container) {
        /** Owned inert host-slot message removed by the returned synchronous disposer. */
        const note = container.ownerDocument.createElement('p');
        note.textContent = 'Saving a draft never publishes it.';
        container.append(note);
        return () => note.remove();
      },
    },
  });
  return {
    load: () => view.reload(),
    async destroy() {
      view.destroy();
      await client.close();
    },
  };
}
// Host stylesheet may use exported tagAdminStyles and scoped --tags-* overrides.
// No application/server, asset compiler, session or cookie is started by these helpers.
