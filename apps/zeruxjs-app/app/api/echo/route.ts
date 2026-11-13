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

export const middleware = ['request-context', 'trace-runtime'];
/** Native form allows the POST example to be exercised from the home-page link. */
export const GET = () =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request echo</title></head><body><main><h1>Request echo</h1><p>Submit this form to inspect parsed form data, or POST JSON to this URL.</p><form method="post" action="/api/echo?debug=1"><label>Message <input name="message" required maxlength="2000"></label><button type="submit">Echo request</button></form><p><a href="/">Back to examples</a></p></main></body></html>`;
