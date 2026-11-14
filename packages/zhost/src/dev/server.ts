import { createLiveRequestHandler } from './live-handler.js';
import { createDevelopmentWatchIgnore } from './watch-policy.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import process from 'node:process';
import { startWatcher } from 'zlook';
import { WebSocketServer, WebSocket } from 'ws';
import {
  closeSharedDevServer,
  ensureSharedDevServer,
  getDevtoolsServerChannelHandler,
  publishSharedDevEvent,
  registerSharedDevApp,
  resolveSharedDevModuleSocketRequest,
  setSharedDevEventBroadcaster,
  unregisterSharedDevApp,
} from 'zforge';

import { createInjectedAppHandler } from './injection.js';
import {
  portlessProxy,
  portlessAlias,
  portlessGet,
} from '../portless/portless.js';

/* ---------------- UTIL ---------------- */

let sharedDevWebSocketServer: WebSocketServer | null = null;
let sharedDevWebSocketHttpServer: http.Server | null = null;
/** Legacy process-global mutable development alias holder shared with injected client handlers. */
const devPortLessAlias: { value: string | null | false } = { value: null };

/** Attach/reuse legacy shared development WebSocket channels on the host-owned devtools server.
 * These channels are development integration, not the explicit authorized production transport adapters.
 * @param {http.Server} server Host-owned shared development HTTP listener.
 * @returns {WebSocketServer} Shared development socket hub; native server close clears the global association. */
const ensureSharedDevSockets = (server: http.Server) => {
  if (sharedDevWebSocketServer && sharedDevWebSocketHttpServer === server) {
    return sharedDevWebSocketServer;
  }

  if (sharedDevWebSocketServer) {
    sharedDevWebSocketServer.close();
  }

  sharedDevWebSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
  });
  sharedDevWebSocketHttpServer = server;

  server.on('upgrade', (req, socket, head) => {
    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      socket.destroy();
      return;
    }
    /** Bounded legacy development channel path match; URL fields remain routing labels, not verified user identity. */
    const wsMatch = requestUrl.pathname.match(/^\/__([a-z0-9_-]{1,64})\/ws$/i);
    if (!wsMatch) {
      socket.destroy();
      return;
    }

    sharedDevWebSocketServer!.handleUpgrade(req, socket, head, (ws) => {
      (ws as WebSocket & { appName?: string }).appName =
        requestUrl.searchParams.get('app') ?? undefined;
      (ws as WebSocket & { identifier?: string }).identifier =
        requestUrl.searchParams.get('identifier') ?? undefined;
      (ws as WebSocket & { clientType?: string }).clientType =
        requestUrl.searchParams.get('client') ?? undefined;
      (ws as WebSocket & { moduleId?: string }).moduleId =
        requestUrl.searchParams.get('moduleId') ?? undefined;
      sharedDevWebSocketServer!.emit('connection', ws, req);
    });
  });

  sharedDevWebSocketServer.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      try {
        /** Unknown parsed development-channel envelope checked before explicit registered-handler dispatch. */
        const message = JSON.parse(String(raw));
        if (
          message?.type !== 'channel' ||
          typeof message.channel !== 'string'
        ) {
          return;
        }

        /** Trusted host application label used for local aliases and development registration. */
        const appName = (ws as WebSocket & { appName?: string }).appName;
        /** Legacy client correlation label; never authorization evidence. */
        const identifier = (ws as WebSocket & { identifier?: string })
          .identifier;
        /** Legacy declared client-kind label for registered development callbacks. */
        const clientType = (ws as WebSocket & { clientType?: string })
          .clientType;
        /** Connection-level module routing label retained for explicit registered module dispatch. */
        const boundModuleId = (ws as WebSocket & { moduleId?: string })
          .moduleId;

        if (message.channelType === 'server') {
          if (!appName) {
            return;
          }

          let data: unknown = null;
          /** Recipient/request module routing label; registered module policy remains authoritative. */
          const targetModuleId =
            typeof message.moduleId === 'string'
              ? message.moduleId
              : boundModuleId;
          if (targetModuleId) {
            data = await resolveSharedDevModuleSocketRequest({
              appName,
              moduleId: targetModuleId,
              channel: message.channel,
              payload: message.payload,
              identifier,
              clientType,
              requesterModuleId:
                typeof message.requesterModuleId === 'string'
                  ? message.requesterModuleId
                  : boundModuleId,
            });
          } else {
            /** Previously registered trusted development channel handler; no source string is evaluated. */
            const handler = getDevtoolsServerChannelHandler(message.channel);
            if (!handler) {
              return;
            }
            data = await handler(message.payload, {
              app: appName,
              identifier,
              clientType,
            });
          }

          ws.send(
            JSON.stringify({
              type: 'server-channel',
              channel: message.channel,
              moduleId: targetModuleId,
              identifier,
              payload: data ?? null,
            })
          );
          return;
        }

        if (message.channelType === 'peer' && appName) {
          for (const client of sharedDevWebSocketServer!.clients) {
            if (client.readyState !== WebSocket.OPEN || client === ws) {
              continue;
            }
            /** Recipient connection’s application routing label. */
            const targetApp = (client as WebSocket & { appName?: string })
              .appName;
            /** Recipient connection’s correlation label, used only to filter development messages. */
            const targetIdentifier = (
              client as WebSocket & { identifier?: string }
            ).identifier;
            /** Recipient/request module routing label; registered module policy remains authoritative. */
            const targetModuleId = (client as WebSocket & { moduleId?: string })
              .moduleId;
            if (targetApp !== appName) {
              continue;
            }
            if (
              identifier &&
              targetIdentifier &&
              identifier !== targetIdentifier
            ) {
              continue;
            }
            if (
              typeof message.targetModuleId === 'string' &&
              targetModuleId !== message.targetModuleId
            ) {
              continue;
            }
            if (
              typeof message.moduleId === 'string' &&
              targetModuleId &&
              targetModuleId !== message.moduleId
            ) {
              continue;
            }
            client.send(
              JSON.stringify({
                type: 'peer-channel',
                channel: message.channel,
                moduleId:
                  typeof message.moduleId === 'string'
                    ? message.moduleId
                    : boundModuleId,
                identifier,
                payload: message.payload ?? null,
              })
            );
          }
        }
      } catch {
        return;
      }
    });
  });

  server.on('close', () => {
    if (sharedDevWebSocketHttpServer === server) {
      sharedDevWebSocketServer?.close();
      sharedDevWebSocketServer = null;
      sharedDevWebSocketHttpServer = null;
      setSharedDevEventBroadcaster(null);
    }
  });

  setSharedDevEventBroadcaster((appName, event) => {
    if (!sharedDevWebSocketServer) {
      return;
    }

    for (const client of sharedDevWebSocketServer.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }

      /** Recipient connection’s application routing label. */
      const targetApp = (client as WebSocket & { appName?: string }).appName;
      if (targetApp && targetApp !== appName) {
        continue;
      }

      /** Recipient connection’s correlation label, used only to filter development messages. */
      const targetIdentifier = (client as WebSocket & { identifier?: string })
        .identifier;
      /** Optional emitted event correlation label used only for development routing. */
      const eventIdentifier =
        typeof event.payload?.identifier === 'string'
          ? event.payload.identifier
          : undefined;
      if (
        event.type === 'client-event' &&
        targetIdentifier &&
        eventIdentifier &&
        targetIdentifier !== eventIdentifier
      ) {
        continue;
      }

      client.send(JSON.stringify(event));
    }
  });

  return sharedDevWebSocketServer;
};

/** Probe native availability with a temporary server, closing it after listening.
 * @param {number} port Host-selected candidate port.
 * @returns {Promise<boolean>} Availability observation only; the eventual bind must still handle races. */
const isPortFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    /** Owned temporary native availability probe, closed after its listening event. */
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port);
  });

/** Find the first currently free candidate in the remaining TCP port range.
 * @param {number} start Trusted validated initial port.
 * @returns {Promise<number>} Observed free candidate, never a reservation against later bind races. */
const findPort = async (start: number) => {
  let p = start;
  while (p <= 65535 && !(await isPortFree(p))) {
    p++;
  }
  if (p > 65535) {
    throw new Error('No free application port');
  }
  return p;
};

/** Read legacy local service metadata; parse/read failures retain the existing empty-list fallback.
 * @param {string} file Trusted host-derived service metadata path.
 * @returns {any} Parsed legacy JSON or an empty list; this is not a validated public configuration loader. */
const readJSON = (file: string) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
};

/** Write legacy host-local service metadata as readable JSON.
 * @param {string} file Trusted host-derived metadata path.
 * @param {any} data Trusted local status records, excluding credentials and request payloads.
 * @returns {void} Synchronous write; this legacy helper is not an atomic durable journal. */
const writeJSON = (file: string, data: any) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

/** Normalize the trusted legacy WebSocket path with a leading slash and default.
 * @param {unknown} value Host configuration path.
 * @returns {string} Legacy normalized path; production adapters use stricter exact-path contracts. */
const normalizeWebSocketPath = (value: unknown) => {
  /** Trimmed legacy configured path or fixed default before adding its leading slash. */
  const pathValue =
    typeof value === 'string' && value.trim() ? value.trim() : '/ws';
  return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
};

/** Match the legacy configured path or suffix for the opt-in development broadcast socket.
 * @param {string} pathname Parsed native request path.
 * @param {string} configuredPath Trusted normalized legacy path.
 * @returns {boolean} Whether the legacy broadcast path matches; this is not authentication. */
const isWebSocketPath = (pathname: string, configuredPath: string) =>
  pathname === configuredPath || pathname.endsWith(configuredPath);

/* ---------------- SERVER.JSON ---------------- */

/** Create the explicit host service metadata directory under the current working root.
 * @param {string} service Previously validated bounded service name.
 * @returns {string} Fixed server.json path; no request-selected destination is accepted. */
const getServiceFile = (service: string) => {
  /** Trusted host-derived legacy service metadata directory. */
  const dir = path.join(process.cwd(), `.${service}`);
  /** Fixed server.json path inside the selected host service directory. */
  const file = path.join(dir, 'server.json');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return file;
};

/** Reset only this legacy service’s metadata list before startup.
 * @param {string} file Trusted fixed service metadata path.
 * @returns {void} Deletes prior metadata and writes an empty list; no app binary is executed. */
const initServiceFile = (file: string) => {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
  writeJSON(file, []);
};

/** Update one legacy local service URL record for operator discovery.
 * @param {string} file Trusted fixed metadata path.
 * @param {string} type Fixed internal app/dev record category.
 * @param {string[]} urls Host-derived listener and alias URLs.
 * @returns {void} Persists the legacy status list synchronously. */
const addSerDetails = (file: string, type: string, urls: string[]) => {
  /** Legacy parsed service status list retained only for local operator discovery. */
  const data = readJSON(file) || [];
  /** Existing matching fixed-category service record, if any. */
  const existing = data.find((x: any) => x.type === type);

  if (existing) {
    existing.urls = urls;
  } else {
    data.push({ type, urls });
  }

  writeJSON(file, data);
};

/** Remove one fixed local service category during owned shutdown.
 * @param {string} file Trusted fixed service metadata path.
 * @param {string} type Fixed internal app/dev record category.
 * @returns {void} Updates metadata only; it does not stop another process. */
const removeSerDetails = (file: string, type: string) => {
  let data = readJSON(file) || [];
  data = data.filter((x: any) => x.type !== type);
  writeJSON(file, data);
};

/* ---------------- MAIN ---------------- */

/** Start the explicit legacy process-lifetime development application with optional shared proxy, devtools and watcher.
 * This compatibility API retains broad host configuration; new protocol listeners use explicit transport adapters.
 * @param {any} details Trusted host bootstrap configuration and registered application callbacks, never request/model input.
 * @returns {Promise<void>} Startup receipt only; process signals own cleanup, with no scoped drain handle returned. */
export const startServer = async (details: any) => {
  /** Detached watch-ignore policy preventing generated output/state feedback loops. */
  const ignoredDevelopmentPath = createDevelopmentWatchIgnore(
    details.dev?.watchIgnoredPaths
  );
  /** Explicit validated compatibility proxy-selection flag. */
  const portless = details.config?.server?.portless ?? true;
  if (typeof portless !== 'boolean') {
    throw new TypeError('Invalid server.portless setting');
  }
  if (!details?.app?.func) {
    throw new Error('App func required');
  }

  /** Validated bounded host service namespace. */
  const service = details.service || 'zdev';
  if (
    typeof service !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(service)
  ) {
    throw new TypeError('Invalid service name');
  }
  /** Host process working root used for registration and source watching. */
  const root = process.cwd();

  /** Fixed host-derived local service status file. */
  const serviceFile = getServiceFile(service);
  initServiceFile(serviceFile);

  /* ---------------- PROXY ---------------- */

  if (portless) {
    console.log('- Starting portless proxy');
    if (!(await portlessProxy(undefined, { https: true }))) {
      throw new Error('Failed to start the portless proxy');
    }
    console.log('- Portless proxy ready');
  }

  /* ---------------- APP ---------------- */

  /** Trusted host application label used for local aliases and development registration. */
  const appName = details.app.name || 'app';

  /** Observed available app port; native bind below remains authoritative. */
  let appPort: number;
  if (details.app.port) {
    if (await isPortFree(details.app.port)) {
      appPort = details.app.port;
    } else {
      throw new Error('Port busy');
    }
  } else {
    appPort = await findPort(3000);
  }

  let devInfo: Awaited<ReturnType<typeof registerSharedDevApp>> | null = null;
  let devAlias = false;

  if (details.dev) {
    devInfo = await registerSharedDevApp({
      appName,
      appPort,
      rootDir: root,
      preferredPort: details.dev.port,
      dataFilePath: details.dev.dataFilePath,
      logFilePath: details.dev.logFilePath,
      runtimeManifestPath: details.dev.runtimeManifestPath,
      allowedDomains:
        details.config?.server?.allowedDomains ??
        details.config?.allowedDomains,
      allowedDevDomain:
        details.config?.server?.allowedDevDomain ??
        details.config?.allowedDevDomain,
      serviceName: service,
      devtools: details.config?.devtools,
    });
    /** Borrowed shared development server owner; unregister controls its final shutdown. */
    const sharedDevHandle = await ensureSharedDevServer(devInfo.port);
    if (sharedDevHandle) {
      ensureSharedDevSockets(sharedDevHandle.server);
    }

    devAlias = portless ? await portlessAlias(service, devInfo.port) : false;

    /** Optional host-owned shared proxy alias base URL. */
    const devAliasBase = devAlias ? await portlessGet(service) : false;
    /** Host-derived devtools/socket discovery URLs; no private session credentials are inserted. */
    const devUrls = [
      devInfo.urls.devtools,
      devInfo.urls.websocket,
      ...(devAliasBase
        ? [
            `${devAliasBase}/${devInfo.routeName}`,
            `${String(devAliasBase).replace(/^http/, 'ws')}/__${service}/ws?app=${encodeURIComponent(devInfo.routeName)}`,
          ]
        : []),
    ];

    addSerDetails(serviceFile, 'dev', devUrls);
    devPortLessAlias.value =
      devUrls.find(
        (url) =>
          new URL(url).hostname.endsWith('.localhost') &&
          new URL(url).protocol === 'https:'
      ) ?? null;
  }

  let appRequestHandler = details.app.func;
  if (devInfo) {
    appRequestHandler = createInjectedAppHandler(details.app.func, {
      serviceName: service,
      routeName: devInfo.routeName,
      devServerUrl: devInfo.urls.devtools,
      allowedDevDomain: devInfo.allowedDevDomain,
      devPortLessAlias: devPortLessAlias,
    });
  }

  let appWebSocketServer: WebSocketServer | null = null;
  if (details.config?.websocket?.enabled === true) {
    /** Optional host-supplied WebSocket message byte budget validated before ws creation. */
    const maxPayload = Number(details.config?.websocket?.maxPayload);
    appWebSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload:
        Number.isSafeInteger(maxPayload) &&
        maxPayload >= 1 &&
        maxPayload <= 16 * 1024 * 1024
          ? maxPayload
          : 1024 * 1024,
    });
    appWebSocketServer.on('connection', (ws) => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
      ws.on('pong', () => {
        (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
      });
      ws.on('message', (raw) => {
        if (appWebSocketServer) {
          for (const client of appWebSocketServer.clients) {
            if (client.readyState === WebSocket.OPEN && client !== ws) {
              client.send(raw);
            }
          }
        }
      });
    });

    /** Owned development broadcast heartbeat timer, cleared on its hub close. */
    const heartbeat = setInterval(() => {
      if (!appWebSocketServer) {
        return;
      }
      for (const client of appWebSocketServer.clients) {
        /** Borrowed native WebSocket recipient observed for heartbeat liveness. */
        const socket = client as WebSocket & { isAlive?: boolean };
        if (socket.isAlive === false) {
          socket.terminate();
          continue;
        }
        socket.isAlive = false;
        socket.ping();
      }
    }, 30_000);
    heartbeat.unref?.();
    appWebSocketServer.on('close', () => clearInterval(heartbeat));
  }

  /** Attach legacy opt-in broadcast upgrade handling to this owned app server.
   * @param {http.Server} server Owned application HTTP server.
   * @returns {void} Registers native upgrade callbacks; this legacy broadcast API supplies no separate authorization layer. */
  const bindWebSocketUpgrade = (server: http.Server) => {
    if (appWebSocketServer) {
      /** Trusted normalized legacy broadcast path used for upgrade routing. */
      const websocketPath = normalizeWebSocketPath(
        details.config?.websocket?.path
      );
      server.on('upgrade', (req, socket, head) => {
        let requestUrl: URL;
        try {
          requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        } catch {
          socket.destroy();
          return;
        }
        if (isWebSocketPath(requestUrl.pathname, websocketPath)) {
          appWebSocketServer!.handleUpgrade(req, socket, head, (ws) => {
            appWebSocketServer!.emit('connection', ws, req);
          });
        } else {
          socket.destroy();
        }
      });
    }
  };

  /** Per-request dispatch owner; a swap affects new requests while in-flight requests retain their captured handler. */
  const liveHandler = createLiveRequestHandler(appRequestHandler);
  /** Owned IPv4-loopback application listener, distinct from the shared portless proxy. */
  const appServer = http.createServer(liveHandler.handle);
  bindWebSocketUpgrade(appServer);

  await new Promise<void>((resolve, reject) => {
    appServer.once('error', reject);
    appServer.listen(appPort, '127.0.0.1', () => {
      appServer.off('error', reject);
      resolve();
    });
  });

  if (portless) {
    await portlessAlias(appName, appPort);
  }

  /** Optional host-created alias URL; direct mode remains available without proxy startup. */
  const appAliasUrl = portless ? await portlessGet(appName) : false;

  /** Public local discovery URLs for this one owned application. */
  const appUrls = [
    `http://127.0.0.1:${appPort}`,
    ...(appAliasUrl ? [appAliasUrl] : []),
  ];

  addSerDetails(serviceFile, 'app', appUrls);

  /* ---------------- LOG ---------------- */

  console.log('Application Started');

  console.log(`- App server started at ${appUrls.join(', ')}`);

  if (devInfo) {
    /** Host-derived devtools/socket discovery URLs; no private session credentials are inserted. */
    const devUrls = readJSON(serviceFile).find(
      (x: any) => x.type === 'dev'
    )?.urls;

    console.log(`- Dev server is running at ${devUrls.join(', ')}`);
  }

  /* ---------------- WATCH ---------------- */

  let stopWatcher: (() => void) | undefined;
  let rebuild = Promise.resolve();
  let stopping = false;
  if (details.dev) {
    /** Explicit trusted watch predicate or inert default; never evaluates changed source as a predicate.
     * @returns {boolean} The default predicate accepts the event; host-supplied predicates own their policy.
     */
    const trigger = details.dev.watchTriggerFunc || (() => true);

    stopWatcher = startWatcher(
      root,
      (event: any) => {
        if (stopping || !trigger(event)) {
          return;
        }
        rebuild = rebuild
          .then(async () => {
            if (stopping) {
              return;
            }

            console.log(
              `[Watcher] File changed: ${event.file} (${event.type})`
            );

            // Prepare the new application before switching traffic. If rebuilding
            // fails, preserve the previous request handler and listening socket.
            // Existing in-flight requests keep their original handler reference.
            await details.dev.watchFunc(event.file);
            /** Borrowed shared development server owner; unregister controls its final shutdown. */
            const sharedDevHandle = await ensureSharedDevServer(devInfo?.port);
            if (sharedDevHandle) {
              ensureSharedDevSockets(sharedDevHandle.server);
            }

            /** Prepared trusted replacement handler published only after successful host rebuild. */
            const nextHandler = devInfo
              ? createInjectedAppHandler(details.app.func, {
                  serviceName: service,
                  routeName: devInfo.routeName,
                  devServerUrl: devInfo.urls.devtools,
                  devPortLessAlias: devPortLessAlias,
                })
              : details.app.func;
            liveHandler.swap(nextHandler);

            console.log(
              `App handler updated without port rebinding at ${appUrls.join(', ')}`
            );

            if (devInfo) {
              await publishSharedDevEvent(devInfo.port, {
                app: devInfo.routeName,
                type: 'hot-update',
                serviceName: service,
                payload: {
                  file: event.file ?? null,
                  appUrls,
                  strategy:
                    typeof event.file === 'string' &&
                    /\.(css|less|sass|scss|styl|pcss)$/i.test(event.file)
                      ? 'style'
                      : 'document',
                  updatedAt: new Date().toISOString(),
                },
              });
            }
          })
          .catch((error) => console.error('[Watcher] Reload failed:', error));
      },
      {
        ignored: ignoredDevelopmentPath,
        onError: (error: Error) => console.error('[Watcher] Failed:', error),
      }
    );
  }

  /* ---------------- CLEANUP ---------------- */

  let cleanedUp = false;
  /** Fence new reloads, release the watcher and unregister local metadata once.
   * @returns {void} Best-effort metadata/shared-devtools cleanup; it does not await already-running rebuild work. */
  const cleanupState = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    stopping = true;
    stopWatcher?.();
    try {
      removeSerDetails(serviceFile, 'app');
      removeSerDetails(serviceFile, 'dev');
    } catch (error) {
      console.error('Cannot clean up service metadata:', error);
    }
    if (devInfo) {
      /** Whether this host root was the last registered development app. */
      const last = unregisterSharedDevApp(root);
      if (last) {
        void closeSharedDevServer().catch((error) =>
          console.error('Cannot close devtools:', error)
        );
      }
      // The proxy can serve unrelated apps; never stop it unconditionally.
    }
  };
  /** Request legacy process-lifetime app shutdown without stopping unrelated shared proxy apps.
   * @returns {Promise<void>} Waits bounded app HTTP close; this legacy path has no separate watcher/rebuild drain promise. */
  const shutdown = async () => {
    cleanupState();
    if (appWebSocketServer) {
      for (const client of appWebSocketServer.clients) {
        client.terminate();
      }
      appWebSocketServer.close();
    }
    // An existing keep-alive request must not block termination forever.
    /** Owned application server captured during shutdown. */
    const current = appServer;
    if (current.listening) {
      await new Promise<void>((resolve) => {
        let finished = false;
        /** Resolve native app close once and clear its deadline timer.
         * @returns {void} Resolves this bounded listener shutdown wait. */
        const done = () => {
          if (!finished) {
            finished = true;
            clearTimeout(timer);
            resolve();
          }
        };
        current.close(done);
        current.closeIdleConnections?.();
        /** Owned finite app close deadline; it closes remaining HTTP connections without stopping unrelated apps. */
        const timer = setTimeout(() => {
          current.closeAllConnections?.();
          done();
        }, 5000);
        timer.unref?.();
      });
    }
    process.exitCode = 0;
  };
  process.once('SIGINT', () => {
    void shutdown().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
  process.once('SIGTERM', () => {
    void shutdown().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
  process.once('exit', cleanupState);
};
