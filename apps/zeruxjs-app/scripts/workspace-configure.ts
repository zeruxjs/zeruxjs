import { parseArguments, validateOptions, formatError } from 'zclivo';
import { hashPassword, validatePasswordStrength } from '@zeruxjs/auth';
import { randomBytes, randomUUID } from 'node:crypto';
import { open, link, unlink } from 'node:fs/promises';
import { emitKeypressEvents, type Key } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Private operator invocation contract; no fields are browser/runtime publication data. */
interface ConfigureWorkspaceInput {
  /** Trusted app root containing the create-only private environment target. */
  root: string;
  /** Public named CLI arguments; passwords are not accepted as flags. */
  argv: string[];
  /** Explicit private input owner, invoked only after help/dry-run and option validation. */
  readPassword?: () => Promise<string>;
}
/** Fixed secret-free usage text; passwords are never accepted through command-line flags. */
const help =
  'workspace:configure [--origin http://localhost:3010] [--username operator] [--tenant local] [--site main] [--dry-run]\nPassword is read hidden from a terminal or as one UTF-8 line on stdin. No password flag is accepted. Existing .env.local files are never overwritten.';
/** Read one bounded private password without command-line flags or terminal echo.
 * @returns {Promise<string>} Private UTF-8 input; byte buffers are zeroed and terminal listeners/mode restored.
 */
async function passwordInput(): Promise<string> {
  if (!process.stdin.isTTY) {
    /** Bounded raw stdin bytes, zeroed after strict UTF-8 decoding. */
    const chunks = [];
    let size = 0;
    /** Finite explicit password-entry deadline, cleared on terminal completion/failure. */
    const timer = setTimeout(
      () => process.stdin.destroy(Error('Password input deadline')),
      60000
    );
    try {
      for await (const chunk of process.stdin) {
        size += chunk.length;
        if (size > 4096) {
          throw Error('Password input limit');
        }
        chunks.push(chunk);
      }
    } finally {
      clearTimeout(timer);
    }
    /** Owned contiguous stdin copy, zeroed after conversion; JavaScript strings cannot be reliably zeroed. */
    const bytes = Buffer.concat(chunks);
    try {
      return new TextDecoder('utf-8', { fatal: true })
        .decode(bytes)
        .replace(/\r?\n$/, '');
    } finally {
      bytes.fill(0);
      for (const chunk of chunks) {
        chunk.fill(0);
      }
    }
  }
  process.stderr.write('Operator password (hidden, at least 16 characters): ');
  emitKeypressEvents(process.stdin);
  return new Promise<string>((accept, reject) => {
    let value = '',
      ended = false;
    /** Preserve the terminal’s prior mode so Ctrl-C, timeout and completion restore ownership. */
    const wasRaw = process.stdin.isRaw;
    /** Settle once and restore terminal ownership before returning private input.
     * @param {Error | undefined} error - Optional cancellation/deadline/input failure.
     * @returns {void} Removes listeners/timer and resolves or rejects the owned prompt.
     */
    const finish = (error?: Error) => {
      if (ended) {
        return;
      }
      ended = true;
      clearTimeout(timer);
      process.stdin.off('keypress', press);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stderr.write('\n');
      if (error) {
        reject(error);
      } else {
        accept(value);
      }
    };
    /** Accept only bounded printable native key input; Ctrl-C/D cancels without exposing it.
     * @param {string} text - Native terminal text, never printed back to stdout/stderr.
     * @param {object} key - Native key metadata used only for explicit control/edit behavior.
     * @returns {void} Updates local input or settles the owned prompt.
     */
    const press = (text: string, key?: Key) => {
      if (key?.ctrl && ['c', 'd'].includes(key.name ?? '')) {
        return finish(Error('Configuration cancelled'));
      }
      if (key?.name === 'return') {
        return finish();
      }
      if (key?.name === 'backspace') {
        value = [...value].slice(0, -1).join('');
        return;
      }
      if (key?.ctrl || key?.meta || !text || /\p{Cc}/u.test(text)) {
        return;
      }
      value += text;
      if (Buffer.byteLength(value) > 4096) {
        finish(Error('Password input limit'));
      }
    };
    /** Finite explicit password-entry deadline, cleared on terminal completion/failure. */
    const timer = setTimeout(
      () => finish(Error('Password input deadline')),
      60000
    );
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', press);
  });
}
/** Plan or exclusively write private operator configuration without starting/installing anything.
 * @param {object} root0 - Trusted explicit operator invocation context.
 * @param {string} root0.root - Target app directory; existing .env.local is never overwritten.
 * @param {string[]} root0.argv - Public named options; secret/password flags and repeats reject.
 * @param {Function} root0.readPassword - Trusted private-input callback, never called for help/dry-run.
 * @returns {Promise<object>} Secret-free help/plan/write receipt; generated keys and password values stay private.
 */
export async function configureWorkspace({
  root,
  argv,
  readPassword = passwordInput,
}: ConfigureWorkspaceInput) {
  /** Public zclivo parsing rejects positional/unknown options before any private file write. */
  const args = parseArguments(argv, ['help', 'dry-run']);
  if (args.positionalArgs.length) {
    throw Error('Use named options only');
  }
  /** Validated CLI choices; none authorizes a remote origin or unreviewed provider. */
  const options = validateOptions(args, {
    help: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    origin: { type: 'string', default: 'http://localhost:3010' },
    username: { type: 'string', default: 'operator' },
    tenant: { type: 'string', default: 'local' },
    site: { type: 'string', default: 'main' },
  });
  if (Object.values(options).some(Array.isArray)) {
    throw Error('Do not repeat workspace options');
  }
  if (options.help) {
    return { status: 'help', text: help };
  }
  /** Exact HTTPS or explicit loopback development origin; credentials/path/query/hash are not accepted. */
  const origin = new URL(String(options.origin));
  if (
    Array.isArray(options.origin) ||
    origin.origin !== options.origin ||
    !(
      origin.protocol === 'https:' ||
      (origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    )
  ) {
    throw Error('Use an exact HTTPS or loopback HTTP origin');
  }
  for (const name of ['username', 'tenant', 'site']) {
    if (
      typeof options[name] !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(options[name])
    ) {
      throw Error('Invalid workspace identity option');
    }
  }
  if (options['dry-run']) {
    return {
      status: 'dry-run',
      text: 'Would exclusively create private .env.local; no password, file, database or service was accessed.',
    };
  }
  /** Private validated input; never print, persist plaintext or include it in a receipt. */
  const password = await readPassword();
  if (
    !validatePasswordStrength(password, { minLength: 16, maxLength: 256 }).valid
  ) {
    throw Error(
      'Password must contain 16–256 characters without control characters'
    );
  }
  /** Independent random password pepper; previous process setting is restored after synchronous hashing. */
  const pepper = randomBytes(32).toString('base64url'),
    previous = process.env.SECURITY_PASSWORD_SALT;
  let passwordHash;
  try {
    process.env.SECURITY_PASSWORD_SALT = pepper;
    passwordHash = hashPassword(password);
  } finally {
    if (previous === undefined) {
      delete process.env.SECURITY_PASSWORD_SALT;
    } else {
      process.env.SECURITY_PASSWORD_SALT = previous;
    }
  }
  /** Private environment document contains server keys/hashes only and is never returned to the caller. */
  const settings = {
    WORKSPACE_ENABLED: 'true',
    WORKSPACE_ORIGIN: origin.origin,
    WORKSPACE_TENANT: options.tenant,
    WORKSPACE_SITE: options.site,
    WORKSPACE_USERNAME: options.username,
    WORKSPACE_PASSWORD_HASH: passwordHash,
    WORKSPACE_KEY: randomBytes(32).toString('base64url'),
    SECURITY_PASSWORD_SALT: pepper,
    ENABLE_MYSQL_DEMO: 'false',
  };
  /** Exclusive private candidate; hard-link promotion cannot overwrite an existing or dangling-symlink target. */
  const temporary = join(root, '.workspace-config-' + randomUUID()),
    destination = join(root, '.env.local');
  try {
    /** Owned mode-0600 exclusive file handle, synced and closed before create-only promotion. */
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(
        Object.entries(settings)
          .map(([name, value]) => name + '=' + value)
          .join('\n') + '\n'
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, destination); // Atomic create-only promotion; existing/symlink targets conflict.
    return {
      status: 'written',
      text: 'Created private .env.local. Run workspace:init explicitly, then start the app yourself.',
    };
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    /** Secret-free status receipt; CLI output never contains generated key or password values. */
    const result = await configureWorkspace({
      root: dirname(dirname(fileURLToPath(import.meta.url))),
      argv: process.argv.slice(2),
    });
    console.log(result.text);
  } catch (error) {
    console.error(
      (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST'
        ? 'Private .env.local already exists; nothing was overwritten.'
        : formatError(error)
    );
    process.exitCode = 1;
  }
}
