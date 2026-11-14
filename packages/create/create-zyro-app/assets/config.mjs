import fs from 'node:fs';
/** Read the fixed public project config without loading arbitrary modules or private environment.
 * @param {URL} root - Explicit generated project root.
 * @returns {object} Validated mode/language/port/mount/title/origin settings.
 */
export function readConfig(root) {
  /** Fixed public config path relative to the explicit project root. */
  const file = new URL('zyro.config.json', root);
  /** Parsed public-only project settings validated before build or preview use. */
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !config ||
    Object.keys(config).some(
      (k) =>
        !['mode', 'language', 'port', 'basePath', 'title', 'origin'].includes(k)
    ) ||
    !['client', 'static', 'ssr', 'hydrated'].includes(config.mode) ||
    !['typescript', 'javascript'].includes(config.language) ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(config.basePath) ||
    typeof config.title !== 'string' ||
    config.title.length > 200 ||
    new URL(config.origin).origin !== config.origin ||
    !['http:', 'https:'].includes(new URL(config.origin).protocol)
  ) {
    throw Error('Invalid public project configuration');
  }
  return config;
}
