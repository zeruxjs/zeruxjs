import type { FontRegistry } from './registry.js';
import type { FontAssetManifest } from './build.js';
import { createFontRegistry } from './registry.js';
import { fontStack, defineFont } from './css.js';
import { fontUrl } from './validate.js';
import { fontIcon } from './icons.js';

/** Structural subset of Zuixs' public plugin API; no compiler dependency at runtime. */
export interface FontThemeAPI {
  /** Register explicit generated utility declarations through the borrowed host compiler API.
   * @param {Record<string, Record<string, string | number>>} items - Trusted generated selector/declaration records, not arbitrary downloaded CSS.
   * @returns {void} Host compiler owns ordering, prefix, important and variant behavior.
   */
  addUtilities(items: Record<string, Record<string, string | number>>): void;
  /** Register deterministic generated fallback variables through the host compiler.
   * @param {string} css - Trusted generated base CSS; host owns cascade/layer ordering.
   * @returns {void} No browser style injection or network request occurs here.
   */
  addBase(css: string): void;
  /** Read the host merged theme so explicit user overrides win over adapter defaults.
   * @param {string} path - Adapter-generated theme path.
   * @param {string | undefined} fallback - Validated default when the host theme has no matching value.
   * @returns {string} Host-resolved theme value; host owns custom override validity.
   */
  theme(path: string, fallback?: string): string;
}
/** Explicit registered face-to-theme mapping with predictable authored fallback families. */
export interface FontToken {
  /** Explicit unique lower-ASCII theme identifier, at most 48 characters. */
  token: string;
  /** Registered font/icon key matched against the supplied manifest. */
  key: string;
  /** Authored fallback families, 1–8 entries; system-ui/sans-serif are always appended. */
  fallback?: readonly string[];
}
/** Explicit registry/manifest selection for the borrowed host compiler, without a runtime Zuixs dependency. */
export interface FontZuixOptions {
  /** Borrowed source registry; entries are copied before selection. */
  registry: FontRegistry;
  /** Matching build manifest; selected records retain source hashes/licenses. */
  assets: FontAssetManifest;
  /** Only explicitly selected face/token mappings; unused faces are not emitted. */
  fonts: readonly FontToken[];
  /** Optional explicit icon mappings; SVGs remain asset records rather than generated glyphs. */
  icons?: readonly {
    /** Explicit unique lower-ASCII theme identifier, at most 48 characters. */
    token: string;
    /** Registered font/icon key matched against the supplied manifest. */
    key: string;
  }[];
}
/** Conservative predictable CSS token spelling; prototype-special keys reject separately. */
const tokenPattern = /^[a-z][a-z0-9-]{0,47}$/;
/** Validate a conservative theme-token identifier and reject prototype-special names.
 * @param {string} value - Lowercase ASCII identifier of at most 48 characters.
 * @returns {string} Original accepted token; never a CSS declaration or network destination.
 */
function token(value: string) {
  if (
    typeof value !== 'string' ||
    !tokenPattern.test(value) ||
    ['constructor', 'prototype', '__proto__'].includes(value)
  ) {
    throw new TypeError('Invalid font theme token');
  }
  return value;
}
/** Snapshot only explicitly mapped registry/build records into theme utilities and local asset references. No compiler dependency, font download or DOM acquisition is started.
 * @param {FontZuixOptions} options - Borrowed trusted registry, matching V1 manifest and explicit font/icon mappings.
 * @returns {object} Selected CSS/theme/plugin/manifest plus bounded route-unioned preload planner; no persistent disposer.
 */
export function createFontZuixAdapter(options: FontZuixOptions) {
  if (
    !options ||
    options.assets?.schema !== 1 ||
    !Array.isArray(options.assets.fonts) ||
    options.assets.fonts.length > 64 ||
    !Array.isArray(options.assets.icons) ||
    options.assets.icons.length > 256 ||
    !Array.isArray(options.fonts) ||
    options.fonts.length > 64 ||
    !Array.isArray(options.icons ?? []) ||
    (options.icons?.length ?? 0) > 256
  ) {
    throw new TypeError('Invalid font adapter input');
  }
  /** Detached registry entries bounded before any selection or theme generation. */
  const entries = options.registry.entries();
  if (entries.length > 64) {
    throw new RangeError('Font registry limit');
  }
  /** Snapshot key-to-definition map, independent of later host registry mutation. */
  const source = new Map(entries);
  /** Copied build-font records keyed by unique registered names. */
  const assets = new Map(
    options.assets.fonts.map((face) => [face.key, structuredClone(face)])
  );
  if (assets.size !== options.assets.fonts.length) {
    throw new TypeError('Duplicate manifest font key');
  }
  /** Separate selected-face registry; constructing it acquires no DOM/native resource. */
  const registry = createFontRegistry();
  /** Null-prototype family theme defaults pointing at scoped-name custom properties. */
  const families: Record<string, string> = Object.create(null);
  /** Null-prototype font-weight defaults; variable descriptor ranges use their minimum. */
  const weights: Record<string, string> = Object.create(null);
  /** Validated selected family/fallback stacks emitted into deterministic base CSS. */
  const stacks: Record<string, string> = Object.create(null);
  /** Copied selected build records; no implicit unused font acquisition. */
  const fonts: FontAssetManifest['fonts'] = [];
  /** Copied explicit icon records, retaining separate SVG/font semantics. */
  const icons: FontAssetManifest['icons'] = [];
  /** Theme tokens already selected across both families and icons; collisions reject. */
  const seen = new Set<string>();
  /** Registered face keys already retained, deduplicating shared font icon/face records. */
  const used = new Set<string>();
  /** Verify a registry face matches its local build record before retaining one selected copy.
   * @param {string} key - Explicit registered build key, not an inferred family or remote source.
   * @returns {FontDefinition} Verified face; repeated selection deduplicates emitted face records.
   */
  function select(key: string) {
    /** Validated registry face selected only when its matching build record exists. */
    const face = source.get(key);
    /** Matching local build record with explicit bytes/hash/license provenance. */
    const asset = assets.get(key);
    if (!face || !asset) {
      throw new TypeError(
        'Selected font is missing from registry or asset manifest'
      );
    }
    defineFont(face);
    fontUrl(asset.url);
    if (
      !asset.url.startsWith('/') ||
      asset.url.startsWith('//') ||
      face.family !== asset.family ||
      String(face.weight ?? 400) !== asset.weight ||
      (face.style ?? 'normal') !== asset.style ||
      !face.sources.some((s) => s.url === asset.url) ||
      !Object.hasOwn(
        { woff2: 1, woff: 1, truetype: 1, opentype: 1 },
        asset.format
      ) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 1
    ) {
      throw new TypeError('Font registry/asset manifest mismatch');
    }
    if (!used.has(key)) {
      registry.add(key, {
        ...face,
        sources: [{ url: asset.url, format: asset.format }],
      });
      fonts.push(structuredClone(asset));
      used.add(key);
    }
    return face;
  }
  /** Copied explicit font mappings sorted by token for deterministic generation. */
  const mappings = options.fonts
    .map((item) => ({ ...item }))
    .sort((a, b) => {
      if (a.token < b.token) {
        return -1;
      }
      return a.token > b.token ? 1 : 0;
    });
  // Select only explicit face mappings; no unused font is emitted or loaded.
  for (const mapping of mappings) {
    /** Validated unique theme token used only in generated selector/property names. */
    const name = token(mapping.token);
    if (seen.has(name)) {
      throw new TypeError('Font theme token collision');
    }
    seen.add(name);
    /** Validated registry face selected only when its matching build record exists. */
    const face = select(mapping.key);
    /** Explicit host fallback stack or predictable system defaults, validated before use. */
    const fallback = mapping.fallback ?? ['system-ui', 'sans-serif'];
    if (!Array.isArray(fallback) || !fallback.length || fallback.length > 8) {
      throw new TypeError('Font fallback stack required');
    }
    // Validate each authored fallback before building the predictable system-terminated stack.
    for (const family of fallback) {
      defineFont({ family, sources: [{ url: '/validation.woff2' }] });
    }
    stacks[name] = fontStack(
      ...new Set([face.family, ...fallback, 'system-ui', 'sans-serif'])
    );
    families[name] = `var(--zx-font-${name})`;
    /** Validated face weight descriptor; range defaults use the first numeric value. */
    const weight = String(face.weight ?? 400);
    // A variable range is a face descriptor, not a valid font-weight property value.
    weights[name] = weight.includes(' ') ? weight.split(' ')[0] : weight;
  }
  /** Unique manifest icon lookup; duplicate source keys reject before emission. */
  const iconKeys = new Map(
    options.assets.icons.map((icon) => [icon.key, icon])
  );
  if (iconKeys.size !== options.assets.icons.length) {
    throw new TypeError('Duplicate manifest icon key');
  }
  /** Null-prototype generated icon font declarations; glyph text remains explicit content. */
  const iconUtilities: Record<string, Record<string, string>> = Object.create(
    null
  );
  // Keep icon mapping order deterministic while retaining distinct font/SVG semantics.
  for (const mapping of [...(options.icons ?? [])].sort((a, b) => {
    if (a.token < b.token) {
      return -1;
    }
    return a.token > b.token ? 1 : 0;
  })) {
    /** Validated unique theme token used only in generated selector/property names. */
    const name = token(mapping.token);
    if (seen.has(name)) {
      throw new TypeError('Font theme token collision');
    }
    seen.add(name);
    /** Explicitly selected font/SVG asset; raw HTML is never accepted here. */
    const icon = iconKeys.get(mapping.key);
    if (!icon) {
      throw new TypeError('Selected icon is missing');
    }
    if (icon.kind === 'font') {
      /** Validated registry face selected only when its matching build record exists. */
      const face = select(icon.fontKey);
      fontIcon(icon.codePoint, face.family);
      // Glyph text remains explicit DOM text, never CSS generated content or HTML.
      stacks[name] = fontStack(face.family, 'sans-serif');
      families[name] = `var(--zx-font-${name})`;
      iconUtilities[`icon-${name}`] = {
        'font-family': families[name],
        'font-style': (face.style ?? 'normal').replace(
          /(-?\d+(?:\.\d+)?deg)\s+-?\d+(?:\.\d+)?deg$/,
          '$1'
        ),
        'font-weight': String(face.weight ?? 400).split(' ')[0],
      };
    } else if (icon.kind === 'svg') {
      fontUrl(icon.url);
      if (!icon.url.startsWith('/') || icon.url.startsWith('//')) {
        throw new TypeError('Icon must be a local asset');
      }
    } else {
      throw new TypeError('Unsupported icon kind');
    }
    icons.push(structuredClone(icon));
  }
  /** Adapter defaults consumed by the host compiler; user extend values retain precedence. */
  const theme = { fontFamily: families, fontWeight: weights };
  /** Register generated defaults/utilities through the explicit host compiler API.
   * @param {FontThemeAPI} api - Borrowed public theme/plugin methods; no compiler is imported here.
   * @returns {void} Utilities registered under host ordering/prefix/important policy. */
  const plugin = (api: FontThemeAPI) => {
    api.addBase(
      `:root{${Object.keys(stacks)
        .sort()
        .map((name) => `--zx-font-${name}:${stacks[name]};`)
        .join('')}}`
    );
    /** Fresh generated declaration records honoring host theme overrides. */
    const utilities: Record<string, Record<string, string>> = Object.create(
      null
    );
    // Read merged family values through the host API so user overrides remain authoritative.
    for (const name of Object.keys(families)) {
      utilities[`font-family-${name}`] = {
        'font-family': api.theme(`fontFamily.${name}`, families[name]),
      };
    }
    // Emit weight utilities using host-resolved defaults instead of freezing user theme values.
    for (const name of Object.keys(weights)) {
      utilities[`font-weight-${name}`] = {
        'font-weight': api.theme(`fontWeight.${name}`, weights[name]),
      };
    }
    // Resolve icon family overrides without generating glyph text or accessible labels in CSS.
    for (const [name, values] of Object.entries(iconUtilities)) {
      utilities[name] = {
        ...values,
        'font-family': api.theme(
          `fontFamily.${name.slice(5)}`,
          values['font-family']
        ),
      };
    }
    api.addUtilities(utilities);
  };
  fonts.sort((a, b) => (a.key < b.key ? -1 : 1));
  icons.sort((a, b) => (a.key < b.key ? -1 : 1));
  return {
    theme,
    plugin,
    registry,
    css: registry.css(),
    manifest: {
      schema: 1 as const,
      sourceDigest: options.assets.digest,
      fonts,
      icons,
    },
    /** Union explicitly requested route tokens into unique binary URL hints under both count/byte caps.
     * @param {readonly (readonly string[])[]} routes - At most 256 routes, each with at most 64 mapped tokens; none means no preloads.
     * @param {object} budget - Explicit count/byte budget; defaults to two URLs and 128 KiB.
     * @param {number} budget.maxCount - Unique URL ceiling from 0–16; defaults to two.
     * @param {number} budget.maxBytes - Total byte ceiling from 0–16 MiB; defaults to 128 KiB.
     * @returns {object[]} URL-sorted selected font preload records; excess/unknown tokens reject.
     */
    preloads(
      routes: readonly (readonly string[])[],
      budget: {
        /** Unique preload URL ceiling; default two and hard maximum 16. */
        maxCount: number;
        /** Selected preload byte ceiling; default 128 KiB and hard maximum 16 MiB. */
        maxBytes: number;
      } = {
        maxCount: 2,
        maxBytes: 128 * 1024,
      }
    ) {
      if (
        !Array.isArray(routes) ||
        routes.length > 256 ||
        !Number.isSafeInteger(budget.maxCount) ||
        budget.maxCount < 0 ||
        budget.maxCount > 16 ||
        !Number.isSafeInteger(budget.maxBytes) ||
        budget.maxBytes < 0 ||
        budget.maxBytes > 16 * 1024 * 1024
      ) {
        throw new RangeError('Invalid preload budget');
      }
      /** Unique selected binary URL hints across the explicitly supplied route lists. */
      const urls = new Map<
        string,
        {
          /** Selected local binary URL under the supplied mounted build manifest. */
          url: string; /** Explicit selected font MIME hint, not a fetched/sniffed content guarantee. */
          type: string; /** Actual build-record byte length used for preload budget accounting. */
          bytes: number;
        }
      >();
      // Union explicit bounded route selections; this is not a global preload cache.
      for (const route of routes) {
        if (!Array.isArray(route) || route.length > 64) {
          throw new RangeError('Route font limit');
        }
        // Resolve only known mapped tokens before adding unique binary URLs.
        for (const name of route) {
          /** Explicit route token mapping; unknown route tokens fail rather than loading a guessed font. */
          const mapping = mappings.find((item) => item.token === name);
          if (!mapping) {
            throw new TypeError('Unknown route font token');
          }
          /** Matching local build record with explicit bytes/hash/license provenance. */
          const asset = assets.get(mapping.key)!;
          urls.set(asset.url, {
            url: asset.url,
            type: `font/${({ truetype: 'ttf', opentype: 'otf', woff: 'woff', woff2: 'woff2' } as const)[asset.format]}`,
            bytes: asset.bytes,
          });
        }
      }
      /** URL-sorted deduplicated preload records checked against both explicit budgets. */
      const result = [...urls.values()].sort((a, b) =>
        a.url < b.url ? -1 : 1
      );
      if (
        result.length > budget.maxCount ||
        result.reduce((n, item) => n + item.bytes, 0) > budget.maxBytes
      ) {
        throw new RangeError('Font preload budget exceeded');
      }
      return result;
    },
  };
}
