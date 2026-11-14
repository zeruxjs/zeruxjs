import path from 'node:path';
/** Read explicit private process settings without loading .env files or opening resources.
 * @param {Record<string, string | undefined>} environment - Borrowed host environment, defaulting to process.env.
 * @returns {object} Validated fixed CMS origin, SQLite filename and tenant/site scope.
 */
export function loadSettings(environment = process.env) {
  /** Private host environment values validated before any database is opened. */
  const {
    ZENIX_ORIGIN: origin,
    ZENIX_DATABASE: filename,
    ZENIX_TENANT: tenant,
    ZENIX_SITE: site,
  } = environment;
  if (
    typeof origin !== 'string' ||
    typeof filename !== 'string' ||
    !path.isAbsolute(filename) ||
    filename.includes('\0') ||
    !/^https?:\/\//.test(origin)
  ) {
    throw Error(
      'ZENIX_SETTINGS_REQUIRED: exact origin, absolute SQLite filename, tenant and site are required'
    );
  }
  /** Parsed exact origin; credentials, paths and invalid tenant/site identifiers reject. */
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    ![tenant, site].every(
      (value) =>
        typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)
    )
  ) {
    throw Error('ZENIX_SETTINGS_INVALID');
  }
  return {
    filename,
    origin,
    scope: { tenant, site },
    basePath: '/cms',
    entryId: 'home',
  };
}
