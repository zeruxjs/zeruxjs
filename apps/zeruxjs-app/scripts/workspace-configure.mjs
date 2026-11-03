import { parseArguments, validateOptions, formatError } from 'zclivo';
import { hashPassword, validatePasswordStrength } from '@zeruxjs/auth';
import { randomBytes, randomUUID } from 'node:crypto';
import { open, link, unlink } from 'node:fs/promises';
import { emitKeypressEvents } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const help = 'workspace:configure [--origin http://localhost:3010] [--username operator] [--tenant local] [--site main] [--dry-run]\nPassword is read hidden from a terminal or as one UTF-8 line on stdin. No password flag is accepted. Existing .env.local files are never overwritten.';
async function passwordInput() {
  if (!process.stdin.isTTY) {
    const chunks = []; let size = 0;
    const timer = setTimeout(() => process.stdin.destroy(Error('Password input deadline')), 60000);
    try { for await (const chunk of process.stdin) { size += chunk.length; if (size > 4096) throw Error('Password input limit'); chunks.push(chunk); } } finally { clearTimeout(timer); }
    const bytes = Buffer.concat(chunks);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r?\n$/, ''); } finally { bytes.fill(0); for (const chunk of chunks) chunk.fill(0); }
  }
  process.stderr.write('Operator password (hidden, at least 16 characters): ');
  emitKeypressEvents(process.stdin);
  return new Promise((accept, reject) => {
    let value = '', ended = false; const wasRaw = process.stdin.isRaw;
    const finish = error => { if (ended) return; ended = true; clearTimeout(timer); process.stdin.off('keypress', press); process.stdin.setRawMode(wasRaw); process.stdin.pause(); process.stderr.write('\n'); error ? reject(error) : accept(value); };
    const press = (text, key) => {
      if (key?.ctrl && ['c', 'd'].includes(key.name)) return finish(Error('Configuration cancelled'));
      if (key?.name === 'return') return finish();
      if (key?.name === 'backspace') { value = [...value].slice(0, -1).join(''); return; }
      if (key?.ctrl || key?.meta || !text || /\p{Cc}/u.test(text)) return;
      value += text; if (Buffer.byteLength(value) > 4096) finish(Error('Password input limit'));
    };
    const timer = setTimeout(() => finish(Error('Password input deadline')), 60000);
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('keypress', press);
  });
}
export async function configureWorkspace({ root, argv, readPassword = passwordInput }) {
  const args = parseArguments(argv, ['help', 'dry-run']);
  if (args.positionalArgs.length) throw Error('Use named options only');
  const options = validateOptions(args, { help: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, origin: { type: 'string', default: 'http://localhost:3010' }, username: { type: 'string', default: 'operator' }, tenant: { type: 'string', default: 'local' }, site: { type: 'string', default: 'main' } });
  if (Object.values(options).some(Array.isArray)) throw Error('Do not repeat workspace options');
  if (options.help) return { status: 'help', text: help };
  const origin = new URL(String(options.origin));
  if (Array.isArray(options.origin) || origin.origin !== options.origin || !(origin.protocol === 'https:' || origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) throw Error('Use an exact HTTPS or loopback HTTP origin');
  for (const name of ['username', 'tenant', 'site']) if (typeof options[name] !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(options[name])) throw Error('Invalid workspace identity option');
  if (options['dry-run']) return { status: 'dry-run', text: 'Would exclusively create private .env.local; no password, file, database or service was accessed.' };
  const password = await readPassword();
  if (!validatePasswordStrength(password, { minLength: 16, maxLength: 256 }).valid) throw Error('Password must contain 16–256 characters without control characters');
  const pepper = randomBytes(32).toString('base64url'), previous = process.env.SECURITY_PASSWORD_SALT;
  let passwordHash;
  try { process.env.SECURITY_PASSWORD_SALT = pepper; passwordHash = hashPassword(password); }
  finally { if (previous === undefined) delete process.env.SECURITY_PASSWORD_SALT; else process.env.SECURITY_PASSWORD_SALT = previous; }
  const settings = { WORKSPACE_ENABLED: 'true', WORKSPACE_ORIGIN: origin.origin, WORKSPACE_TENANT: options.tenant, WORKSPACE_SITE: options.site, WORKSPACE_USERNAME: options.username, WORKSPACE_PASSWORD_HASH: passwordHash, WORKSPACE_KEY: randomBytes(32).toString('base64url'), SECURITY_PASSWORD_SALT: pepper, ENABLE_MYSQL_DEMO: 'false' };
  const temporary = join(root, '.workspace-config-' + randomUUID()), destination = join(root, '.env.local');
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(Object.entries(settings).map(([name, value]) => name + '=' + value).join('\n') + '\n'); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, destination); // Atomic create-only promotion; existing/symlink targets conflict.
    return { status: 'written', text: 'Created private .env.local. Run workspace:init explicitly, then start the app yourself.' };
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await configureWorkspace({ root: dirname(dirname(fileURLToPath(import.meta.url))), argv: process.argv.slice(2) }); console.log(result.text); }
  catch (error) { console.error(error?.code === 'EEXIST' ? 'Private .env.local already exists; nothing was overwritten.' : formatError(error)); process.exitCode = 1; }
}
