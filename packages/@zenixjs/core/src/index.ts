/** Package release version; no environment or global state is read. */
export const version = '0.0.4';

/** Legacy metadata value retained for compatibility; consult capabilities for implemented APIs. */
export const status = 'placeholder';

/** Actual opt-in domain capabilities; legacy status remains compatible. */
export const capabilities = Object.freeze({
  domainCore: 'minimal',
  durableAdapter: 'sqlite',
  adminRoutes: false,
});
