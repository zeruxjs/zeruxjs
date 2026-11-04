import {createTagAdminClient} from '@zeruxjs/tags/admin-client';
import {mountTagAdmin} from '@zeruxjs/tags/admin-view';

export function mountAdministration(host: HTMLElement, sessionToken: (signal: AbortSignal) => Promise<string>) {
  const client = createTagAdminClient({apiBaseUrl: 'https://api.example.com/control/tags',
    csrfToken: sessionToken}); // host obtains the token through its authenticated session flow
  const view = mountTagAdmin(host, client, {slots: {
    toolbar(container) {
      const note = container.ownerDocument.createElement('p');
      note.textContent = 'Saving a draft never publishes it.';
      container.append(note);
      return () => note.remove();
    },
  }});
  return {load: () => view.reload(), async destroy() {view.destroy(); await client.close();}};
}
// Host stylesheet may use exported tagAdminStyles and scoped --tags-* overrides.
// No application/server, asset compiler, session or cookie is started by these helpers.
