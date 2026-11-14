/** Record the explicit teaching middleware order and delegate exactly once.
 * @param {object} context - Borrowed framework request context; private workspace auth is enforced separately.
 * @param {() => Promise<void>} next - Framework-owned continuation, awaited once without mutation retries.
 * @returns {Promise<void>} Actual downstream settlement; exceptions remain with framework error handling.
 */
export default async (context: any, next: () => Promise<void>) => {
  context.state.middleware = [
    ...(context.state.middleware ?? []),
    'trace-runtime',
  ];
  context.logger.info('Sample route hit', {
    pathname: context.pathname,
    method: context.method,
  });

  await next();
};
