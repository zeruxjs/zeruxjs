import type { SharedDevRegistration, SharedDevSnapshot } from "./types.js";

export interface DevtoolsSectionContext {
    app: SharedDevRegistration;
    snapshot: SharedDevSnapshot;
    identifier?: string | null;
    modules: DevtoolsModuleDefinition[];
    module?: DevtoolsModuleDefinition;
}

export interface DevtoolsSectionDefinition {
    id: string;
    title: string;
    icon?: string;
    order?: number;
    moduleId?: string;
    render(context: DevtoolsSectionContext): string | Promise<string>;
}

export interface DevtoolsModuleAssetConfig {
    style?: string;
    script?: string;
}

export interface DevtoolsModuleServerConfig {
    api?: string;
    websocket?: string;
    shareWith?: string[];
}

export interface DevtoolsModuleConfig {
    id?: string;
    title?: string;
    version?: string;
    description?: string;
    entry: string;
    assets?: DevtoolsModuleAssetConfig;
    server?: DevtoolsModuleServerConfig;
    dependencies?: string[];
    meta?: Record<string, unknown>;
}

export interface DevtoolsModuleDefinition {
    id: string;
    title: string;
    version?: string;
    description?: string;
    badge?: string;
    packageName?: string;
    packageRoot?: string;
    dependencies?: string[];
    sections?: DevtoolsSectionDefinition[];
    assets?: {
        styleUrl?: string;
        scriptUrl?: string;
    };
    meta?: Record<string, unknown>;
}

export type DevtoolsApiModuleHandlers = Record<string, (context: {
    app: SharedDevRegistration;
    snapshot: SharedDevSnapshot;
    identifier?: string | null;
    request: import("node:http").IncomingMessage;
    body: unknown;
    module: DevtoolsModuleDefinition;
}) => Promise<unknown> | unknown>;

export type DevtoolsSocketModuleHandlers = Record<string, (context: {
    app: SharedDevRegistration;
    snapshot: SharedDevSnapshot;
    identifier?: string | null;
    clientType?: string;
    payload?: Record<string, unknown>;
    module: DevtoolsModuleDefinition;
}) => Promise<unknown> | unknown>;

const modules = new Map<string, DevtoolsModuleDefinition>();

export const defineDevtoolsModule = <T extends DevtoolsModuleDefinition>(definition: T) => definition;
export const defineDevtoolsModuleConfig = <T extends DevtoolsModuleConfig>(definition: T) => definition;
export const defineDevtoolsModuleApiHandlers = <T extends DevtoolsApiModuleHandlers>(handlers: T) => handlers;
export const defineDevtoolsModuleSocketHandlers = <T extends DevtoolsSocketModuleHandlers>(handlers: T) => handlers;

export const registerDevtoolsModule = (definition: DevtoolsModuleDefinition) => {
    modules.set(definition.id, definition);
    return definition;
};

export const unregisterDevtoolsModule = (id: string) => {
    modules.delete(id);
};

export const getRegisteredDevtoolsModules = () =>
    [...modules.values()].sort((left, right) => left.title.localeCompare(right.title));
