import fs from "node:fs";
import path from "node:path";

type PathMap = Record<string, string>;

const STORE_FILE = path.resolve(process.cwd(), ".zerux-paths.json");

let cache: PathMap | null = null;

/**
 * Safely load cache from disk
 */
function load(): void {
    if (cache !== null) return;

    try {
        if (fs.existsSync(STORE_FILE)) {
            const raw = fs.readFileSync(STORE_FILE, "utf-8");

            try {
                cache = JSON.parse(raw) as PathMap;
            } catch {
                // Corrupted JSON → reset safely
                cache = {};
            }
        } else {
            cache = {};
        }
    } catch {
        cache = {};
    }
}

/**
 * Persist cache safely
 */
function save(): void {
    if (!cache) return;

    try {
        fs.writeFileSync(STORE_FILE, JSON.stringify(cache, null, 2), {
            encoding: "utf-8",
            mode: 0o600
        });
    } catch (err) {
        throw new Error(`[zerux] Failed to save paths: ${(err as Error).message}`);
    }
}

/**
 * Validate alias format
 */
function validateAlias(alias: string): void {
    if (typeof alias !== "string" || alias.trim() === "") {
        throw new Error(`[zerux] Alias must be a non-empty string`);
    }

    if (!alias.includes(":")) {
        throw new Error(`[zerux] Invalid alias "${alias}". Expected format "prefix:name"`);
    }
}

/**
 * Register a new path alias
 */
export function registerPath(alias: string, target: string): void {
    load();
    validateAlias(alias);

    if (typeof target !== "string" || target.trim() === "") {
        throw new Error(`[zerux] Target must be a valid path`);
    }

    const resolved = path.resolve(target);

    if (!fs.existsSync(resolved)) {
        throw new Error(`[zerux] Target not found: ${resolved}`);
    }

    if (cache![alias] && cache![alias] !== resolved) {
        throw new Error(`[zerux] Alias already exists: ${alias}`);
    }

    cache![alias] = resolved;
    save();
}

/**
 * Resolve alias to actual path
 */
export function resolvePath(alias: string): string | null {
    load();
    return cache![alias] || null;
}

/**
 * Get all registered paths
 */
export function getAllPaths(): PathMap {
    load();
    return { ...cache! };
}

/**
 * Remove alias
 */
export function unregisterPath(alias: string): void {
    load();

    if (!cache![alias]) return;

    delete cache![alias];
    save();
}