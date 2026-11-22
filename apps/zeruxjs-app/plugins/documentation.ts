import { registerFetchRoutes, type ZeruxPluginApi } from 'zeruxjs';
import { createDocumentationHandler } from '@zeruxjs/docs';
import { renderDocumentationArticle } from '@zeruxjs/docs/zerux';
import { documentation } from '../lib/docs/catalog.js';
/** Register public docs through normal framework Fetch routes without starting optional services.
 * @param {ZeruxPluginApi} api - Borrowed generation-scoped route owner.
 * @returns {void} Registration completion; no listener or storage resource is acquired.
 */
export default function installDocumentation(api: ZeruxPluginApi): void {
  /** Immutable public catalog consumer shared only within this generation. */
  const handler = createDocumentationHandler(documentation, {
    render: (page) =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local integration documentation</title></head><body>${renderDocumentationArticle(documentation, page)}</body></html>`,
  });
  registerFetchRoutes(
    api,
    documentation.pages().map((page) => ({ path: page.url, handler }))
  );
  registerFetchRoutes(api, [
    {
      path: '/docs',
      handler: () =>
        new Response(null, {
          status: 302,
          headers: { Location: '/docs/current/introduction/' },
        }),
    },
  ]);
}
