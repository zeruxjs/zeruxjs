/** Authenticated, loopback-only process control. Control descriptors are private
 * to the OS user; untrusted clients cannot select a different process by PID. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { processExists, processIdentity } from './lifecycle.js';

export interface ControlDescriptor {
  version: 1;
  name: string;
  pid: number;
  identity: string;
  port: number;
  token: string;
}
export interface LocalControl {
  readonly descriptor: ControlDescriptor;
  close(): Promise<void>;
}
const MAX_REQUEST = 4096;
const MAX_RESPONSE = 131072;
const CONTROL_TIMEOUT = 30_000;
const LONG_CONTROL_TIMEOUT = 620_000;
export function validateControlName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,240}$/.test(name) || name.includes('..')) throw new TypeError('Invalid control name');
}
export function controlDirectory(stateDir: string): string {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  return path.join(stateDir, `app-controls-${uid}`);
}
export function ensureControlDirectory(stateDir: string, create = false): string {
  const dir = controlDirectory(stateDir);
  if (create) fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || (typeof process.getuid === 'function' && st.uid !== process.getuid()) || (st.mode & 0o077) !== 0) {
    throw new Error('Unsafe control directory: expected a private, owned directory');
  }
  return dir;
}
export function descriptorPath(stateDir: string, name: string): string {
  validateControlName(name);
  return path.join(controlDirectory(stateDir), `${createHash('sha256').update(name).digest('hex')}.json`);
}
function validateRecord(value: any, name: string): value is ControlDescriptor {
  return value?.version === 1 && value.name === name && Number.isSafeInteger(value.pid) && value.pid > 1 &&
    typeof value.identity === 'string' && value.identity.length > 0 && value.identity.length < 256 &&
    Number.isInteger(value.port) && value.port > 0 && value.port <= 65535 &&
    typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token);
}
export function readControlDescriptor(stateDir: string, name: string): ControlDescriptor | null {
  validateControlName(name);
  try {
    ensureControlDirectory(stateDir);
    const filename = descriptorPath(stateDir, name);
    const st = fs.lstatSync(filename);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 2048 || (st.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid())) throw new Error('Unsafe control descriptor');
    const value: unknown = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!validateRecord(value, name)) throw new Error('Invalid control descriptor');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function writePrivate(filename: string, payload: string): void {
  const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Unsafe control descriptor symlink'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    fs.renameSync(temporary, filename);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}
export type ControlHandler = (action: string, data: unknown) => Promise<unknown> | unknown;
/** Serve JSON-line requests on an ephemeral IPv4 loopback port. Auth is required
 * even on localhost because another local user may reach the TCP listener. */
export async function createLocalControl(stateDir: string, name: string, handler: ControlHandler): Promise<LocalControl> {
  const dir = ensureControlDirectory(stateDir, true);
  const filename = descriptorPath(stateDir, name);
  const old = readControlDescriptor(stateDir, name);
  if (old && processExists(old.pid) && processIdentity(old.pid) === old.identity) throw new Error(`Control already running: ${name}`);
  if (old && processExists(old.pid) && processIdentity(old.pid) === null) throw new Error('Unverifiable control owner; refusing takeover');
  const identity = processIdentity(process.pid);
  if (!identity) throw new Error('Cannot verify this process identity for local controls');
  const token = randomBytes(32).toString('hex');
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.setTimeout(CONTROL_TIMEOUT, () => socket.destroy());
    let raw = '';
    let handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      raw += chunk.toString('utf8');
      if (Buffer.byteLength(raw) > MAX_REQUEST) { handled = true; socket.destroy(); return; }
      const end = raw.indexOf('\n');
      if (end < 0) return;
      handled = true;
      const respond = (result: unknown) => {
        const data = JSON.stringify(result);
        if (Buffer.byteLength(data) > MAX_RESPONSE) { socket.end('{"ok":false,"error":"Response too large"}\n'); return; }
        socket.end(data + '\n');
      };
      void (async () => {
        try {
          const msg = JSON.parse(raw.slice(0, end));
          if (typeof msg?.token !== 'string' || !/^[a-f0-9]{64}$/.test(msg.token) ||
              !timingSafeEqual(Buffer.from(msg.token, 'hex'), Buffer.from(token, 'hex'))) throw new Error('Unauthorized');
          if (typeof msg.action !== 'string' || !/^[a-z-]{1,32}$/.test(msg.action)) throw new Error('Invalid control action');
          if (msg.action === 'deploy' || msg.action === 'stop' || msg.action === 'drain' || msg.action === 'reconcile' || msg.action === 'scale') socket.setTimeout(LONG_CONTROL_TIMEOUT);
          return { ok: true, value: await handler(msg.action, msg.data) };
        } catch (error) { return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : 'Control error' }; }
      })().then(respond).catch(() => socket.destroy());
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Unexpected control address');
    const descriptor: ControlDescriptor = { version: 1, name, pid: process.pid, identity, port: address.port, token };
    writePrivate(filename, JSON.stringify(descriptor) + '\n');
    let closed = false;
    return { descriptor, async close() {
      if (closed) return;
      closed = true;
      try {
        const current = readControlDescriptor(stateDir, name);
        if (current && current.token === token && current.pid === process.pid) fs.unlinkSync(filename);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const force = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 2_000);
      try { await new Promise<void>(resolve => server.close(() => resolve())); }
      finally { clearTimeout(force); }
    }};
  } catch (error) { for (const socket of sockets) socket.destroy(); server.close(); throw error; }
}
export async function sendLocalControl<T = unknown>(stateDir: string, name: string, action: string, data?: unknown, timeoutMs = 30_000): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LONG_CONTROL_TIMEOUT) throw new RangeError('Invalid control timeout');
  const descriptor = readControlDescriptor(stateDir, name);
  if (!descriptor) throw new Error(`Control not running: ${name}`);
  if (processIdentity(descriptor.pid) !== descriptor.identity) throw new Error('Control owner is no longer verified');
  const request = JSON.stringify({ token: descriptor.token, action, data }) + '\n';
  if (Buffer.byteLength(request) > MAX_REQUEST) throw new Error('Control request too large');
  return new Promise<T>((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: descriptor.port });
    let settled = false;
    let response = '';
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value as T);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error('Control request timed out')));
    socket.once('error', error => finish(error));
    socket.on('connect', () => socket.write(request));
    socket.on('data', chunk => {
      response += chunk.toString('utf8');
      if (Buffer.byteLength(response) > MAX_RESPONSE) { finish(new Error('Control response too large')); return; }
      const pos = response.indexOf('\n');
      if (pos === -1) return;
      try {
        const result = JSON.parse(response.slice(0, pos));
        if (result?.ok !== true) throw new Error(typeof result?.error === 'string' ? result.error : 'Control request rejected');
        finish(undefined, result.value as T);
      } catch (error) { finish(error as Error); }
    });
    socket.on('end', () => { if (!settled) finish(new Error('Control closed without response')); });
  });
}
