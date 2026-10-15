import { pathToFileURL } from "node:url";

type LoaderModuleValue = string | Record<string, unknown>;
type LoaderResolver = (identifier: string, specifier: string) => LoaderModuleValue | null | undefined;

type LoaderRegistryStore = Map<string, LoaderResolver>;
type LoaderModuleStore = Map<string, Record<string, unknown>>;

const RESOLVER_SYMBOL = Symbol.for("zerux.loader.resolvers");
const MODULE_SYMBOL = Symbol.for("zerux.loader.modules");
const SERVICE_SYMBOL = Symbol.for("zerux.loader.service");

let currentService = "zerux";

export const setLoaderService = (name: string) => {
    currentService = name;
};

export const getLoaderService = () => currentService;

const EXPORTABLE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const getResolverStore = (): LoaderRegistryStore => {
    const scope = globalThis as typeof globalThis & { [RESOLVER_SYMBOL]?: LoaderRegistryStore; };
    if (!scope[RESOLVER_SYMBOL]) {
        scope[RESOLVER_SYMBOL] = new Map<string, LoaderResolver>();
    }

    return scope[RESOLVER_SYMBOL]!;
};

const getModuleStore = (): LoaderModuleStore => {
    const scope = globalThis as typeof globalThis & { [MODULE_SYMBOL]?: LoaderModuleStore; };
    if (!scope[MODULE_SYMBOL]) {
        scope[MODULE_SYMBOL] = new Map<string, Record<string, unknown>>();
    }

    return scope[MODULE_SYMBOL]!;
};

/**
 * Title: Loader resolver registration
 * Description: Registers a virtual import prefix resolver used by the runtime loader.
 * Global Variables: globalThis[Symbol.for("zerux.loader.resolvers")]
 * @param prefix Import prefix to register.
 * @param resolver Resolver implementation.
 */
export const register = (prefix: string, resolver: LoaderResolver): void => {
    if (typeof prefix !== "string" || prefix.trim() === "") {
        throw new Error("[zerux loader] Resolver prefix must be a non-empty string");
    }

    getResolverStore().set(prefix, resolver);
};

/**
 * Title: Loader resolver removal
 * Description: Removes a previously registered resolver.
 * Global Variables: globalThis[Symbol.for("zerux.loader.resolvers")]
 * @param prefix Import prefix to remove.
 */
export const unregister = (prefix: string): void => {
    getResolverStore().delete(prefix);
};

/**
 * Title: Registered module access
 * Description: Returns the cached virtual module payload used by generated data URLs.
 * Global Variables: globalThis[Symbol.for("zerux.loader.modules")]
 * @param id Generated module id.
 * @returns Virtual module payload.
 */
export const getRegisteredModule = (id: string): Record<string, unknown> => {
    const moduleValue = getModuleStore().get(id);
    if (!moduleValue) {
        throw new Error(`[zerux loader] Virtual module "${id}" is no longer registered`);
    }

    return moduleValue;
};

const createModuleSource = (id: string, exportsObject: Record<string, unknown>): string => {
    const registryUrl = pathToFileURL(new URL("./registry.ts", import.meta.url).pathname).href
        .replace(/\.ts$/, ".js");

    const lines = [
        `import { getRegisteredModule } from ${JSON.stringify(registryUrl)};`,
        `const moduleValue = getRegisteredModule(${JSON.stringify(id)});`
    ];

    if ("default" in exportsObject) {
        lines.push("export default moduleValue.default;");
    } else {
        lines.push("export default moduleValue;");
    }

    Object.keys(exportsObject)
        .filter((key) => key !== "default" && EXPORTABLE_IDENTIFIER.test(key))
        .forEach((key) => {
            lines.push(`export const ${key} = moduleValue[${JSON.stringify(key)}];`);
        });

    return lines.join("\n");
};

/**
 * Title: Virtual specifier resolver
 * Description: Resolves registered prefixes into file paths or generated in-memory modules.
 * Global Variables: globalThis[Symbol.for("zerux.loader.resolvers")], globalThis[Symbol.for("zerux.loader.modules")]
 * @param specifier Requested import specifier.
 * @returns Resolved specifier or null.
 */
export const resolveRegisteredSpecifier = (specifier: string): string | null => {
    for (const [prefix, resolver] of getResolverStore().entries()) {
        const isExact = specifier === prefix;
        const isNested = specifier.startsWith(`${prefix}:`);

        if (!isExact && !isNested) {
            continue;
        }

        const identifier = isExact ? "" : specifier.slice(prefix.length + 1);
        const resolved = resolver(identifier, specifier);

        if (!resolved) {
            return null;
        }

        if (typeof resolved === "string") {
            return resolved;
        }

        const id = `${prefix}:${identifier || "default"}`;
        getModuleStore().set(id, resolved);
        const source = createModuleSource(id, resolved);
        return `data:text/javascript,${encodeURIComponent(source)}`;
    }

    return null;
};
