import { readStateFile } from './state-file.js';
/** Authenticated, loopback-only process control. Control descriptors are private
 * to the OS user; untrusted clients cannot select a different process by PID. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { processExists, processIdentity } from './lifecycle.js';

/** Private token-bearing endpoint identity; possession still requires trusted host action policy. */
export interface ControlDescriptor {
  /** Supported private control descriptor schema version. */
  version: 1;
  /** Validated exact private endpoint namespace. */
  name: string;
  /** Native owning process PID, always verified against its creation fingerprint before client use. */
  pid: number;
  /** Native owner creation fingerprint; numeric PID existence is insufficient. */
  identity: string;
  /** Ephemeral IPv4-loopback control listener port. */
  port: number;
  /** Private random 256-bit control credential; never log or expose to browsers. */
  token: string;
}
/** Owned private control endpoint; close handles sockets, not arbitrary handler promise settlement. */
export interface LocalControl {
  /** Borrowed private token-bearing endpoint metadata; host-only, not public configuration. */
  readonly descriptor: ControlDescriptor;
  /** Conditionally remove this descriptor, stop the listener and destroy retained sockets after two seconds.
   * @returns {Promise<void>} First caller waits for native listener close; later calls return immediately, and arbitrary handler promises are not force-cancelled or drained.
   */
  close(): Promise<void>;
}
/** Maximum complete authenticated control JSON-line bytes, 4 KiB. */
const MAX_REQUEST = 4096;
/** Maximum complete control response JSON-line bytes, 128 KiB. */
const MAX_RESPONSE = 131072;
/** Default accepted-socket inactivity timeout in milliseconds. */
const CONTROL_TIMEOUT = 30_000;
/** Maximum declared long-running control operation timeout in milliseconds. */
const LONG_CONTROL_TIMEOUT = 620_000;
/** Reject unsupported names and traversal-like double dots before deriving a fixed private descriptor path.
 * @param {string} name - Explicit host-selected bounded control namespace.
 * @returns {void} Throws for unsupported names without touching disk.
 */
export function validateControlName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,240}$/.test(name) || name.includes('..')) {
    throw new TypeError('Invalid control name');
  }
}
/** Derive the current OS-user control namespace; this is a path helper, not a recursive filesystem sandbox.
 * @param {string} stateDir - Trusted host-owned private state directory; callers authorize operations separately.
 * @returns {string} Per-UID control directory path, without creating it.
 */
export function controlDirectory(stateDir: string): string {
  /** Native OS UID namespace or fixed fallback when no UID API exists. */
  const uid =
    typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  return path.join(stateDir, `app-controls-${uid}`);
}
/** Optionally create then verify the final control directory is an owner-private real directory.
 * @param {string} stateDir - Trusted host-owned private state directory; callers authorize operations separately.
 * @param {boolean} create - Explicitly create missing directories when true; default false.
 * @returns {string} Verified final directory path; trusted parent ownership remains a host prerequisite.
 */
export function ensureControlDirectory(
  stateDir: string,
  create = false
): string {
  /** Derived final private control directory; trusted parent policy remains separate. */
  const dir = controlDirectory(stateDir);
  if (create) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  }
  /** Native final-directory metadata requiring real-directory, mode and owner checks. */
  const st = fs.lstatSync(dir);
  if (
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    (typeof process.getuid === 'function' && st.uid !== process.getuid()) ||
    (st.mode & 0o077) !== 0
  ) {
    throw new Error(
      'Unsafe control directory: expected a private, owned directory'
    );
  }
  return dir;
}
/** Derive a validated hashed descriptor filename without creating files or exposing the control token.
 * @param {string} stateDir - Trusted host-owned private state directory; callers authorize operations separately.
 * @param {string} name - Validated host-selected bounded control namespace.
 * @returns {string} Deterministic private child path.
 */
export function descriptorPath(stateDir: string, name: string): string {
  validateControlName(name);
  return path.join(
    controlDirectory(stateDir),
    `${createHash('sha256').update(name).digest('hex')}.json`
  );
}
/** Validate the supported inert private descriptor envelope before native identity verification.
 * @param {any} value - Unknown parsed JSON; subsequent checks validate each supported field.
 * @param {string} name - Expected exact host-selected namespace.
 * @returns {boolean} Whether supported version, name, PID, identity, port and token fields match.
 */
function validateRecord(value: any, name: string): value is ControlDescriptor {
  return (
    value?.version === 1 &&
    value.name === name &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 1 &&
    typeof value.identity === 'string' &&
    value.identity.length > 0 &&
    value.identity.length < 256 &&
    Number.isInteger(value.port) &&
    value.port > 0 &&
    value.port <= 65535 &&
    typeof value.token === 'string' &&
    /^[a-f0-9]{64}$/.test(value.token)
  );
}
/** Read bounded no-follow owner-private descriptor bytes and validate the expected namespace; does not itself verify current native PID identity.
 * @param {string} stateDir - Trusted host-owned private state directory; callers authorize operations separately.
 * @param {string} name - Validated host-selected namespace.
 * @returns {ControlDescriptor | null} Private token-bearing record or null only for absence; never return this through public diagnostics.
 */
export function readControlDescriptor(
  stateDir: string,
  name: string
): ControlDescriptor | null {
  validateControlName(name);
  try {
    ensureControlDirectory(stateDir);
    /** Fixed hashed private descriptor path; never a request-selected destination. */
    const filename = descriptorPath(stateDir, name);
    /** Bounded same-inode descriptor bytes/metadata awaiting owner and mode checks. */
    const { stat: st, bytes } = readStateFile(filename, 2048);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.size > 2048 ||
      (st.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid())
    ) {
      throw new Error('Unsafe control descriptor');
    }
    /** Unknown parsed descriptor validated before use. */
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!validateRecord(value, name)) {
      throw new Error('Invalid control descriptor');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
/** Replace a private descriptor using exclusive staging, file fsync and same-directory rename; temporary unlink is best-effort legacy cleanup.
 * @param {string} filename - Fixed descriptor path beneath the verified private namespace.
 * @param {string} payload - Trusted complete serialized private descriptor, never log it.
 * @returns {void} Commits descriptor publication or throws before exposing a partial file.
 */
function writePrivate(filename: string, payload: string): void {
  /** Exclusive private same-directory descriptor staging filename. */
  const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    /** Owned staging descriptor closed after write/fsync. */
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, payload);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      if (fs.lstatSync(filename).isSymbolicLink()) {
        throw new Error('Unsafe control descriptor symlink');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    fs.renameSync(temporary, filename);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      /* This optional failure is intentionally ignored. */
    }
  }
}
/** Explicit trusted host callback; JSON arguments are data and never dynamically executed. */
export type ControlHandler = (
  action: string,
  data: unknown
) => Promise<unknown> | unknown;
/** Acquire an ephemeral IPv4-loopback JSON-line server with fixed byte/time limits and a private random-token descriptor; loopback alone never bypasses authentication.
 * @param {string} stateDir - Trusted host-owned private state directory; callers authorize operations separately.
 * @param {string} name - Validated namespace; live/unverifiable prior owners reject takeover.
 * @param {ControlHandler} handler - Explicit trusted host action handler; it owns action-level authorization and side-effect cancellation.
 * @returns {Promise<LocalControl>} Owned native endpoint; await close before releasing its dependencies, noting handlers have no separate drain contract.
 */
export async function createLocalControl(
  stateDir: string,
  name: string,
  handler: ControlHandler
): Promise<LocalControl> {
  ensureControlDirectory(stateDir, true);
  /** Fixed hashed private descriptor path; never a request-selected destination. */
  const filename = descriptorPath(stateDir, name);
  /** Prior supported private descriptor requiring native owner verification before takeover. */
  const old = readControlDescriptor(stateDir, name);
  if (
    old &&
    processExists(old.pid) &&
    processIdentity(old.pid) === old.identity
  ) {
    throw new Error(`Control already running: ${name}`);
  }
  if (old && processExists(old.pid) && processIdentity(old.pid) === null) {
    throw new Error('Unverifiable control owner; refusing takeover');
  }
  /** Readable native identity of this process, required before opening the control listener. */
  const identity = processIdentity(process.pid);
  if (!identity) {
    throw new Error('Cannot verify this process identity for local controls');
  }
  /** Fresh private 256-bit credential retained only in this endpoint and its private descriptor. */
  const token = randomBytes(32).toString('hex');
  /** Accepted native sockets retained only until native close. */
  const sockets = new Set<net.Socket>();
  /** Owned IPv4-loopback JSON-line control server. */
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setTimeout(CONTROL_TIMEOUT, () => socket.destroy());
    let raw = '';
    let handled = false;
    socket.on('data', (chunk) => {
      if (handled) {
        return;
      }
      raw += chunk.toString('utf8');
      if (Buffer.byteLength(raw) > MAX_REQUEST) {
        handled = true;
        socket.destroy();
        return;
      }
      /** Position of the first complete request line within the bounded accumulator. */
      const end = raw.indexOf('\n');
      if (end < 0) {
        return;
      }
      handled = true;
      /** Serialize one bounded private result and end this accepted socket.
       * @param {unknown} result Trusted handler envelope, still subject to the response byte budget.
       * @returns {void} Writes one bounded line or an explicit size failure. */
      const respond = (result: unknown) => {
        /** Serialized result checked before sending; never default-log its contents. */
        const data = JSON.stringify(result);
        if (Buffer.byteLength(data) > MAX_RESPONSE) {
          socket.end('{"ok":false,"error":"Response too large"}\n');
          return;
        }
        socket.end(data + '\n');
      };
      void (async () => {
        try {
          /** Unknown JSON-line message; fixed token/action checks precede trusted handler dispatch. */
          const msg = JSON.parse(raw.slice(0, end));
          if (
            typeof msg?.token !== 'string' ||
            !/^[a-f0-9]{64}$/.test(msg.token) ||
            !timingSafeEqual(
              Buffer.from(msg.token, 'hex'),
              Buffer.from(token, 'hex')
            )
          ) {
            throw new Error('Unauthorized');
          }
          if (
            typeof msg.action !== 'string' ||
            !/^[a-z-]{1,32}$/.test(msg.action)
          ) {
            throw new Error('Invalid control action');
          }
          if (
            msg.action === 'deploy' ||
            msg.action === 'stop' ||
            msg.action === 'drain' ||
            msg.action === 'reconcile' ||
            msg.action === 'scale'
          ) {
            socket.setTimeout(LONG_CONTROL_TIMEOUT);
          }
          return { ok: true, value: await handler(msg.action, msg.data) };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error
                ? error.message.slice(0, 300)
                : 'Control error',
          };
        }
      })()
        .then(respond)
        .catch(() => socket.destroy());
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    /** Native bound server address used only after successful ephemeral listen. */
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unexpected control address');
    }
    /** Private native owner/port/token record; never expose it through public metrics. */
    const descriptor: ControlDescriptor = {
      version: 1,
      name,
      pid: process.pid,
      identity,
      port: address.port,
      token,
    };
    writePrivate(filename, JSON.stringify(descriptor) + '\n');
    let closed = false;
    return {
      descriptor,
      /** Conditionally remove this descriptor, stop the listener and destroy retained sockets after two seconds.
       * @returns {Promise<void>} First caller waits for native listener close; later calls return immediately, and arbitrary handler promises are not force-cancelled or drained.
       */ async close() {
        if (closed) {
          return;
        }
        closed = true;
        try {
          /** Current descriptor reread before conditional removal so newer ownership survives. */
          const current = readControlDescriptor(stateDir, name);
          if (
            current &&
            current.token === token &&
            current.pid === process.pid
          ) {
            fs.unlinkSync(filename);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
        /** Owned two-second socket cleanup timer cleared after native listener close. */
        const force = setTimeout(() => {
          for (const socket of sockets) {
            socket.destroy();
          }
        }, 2_000);
        try {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        } finally {
          clearTimeout(force);
        }
      },
    };
  } catch (error) {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close();
    throw error;
  }
}
/** Verify the private descriptor owner’s native identity and send one bounded authenticated loopback request without replay.
 * @param {string} stateDir - Trusted host-owned private state directory; callers authorize operations separately.
 * @param {string} name - Validated target namespace, never a caller-supplied PID.
 * @param {string} action - Explicit fixed host operation name, validated again at the server.
 * @param {unknown} data - Optional bounded inert JSON payload; no executable strings are interpreted.
 * @param {number} timeoutMs - Finite timeout from one through 620000 milliseconds, default thirty seconds.
 * @returns {Promise<T>} Decoded private result; timeout destroys this client socket but does not prove server-side rollback.
 */
export async function sendLocalControl<T = unknown>(
  stateDir: string,
  name: string,
  action: string,
  data?: unknown,
  timeoutMs = 30_000
): Promise<T> {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > LONG_CONTROL_TIMEOUT
  ) {
    throw new RangeError('Invalid control timeout');
  }
  /** Private native owner/port/token record; never expose it through public metrics. */
  const descriptor = readControlDescriptor(stateDir, name);
  if (!descriptor) {
    throw new Error(`Control not running: ${name}`);
  }
  if (processIdentity(descriptor.pid) !== descriptor.identity) {
    throw new Error('Control owner is no longer verified');
  }
  /** Complete bounded private request line including its secret token; never log it. */
  const request =
    JSON.stringify({ token: descriptor.token, action, data }) + '\n';
  if (Buffer.byteLength(request) > MAX_REQUEST) {
    throw new Error('Control request too large');
  }
  return new Promise<T>((resolve, reject) => {
    /** Owned one-request IPv4-loopback client, destroyed on every terminal outcome. */
    const socket = net.connect({ host: '127.0.0.1', port: descriptor.port });
    let settled = false;
    let response = '';
    /** Settle this client once and destroy its native socket; server side effects may still be running.
     * @param {Error | undefined} error Optional private transport or control failure.
     * @param {T | undefined} value Optional decoded success value.
     * @returns {void} Resolves or rejects once without replay. */
    const finish = (error?: Error, value?: T) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(value as T);
      }
    };
    socket.setTimeout(timeoutMs, () =>
      finish(new Error('Control request timed out'))
    );
    socket.once('error', (error) => finish(error));
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (Buffer.byteLength(response) > MAX_RESPONSE) {
        finish(new Error('Control response too large'));
        return;
      }
      /** Position of a complete response line inside the bounded accumulator. */
      const pos = response.indexOf('\n');
      if (pos === -1) {
        return;
      }
      try {
        /** Unknown parsed response envelope; require explicit ok true before returning its value. */
        const result = JSON.parse(response.slice(0, pos));
        if (result?.ok !== true) {
          throw new Error(
            typeof result?.error === 'string'
              ? result.error
              : 'Control request rejected'
          );
        }
        finish(undefined, result.value as T);
      } catch (error) {
        finish(error as Error);
      }
    });
    socket.on('end', () => {
      if (!settled) {
        finish(new Error('Control closed without response'));
      }
    });
  });
}
