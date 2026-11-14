import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Validated alias-to-absolute-target file data, never executable module discovery. */
type PathMap = Record<string, string>;
/** Bounded explicit alias syntax; traversal/prototype-special segments are checked separately. */
const ALIAS = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}:[a-zA-Z0-9_./-]{1,200}$/;
/** Validate bounded alias syntax and reject traversal/prototype-special segments before filesystem use.
 * @param {string} alias - Literal trusted alias; legacy validation errors may include its spelling.
 * @returns {void} Invalid aliases reject before reading/writing the registry.
 */
function validateAlias(alias: string): void {
  if (
    typeof alias !== 'string' ||
    !ALIAS.test(alias) ||
    alias.includes('..') ||
    alias.includes('//') ||
    ['__proto__', 'constructor', 'prototype'].some((v) =>
      alias.split(':').includes(v)
    )
  ) {
    throw new Error(`[zerux] Invalid path alias: ${String(alias)}`);
  }
}

export interface PathRegistryOptions {
  /** Trusted owner-controlled directory; defaults to invocation-time process.cwd(). */
  directory?: string;
  /** Optional registry filename resolving directly within directory; defaults to .zerux-paths.json. */
  file?: string;
}
/** Create an inert synchronous alias facade over a trusted directory. Each operation closes its own file handles; no persistent close owner exists.
 * @param {PathRegistryOptions} options - Trusted directory/file selection; directory ownership and cross-process writer serialization remain host responsibilities.
 * @returns {object} Register/resolve/list/unregister methods; atomic replacement does not prevent concurrent lost updates.
 */
export function createPathRegistry(options: PathRegistryOptions = {}) {
  /** Resolved trusted registry directory; no automatic sandbox against a hostile directory owner. */
  const directory = path.resolve(options.directory ?? process.cwd());
  /** Registry destination whose resolved parent must be the selected directory. */
  const filename = path.resolve(directory, options.file ?? '.zerux-paths.json');
  if (path.dirname(filename) !== directory) {
    throw new Error('[zerux] Path registry file must be within directory');
  }

  /** Read/validate a bounded private registry with no-follow file ownership.
   * @returns {PathMap} Fresh null-prototype map, empty on ENOENT; corruption/permission errors propagate. */
  const read = (): PathMap => {
    let raw: string;
    try {
      /** Owned synchronous no-follow/nonblocking read descriptor, always closed in finally. */
      const fd = fs.openSync(
        filename,
        fs.constants.O_RDONLY |
          fs.constants.O_NOFOLLOW |
          fs.constants.O_NONBLOCK,
        0o600
      );
      try {
        /** Physical registry shape/size observation; only files up to 1 MiB are accepted. */
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > 1024 * 1024) {
          throw new Error('[zerux] Unsafe path registry');
        }
        /** One-extra-byte read buffer detects source growth beyond the observed size. */
        const bytes = Buffer.alloc(stat.size + 1);
        let size = 0;
        // Bound synchronous reads and observe one extra byte to reject registry growth.
        while (size < bytes.length) {
          /** Actual synchronous read size; zero terminates the bounded file read. */
          const count = fs.readSync(fd, bytes, size, bytes.length - size, null);
          if (!count) {
            break;
          }
          size += count;
        }
        if (size > stat.size) {
          throw new Error('[zerux] Path registry changed');
        }
        raw = bytes.subarray(0, size).toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.create(null);
      }
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('[zerux] Unsafe path registry', { cause: error });
      }
      throw error;
    }
    /** Parsed inert JSON, validated before any alias/target is trusted. */
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('[zerux] Invalid path registry');
    }
    /** Fresh null-prototype alias map preventing inherited-key lookup confusion. */
    const output: PathMap = Object.create(null);
    // Validate every own entry before exposing any parsed mapping.
    for (const [alias, target] of Object.entries(data)) {
      validateAlias(alias);
      if (typeof target !== 'string' || !path.isAbsolute(target)) {
        throw new Error('[zerux] Invalid registry path');
      }
      output[alias] = target;
    }
    return output;
  };
  /** Write/fsync a private exclusive temporary registry then rename it into place.
   * @param {PathMap} data - Validated inert mapping snapshot; no source module is executed.
   * @returns {void} Atomic-file observation; cleanup failures stay visible and cross-process lost updates remain possible. */
  const write = (data: PathMap): void => {
    fs.mkdirSync(directory, { recursive: true });
    /** Unique owned private temporary file, removed after promotion or failure. */
    const temp = path.join(
      directory,
      `.zerux-paths-${randomBytes(8).toString('hex')}.tmp`
    );
    try {
      /** Bounded UTF-8 JSON plus the compatible trailing newline. */
      const serialized = JSON.stringify(data, null, 2) + '\n';
      if (Buffer.byteLength(serialized) > 1024 * 1024) {
        throw new Error('[zerux] Path registry exceeds the maximum size');
      }
      /** Owned exclusive temporary descriptor, closed before rename. */
      const handle = fs.openSync(temp, 'wx', 0o600);
      try {
        fs.writeFileSync(handle, serialized, 'utf8');
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(temp, filename);
    } finally {
      try {
        fs.unlinkSync(temp);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // eslint-disable-next-line no-unsafe-finally -- Preserve visible failure when owned private temporary cleanup fails.
          throw error;
        }
      }
    }
  };
  return {
    /** Resolve an existing target and reserve the alias unless it already points to that same target.
     * @param {string} alias - Validated exact alias.
     * @param {string} target - Trusted relative/absolute target; resolution is not a filesystem sandbox.
     * @returns {void} Private atomic mapping update; conflicting aliases reject without replacing the old target.
     */
    register(alias: string, target: string): void {
      validateAlias(alias);
      if (typeof target !== 'string' || !target.trim()) {
        throw new Error('[zerux] Path target is empty');
      }
      /** Trusted existing target path; not fetched or imported by registry operations. */
      const resolved = path.resolve(directory, target);
      if (!fs.existsSync(resolved)) {
        throw new Error(`[zerux] Target not found: ${resolved}`);
      }
      /** Fresh validated snapshot staged before one compatible alias mutation. */
      const current = read();
      if (Object.hasOwn(current, alias) && current[alias] !== resolved) {
        throw new Error(`[zerux] Alias already exists: ${alias}`);
      }
      current[alias] = resolved;
      write(current);
    },
    /** Look up one validated alias without loading or executing its target.
     * @param {string} alias - Exact alias key.
     * @returns {string | null} Stored absolute target or null.
     */
    resolve(alias: string): string | null {
      validateAlias(alias);
      return read()[alias] ?? null;
    },
    /** Read and project the bounded registry without sharing its mutable parsed map.
     * @returns {PathMap} Fresh alias/target map; file corruption and unsafe entries reject.
     */
    list(): PathMap {
      return { ...read() };
    },
    /** Delete one mapping while preserving the target file itself.
     * @param {string} alias - Validated exact alias key.
     * @returns {void} Missing aliases do not trigger a write; failures remain visible.
     */
    unregister(alias: string): void {
      validateAlias(alias);
      /** Fresh validated snapshot staged before one compatible alias mutation. */
      const current = read();
      if (!Object.hasOwn(current, alias)) {
        return;
      }
      delete current[alias];
      write(current);
    },
  };
}
