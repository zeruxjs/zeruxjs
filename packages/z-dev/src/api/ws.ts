export type DevtoolsSocketChannelType = "server" | "peer";

export interface DevtoolsSocketEnvelope {
    type: "channel";
    channelType: DevtoolsSocketChannelType;
    channel: string;
    app: string;
    identifier?: string;
    moduleId?: string;
    targetModuleId?: string;
    requesterModuleId?: string;
    payload?: Record<string, unknown>;
}

export interface DevtoolsSocketContext {
    app: string;
    identifier?: string;
    clientType?: string;
}

export type DevtoolsServerChannelHandler = (
    payload: Record<string, unknown> | undefined,
    context: DevtoolsSocketContext
) => Promise<unknown> | unknown;

const serverChannelHandlers = new Map<string, DevtoolsServerChannelHandler>();

export const registerDevtoolsServerChannel = (name: string, handler: DevtoolsServerChannelHandler) => {
    serverChannelHandlers.set(name, handler);
    return handler;
};

export const unregisterDevtoolsServerChannel = (name: string) => {
    serverChannelHandlers.delete(name);
};

export const getDevtoolsServerChannelHandler = (name: string) =>
    serverChannelHandlers.get(name) ?? null;

export const createWebSocketUrl = (options: {
    baseUrl: string;
    app: string;
    client: "devtools" | "page" | string;
    serviceName?: string;
    identifier?: string | null;
    moduleId?: string | null;
}) => {
    const base = new URL(options.baseUrl);
    const protocol = base.protocol === "https:" ? "wss:" : "ws:";
    const service = options.serviceName || "zdev";
    const url = new URL(`${protocol}//${base.host}/__${service}/ws`);
    url.searchParams.set("app", options.app);
    url.searchParams.set("client", options.client);
    if (options.identifier) {
        url.searchParams.set("identifier", options.identifier);
    }
    if (options.moduleId) {
        url.searchParams.set("moduleId", options.moduleId);
    }
    return url.toString();
};

export const createServerChannelMessage = (
    app: string,
    channel: string,
    payload?: Record<string, unknown>,
    identifier?: string,
    moduleId?: string,
    requesterModuleId?: string
): DevtoolsSocketEnvelope => ({
    type: "channel",
    channelType: "server",
    app,
    channel,
    identifier,
    moduleId,
    requesterModuleId,
    payload
});

export const createPeerChannelMessage = (
    app: string,
    channel: string,
    payload?: Record<string, unknown>,
    identifier?: string,
    moduleId?: string,
    targetModuleId?: string,
    requesterModuleId?: string
): DevtoolsSocketEnvelope => ({
    type: "channel",
    channelType: "peer",
    app,
    channel,
    identifier,
    moduleId,
    targetModuleId,
    requesterModuleId,
    payload
});
