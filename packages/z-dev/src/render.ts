import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getDevtoolsApiHandler } from "./api/registry.js";
import { loadApplicationSections as loadResolvedApplicationSections } from "./module-loader.js";
import type { DevtoolsModuleDefinition, DevtoolsSectionDefinition } from "./module-registry.js";
import type { SharedDevRegistration, SharedDevSnapshot } from "./types.js";

const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const runtimeRoot = path.join(packageRoot, "dist");
const assetsRoot = path.join(packageRoot, "assets");
const appRoot = path.join(runtimeRoot, "app");
const applicationRoot = path.join(appRoot, "application");

const importSourceModule = async <T = any>(filePath: string): Promise<T> => {
    const target = `${pathToFileURL(filePath).href}?v=${fs.statSync(filePath).mtimeMs}`;
    return import(target) as Promise<T>;
};

export const readDevAsset = (name: string) => {
    const filePath = path.join(assetsRoot, name);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
};

const toSectionDefinition = (value: any): DevtoolsSectionDefinition | null => {
    const definition = value?.default ?? value?.section ?? value;
    if (!definition || typeof definition.id !== "string" || typeof definition.title !== "string") {
        return null;
    }
    return definition as DevtoolsSectionDefinition;
};

export const loadFileSections = async () => {
    const fileSections: DevtoolsSectionDefinition[] = [];
    if (fs.existsSync(applicationRoot)) {
        for (const entry of fs.readdirSync(applicationRoot, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith(".js") || entry.name === "page.js") continue;
            const definition = toSectionDefinition(await importSourceModule(path.join(applicationRoot, entry.name)));
            if (definition) {
                fileSections.push(definition);
            }
        }
    }
    return fileSections;
};

export const loadApplicationSections = async (
    app: SharedDevRegistration,
    snapshot: SharedDevSnapshot,
    identifier?: string | null
) => {
    return loadResolvedApplicationSections(app, snapshot, await loadFileSections(), identifier);
};

export const renderHomePage = async (apps: SharedDevRegistration[]) => {
    const mod = await importSourceModule<{ default: (context: { apps: SharedDevRegistration[]; nonce?: string }) => string }>(
        path.join(appRoot, "page.js")
    );
    return (nonce?: string) => mod.default({ apps, nonce });
};

export const renderApplicationPage = async (
    app: SharedDevRegistration,
    snapshot: SharedDevSnapshot,
    identifier?: string | null,
    sectionId?: string | null
) => {
    const application = await importSourceModule<{
        default: (context: {
            app: SharedDevRegistration;
            snapshot: SharedDevSnapshot;
            identifier?: string | null;
            sectionId?: string | null;
            sections: Array<DevtoolsSectionDefinition & { content: string }>;
            modules: DevtoolsModuleDefinition[];
            nonce?: string;
        }) => string;
    }>(path.join(applicationRoot, "page.js"));
 
    const { modules, sections } = await loadApplicationSections(app, snapshot, identifier);
    return (nonce?: string) => application.default({ app, snapshot, identifier, sectionId, sections, modules, nonce });
};

export const resolveCustomApiHandler = (name: string) => getDevtoolsApiHandler(name);
