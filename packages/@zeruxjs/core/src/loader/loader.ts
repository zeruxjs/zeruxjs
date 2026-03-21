import { resolvePath } from "@zeruxjs/hooks";

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
        const resolved = resolvePath(specifier);

        if (resolved) {
            return nextResolve(resolved, context);
        }

        return nextResolve(specifier, context);
    } catch (err) {
        throw new Error(`[zerux loader] ${(err as Error).message}`);
    }
}