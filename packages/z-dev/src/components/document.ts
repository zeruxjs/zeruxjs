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
  serviceName?: string;
  nonce?: string;
}

export const createDocumentSecurity = () => ({
  nonce: createNonce()
});

export const renderDocument = ({ title, bodyClass = "", content, config, bootstrap, serviceName = "zdev", nonce = createNonce() }: RenderDocumentOptions) => `<!doctype html>
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
      bootstrap: ${bootstrap ? serializeJsonForScript(bootstrap) : "null"}
    };
  </script>
  <script nonce="${escapeHtml(nonce)}" type="module" src="/__${serviceName}/assets/app.js"></script>
</body>
</html>`;

export { escapeHtml };
