import type { SharedDevRegistration, SharedDevSnapshot } from './types.js';

export interface DevtoolsSectionContext {
  /** Registered application whose controlled development view is being rendered. */
  app: SharedDevRegistration;
  /** Normalized private development state for the selected application. */
  snapshot: SharedDevSnapshot;
  /** Optional opaque client pairing identifier; never authentication or authorization. */
  identifier?: string | null;
  /** Explicit trusted module definitions available to this render context. */
  modules: DevtoolsModuleDefinition[];
  /** Optional current module definition for a module-owned section. */
  module?: DevtoolsModuleDefinition;
}

export interface DevtoolsSectionDefinition {
  /** Stable authored section/module identifier used for registration and navigation. */
  id: string;
  /** Authored display title; serializers must escape it in their output context. */
  title: string;
  /** Optional authored text icon for the navigation item. */
  icon?: string;
  /** Optional numeric section order before display-title tie breaking. */
  order?: number;
  /** Owning module identifier for a module-rendered section. */
  moduleId?: string;
  /** Render a trusted authored section within the controlled development document.
   * @param {DevtoolsSectionContext} context - Registered application/snapshot/module context selected by the host.
   * @returns {string | Promise<string>} Trusted section HTML; this contract does not sanitize arbitrary plugin output.
   */
  render(context: DevtoolsSectionContext): string | Promise<string>;
}

export interface DevtoolsModuleAssetConfig {
  /** Package-relative explicitly configured stylesheet path. */
  style?: string;
  /** Package-relative explicitly configured trusted browser script path. */
  script?: string;
  /** Package-relative public asset directory; resolution must remain inside its real root. */
  public?: string;
}

export interface DevtoolsModuleServerConfig {
  /** Package-relative trusted API handler module path. */
  api?: string;
  /** Package-relative trusted socket handler module path. */
  websocket?: string;
  /** Explicit module identifiers allowed to request this module legacy handlers. */
  shareWith?: string[];
  /** Whether legacy module access is limited to self/framework requests. */
  isolated?: boolean;
  /** Whether configured child modules may extend or override this module. */
  allowChildren?: boolean;
}

export interface DevtoolsModuleConfig {
  /** Stable authored section/module identifier used for registration and navigation. */
  id?: string;
  /** Authored display title; serializers must escape it in their output context. */
  title?: string;
  /** Optional authored module/configuration version used in displayed metadata and asset URLs. */
  version?: string;
  /** Inert authored description; renderers remain responsible for context-specific escaping. */
  description?: string;
  /** Explicit package-relative trusted module entry executed only after host configuration selects it. */
  entry: string;
  /** Configured local assets or emitted public asset URLs, according to the owning declaration. */
  assets?: DevtoolsModuleAssetConfig;
  /** Explicit trusted server module wiring; not permission to execute caller-supplied source. */
  server?: DevtoolsModuleServerConfig;
  /** Declared module identifiers used by legacy sharing relationships. */
  dependencies?: string[];
  /** Trusted host/module metadata; do not put secrets in records projected to development UI. */
  meta?: Record<string, unknown>;
}

export interface DevtoolsModuleDefinition {
  /** Stable authored section/module identifier used for registration and navigation. */
  id: string;
  /** Authored display title; serializers must escape it in their output context. */
  title: string;
  /** Optional authored module/configuration version used in displayed metadata and asset URLs. */
  version?: string;
  /** Inert authored description; renderers remain responsible for context-specific escaping. */
  description?: string;
  /** Optional inert module display badge. */
  badge?: string;
  /** Configured package name retained for controlled development inspection. */
  packageName?: string;
  /** Resolved host-owned module package root used for real-path asset boundaries. */
  packageRoot?: string;
  /** Declared module identifiers used by legacy sharing relationships. */
  dependencies?: string[];
  /** Trusted section callbacks installed by this module definition. */
  sections?: DevtoolsSectionDefinition[];
  /** Configured local assets or emitted public asset URLs, according to the owning declaration. */
  assets?: {
    /** Validated module stylesheet URL exposed by the controlled development server. */
    styleUrl?: string;
    /** Validated module script URL; code is trusted host-selected package code. */
    scriptUrl?: string;
  };
  /** Trusted host/module metadata; do not put secrets in records projected to development UI. */
  meta?: Record<string, unknown>;
  /** Whether configured child modules may extend or override this module. */
  allowChildren?: boolean;
}

export type DevtoolsApiModuleHandlers = Record<
  string,
  (context: {
    /** Registered application whose controlled development view is being rendered. */
    app: SharedDevRegistration;
    /** Normalized private development state for the selected application. */
    snapshot: SharedDevSnapshot;
    /** Optional opaque client pairing identifier; never authentication or authorization. */
    identifier?: string | null;
    /** Actual incoming request; handlers must retain host authentication and input-validation policy. */
    request: import('node:http').IncomingMessage;
    /** Untrusted parsed request body requiring handler-specific validation. */
    body: unknown;
    /** Optional current module definition for a module-owned section. */
    module: DevtoolsModuleDefinition;
    /** Optional result supplied by a trusted parent/child handler integration. */
    parentResult?: any;
    /** Optional trusted parent callback; calling it does not grant additional authorization. */
    parentHandler?: (ctx: any) => Promise<any>;
  }) => Promise<unknown> | unknown
>;

export type DevtoolsSocketModuleHandlers = Record<
  string,
  (context: {
    /** Registered application whose controlled development view is being rendered. */
    app: SharedDevRegistration;
    /** Normalized private development state for the selected application. */
    snapshot: SharedDevSnapshot;
    /** Optional opaque client pairing identifier; never authentication or authorization. */
    identifier?: string | null;
    /** Optional client kind used by the legacy socket integration, not a verified identity. */
    clientType?: string;
    /** Untrusted socket payload requiring handler-specific validation. */
    payload?: Record<string, unknown>;
    /** Optional current module definition for a module-owned section. */
    module: DevtoolsModuleDefinition;
    /** Optional result supplied by a trusted parent/child handler integration. */
    parentResult?: any;
    /** Optional trusted parent callback; calling it does not grant additional authorization. */
    parentHandler?: (ctx: any) => Promise<any>;
  }) => Promise<unknown> | unknown
>;

/** Legacy process-wide module definitions; unregister explicitly during host reload/teardown. */
const modules = new Map<string, DevtoolsModuleDefinition>();

/** Preserve the concrete trusted module definition type without registration or execution.
 * @template T
 * @param {T} definition - Explicit authored module definition.
 * @returns {T} The same caller-owned definition.
 */
export const defineDevtoolsModule = <T extends DevtoolsModuleDefinition>(
  definition: T
) => definition;
/** Preserve an explicit module package configuration without loading code.
 * @template T
 * @param {T} definition - Trusted module configuration.
 * @returns {T} The unchanged caller-owned configuration.
 */
export const defineDevtoolsModuleConfig = <T extends DevtoolsModuleConfig>(
  definition: T
) => definition;
/** Preserve trusted API handler types without installing HTTP routes.
 * @template T
 * @param {T} handlers - Explicit host-authored handler map.
 * @returns {T} The same map; registration/authorization remains host-owned.
 */
export const defineDevtoolsModuleApiHandlers = <
  T extends DevtoolsApiModuleHandlers,
>(
  handlers: T
) => handlers;
/** Preserve trusted socket handler types without starting a socket.
 * @template T
 * @param {T} handlers - Explicit host-authored channel handlers.
 * @returns {T} The unchanged caller-owned handler map.
 */
export const defineDevtoolsModuleSocketHandlers = <
  T extends DevtoolsSocketModuleHandlers,
>(
  handlers: T
) => handlers;

/** Register a trusted definition in the legacy process-wide module map.
 * @param {DevtoolsModuleDefinition} definition - Module replacing the same identifier when present.
 * @returns {DevtoolsModuleDefinition} The registered borrowed definition; no disposer handle is created.
 */
export const registerDevtoolsModule = (
  definition: DevtoolsModuleDefinition
) => {
  modules.set(definition.id, definition);
  return definition;
};

/** Remove a legacy process-wide module definition by identifier.
 * @param {string} id - Explicit registration identifier.
 * @returns {void} Deletes the registration without disposing arbitrary module code.
 */
export const unregisterDevtoolsModule = (id: string) => {
  modules.delete(id);
};

/** Project legacy registrations into deterministic display-title order.
 * @returns {DevtoolsModuleDefinition[]} Fresh sorted array borrowing the existing definition objects.
 */
export const getRegisteredDevtoolsModules = () =>
  [...modules.values()].sort((left, right) =>
    left.title.localeCompare(right.title)
  );
