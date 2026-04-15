import {
  createNonce,
  escapeHtml,
  serializeJsonForScript
} from "@zeruxjs/security";

interface RenderDocumentOptions {
  title: string;
  bodyClass?: string;
  content: string;
  config: unknown;
  bootstrap?: unknown;
  nonce?: string;
}

export const createDocumentSecurity = () => ({
  nonce: createNonce()
});

export const renderDocument = ({ title, bodyClass = "", content, config, bootstrap, nonce = createNonce() }: RenderDocumentOptions) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/__zerux/assets/style.css" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/favicon.png" />
</head>
<body class="${escapeHtml(bodyClass)}">
  ${content}
  <script nonce="${escapeHtml(nonce)}">
    window.zerux = {
      config: ${serializeJsonForScript(config)},
      bootstrap: ${bootstrap ? serializeJsonForScript(bootstrap) : "null"}
    };
  </script>
  <script nonce="${escapeHtml(nonce)}" type="module" src="/__zerux/assets/app.js"></script>
</body>
</html>`;

export { escapeHtml };
