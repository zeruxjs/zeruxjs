import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getDevtoolsApiHandler } from './api/registry.js';
import { loadApplicationSections as loadResolvedApplicationSections } from './module-loader.js';
import type {
  DevtoolsModuleDefinition,
  DevtoolsSectionDefinition,
} from './module-registry.js';
import type { SharedDevRegistration, SharedDevSnapshot } from './types.js';

// Decode file URLs correctly for package paths containing spaces and Windows paths.
/** Installed package root decoded through fileURLToPath, including spaces and platform paths. */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
/** Compiled package runtime directory; source modules are not a published runtime fallback. */
const runtimeRoot = path.join(packageRoot, 'dist');
/** Package-owned static development asset directory. */
const assetsRoot = path.join(packageRoot, 'assets');
/** Compiled authored development page directory. */
const appRoot = path.join(runtimeRoot, 'app');
/** Compiled built-in application section directory; only these package-owned files are discovered. */
const applicationRoot = path.join(appRoot, 'application');

/** Import an explicitly selected trusted local package module with an mtime cache identity.
 * @template T
 * @param {string} filePath - Host/package-selected compiled module path.
 * @returns {Promise<T>} Trusted module namespace; this is executable code, not document extraction.
 */
const importSourceModule = async <T = any>(filePath: string): Promise<T> => {
  /** Explicit local module URL keyed by its current modification timestamp. */
  const target = `${pathToFileURL(filePath).href}?v=${fs.statSync(filePath).mtimeMs}`;
  return import(target) as Promise<T>;
};

/** Read a package-owned development asset selected by trusted routing code.
 * @param {string} name - Authored asset name; callers must not pass arbitrary request paths.
 * @returns {Buffer | null} Local asset bytes or null when absent.
 */
export const readDevAsset = (name: string) => {
  /** Package asset path formed only from the trusted caller-selected asset name. */
  const filePath = path.join(assetsRoot, name);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
};

/** Normalize an imported trusted built-in section namespace.
 * @param {unknown} value - Imported module namespace or definition.
 * @returns {DevtoolsSectionDefinition | null} Structurally recognized definition; this is not a plugin sandbox.
 */
const toSectionDefinition = (value: any): DevtoolsSectionDefinition | null => {
  /** Imported trusted section candidate checked for the required display identity. */
  const definition = value?.default ?? value?.section ?? value;
  if (
    !definition ||
    typeof definition.id !== 'string' ||
    typeof definition.title !== 'string'
  ) {
    return null;
  }
  return definition as DevtoolsSectionDefinition;
};

/** Load authored built-in compiled sections without scanning application dependencies.
 * @returns {Promise<DevtoolsSectionDefinition[]>} Package-owned section definitions in filesystem discovery order.
 */
export const loadFileSections = async () => {
  /** Recognized built-in section definitions accumulated for this page render. */
  const fileSections: DevtoolsSectionDefinition[] = [];
  if (fs.existsSync(applicationRoot)) {
    for (const entry of fs.readdirSync(applicationRoot, {
      withFileTypes: true,
    })) {
      if (
        !entry.isFile() ||
        !entry.name.endsWith('.js') ||
        entry.name === 'page.js'
      ) {
        continue;
      }
      /** Imported trusted section candidate checked for the required display identity. */
      const definition = toSectionDefinition(
        await importSourceModule(path.join(applicationRoot, entry.name))
      );
      if (definition) {
        fileSections.push(definition);
      }
    }
  }
  return fileSections;
};

/** Combine trusted built-in and explicitly configured module sections.
 * @param {SharedDevRegistration} app - Host-registered application.
 * @param {SharedDevSnapshot} snapshot - Private normalized development state.
 * @param {string | null} [identifier] - Optional pairing label, never authentication.
 * @returns {ReturnType<typeof loadResolvedApplicationSections>} Resolved sections and module definitions borrowed for rendering.
 */
export const loadApplicationSections = async (
  app: SharedDevRegistration,
  snapshot: SharedDevSnapshot,
  identifier?: string | null
) => {
  return loadResolvedApplicationSections(
    app,
    snapshot,
    await loadFileSections(),
    identifier
  );
};

/** Load the trusted hub page and defer its response-owned nonce injection.
 * @param {SharedDevRegistration[]} apps - Host-approved application registrations.
 * @returns {Promise<(nonce?: string) => string>} Renderer for one controlled development document.
 */
export const renderHomePage = async (apps: SharedDevRegistration[]) => {
  /** Trusted built-in compiled hub module selected by the package-owned path. */
  const mod = await importSourceModule<{
    default: (context: {
      apps: SharedDevRegistration[];
      nonce?: string;
    }) => string;
  }>(path.join(appRoot, 'page.js'));
  return (nonce?: string) => mod.default({ apps, nonce });
};

/** Resolve a trusted application page and its explicitly configured module content.
 * @param {SharedDevRegistration} app - Host-registered application.
 * @param {SharedDevSnapshot} snapshot - Private normalized development state.
 * @param {string | null} [identifier] - Optional pairing label.
 * @param {string | null} [sectionId] - Requested authored section identifier.
 * @returns {Promise<(nonce?: string) => string>} Document renderer borrowing the response nonce; plugin HTML remains trusted code output.
 */
export const renderApplicationPage = async (
  app: SharedDevRegistration,
  snapshot: SharedDevSnapshot,
  identifier?: string | null,
  sectionId?: string | null
) => {
  /** Trusted compiled application page module, separate from host-selected third-party modules. */
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
  }>(path.join(applicationRoot, 'page.js'));

  /** Resolved trusted module/section projections passed into the authored page renderer. */
  const { modules, sections } = await loadApplicationSections(
    app,
    snapshot,
    identifier
  );
  return (nonce?: string) =>
    application.default({
      app,
      snapshot,
      identifier,
      sectionId,
      sections,
      modules,
      nonce,
    });
};

/** Look up the legacy explicitly registered API callback without invoking it.
 * @param {string} name - Exact registration key.
 * @returns {ReturnType<typeof getDevtoolsApiHandler>} Borrowed callback or null; no new cleanup owner is created.
 */
export const resolveCustomApiHandler = (name: string) =>
  getDevtoolsApiHandler(name);
