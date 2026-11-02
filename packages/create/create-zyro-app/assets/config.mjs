import fs from 'node:fs';
export function readConfig(root) {
  const file = new URL('zyro.config.json', root);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !config ||
    Object.keys(config).some(
      (k) =>
        !['mode', 'language', 'port', 'basePath', 'title', 'origin'].includes(
          k,
        ),
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
  )
    throw Error('Invalid public project configuration');
  return config;
}
