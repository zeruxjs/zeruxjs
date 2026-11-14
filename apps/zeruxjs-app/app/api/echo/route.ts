/** Echo the public teaching request projection without evaluating body content.
 * @param {object} root0 - Borrowed framework request context projection.
 * @param {unknown} root0.body - Parsed body; URL-encoded text is projected into inert key/value data.
 * @param {URLSearchParams} root0.query - Request query entries, not routing/authorization policy.
 * @param {object} root0.state - Middleware-owned diagnostic fields.
 * @param {string} root0.method - Actual request method.
 * @param {object} root0.req - Borrowed native request used only for content-type selection.
 * @returns {object} JSON echo payload; this endpoint is a development example, not private workspace storage.
 */
export const POST = ({ body, query, state, method, req }: any) => ({
  ok: true,
  method,
  query: Object.fromEntries(query.entries()),
  body:
    typeof body === 'string' &&
    req.headers['content-type']?.split(';')[0] ===
      'application/x-www-form-urlencoded'
      ? Object.fromEntries(new URLSearchParams(body))
      : body,
  requestId: state.requestId,
  middleware: state.middleware ?? [],
});

/** Fixed sample middleware order; caller data cannot register additional middleware. */
export const middleware = ['request-context', 'trace-runtime'];
/** Render the native no-JavaScript form for the public echo demonstration.
 * @returns {string} Fixed authored HTML with an actual POST action; no service is started by rendering.
 */
export const GET = () =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request echo</title></head><body><main><h1>Request echo</h1><p>Submit this form to inspect parsed form data, or POST JSON to this URL.</p><form method="post" action="/api/echo?debug=1"><label>Message <input name="message" required maxlength="2000"></label><button type="submit">Echo request</button></form><p><a href="/">Back to examples</a></p></main></body></html>`;
