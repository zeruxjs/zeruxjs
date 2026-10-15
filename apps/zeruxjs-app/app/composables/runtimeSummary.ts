export default (runtime: any, env: Record<string, string | undefined>) =>
  `mode=${runtime.mode}, routes=${runtime.routes.length}, env=${env.NODE_ENV ?? "development"}`;
