import type { IncomingMessage } from "node:http";

import type { SharedDevRegistration, SharedDevSnapshot } from "../types.js";

export interface DevtoolsApiContext {
    req: IncomingMessage;
    app: SharedDevRegistration;
    snapshot: SharedDevSnapshot;
    identifier?: string | null;
}

export type DevtoolsApiHandler = (context: DevtoolsApiContext) => Promise<unknown> | unknown;

const apiHandlers = new Map<string, DevtoolsApiHandler>();

export const registerDevtoolsApiHandler = (name: string, handler: DevtoolsApiHandler) => {
    apiHandlers.set(name, handler);
    return handler;
};

export const unregisterDevtoolsApiHandler = (name: string) => {
    apiHandlers.delete(name);
};

export const getDevtoolsApiHandler = (name: string) => apiHandlers.get(name) ?? null;
