/** Establish request-local diagnostic identity and metadata; correlation is not authentication.
 * @param {object} context - Borrowed framework request context; private workspace auth is enforced separately.
 * @param {() => Promise<void>} next - Framework-owned continuation, awaited once without mutation retries.
 * @returns {Promise<void>} Actual downstream settlement; exceptions remain with framework error handling.
 */
export default async (context: any, next: () => Promise<void>) => {
  /** Public correlation label only; the fallback is not suitable for tokens or authorization proofs. */
  const requestId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  context.state.requestId = requestId;
  context.state.startedAt = new Date().toISOString();
  context.state.middleware = [
    ...(context.state.middleware ?? []),
    'request-context',
  ];
  context.res.setHeader('x-zerux-request-id', requestId);

  await next();
};
