import fs from 'node:fs';

import { CLIENT_EVENT_LIMIT, LOG_LINE_LIMIT } from './constants.js';
import { readJsonFile, writeJsonFile } from './fs.js';
import type { SharedDevRegistration, SharedDevSnapshot } from './types.js';

/** Read a bounded suffix from the opened log descriptor.
 * @param {string | null} filePath - Host-selected log path; null returns no lines.
 * @param {number} [limit] - Maximum returned nonempty lines.
 * @returns {string[]} Log suffix bounded to the final 256KiB; this is not a complete log export.
 */
export const readTailLines = (
  filePath: string | null,
  limit = LOG_LINE_LIMIT
) => {
  if (!filePath) {
    return [];
  }

  // Keep memory bounded even when the application's log file is very large.
  let fd: number;
  try {
    fd = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  let content: string;
  try {
    /** Opened log descriptor metadata validated as a regular file before reading. */
    const info = fs.fstatSync(fd);
    if (!info.isFile()) {
      throw new Error('Unsafe devtools log file');
    }
    /** At most 256KiB of trailing bytes, avoiding a whole-file read. */
    const length = Math.min(info.size, 256 * 1024);
    /** Owned bounded log buffer released after the synchronous read returns. */
    const buffer = Buffer.alloc(length);
    /** Actual number of bytes read from the observed trailing file region. */
    const bytes = fs.readSync(fd, buffer, 0, length, info.size - length);
    content = buffer.subarray(0, bytes).toString('utf8');
    if (info.size > length) {
      content = content.slice(content.indexOf('\n') + 1);
    }
  } finally {
    fs.closeSync(fd);
  }
  return content.split(/\r?\n/).filter(Boolean).slice(-limit);
};

/** Append one event to bounded private snapshot history.
 * @param {string | null} filePath - Host-owned snapshot destination; null is inert.
 * @param {Record<string, unknown>} event - Trusted already-redacted event record.
 * @returns {void} Atomically writes the updated capped history when a destination exists.
 */
export const appendSnapshotEvent = (
  filePath: string | null,
  event: Record<string, unknown>
) => {
  if (!filePath) {
    return;
  }

  /** Host-owned private snapshot loaded through the bounded state-file reader. */
  const snapshot = readJsonFile<Record<string, unknown>>(filePath, {});
  /** Existing array history normalized before appending and retaining only the newest records. */
  const currentEvents = Array.isArray(snapshot.clientEvents)
    ? snapshot.clientEvents
    : [];
  snapshot.clientEvents = [...currentEvents, event].slice(-CLIENT_EVENT_LIMIT);
  snapshot.updatedAt = new Date().toISOString();
  writeJsonFile(filePath, snapshot);
};

/** Project one registered application and its private state into the legacy development snapshot.
 * @param {SharedDevRegistration} app - Registered application with host-owned state/log paths.
 * @param {{identifier?: string | null}} [options] - Optional exact client-event identifier selection.
 * @param {string | null} [options.identifier] - Exact public event identifier filter; never authentication.
 * @returns {SharedDevSnapshot} Normalized development view; exposure still requires host access policy.
 */
export const normalizeSnapshot = (
  app: SharedDevRegistration,
  options?: { identifier?: string | null }
): SharedDevSnapshot => {
  /** Host-owned private snapshot loaded through the bounded state-file reader. */
  const snapshot = app.dataFilePath
    ? readJsonFile<Record<string, unknown>>(app.dataFilePath, {})
    : {};
  /** Stored event array used only after the snapshot field passes the legacy array check. */
  const rawEvents = Array.isArray(snapshot.clientEvents)
    ? (snapshot.clientEvents as Record<string, unknown>[])
    : [];
  /** Optional identifier-filtered event history; the identifier is not an authenticated identity. */
  const clientEvents = options?.identifier
    ? rawEvents.filter((event) => event.identifier === options.identifier)
    : rawEvents;

  return {
    routeName: app.routeName,
    appName: app.appName,
    rootDir: app.rootDir,
    appPort: app.appPort,
    manifestPath: app.runtimeManifestPath,
    logFilePath: app.logFilePath,
    startedAt: app.startedAt,
    updatedAt: String(snapshot.updatedAt ?? app.updatedAt),
    mode: String(snapshot.mode ?? 'dev'),
    routes: Array.isArray(snapshot.routes)
      ? (snapshot.routes as Array<{ path: string; methods: string[] }>)
      : [],
    devtools: {
      modules: [
        ...new Set([
          ...app.devtools.modules,
          ...(Array.isArray(
            (snapshot as { devtools?: { modules?: unknown[] } }).devtools
              ?.modules
          )
            ? (
                snapshot as {
                  devtools?: {
                    modules?: Array<
                      | string
                      | {
                          package: string;
                          enabled?: boolean;
                          options?: Record<string, unknown>;
                        }
                    >;
                  };
                }
              ).devtools!.modules!.map((m) =>
                typeof m === 'string' ? m : m.package
              )
            : []),
        ]),
      ],
    },
    clientEvents,
    logs: readTailLines(app.logFilePath),
    reload:
      snapshot.reload &&
      typeof snapshot.reload === 'object' &&
      !Array.isArray(snapshot.reload)
        ? (snapshot.reload as SharedDevSnapshot['reload'])
        : undefined,
  };
};
