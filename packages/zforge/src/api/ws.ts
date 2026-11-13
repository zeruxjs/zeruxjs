export type DevtoolsSocketChannelType = 'server' | 'peer';

export interface DevtoolsSocketEnvelope {
  /** Fixed channel envelope discriminator. */
  type: 'channel';
  /** Explicit server-handler or peer-forwarding routing kind. */
  channelType: DevtoolsSocketChannelType;
  /** Named channel whose receiving owner validates payload and permissions. */
  channel: string;
  /** Registered application namespace; client labels are not authenticated identity. */
  app: string;
  /** Optional client pairing label; never sufficient authorization. */
  identifier?: string;
  /** Explicit module routing label. */
  moduleId?: string;
  /** Optional peer module destination. */
  targetModuleId?: string;
  /** Declared caller module label interpreted only by trusted host policy. */
  requesterModuleId?: string;
  /** Untrusted data requiring validation by the receiving handler. */
  payload?: Record<string, unknown>;
}

export interface DevtoolsSocketContext {
  /** Registered application namespace; client labels are not authenticated identity. */
  app: string;
  /** Optional client pairing label; never sufficient authorization. */
  identifier?: string;
  /** Declared development client kind, not a verified role. */
  clientType?: string;
}

export type DevtoolsServerChannelHandler = (
  payload: Record<string, unknown> | undefined,
  context: DevtoolsSocketContext
) => Promise<unknown> | unknown;

/** Legacy process-wide server channel callbacks; hosts own explicit unregister and callback cleanup. */
const serverChannelHandlers = new Map<string, DevtoolsServerChannelHandler>();

/** Install a trusted server channel callback by exact name.
 * @param {string} name - Explicit channel key replacing any existing callback.
 * @param {DevtoolsServerChannelHandler} handler - Host-owned callback retaining authorization/input validation.
 * @returns {DevtoolsServerChannelHandler} The registered callback, not a disposer.
 */
export const registerDevtoolsServerChannel = (
  name: string,
  handler: DevtoolsServerChannelHandler
) => {
  serverChannelHandlers.set(name, handler);
  return handler;
};

/** Remove one legacy server channel callback.
 * @param {string} name - Exact channel registration key.
 * @returns {void} Deletes only the registration; arbitrary callback resources remain host-owned.
 */
export const unregisterDevtoolsServerChannel = (name: string) => {
  serverChannelHandlers.delete(name);
};

/** Look up a legacy channel callback without dispatching it.
 * @param {string} name - Exact channel key.
 * @returns {DevtoolsServerChannelHandler | null} Borrowed callback or null.
 */
export const getDevtoolsServerChannelHandler = (name: string) =>
  serverChannelHandlers.get(name) ?? null;

/** Construct a native WebSocket URL from explicit development settings.
 * @param {{baseUrl: string, app: string, client: string, serviceName?: string, identifier?: string | null, moduleId?: string | null}} options - Host-selected route and optional pairing labels.
 * @param {string} options.baseUrl - Trusted development server origin.
 * @param {string} options.app - Registered application namespace.
 * @param {string} options.client - Declared client kind, not authenticated identity.
 * @param {string} [options.serviceName] - Trusted endpoint namespace.
 * @param {string | null} [options.identifier] - Optional pairing label.
 * @param {string | null} [options.moduleId] - Explicit module routing label.
 * @returns {string} WS/WSS URL; construction does not authenticate or open a socket.
 */
export const createWebSocketUrl = (options: {
  /** Trusted development origin used for the socket URL. */
  baseUrl: string;
  /** Registered application namespace; client labels are not authenticated identity. */
  app: string;
  /** Explicit page/devtools client label. */
  client: 'devtools' | 'page' | string;
  /** Trusted socket endpoint namespace; defaults to zdev. */
  serviceName?: string;
  /** Optional client pairing label; never sufficient authorization. */
  identifier?: string | null;
  /** Explicit module routing label. */
  moduleId?: string | null;
}) => {
  /** Parsed trusted development origin used to choose the WebSocket scheme and authority. */
  const base = new URL(options.baseUrl);
  /** WSS for an HTTPS development origin, otherwise legacy WS. */
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  /** Trusted service namespace used in the WebSocket endpoint path. */
  const service = options.serviceName || 'zdev';
  /** Constructed socket URL carrying only the explicit host-selected labels. */
  const url = new URL(`${protocol}//${base.host}/__${service}/ws`);
  url.searchParams.set('app', options.app);
  url.searchParams.set('client', options.client);
  if (options.identifier) {
    url.searchParams.set('identifier', options.identifier);
  }
  if (options.moduleId) {
    url.searchParams.set('moduleId', options.moduleId);
  }
  return url.toString();
};

/** Describe a legacy server-channel dispatch without executing any callback.
 * @param {string} app - Registered application namespace.
 * @param {string} channel - Explicit server channel key.
 * @param {Record<string, unknown>} [payload] - Receiver-validated message data.
 * @param {string} [identifier] - Optional pairing label.
 * @param {string} [moduleId] - Target module label.
 * @param {string} [requesterModuleId] - Declared caller module label.
 * @returns {DevtoolsSocketEnvelope} Inert envelope; server authorization remains independent.
 */
export const createServerChannelMessage = (
  app: string,
  channel: string,
  payload?: Record<string, unknown>,
  identifier?: string,
  moduleId?: string,
  requesterModuleId?: string
): DevtoolsSocketEnvelope => ({
  type: 'channel',
  channelType: 'server',
  app,
  channel,
  identifier,
  moduleId,
  requesterModuleId,
  payload,
});

/** Describe peer-channel forwarding without opening or sending a socket.
 * @param {string} app - Registered application namespace.
 * @param {string} channel - Explicit peer channel key.
 * @param {Record<string, unknown>} [payload] - Receiver-validated message data.
 * @param {string} [identifier] - Optional pairing label.
 * @param {string} [moduleId] - Origin module label.
 * @param {string} [targetModuleId] - Destination module label.
 * @param {string} [requesterModuleId] - Declared caller module label.
 * @returns {DevtoolsSocketEnvelope} Inert routing envelope, not a grant of access.
 */
export const createPeerChannelMessage = (
  app: string,
  channel: string,
  payload?: Record<string, unknown>,
  identifier?: string,
  moduleId?: string,
  targetModuleId?: string,
  requesterModuleId?: string
): DevtoolsSocketEnvelope => ({
  type: 'channel',
  channelType: 'peer',
  app,
  channel,
  identifier,
  moduleId,
  targetModuleId,
  requesterModuleId,
  payload,
});
