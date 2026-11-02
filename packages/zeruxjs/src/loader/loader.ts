import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolvePath } from "@zeruxjs/hooks";
import { resolveRegisteredSpecifier, getLoaderService } from "./registry.js";

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

export async function resolve(
    specifier: string,
    context: ResolveContext,
    nextResolve: NextResolve
): Promise<ResolveResult> {
    try {
        // Node URL/builtin protocols are not custom path aliases. In particular,
        // file:/// imports contain // which the private alias registry must reject.
        if (/^(?:file|node|data|https?):/.test(specifier)) {
            return nextResolve(specifier, context);
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

        return nextResolve(specifier, context);
    } catch (err) {
        throw new Error(`[zerux loader] ${(err as Error).message}`);
    }
}
