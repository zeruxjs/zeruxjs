/** Host-owned relative directory exclusions; subscriber-local, never global watcher state. */
export function createDevelopmentWatchIgnore(input: unknown = []): (relative: string) => boolean {
  if (!Array.isArray(input) || input.length > 128) throw new TypeError('Invalid development watch exclusions');
  const paths = input.map(value => {
    if (typeof value !== 'string' || !value || value.length > 256 || !/^[A-Za-z0-9._/-]+$/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new TypeError('Development watch exclusions must be relative directory paths');
    return value;
  });
  return relative => typeof relative === 'string' && paths.some(path => relative === path || relative.startsWith(path + '/'));
}
