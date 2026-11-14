/** Project public runtime inventory without serializing private service configuration.
 * @param {object} runtime - Borrowed current framework generation.
 * @returns {object} Sorted names/counts only, without handles, credentials or records.
 */
const summarizeRuntime = (runtime: any) => ({
  mode: runtime.mode,
  routes: runtime.routes.length,
  middleware: [...runtime.middleware.keys()].sort(),
  controllers: [...runtime.controllers.keys()].sort(),
  composables: [...runtime.composables.keys()].sort(),
  publicFiles: [...runtime.publicFiles.keys()].sort(),
});

export default {
  /** Return the legacy public teaching health projection; private workspace auth is a separate boundary.
   * @param {object} context - Borrowed framework request context.
   * @returns {object} Request/runtime diagnostic projection, not proof of external service health.
   */
  health(context: any) {
    return {
      ok: true,
      app: 'zeruxjs-app',
      requestId: context.state.requestId,
      params: context.params,
      query: Object.fromEntries(context.query.entries()),
      runtime: summarizeRuntime(context.runtime),
    };
  },
};
