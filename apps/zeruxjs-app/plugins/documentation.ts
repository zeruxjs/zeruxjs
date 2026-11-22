import { registerFetchRoutes, type ZeruxPluginApi } from 'zeruxjs';
import { createDocumentationHandler } from '@zeruxjs/docs';
import {
  renderDocumentationDocument,
  documentationRedirects,
} from '@zeruxjs/docs/zerux';
import { createDocumentationSearch } from '@zeruxjs/docs/search';
import { documentation } from '../lib/docs/catalog.js';
/** Register public docs through normal framework Fetch routes without starting optional services.
 * @param {ZeruxPluginApi} api - Borrowed generation-scoped route owner.
 * @returns {void} Registration completion; no listener or storage resource is acquired.
 */
export default function installDocumentation(api: ZeruxPluginApi): void {
  /** The generation owns this optional public-only local index; private workspace data is never indexed. */
  const search = createDocumentationSearch(documentation);
  api.onDispose(() => search.destroy());
  registerFetchRoutes(api, [
    {
      path: '/docs/search',
      handler: (request) => {
        if (!['GET', 'HEAD'].includes(request.method)) {
          return new Response(null, {
            status: 405,
            headers: {
              Allow: 'GET, HEAD',
              'Cache-Control': 'private, no-store',
            },
          });
        }
        try {
          /** Query syntax is bounded by the package; clients cannot select private data or another index. */
          const results = search
            .search(new URL(request.url).searchParams.get('q') ?? '')
            .map((result) => ({
              title: result.document.title,
              url: result.document.url,
              score: result.score,
            }));
          return new Response(
            request.method === 'HEAD'
              ? null
              : JSON.stringify({ version: documentation.latest, results }),
            {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
              },
            }
          );
        } catch {
          return new Response('Invalid documentation query', {
            status: 400,
            headers: { 'Cache-Control': 'private, no-store' },
          });
        }
      },
    },
  ]);
  /** Immutable public catalog consumer shared only within this generation. */
  const handler = createDocumentationHandler(documentation, {
    enableLocalScripts: true,
    render: (page) =>
      renderDocumentationDocument(documentation, page, {
        siteTitle: 'Local integration documentation',
        stylesheet: '/docs/assets/docs.css',
        script: '/docs/assets/docs-client.js',
      }),
  });
  registerFetchRoutes(
    api,
    documentation.pages().map((page) => ({ path: page.url, handler }))
  );
  registerFetchRoutes(
    api,
    documentationRedirects(documentation, { landing: 'introduction' }).map(
      (route) => ({
        path: route.path,
        handler: (request) => {
          if (!['GET', 'HEAD'].includes(request.method)) {
            return new Response(null, {
              status: 405,
              headers: {
                Allow: 'GET, HEAD',
                'Cache-Control': 'private, no-store',
              },
            });
          }
          return new Response(null, {
            status: route.status,
            headers: {
              Location: route.redirect,
              'Cache-Control': 'private, no-store',
            },
          });
        },
      })
    )
  );
}
