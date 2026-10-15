export default async (context: any, next: () => Promise<void>) => {
  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  context.state.requestId = requestId;
  context.state.startedAt = new Date().toISOString();
  context.state.middleware = [...(context.state.middleware ?? []), "request-context"];
  context.res.setHeader("x-zerux-request-id", requestId);

  await next();
};
