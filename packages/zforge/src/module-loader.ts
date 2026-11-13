import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import {
  ensurePathInsideRoot,
  sanitizeIdentifier,
  sanitizeRelativeAssetPath,
} from '@zeruxjs/security';

import {
  getRegisteredDevtoolsModules,
  type DevtoolsApiModuleHandlers,
  type DevtoolsModuleConfig,
  type DevtoolsModuleDefinition,
  type DevtoolsSectionDefinition,
  type DevtoolsSocketModuleHandlers,
} from './module-registry.js';
import type { SharedDevRegistration, SharedDevSnapshot } from './types.js';

interface LoadedDevtoolsModule {
  /** Recognized trusted module definition; its callbacks execute host-selected code. */
  definition: DevtoolsModuleDefinition;
  /** Explicit trusted HTTP callbacks indexed by operation name. */
  apiHandlers: DevtoolsApiModuleHandlers;
  /** Explicit trusted socket callbacks indexed by channel name. */
  socketHandlers: DevtoolsSocketModuleHandlers;
  /** Optional contained local stylesheet file. */
  stylePath?: string;
  /** Optional contained local browser script file. */
  scriptPath?: string;
  /** Explicit legacy requester-module sharing labels; not authenticated principals. */
  shareWith: string[];
  /** Optional canonical contained public asset directory. */
  publicRoot?: string;
  /** Optional explicit parent module identity. */
  parent?: string;
  /** Legacy module sharing isolation flag. */
  isolated: boolean;
  /** Whether declared child modules may participate in legacy overrides. */
  allowChildren: boolean;
}

/** Import only a trusted explicitly selected local module with mtime identity.
 * @template T
 * @param {string} filePath - Resolved host-selected package file.
 * @returns {Promise<T>} Executed trusted module namespace; this is not sandboxed data loading.
 */
const importModule = async <T = any>(filePath: string): Promise<T> => {
  /** Selected module or import URL; lookup is scoped to the explicitly registered app/module. */
  const target = `${pathToFileURL(filePath).href}?v=${fs.statSync(filePath).mtimeMs}`;
  return import(target) as Promise<T>;
};

/** Normalize the trusted imported module configuration export shape.
 * @param {unknown} value - Executed namespace selected by the host.
 * @returns {DevtoolsModuleConfig | null} Recognized configuration with an explicit entry, or null.
 */
const toModuleConfig = (value: any): DevtoolsModuleConfig | null => {
  /** Trusted imported configuration candidate checked before entry/asset resolution. */
  const config = value?.default ?? value?.config ?? value;
  if (!config || typeof config.entry !== 'string') {
    return null;
  }
  return config as DevtoolsModuleConfig;
};

/** Project a trusted imported module into the legacy display/section contract.
 * @param {unknown} value - Executed host-selected namespace.
 * @param {{id: string, title: string, description?: string, packageName: string, packageRoot: string, dependencies: string[], routeName: string}} fallback - Explicit host/package fallback metadata.
 * @param {string} fallback.id - Stable host/package fallback module identifier.
 * @param {string} fallback.title - Trusted fallback display title.
 * @param {string} [fallback.description] - Inert fallback description.
 * @param {string} fallback.packageName - Explicit selected package reference.
 * @param {string} fallback.packageRoot - Resolved trusted package root.
 * @param {string[]} fallback.dependencies - Explicit legacy sharing dependencies.
 * @param {string} fallback.routeName - Registered application namespace.
 * @returns {DevtoolsModuleDefinition} Recognized trusted module definition; render callbacks remain executable code.
 */
const toModuleDefinition = (
  value: any,
  fallback: {
    /** Explicit normalized fallback module identity. */
    id: string;
    /** Trusted fallback display title. */
    title: string;
    /** Optional inert fallback description. */
    description?: string;
    /** Explicit configured package reference. */
    packageName: string;
    /** Resolved trusted package root for real-path asset checks. */
    packageRoot: string;
    /** Declared trusted module-sharing dependencies. */
    dependencies: string[];
    /** Registered application route namespace. */
    routeName: string;
  }
): DevtoolsModuleDefinition => {
  /** Trusted module/section definition normalized for this explicitly configured package. */
  const definition = value?.default ?? value?.module ?? value ?? {};
  /** Ordered trusted built-in and module sections; callbacks are not evaluated from strings. */
  const sections = Array.isArray(definition.sections)
    ? definition.sections.filter(
        (section: unknown): section is DevtoolsSectionDefinition =>
          Boolean(
            section &&
            typeof section === 'object' &&
            typeof (section as DevtoolsSectionDefinition).id === 'string' &&
            typeof (section as DevtoolsSectionDefinition).title === 'string' &&
            typeof (section as DevtoolsSectionDefinition).render === 'function'
          )
      )
    : [];

  return {
    id: sanitizeIdentifier(definition.id ?? fallback.id, fallback.id),
    title: String(definition.title ?? fallback.title),
    version:
      typeof definition.version === 'string' ? definition.version : undefined,
    description:
      typeof definition.description === 'string'
        ? definition.description
        : fallback.description,
    badge: typeof definition.badge === 'string' ? definition.badge : 'module',
    packageName: fallback.packageName,
    packageRoot: fallback.packageRoot,
    dependencies: Array.isArray(definition.dependencies)
      ? definition.dependencies.filter(
          (item: unknown): item is string => typeof item === 'string'
        )
      : fallback.dependencies,
    sections: sections.map((section: DevtoolsSectionDefinition) => ({
      ...section,
      moduleId: sanitizeIdentifier(definition.id ?? fallback.id, fallback.id),
    })),
    meta:
      typeof definition.meta === 'object' && definition.meta
        ? definition.meta
        : {},
  };
};

/** Normalize a trusted module handler export without evaluating arbitrary request data.
 * @template T
 * @param {unknown} value - Imported host-selected handler namespace.
 * @returns {T} Legacy handler-map projection; the receiving dispatch path checks exact registration keys.
 */
const toHandlers = <T extends Record<string, unknown>>(value: any): T => {
  /** Trusted default/handlers export candidate retained only when object-shaped. */
  const handlers = value?.default ?? value?.handlers ?? value;
  return (handlers && typeof handlers === 'object' ? handlers : {}) as T;
};

/** Resolve a configured package from its registered application dependency context.
 * @param {string} appRoot - Host-owned application root.
 * @param {string} packageName - Explicit trusted module package reference.
 * @returns {string} Resolved package root; missing dependencies throw rather than trigger package discovery.
 */
const resolveModulePackageRoot = (appRoot: string, packageName: string) => {
  try {
    /** Application-relative resolver used only for an explicitly configured package manifest. */
    const require = createRequire(path.join(appRoot, 'package.json'));
    /** Resolved configured package manifest; the file is not a browser-controlled import. */
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    return path.dirname(packageJsonPath);
  } catch (err) {
    console.error(
      `[zdev] Failed to resolve module package root for "${packageName}" from "${appRoot}":`,
      err
    );
    throw err;
  }
};

/** Validate canonical filesystem containment and the declared asset kind.
 * @param {string} packageRoot - Trusted real package/public root.
 * @param {string | null} [relativePath] - Relative candidate validated before real-path resolution.
 * @param {"file" | "directory"} [kind] - Required existing candidate kind.
 * @returns {string | null} Canonical contained path, or null for invalid/missing/escaped assets.
 */
export const resolveSafeModuleAsset = (
  packageRoot: string,
  relativePath?: string | null,
  kind: 'file' | 'directory' = 'file'
): string | null => {
  /** Validated relative asset path before any filesystem real-path lookup. */
  const safePath = sanitizeRelativeAssetPath(relativePath);
  if (!safePath) {
    return null;
  }
  try {
    /** Canonical package/public root used for actual filesystem containment checks. */
    const realRoot = fs.realpathSync(packageRoot);
    /** Canonical candidate leaf checked against its real root and required file kind. */
    const absolutePath = fs.realpathSync(path.resolve(packageRoot, safePath));
    if (!ensurePathInsideRoot(realRoot, absolutePath)) {
      return null;
    }
    /** Resolved candidate metadata checked for the declared file/directory kind. */
    const stat = fs.statSync(absolutePath);
    if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) {
      return null;
    }
    return absolutePath;
  } catch {
    return null;
  }
};

/** Resolve an explicit module file through the real-path asset boundary.
 * @param {string} packageRoot - Trusted resolved package root.
 * @param {string | null} [relativePath] - Configured package-relative file.
 * @returns {string | null} Contained existing regular-file path, or null.
 */
const resolveModuleFile = (packageRoot: string, relativePath?: string | null) =>
  resolveSafeModuleAsset(packageRoot, relativePath);

/** Load one explicit trusted package reference; disabled or invalid modules remain unavailable.
 * @param {SharedDevRegistration} app - Registered application dependency root.
 * @param {SharedDevSnapshot} snapshot - Private current app snapshot retained for compatible loader signatures.
 * @param {string | {package: string, enabled?: boolean, options?: Record<string, unknown>}} reference - Host-configured module reference.
 * @returns {Promise<LoadedDevtoolsModule | null>} Loaded trusted callbacks/assets, or null after the legacy failure path.
 */
const loadConfiguredModule = async (
  app: SharedDevRegistration,
  snapshot: SharedDevSnapshot,
  reference:
    | string
    | {
        /** Explicit trusted module package reference. */
        package: string;
        /** False excludes this configured module before import. */
        enabled?: boolean;
        /** Trusted module configuration supplied by the host. */
        options?: Record<string, unknown>;
      }
): Promise<LoadedDevtoolsModule | null> => {
  /** Explicit host-configured package reference; the loader does not enumerate installed packages. */
  const packageName =
    typeof reference === 'string' ? reference : reference.package;
  console.log(`[zdev] Attempting to load configured module: "${packageName}"`);
  if (
    !packageName ||
    (typeof reference === 'object' && reference.enabled === false)
  ) {
    return null;
  }

  try {
    /** Resolved trusted package root used to constrain its entry and asset files. */
    const packageRoot = resolveModulePackageRoot(app.rootDir, packageName);
    console.log(
      `[zdev] Resolved package root for "${packageName}": ${packageRoot}`
    );

    /** First existing authored service/zdev module configuration file within the selected package. */
    const configPath = [
      `${app.serviceName}.module.config.ts`,
      `${app.serviceName}.module.config.js`,
      'zdev.module.config.ts',
      'zdev.module.config.js',
    ]
      .map((file) => path.join(packageRoot, file))
      .find((file) => fs.existsSync(file));

    if (!configPath) {
      console.warn(
        `[zdev] Module config not found for "${packageName}" (tried ${app.serviceName}.module.config and zdev.module.config)`
      );
      return null;
    }

    /** Trusted imported configuration candidate checked before entry/asset resolution. */
    const config = toModuleConfig(await importModule(configPath));
    if (!config) {
      console.warn(`[zdev] Failed to parse module config: ${configPath}`);
      return null;
    }

    /** Sanitized explicit module identity used consistently for URLs and section ownership. */
    const moduleId = sanitizeIdentifier(
      config.id ?? packageName.split('/').pop() ?? packageName,
      'module'
    );
    /** Inert display title derived from trusted configuration with a stable identifier fallback. */
    const title = String(config.title ?? moduleId);
    /** Real-path-contained explicitly configured executable entry file. */
    const entryPath = resolveModuleFile(packageRoot, config.entry);
    if (!entryPath) {
      console.warn(
        `[zdev] Module entry not found: ${config.entry} in ${packageRoot}`
      );
      return null;
    }

    /** Trusted executed module namespace; arbitrary request source is never imported here. */
    const entryModule = await importModule(entryPath);
    /** Trusted module/section definition normalized for this explicitly configured package. */
    const definition = toModuleDefinition(entryModule, {
      id: moduleId,
      title,
      description: config.description,
      packageName,
      packageRoot,
      dependencies: Array.isArray(config.dependencies)
        ? config.dependencies.filter(
            (item): item is string => typeof item === 'string'
          )
        : [],
      routeName: app.routeName,
    });

    definition.sections = (definition.sections ?? []).map((section) => ({
      ...section,
      moduleId,
    }));

    /** Contained local stylesheet file selected by trusted package configuration. */
    const stylePath = resolveModuleFile(packageRoot, config.assets?.style);
    /** Contained local trusted browser entry selected by package configuration. */
    const scriptPath = resolveModuleFile(packageRoot, config.assets?.script);
    /** Optional URL-encoded authored module version for stable asset cache identity. */
    const versionSuffix =
      typeof config.version === 'string'
        ? `?v=${encodeURIComponent(config.version)}`
        : '';
    definition.assets = {
      styleUrl: stylePath
        ? `/${app.routeName}/__${app.serviceName}/modules/${moduleId}/style.css${versionSuffix}`
        : undefined,
      scriptUrl: scriptPath
        ? `/${app.routeName}/__${app.serviceName}/modules/${moduleId}/client.js${versionSuffix}`
        : undefined,
    };
    definition.meta = {
      ...definition.meta,
      packageName,
      options: typeof reference === 'object' ? (reference.options ?? {}) : {},
    };

    /** Contained trusted API module file, loaded only when explicitly configured. */
    const apiPath = resolveModuleFile(packageRoot, config.server?.api);
    /** Contained trusted socket callback module, loaded only when configured. */
    const websocketPath = resolveModuleFile(
      packageRoot,
      config.server?.websocket
    );

    /** Real-path-contained public directory used as the boundary for module asset requests. */
    const publicRoot = resolveSafeModuleAsset(
      packageRoot,
      config.assets?.public,
      'directory'
    );

    return {
      definition,
      apiHandlers: apiPath
        ? toHandlers<DevtoolsApiModuleHandlers>(await importModule(apiPath))
        : {},
      socketHandlers: websocketPath
        ? toHandlers<DevtoolsSocketModuleHandlers>(
            await importModule(websocketPath)
          )
        : {},
      stylePath: stylePath ?? undefined,
      scriptPath: scriptPath ?? undefined,
      shareWith: Array.isArray(config.server?.shareWith)
        ? config
            .server!.shareWith.filter(
              (item): item is string => typeof item === 'string'
            )
            .map((item) => sanitizeIdentifier(item, item))
        : [],
      publicRoot: publicRoot ?? undefined,
      parent: (config as any).parent || (config.meta as any)?.parent,
      isolated: !!config.server?.isolated,
      allowChildren: !!config.server?.allowChildren,
    };
  } catch {
    return null;
  }
};

/** Legacy process-wide two-second cache keyed by app route label; not a tenant store or generation disposer. */
const moduleCache = new Map<
  string,
  {
    /** Legacy cache creation time used for its two-second reuse window. */
    timestamp: number;
    /** Recognized trusted modules retained by the legacy cache. */
    modules: LoadedDevtoolsModule[];
  }
>();

/** Combine explicit configured modules with legacy trusted registrations.
 * @param {SharedDevRegistration} app - Registered application dependency scope.
 * @param {SharedDevSnapshot} snapshot - Explicit configured module list.
 * @returns {Promise<LoadedDevtoolsModule[]>} Cached/sorted trusted modules; callers borrow module definitions and callbacks.
 */
export const loadAppDevtoolsModules = async (
  app: SharedDevRegistration,
  snapshot: SharedDevSnapshot
) => {
  /** Legacy registered application route namespace used by the short-lived module cache. */
  const cacheKey = app.routeName;
  /** Prior route-keyed cache entry reused only within its existing two-second window. */
  const cached = moduleCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 2000) {
    return cached.modules;
  }

  /** Explicit configured package loads; no arbitrary dependency scanning is performed. */
  const configured = await Promise.all(
    snapshot.devtools.modules.map((reference) =>
      loadConfiguredModule(app, snapshot, reference)
    )
  );

  /** Module identity map preserving configured-package precedence over legacy registrations. */
  const unique = new Map<string, LoadedDevtoolsModule>();

  getRegisteredDevtoolsModules().forEach((definition) => {
    unique.set(definition.id, {
      definition,
      apiHandlers: {} as DevtoolsApiModuleHandlers,
      socketHandlers: {} as DevtoolsSocketModuleHandlers,
      shareWith: [],
      isolated: false,
      stylePath: undefined,
      scriptPath: undefined,
      publicRoot: undefined,
      parent: undefined,
      allowChildren: true,
    });
  });

  configured
    .filter((item): item is LoadedDevtoolsModule => item !== null)
    .forEach((item) => {
      unique.set(item.definition.id, item);
    });

  /** Combined recognized modules before parent/child visibility filtering. */
  const rawLoaded = [...unique.values()];

  /** Modules whose declared parent exists and explicitly permits child integration. */
  const loaded = rawLoaded.filter((module) => {
    if (!module.parent) {
      return true;
    }
    /** Recognized declared parent consulted before exposing a child module. */
    const parentModule = rawLoaded.find(
      (other) => other.definition.id === module.parent
    );
    if (!parentModule) {
      return false;
    }

    // If parent exists, check if it allows children
    return parentModule.allowChildren !== false;
  });

  /** Final title-sorted module list retained in the legacy short-lived cache. */
  const result = loaded.sort((left, right) =>
    left.definition.title.localeCompare(right.definition.title)
  );
  moduleCache.set(cacheKey, { timestamp: Date.now(), modules: result });
  return result;
};

/** Render trusted built-in/module sections for one controlled development view.
 * @param {SharedDevRegistration} app - Registered application.
 * @param {SharedDevSnapshot} snapshot - Private host snapshot.
 * @param {DevtoolsSectionDefinition[]} baseSections - Trusted package-owned sections.
 * @param {string | null} [identifier] - Optional pairing label, not authentication.
 * @returns {Promise<object>} Module definitions and rendered trusted section content.
 */
export const loadApplicationSections = async (
  app: SharedDevRegistration,
  snapshot: SharedDevSnapshot,
  baseSections: DevtoolsSectionDefinition[],
  identifier?: string | null
) => {
  /** Recognized modules belonging to the selected application cache view. */
  const loadedModules = await loadAppDevtoolsModules(app, snapshot);
  /** Borrowed trusted module definitions passed to authored section renderers. */
  const modules = loadedModules.map((entry) => entry.definition);
  /** Trusted section callbacks supplied by explicit module definitions. */
  const moduleSections = loadedModules.flatMap(
    (entry) => entry.definition.sections ?? []
  );
  /** Ordered trusted built-in and module sections; callbacks are not evaluated from strings. */
  const sections = [...baseSections, ...moduleSections].sort(
    (left, right) =>
      (left.order ?? 1000) - (right.order ?? 1000) ||
      left.title.localeCompare(right.title)
  );

  return {
    modules,
    sections: await Promise.all(
      sections.map(async (section) => ({
        ...section,
        content: await section.render({
          app,
          snapshot,
          identifier,
          modules,
          module: section.moduleId
            ? modules.find((module) => module.id === section.moduleId)
            : undefined,
        }),
      }))
    ),
  };
};

/** Evaluate only legacy module-sharing labels, independently of request authentication.
 * @param {string | undefined} fromModuleId - Declared requester module or framework access sentinel.
 * @param {LoadedDevtoolsModule} target - Trusted target sharing/isolation declaration.
 * @returns {boolean | undefined} Whether the legacy sharing relation permits this dispatch.
 */
const canAccessModule = (
  fromModuleId: string | undefined,
  target: LoadedDevtoolsModule
) => {
  if (!fromModuleId) {
    return true;
  } // Framework access
  if (fromModuleId === target.definition.id) {
    return true;
  } // Self access
  if (target.isolated) {
    return false;
  } // Isolated modules only allow self/framework

  return (
    target.definition.dependencies?.includes(fromModuleId) ||
    target.shareWith.includes(fromModuleId)
  );
};

/** Resolve one explicitly named trusted legacy API callback after module-sharing checks.
 * @param {object} options - Registered app/snapshot, request, input and explicit module/handler labels.
 * @param {SharedDevRegistration} options.app - Host-registered application scope.
 * @param {SharedDevSnapshot} options.snapshot - Private configured module snapshot.
 * @param {string} options.moduleId - Exact configured target module identifier.
 * @param {string | null} [options.identifier] - Pairing label, never an authenticated identity.
 * @param {string | null} [options.requesterModuleId] - Declared legacy module sharing label.
 * @param {string} options.handlerName - Explicit trusted API callback key.
 * @param {import("node:http").IncomingMessage} options.request - Borrowed native request with host-owned authorization.
 * @param {unknown} options.body - Untrusted parsed data validated by the receiving callback.
 * @returns {Promise<unknown>} Callback result, or null when unavailable/denied; host HTTP authorization remains independent.
 */
export const resolveModuleApiRequest = async (options: {
  /** Host-registered application dependency scope. */
  app: SharedDevRegistration;
  /** Private host module configuration snapshot. */
  snapshot: SharedDevSnapshot;
  /** Exact configured target module identity. */
  moduleId: string;
  /** Exact trusted API callback registration key. */
  handlerName: string;
  /** Borrowed native request; authentication remains the host boundary responsibility. */
  request: IncomingMessage;
  /** Untrusted parsed input validated by the trusted receiving callback. */
  body: unknown;
  /** Optional pairing label, never an authorization grant. */
  identifier?: string | null;
  /** Declared module-sharing label; it must not substitute for verified request identity. */
  requesterModuleId?: string | null;
}) => {
  /** Recognized modules belonging to the selected application cache view. */
  const loadedModules = await loadAppDevtoolsModules(
    options.app,
    options.snapshot
  );
  /** Selected module or import URL; lookup is scoped to the explicitly registered app/module. */
  const target = loadedModules.find(
    (module) => module.definition.id === options.moduleId
  );
  if (
    !target ||
    !canAccessModule(options.requesterModuleId ?? undefined, target)
  ) {
    return null;
  }

  // Check for child overrides or extensions
  /** Recognized declared child modules considered for legacy callback override precedence. */
  const children = loadedModules.filter(
    (m) => m.parent === target.definition.id
  );
  /** First configured child with the exact requested callback key; no client code is evaluated. */
  const hijacker = children.find(
    (child) => child.apiHandlers[options.handlerName]
  );

  /** Recognized parent callback retained for an explicitly supplied child extension wrapper. */
  const baseHandler = target.apiHandlers[options.handlerName];

  if (hijacker) {
    // The preceding child search proved this exact handler key exists.
    /** Exact trusted child callback proven present by the preceding child search. */
    const handler = hijacker.apiHandlers[options.handlerName]!;
    return handler({
      app: options.app,
      snapshot: options.snapshot,
      identifier: options.identifier,
      request: options.request,
      body: options.body,
      module: hijacker.definition,
      parentHandler: baseHandler
        ? async (ctx) =>
            await baseHandler({
              app: options.app,
              snapshot: options.snapshot,
              identifier: options.identifier,
              request: options.request,
              body: options.body,
              module: target.definition,
              ...ctx,
            })
        : undefined,
    });
  }

  if (!baseHandler) {
    return null;
  }

  return baseHandler({
    app: options.app,
    snapshot: options.snapshot,
    identifier: options.identifier,
    request: options.request,
    body: options.body,
    module: target.definition,
  });
};

/** Resolve one trusted socket callback after legacy module-sharing checks.
 * @param {object} options - Registered app/snapshot and explicit routing/payload context.
 * @param {SharedDevRegistration} options.app - Host-registered application scope.
 * @param {SharedDevSnapshot} options.snapshot - Private configured module snapshot.
 * @param {string} options.moduleId - Exact configured target module identifier.
 * @param {string | null} [options.identifier] - Pairing label, never an authenticated identity.
 * @param {string | null} [options.requesterModuleId] - Declared legacy module sharing label.
 * @param {string} options.channel - Explicit trusted socket callback key.
 * @param {Record<string, unknown>} [options.payload] - Receiver-validated message input.
 * @param {string} [options.clientType] - Declared client label, not a verified role.
 * @returns {Promise<unknown>} Callback result, or null when unavailable/denied; labels never authenticate the caller.
 */
export const resolveModuleSocketRequest = async (options: {
  /** Host-registered application dependency scope. */
  app: SharedDevRegistration;
  /** Private host module configuration snapshot. */
  snapshot: SharedDevSnapshot;
  /** Exact configured target module identity. */
  moduleId: string;
  /** Exact trusted socket callback key. */
  channel: string;
  /** Untrusted socket input requiring callback-specific validation. */
  payload?: Record<string, unknown>;
  /** Optional pairing label, never an authorization grant. */
  identifier?: string | null;
  /** Declared development client kind, not a verified role. */
  clientType?: string;
  /** Declared module-sharing label; it must not substitute for verified request identity. */
  requesterModuleId?: string | null;
}) => {
  /** Recognized modules belonging to the selected application cache view. */
  const loadedModules = await loadAppDevtoolsModules(
    options.app,
    options.snapshot
  );
  /** Selected module or import URL; lookup is scoped to the explicitly registered app/module. */
  const target = loadedModules.find(
    (module) => module.definition.id === options.moduleId
  );
  if (
    !target ||
    !canAccessModule(options.requesterModuleId ?? undefined, target)
  ) {
    return null;
  }

  // Check for child overrides or extensions
  /** Recognized declared child modules considered for legacy callback override precedence. */
  const children = loadedModules.filter(
    (m) => m.parent === target.definition.id
  );
  /** First configured child with the exact requested callback key; no client code is evaluated. */
  const hijacker = children.find(
    (child) => child.socketHandlers[options.channel]
  );

  /** Recognized parent callback retained for an explicitly supplied child extension wrapper. */
  const baseHandler = target.socketHandlers[options.channel];

  if (hijacker) {
    // The preceding child search proved this exact channel key exists.
    /** Exact trusted child callback proven present by the preceding child search. */
    const handler = hijacker.socketHandlers[options.channel]!;
    return handler({
      app: options.app,
      snapshot: options.snapshot,
      identifier: options.identifier,
      clientType: options.clientType,
      payload: options.payload,
      module: hijacker.definition,
      parentHandler: baseHandler
        ? async (ctx) =>
            await baseHandler({
              app: options.app,
              snapshot: options.snapshot,
              identifier: options.identifier,
              clientType: options.clientType,
              payload: options.payload,
              module: target.definition,
              ...ctx,
            })
        : undefined,
    });
  }

  if (!baseHandler) {
    return null;
  }

  return baseHandler({
    app: options.app,
    snapshot: options.snapshot,
    identifier: options.identifier,
    clientType: options.clientType,
    payload: options.payload,
    module: target.definition,
  });
};

/** Read one configured style/script file only after rechecking its real package containment.
 * @param {SharedDevRegistration} app - Registered application.
 * @param {SharedDevSnapshot} snapshot - Explicit module configuration snapshot.
 * @param {string} moduleId - Exact configured module identity.
 * @param {"style" | "script"} asset - Allowed configured asset kind.
 * @returns {Promise<Buffer | null>} Contained local bytes or null; no remote file is fetched.
 */
export const readModuleAsset = async (
  app: SharedDevRegistration,
  snapshot: SharedDevSnapshot,
  moduleId: string,
  asset: 'style' | 'script'
) => {
  /** Recognized modules belonging to the selected application cache view. */
  const loadedModules = await loadAppDevtoolsModules(app, snapshot);
  /** Selected module or import URL; lookup is scoped to the explicitly registered app/module. */
  const target = loadedModules.find(
    (module) => module.definition.id === moduleId
  );
  /** Configured style/script leaf revalidated against its canonical package root before reading. */
  const targetPath = asset === 'style' ? target?.stylePath : target?.scriptPath;

  if (
    !target ||
    !targetPath ||
    !target.definition.packageRoot ||
    !resolveSafeModuleAsset(
      target.definition.packageRoot,
      path.relative(target.definition.packageRoot, targetPath)
    )
  ) {
    return null;
  }

  return fs.readFileSync(targetPath);
};

/** Read one module public asset through its explicit canonical public directory boundary.
 * @param {SharedDevRegistration} app - Registered application.
 * @param {SharedDevSnapshot} snapshot - Explicit configured module list.
 * @param {string} moduleId - Exact configured module identity.
 * @param {string} assetPath - Requested relative public asset path.
 * @returns {Promise<Buffer | null>} Contained local bytes or null for missing/unsafe paths.
 */
export const readModulePublicAsset = async (
  app: SharedDevRegistration,
  snapshot: SharedDevSnapshot,
  moduleId: string,
  assetPath: string
) => {
  /** Recognized modules belonging to the selected application cache view. */
  const loadedModules = await loadAppDevtoolsModules(app, snapshot);
  /** Selected module or import URL; lookup is scoped to the explicitly registered app/module. */
  const target = loadedModules.find(
    (module) => module.definition.id === moduleId
  );
  if (!target || !target.publicRoot) {
    return null;
  }

  /** Canonical candidate leaf checked against its real root and required file kind. */
  const absolutePath = resolveSafeModuleAsset(target.publicRoot, assetPath);
  if (!absolutePath) {
    return null;
  }
  return fs.readFileSync(absolutePath);
};
