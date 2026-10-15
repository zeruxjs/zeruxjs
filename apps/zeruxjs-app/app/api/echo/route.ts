export const POST = ({ body, query, state, method }: any) => ({
  ok: true,
  method,
  query: Object.fromEntries(query.entries()),
  body,
  requestId: state.requestId,
  middleware: state.middleware ?? []
});

export const middleware = ["request-context", "trace-runtime"];
