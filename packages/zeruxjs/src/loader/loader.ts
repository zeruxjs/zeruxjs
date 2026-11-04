import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs/promises";

import { resolvePath } from "@zeruxjs/hooks";
import { resolveRegisteredSpecifier, getLoaderService, setLoaderService } from "./registry.js";

type ResolveContext = {
    parentURL?: string;
    conditions?: string[];
};

type ResolveResult = {
    url: string;
    shortCircuit?: boolean;
};

type NextResolve = (
    specifier: string,
    context: ResolveContext
) => Promise<ResolveResult>;

let sourceRoot: string | undefined;
/** Registration data crosses Node's loader thread boundary explicitly. */
export async function initialize(data: {serviceName?: string; sourceRoot?: string} = {}): Promise<void> {
    if (data.serviceName !== undefined) setLoaderService(data.serviceName);
    sourceRoot = data.sourceRoot === undefined ? undefined : await fs.realpath(path.resolve(data.sourceRoot));
}
const insideSource = (file: string): boolean => {
    if (!sourceRoot) return false;
    const relative = path.relative(sourceRoot, file);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) &&
        !relative.split(path.sep).some(part => ['node_modules', '.git', '.zerux'].includes(part));
};
async function resolveSource(specifier: string, context: ResolveContext, nextResolve: NextResolve): Promise<ResolveResult> {
    try { return await nextResolve(specifier, context); }
    catch (error) {
        // Only missing, explicitly local file specifiers may use authored TS.
        // A successful JS resolution, dependency error or permission denial stays native.
        if (!sourceRoot || (error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND' ||
            !context.parentURL?.startsWith('file:') || !(/^(?:\.\.?\/|file:)/.test(specifier))) throw error;
        const parent = new URL(context.parentURL), requested = new URL(specifier, parent);
        if (requested.protocol !== 'file:' || !insideSource(fileURLToPath(parent)) || !insideSource(fileURLToPath(requested))) throw error;
        const extension = path.extname(requested.pathname), mapped = ({'.js':'.ts', '.mjs':'.mts', '.cjs':'.cts'} as Record<string,string>)[extension];
        if (!mapped) throw error;
        const candidate = new URL(requested);
        candidate.pathname = candidate.pathname.slice(0, -extension.length) + mapped;
        let real: string;
        try { real = await fs.realpath(fileURLToPath(candidate)); } catch { throw error; }
        if (!insideSource(real) || !(await fs.stat(real)).isFile()) throw error;
        const target = pathToFileURL(real);
        target.search = candidate.search;
        target.hash = candidate.hash;
        if (!target.searchParams.has('t') && parent.searchParams.has('t')) target.searchParams.set('t', parent.searchParams.get('t')!);
        return nextResolve(target.href, context);
    }
}

export async function resolve(
    specifier: string,
    context: ResolveContext,
    nextResolve: NextResolve
): Promise<ResolveResult> {
    try {
        // Node URL/builtin protocols are not custom path aliases. In particular,
        // file:/// imports contain // which the private alias registry must reject.
        if (/^(?:file|node|data|https?):/.test(specifier)) {
            return resolveSource(specifier, context, nextResolve);
        }
        if (specifier === "db" || specifier.startsWith("db:")) {
            const identifier = specifier === "db" ? "default" : specifier.slice(3);
            const service = getLoaderService();
            const modulePath = path.join(process.cwd(), `.${service}`, "virtual", "db", `${identifier}.mjs`);
            return nextResolve(pathToFileURL(modulePath).href, context);
        }

        const registered = resolveRegisteredSpecifier(specifier);
        if (registered) {
            return nextResolve(registered, context);
        }

        const resolved = resolvePath(specifier);

        if (resolved) {
            return nextResolve(resolved, context);
        }

        return resolveSource(specifier, context, nextResolve);
    } catch (err) {
        throw new Error(`[zerux loader] ${(err as Error).message}`);
    }
}
