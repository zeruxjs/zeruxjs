import fs from 'node:fs';
import path from 'node:path';

import type { ZeruxConfig } from '../index.js';
import { register, unregister, getLoaderService } from '../loader/registry.js';

type DatabaseModuleNamespace = {
  default?: unknown;
  db?: unknown;
  query?: unknown;
  createDb?: unknown;
  dropDb?: unknown;
  switchDB?: unknown;
  createTable?: unknown;
  dropTable?: unknown;
  alterTable?: unknown;
  turcunateTable?: unknown;
  createIndex?: unknown;
  dropIndex?: unknown;
  insert?: unknown;
  select?: unknown;
  update?: unknown;
  delete?: unknown;
  dbAccess?: unknown;
  /** Legacy factory that may publish the active compatibility manager. */
  configureDatabaseManager?: (config: Record<string, unknown>) => Promise<{
    /** Validated configured connection names used to emit virtual modules. */
    connectionSlugs: string[];
    getConnectionFacade(slug?: string): Record<string, unknown>;
  }>;
  /** Scoped factory required when generation activation is staged. */
  createDatabaseManager?: (config: Record<string, unknown>) => Promise<{
    /** Validated configured connection names used to emit virtual modules. */
    connectionSlugs: string[];
    getConnectionFacade(slug?: string): Record<string, unknown>;
  }>;
  /** Compatibility publication hook invoked during generation activation. */
  setActiveDatabaseManager?: (manager: unknown) => void;
};

/** Compatibility manager exports forwarded by the default virtual database module. */
const DB_EXPORT_KEYS = [
  'db',
  'query',
  'createDb',
  'dropDb',
  'switchDB',
  'createTable',
  'dropTable',
  'alterTable',
  'turcunateTable',
  'createIndex',
  'dropIndex',
  'insert',
  'select',
  'update',
  'delete',
  'dbAccess',
] as const;

/** Compatibility per-connection exports forwarded by named database modules. */
const DB_FACADE_EXPORT_KEYS = [
  'slug',
  'name',
  'connector',
  'options',
  'query',
  'createDb',
  'dropDb',
  'switchDB',
  'createTable',
  'dropTable',
  'alterTable',
  'turcunateTable',
  'createIndex',
  'dropIndex',
  'insert',
  'select',
  'update',
  'delete',
  'native',
] as const;

/** Resolve the process compatibility directory for generated database modules.
 * @returns {string} Private working-directory-relative virtual module directory.
 */
const getDbVirtualDir = () =>
  path.join(process.cwd(), `.${getLoaderService()}`, 'virtual', 'db');
/** Reserved JavaScript names that require an intermediate binding in generated source. */
const RESERVED_EXPORT_NAMES = new Set(['delete']);

/** Create the private compatibility module directory before writing generated files.
 * @returns {void} Synchronous directory preparation completion.
 */
const ensureVirtualDbDir = () => {
  fs.mkdirSync(getDbVirtualDir(), { recursive: true });
};

/** Write trusted generated JavaScript, never request-supplied source.
 * @param {string} fileName - Internally selected module filename.
 * @param {string} source - Generated forwarding module text.
 * @returns {void} Synchronous file write completion.
 */
const writeVirtualDbModule = (fileName: string, source: string) => {
  ensureVirtualDbDir();
  fs.writeFileSync(path.join(getDbVirtualDir(), fileName), source, 'utf8');
};

/** Write declarations corresponding to the generated compatibility module.
 * @param {string} fileName - Internally selected declaration filename.
 * @param {string} source - Generated declaration text.
 * @returns {void} Synchronous declaration write completion.
 */
const writeVirtualDbTypes = (fileName: string, source: string) => {
  ensureVirtualDbDir();
  fs.writeFileSync(path.join(getDbVirtualDir(), fileName), source, 'utf8');
};

/** Append one authored forwarding export, handling reserved names explicitly.
 * @param {string[]} lines - Owned generated-source statements.
 * @param {string} exportName - Allowlisted compatibility export name.
 * @param {string} expression - Internally generated source expression.
 * @returns {void} Statement append completion.
 */
const appendExportBinding = (
  lines: string[],
  exportName: string,
  expression: string
) => {
  if (RESERVED_EXPORT_NAMES.has(exportName)) {
    /** Internal compatibility binding used to export a reserved JavaScript name. */
    const localName = `__${getLoaderService()}_${exportName}`;
    lines.push(`const ${localName} = ${expression};`);
    lines.push(`export { ${localName} as ${exportName} };`);
    return;
  }

  lines.push(`export const ${exportName} = ${expression};`);
};

/** Append one declaration matching an authored compatibility export.
 * @param {string[]} lines - Owned generated declaration statements.
 * @param {string} exportName - Allowlisted compatibility export name.
 * @param {string} typeExpression - Internally generated TypeScript type expression.
 * @returns {void} Statement append completion.
 */
const appendExportDeclaration = (
  lines: string[],
  exportName: string,
  typeExpression: string
) => {
  if (RESERVED_EXPORT_NAMES.has(exportName)) {
    /** Internal compatibility binding used to export a reserved JavaScript name. */
    const localName = `__${getLoaderService()}_${exportName}`;
    lines.push(`declare const ${localName}: ${typeExpression};`);
    lines.push(`export { ${localName} as ${exportName} };`);
    return;
  }

  lines.push(`export const ${exportName}: ${typeExpression};`);
};

/** Generate default-manager forwarding source using JSON-encoded module specifiers.
 * @param {string} managerPackage - Trusted host-selected manager module.
 * @returns {string} Generated module forwarding the fixed compatibility exports.
 */
const createDefaultDbModuleSource = (managerPackage: string) => {
  /** Owned statements assembled only from fixed templates and encoded host configuration. */
  const lines = [
    `import managerModule from ${JSON.stringify(managerPackage)};`,
    `import * as managerExports from ${JSON.stringify(managerPackage)};`,
    'export default managerModule;',
  ];

  DB_EXPORT_KEYS.forEach((key) => {
    appendExportBinding(lines, key, `managerExports[${JSON.stringify(key)}]`);
  });

  return lines.join('\n');
};

/** Generate default-manager declarations against the public database contract.
 * @returns {string} TypeScript declaration source.
 */
const createDefaultDbModuleTypes = (): string => {
  /** Owned statements assembled only from fixed templates and encoded host configuration. */
  const lines = [
    'import type * as DatabaseModule from "@zeruxjs/db";',
    'declare const __zerux_default_db: typeof import("@zeruxjs/db").default;',
    'export default __zerux_default_db;',
  ];

  DB_EXPORT_KEYS.forEach((key) => {
    appendExportDeclaration(
      lines,
      key,
      `typeof DatabaseModule[${JSON.stringify(key)}]`
    );
  });

  return lines.join('\n');
};

/** Generate a named connection facade reference using JSON-encoded slug/module literals.
 * @param {string} managerPackage - Trusted host-selected manager module.
 * @param {string} slug - Configured connection slug.
 * @returns {string} Generated connection forwarding module.
 */
const createSlugDbModuleSource = (managerPackage: string, slug: string) => {
  /** Owned statements assembled only from fixed templates and encoded host configuration. */
  const lines = [
    `import { getActiveDatabaseManager } from ${JSON.stringify(managerPackage)};`,
    `const db = getActiveDatabaseManager().getConnectionFacade(${JSON.stringify(slug)});`,
    'export default db;',
    'export { db };',
  ];

  DB_FACADE_EXPORT_KEYS.forEach((key) => {
    appendExportBinding(lines, key, `db[${JSON.stringify(key)}]`);
  });

  return lines.join('\n');
};

/** Generate declarations for the public named connection facade.
 * @returns {string} TypeScript declaration source.
 */
const createSlugDbModuleTypes = (): string => {
  /** Owned statements assembled only from fixed templates and encoded host configuration. */
  const lines = [
    'import type { DatabaseFacade } from "@zeruxjs/db";',
    'declare const db: DatabaseFacade;',
    'export default db;',
    'export { db };',
  ];

  DB_FACADE_EXPORT_KEYS.forEach((key) => {
    appendExportDeclaration(
      lines,
      key,
      `DatabaseFacade[${JSON.stringify(key)}]`
    );
  });

  return lines.join('\n');
};

/**
 * Prepare the configured database manager and consume private connection settings.
 * Activation prepares generated modules before publishing process-wide compatibility state.
 * @param {ZeruxConfig} config - Mutable private generation configuration.
 * @param {object} activation - Optional staged-generation activation registrar.
 * @param {Function} activation.onActivate - Register publication after preparation succeeds.
 * @returns {Promise<unknown | null>} Prepared manager, or null when configuration is absent.
 */
export const initializeDatabaseRuntime = async (
  config: ZeruxConfig,
  activation?: {
    /** Host registrar for delayed compatibility publication. */
    onActivate: (callback: () => void) => void;
  }
): Promise<unknown | null> => {
  /** Explicit trusted host manager module; selecting it authorizes server-side module loading. */
  const managerPackage =
    typeof config.connectorManager === 'string'
      ? config.connectorManager
      : '@zeruxjs/db';
  /** Private database configuration captured before removal from runtime settings. */
  const dbConfig = config.db ?? config.database;

  delete config.db;
  delete config.database;
  delete config.connectorManager;

  if (!dbConfig || typeof dbConfig !== 'object') {
    return null;
  }

  /** Trusted manager module exports; database package owns connector behavior. */
  const moduleValue = (await import(managerPackage)) as DatabaseModuleNamespace;
  if (activation && typeof moduleValue.createDatabaseManager !== 'function') {
    throw new Error('Staged services require a non-publishing manager factory');
  }
  /** Prefer a non-publishing scoped factory; retain legacy bootstrap compatibility. */
  const configure =
    moduleValue.createDatabaseManager ?? moduleValue.configureDatabaseManager;

  if (typeof configure !== 'function') {
    throw new Error(
      `[zerux database] Connector manager "${managerPackage}" does not export a manager factory`
    );
  }

  /** Prepared database-owned manager returned to the generation service scope. */
  const manager = await configure(dbConfig as Record<string, unknown>);
  /** Prepare virtual files before publishing the active manager and compatibility resolver.
   * @returns {void} Activation completion; filesystem preparation may throw before publication.
   */
  const activate = () => {
    // Complete fallible file preparation before publishing the active manager.
    writeVirtualDbModule(
      'default.mjs',
      createDefaultDbModuleSource(managerPackage)
    );
    writeVirtualDbTypes('default.d.ts', createDefaultDbModuleTypes());

    for (const slug of manager.connectionSlugs as string[]) {
      writeVirtualDbModule(
        `${slug}.mjs`,
        createSlugDbModuleSource(managerPackage, slug)
      );
      writeVirtualDbTypes(`${slug}.d.ts`, createSlugDbModuleTypes());
    }

    if (moduleValue.setActiveDatabaseManager) {
      moduleValue.setActiveDatabaseManager(manager);
    }
    unregister('db');
    register('db', (identifier) => {
      if (!identifier) {
        /** Fixed compatibility export projection; private configuration is not serialized into module source. */
        const exportsObject = Object.fromEntries(
          DB_EXPORT_KEYS.filter((key) => moduleValue[key] !== undefined).map(
            (key) => [key, moduleValue[key]]
          )
        );

        return {
          default: moduleValue.default ?? moduleValue.db,
          ...exportsObject,
        };
      }

      /** Borrowed named connection facade owned by the prepared manager. */
      const facade = manager.getConnectionFacade(identifier);
      return {
        default: facade,
        db: facade,
        ...facade,
      };
    });
  };
  if (activation) {
    activation.onActivate(activate);
  } else {
    activate();
  }

  return manager;
};
