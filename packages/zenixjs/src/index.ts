/** Package release version; no environment or global state is read. */
export const version = '0.0.4';

/** Initial SSR CMS application; no complete CMS parity is implied. */
export const status = 'initial-cms';
/** Delivered metadata flags only; importing opens no CMS/database/network resources. */
export const capabilities = Object.freeze({
  setup: true,
  login: true,
  editor: true,
  publicPage: true,
  hydration: false,
});
