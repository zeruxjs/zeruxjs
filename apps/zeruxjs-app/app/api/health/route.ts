/** Resolve only the explicitly registered sample controller/method. */
export const controller = 'status#health';
/** This teaching route is read-only; other methods are not declared. */
export const method = 'GET';
/** Explicit middleware dependencies for the public diagnostic controller. */
export const middleware = ['request-context', 'trace-runtime'];
