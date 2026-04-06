import {
  createNonce,
  escapeHtml,
  serializeJsonForScript
} from "@zeruxjs/security";

interface RenderDocumentOptions {
  title: string;
  bodyClass?: string;
  content: string;
  payload: unknown;
  nonce?: string;
}

export const createDocumentSecurity = () => ({
  nonce: createNonce()
});

export const renderDocument = ({ title, bodyClass = "", content, payload, nonce = createNonce() }: RenderDocumentOptions) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/__zerux/assets/style.css" />
</head>
<body class="${escapeHtml(bodyClass)}">
  ${content}
  <script nonce="${escapeHtml(nonce)}" id="zerux-dev-payload" type="application/json">${serializeJsonForScript(payload)}</script>
  <script nonce="${escapeHtml(nonce)}" type="module" src="/__zerux/assets/app.js"></script>
</body>
</html>`;

export { escapeHtml };
