/** Read only the declared public runtime summary fields.
 * @param {object} runtime - Borrowed current generation, never copied wholesale into a response.
 * @param {Record<string, string | undefined>} env - Host environment; only NODE_ENV is projected.
 * @returns {string} Public mode/route-count/environment summary without credentials.
 */
export default (runtime: any, env: Record<string, string | undefined>) =>
  `mode=${runtime.mode}, routes=${runtime.routes.length}, env=${env.NODE_ENV ?? 'development'}`;
