export default async (context: any, next: () => Promise<void>) => {
  context.state.middleware = [...(context.state.middleware ?? []), "trace-runtime"];
  context.logger.info("Sample route hit", {
    pathname: context.pathname,
    method: context.method
  });

  await next();
};
