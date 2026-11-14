import { createSecurityHeaders } from '@zeruxjs/security';
import { randomBytes } from 'node:crypto';
import { h, type VNodeChild } from 'zyrojs/component';
import { renderToString } from 'zyrojs/dom';
/** Private no-store baseline with fixed security policy; response HTML adds its own style nonce. */
export const headers = {
  ...createSecurityHeaders({
    referrerPolicy: 'same-origin',
    frameOptions: 'DENY',
  }),
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'content-security-policy':
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
/** Fixed public route/label inventory; stored notes cannot add scripts or executable links. */
const nav = [
  ['/workspace', 'Workspace'],
  ['/workspace/notes', 'Notebook'],
  ['/workspace/search', 'Search'],
  ['/workspace/files', 'Files'],
  ['/workspace/assets', 'Assets'],
  ['/workspace/share', 'Short links'],
  ['/workspace/email', 'Email templates'],
  ['/workspace/experiments', 'Experiments'],
  ['/workspace/protocols', 'Protocols'],
  ['/workspace/lab', 'Browser lab'],
  ['/workspace/reports', 'Reports'],
  ['/workspace/tags', 'Tags'],
  ['/workspace/performance', 'Performance'],
  ['/workspace/diagnostics', 'Diagnostics'],
  ['/playground', 'Runtime lab'],
] as const;
/** Serialize the authored HTML shell through public ZyroJS escaped node construction.
 * @param {string} title - Inert display title, not raw markup.
 * @param {VNodeChild} content - Trusted authored node description; stored data must remain scalar text.
 * @param {string} nonce - Response-owned style nonce, not an authorization token.
 * @param {number} status - Deliberate status; error headings receive native focus management.
 * @returns {string} Complete noindex HTML; fixed external module URLs are authored here.
 */
function document(
  title: string,
  content: VNodeChild,
  nonce: string,
  status: number
): string {
  return (
    '<!doctype html>' +
    renderToString(
      h(
        'html',
        { lang: 'en' },
        h(
          'head',
          null,
          h('meta', { charset: 'utf-8' }),
          h('meta', {
            name: 'viewport',
            content: 'width=device-width,initial-scale=1',
          }),
          h('meta', { name: 'workspace-style-nonce', content: nonce }),
          h('meta', { name: 'robots', content: 'noindex,nofollow' }),
          h('title', null, title + ' · Zerux workspace'),
          h('link', { rel: 'stylesheet', href: '/workspace.css' }),
          h('link', { rel: 'stylesheet', href: '/workspace-utilities.css' })
        ),
        h(
          'body',
          null,
          h('a', { href: '#main', class: 'skip' }, 'Skip to content'),
          h(
            'header',
            null,
            h(
              'a',
              { href: '/workspace', class: 'brand' },
              h('img', {
                src: '/workspace-mark.svg',
                alt: '',
                width: 24,
                height: 24,
              }),
              ' Zerux / workspace'
            ),
            h('span', null, 'Local integration lab')
          ),
          h(
            'div',
            { class: 'workspace' },
            h(
              'nav',
              { 'aria-label': 'Workspace' },
              nav.map(([href, label]) => h('a', { href }, label))
            ),
            h(
              'main',
              { id: 'main', tabindex: -1 },
              h(
                'h1',
                {
                  tabindex: status >= 400 ? -1 : undefined,
                  autofocus: status >= 400,
                },
                title
              ),
              content
            )
          ),
          h(
            'footer',
            null,
            'Local tools. Explicit consent. Private by default.'
          ),
          h('script', { type: 'module', src: '/workspace-client.js' })
        )
      )
    )
  );
}
/** Create one private no-store HTML response with a fresh scoped style nonce.
 * @param {string} title - Inert page title.
 * @param {VNodeChild} content - Trusted authored tree with stored text passed as scalar children.
 * @param {number} status - Explicit HTTP status, default 200.
 * @returns {Response} HTML response with fixed self-only script and explicit owned blob-media policy.
 */
export function html(title: string, content: VNodeChild, status = 200) {
  /** Fresh per-response style nonce, separate from CSRF and authorization proofs. */
  const nonce = randomBytes(18).toString('base64');
  return new Response(document(title, content, nonce, status), {
    status,
    headers: {
      ...headers,
      'content-security-policy': `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; img-src 'self'; media-src 'self' blob:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      'content-type': 'text/html; charset=utf-8',
    },
  });
}
/** Explain disabled/unconfigured state without opening any database or external provider.
 * @returns {Response} Private noindex 503 page with explicit operator setup guidance.
 */
export function workspaceUnavailable() {
  return html(
    'Workspace setup required',
    h(
      'section',
      { class: 'card' },
      h(
        'p',
        null,
        'The workspace has not been enabled by its operator. No database or external provider has been opened.'
      ),
      h(
        'p',
        null,
        'Configure private workspace settings and run the explicit initialization command in this app’s README.'
      ),
      h('a', { href: '/playground' }, 'Open the existing runtime playground')
    ),
    503
  );
}
