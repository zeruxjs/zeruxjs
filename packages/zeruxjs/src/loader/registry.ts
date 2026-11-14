import { pathToFileURL } from 'node:url';

type LoaderModuleValue = string | Record<string, unknown>;
type LoaderResolver = (
  identifier: string,
  specifier: string
) => LoaderModuleValue | null | undefined;

type LoaderRegistryStore = Map<string, LoaderResolver>;
type LoaderModuleStore = Map<string, Record<string, unknown>>;

/** Process-wide compatibility key shared by loader registry module copies. */
const RESOLVER_SYMBOL = Symbol.for('zerux.loader.resolvers');
/** Process-wide payload store used by generated virtual module references. */
const MODULE_SYMBOL = Symbol.for('zerux.loader.modules');

/** Process-wide compatibility service name, replaced by loader registration. */
let currentService = 'zerux';

/** Select the process-wide compatibility service label.
 * @param {string} name - Host-selected service name.
 * @returns {void} Shared label update completion.
 */
export const setLoaderService = (name: string) => {
  currentService = name;
};

/** Read the last process-wide loader service label.
 * @returns {string} Current compatibility label.
 */
export const getLoaderService = () => currentService;

/** Conservative JavaScript identifier grammar for generated named exports. */
const EXPORTABLE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Lazily obtain the process-wide trusted resolver registry.
 * @returns {LoaderRegistryStore} Shared mutable resolver map.
 */
const getResolverStore = (): LoaderRegistryStore => {
  /** Global compatibility scope; this store is not isolated per application. */
  const scope = globalThis as typeof globalThis & {
    [RESOLVER_SYMBOL]?: LoaderRegistryStore;
  };
  if (!scope[RESOLVER_SYMBOL]) {
    scope[RESOLVER_SYMBOL] = new Map<string, LoaderResolver>();
  }

  return scope[RESOLVER_SYMBOL]!;
};

/** Lazily obtain payloads referenced by generated virtual modules.
 * @returns {LoaderModuleStore} Shared mutable payload map.
 */
const getModuleStore = (): LoaderModuleStore => {
  /** Global compatibility scope; this store is not isolated per application. */
  const scope = globalThis as typeof globalThis & {
    [MODULE_SYMBOL]?: LoaderModuleStore;
  };
  if (!scope[MODULE_SYMBOL]) {
    scope[MODULE_SYMBOL] = new Map<string, Record<string, unknown>>();
  }

  return scope[MODULE_SYMBOL]!;
};

/**
 * Title: Loader resolver registration
 * Description: Registers a virtual import prefix resolver used by the runtime loader.
 * Global Variables: globalThis[Symbol.for("zerux.loader.resolvers")]
 * @param {string} prefix - Nonempty trusted import prefix.
 * @param {LoaderResolver} resolver - Explicitly registered trusted resolver code.
 * @returns {void} Registration completion; an existing prefix is replaced.
 */
export const register = (prefix: string, resolver: LoaderResolver): void => {
  if (typeof prefix !== 'string' || prefix.trim() === '') {
    throw new Error(
      '[zerux loader] Resolver prefix must be a non-empty string'
    );
  }

  getResolverStore().set(prefix, resolver);
};

/**
 * Title: Loader resolver removal
 * Description: Removes a previously registered resolver.
 * Global Variables: globalThis[Symbol.for("zerux.loader.resolvers")]
 * @param {string} prefix - Prefix whose resolver should be removed.
 * @returns {void} Resolver removal; previously registered module payloads remain retained.
 */
export const unregister = (prefix: string): void => {
  getResolverStore().delete(prefix);
};

/**
 * Title: Registered module access
 * Description: Returns the cached virtual module payload used by generated data URLs.
 * Global Variables: globalThis[Symbol.for("zerux.loader.modules")]
 * @param {string} id - Generated compatibility module key.
 * @returns {Record<string, unknown>} Borrowed virtual module payload.
 */
export const getRegisteredModule = (id: string): Record<string, unknown> => {
  /** Borrowed registered payload; missing records fail rather than invent exports. */
  const moduleValue = getModuleStore().get(id);
  if (!moduleValue) {
    throw new Error(
      `[zerux loader] Virtual module "${id}" is no longer registered`
    );
  }

  return moduleValue;
};

/** Generate forwarding exports without serializing or executing payload values.
 * @param {string} id - Registered payload key embedded using JSON string encoding.
 * @param {Record<string, unknown>} exportsObject - Borrowed payload supplying export names.
 * @returns {string} JavaScript module source for the loader-owned data URL.
 */
const createModuleSource = (
  id: string,
  exportsObject: Record<string, unknown>
): string => {
  /** File URL for generated imports, resolved relative to this registry module. */
  const registryUrl = pathToFileURL(
    new URL('./registry.ts', import.meta.url).pathname
  ).href.replace(/\.ts$/, '.js');

  /** Generated module statements; values remain in the registered payload store. */
  const lines = [
    `import { getRegisteredModule } from ${JSON.stringify(registryUrl)};`,
    `/** Borrowed registered payload; missing records fail rather than invent exports. */
const moduleValue = getRegisteredModule(${JSON.stringify(id)});`,
  ];

  if ('default' in exportsObject) {
    lines.push('export default moduleValue.default;');
  } else {
    lines.push('export default moduleValue;');
  }

  Object.keys(exportsObject)
    .filter((key) => key !== 'default' && EXPORTABLE_IDENTIFIER.test(key))
    .forEach((key) => {
      lines.push(`export const ${key} = moduleValue[${JSON.stringify(key)}];`);
    });

  return lines.join('\n');
};

/**
 * Title: Virtual specifier resolver
 * Description: Resolves registered prefixes into file paths or generated in-memory modules.
 * Global Variables: globalThis[Symbol.for("zerux.loader.resolvers")], globalThis[Symbol.for("zerux.loader.modules")]
 * @param {string} specifier - Import checked against explicit registered prefixes.
 * @returns {string | null} Trusted file/specifier or generated module URL, otherwise null.
 */
export const resolveRegisteredSpecifier = (
  specifier: string
): string | null => {
  for (const [prefix, resolver] of getResolverStore().entries()) {
    /** Whether the complete specifier equals the registered prefix. */
    const isExact = specifier === prefix;
    /** Whether this specifier addresses a colon-delimited member of the prefix. */
    const isNested = specifier.startsWith(`${prefix}:`);

    if (!isExact && !isNested) {
      continue;
    }

    /** Prefix-relative member identifier passed to trusted resolver code. */
    const identifier = isExact ? '' : specifier.slice(prefix.length + 1);
    /** Trusted resolver result; objects are registered without evaluating their values. */
    const resolved = resolver(identifier, specifier);

    if (!resolved) {
      return null;
    }

    if (typeof resolved === 'string') {
      return resolved;
    }

    /** Stable compatibility payload key for this prefix and member. */
    const id = `${prefix}:${identifier || 'default'}`;
    getModuleStore().set(id, resolved);
    /** Generated forwarding module, containing export names and a payload reference only. */
    const source = createModuleSource(id, resolved);
    return `data:text/javascript,${encodeURIComponent(source)}`;
  }

  return null;
};
