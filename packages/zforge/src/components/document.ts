import {
  createNonce,
  escapeHtml,
  serializeJsonForScript,
} from '@zeruxjs/security';

interface RenderDocumentOptions {
  /** Inert document title escaped for its HTML text context. */
  title: string;
  /** Authored body class string escaped for the attribute context. */
  bodyClass?: string;
  /** Trusted authored section markup; arbitrary plugin output is not sanitized by this renderer. */
  content: string;
  /** Host-approved public development bootstrap data serialized for script context. */
  config: unknown;
  /** Optional host-approved initial data serialized independently for script context. */
  bootstrap?: unknown;
  /** Trusted endpoint namespace for package asset URLs. */
  serviceName?: string;
  /** Response-owned approved nonce; the caller must align its CSP header and document. */
  nonce?: string;
}

/** Create only a nonce value for an explicitly owned response.
 * @returns {{nonce: string}} Fresh nonce; this helper does not install CSP or authorize a response.
 */
export const createDocumentSecurity = () => ({
  nonce: createNonce(),
});

/** Serialize the controlled development document around trusted section HTML.
 * @param {RenderDocumentOptions} options - Host-approved content, bootstrap and response-owned nonce.
 * @returns {string} Document with script-safe JSON and escaped display fields; content is trusted authored HTML.
 */
export const renderDocument = ({
  title,
  bodyClass = '',
  content,
  config,
  bootstrap,
  serviceName = 'zdev',
  nonce = createNonce(),
}: RenderDocumentOptions) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/__${serviceName}/assets/style.css" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/favicon.png" />
</head>
<body class="${escapeHtml(bodyClass)}">
  ${content}
  <script nonce="${escapeHtml(nonce)}">
    window.zdev = {
      service: ${serializeJsonForScript(serviceName)},
      config: ${serializeJsonForScript(config)},
      bootstrap: ${bootstrap ? serializeJsonForScript(bootstrap) : 'null'}
    };
  </script>
  <script nonce="${escapeHtml(nonce)}" type="module" src="/__${serviceName}/assets/app.js"></script>
</body>
</html>`;

export { escapeHtml };
