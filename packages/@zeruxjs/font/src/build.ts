import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  open,
  mkdir,
  lstat,
  realpath,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { defineFont } from './css.js';
import { validateSvgIcon, svgIconMarkup, fontIcon } from './icons.js';
import type { SvgIcon } from './icons.js';
import { validateFace } from './face-validation.js';
import type { FontDefinition } from './types.js';
import type {
  FontAxis,
  FontToolsTool,
  FontBinaryFormat,
  FontInspection,
} from './fonttools.js';
export { createFontToolsTool } from './fonttools.js';
export type {
  FontToolsTool,
  FontBinaryFormat,
  FontAxis,
  FontInspection,
} from './fonttools.js';
/** Host-declared redistribution rights and public attribution, not a legal verification service. */
export interface FontLicense {
  /** Explicit license identifier; not a signed proof of permission. */
  id: string;
  /** Explicit source selection or public provenance under its owning contract; never executable discovery. */
  source: string;
  /** Nonblank public attribution, at most 2048 code units, without controls. */
  attribution: string;
  /** Required literal true host permission declaration; does not verify license compliance. */
  redistributionAllowed: true;
  /** Optional explicit modification permission, required true for requested subsets. */
  subsettingAllowed?: boolean;
  /** Optional required license/notices text, at most 32768 code units. */
  text?: string;
}
/** Explicit licensed build input; sources are acquired only during an invoked build. */
export interface BuildFont extends Omit<FontDefinition, 'sources'> {
  /** Unique validated asset key across font and icon definitions. */
  key: string;
  /** Explicit source selection or public provenance under its owning contract; never executable discovery. */
  source:
    | {
        /** Project-relative binary source path; never included in public provenance. */
        path: string;
      }
    | {
        /** Approved direct acquisition URL; private query credentials are never emitted in the manifest. */
        url: string;
      };
  /** Explicit supported font container format, independently signature checked. */
  format: FontBinaryFormat;
  /** Explicit validated host redistribution/attribution declaration for this asset. */
  license: FontLicense;
  /** Explicit opt-in face preload suggestion; no automatic HTML/header injection. */
  preload?: boolean;
  /** Declared variable axes checked against native inspection when requested. */
  axes?: readonly FontAxis[];
  /** Explicit finite glyph selection with optional validated language/script attribution. */
  subset?: {
    /** Explicit requested Unicode scalars, at most 65536; coverage verified before/after subsetting. */
    codePoints: readonly number[];
    /** Optional canonical locale hint; not complete linguistic/shaping coverage. */
    language?: string;
    /** Optional four-letter ISO-style script hint; not an inferred glyph table. */
    script?: string;
  };
}
/** Separate structured SVG or registered font-glyph build input, never raw markup. */
export type BuildIcon =
  | {
      /** Unique validated asset key across font and icon definitions. */
      key: string;
      /** Explicit font or structured SVG icon kind; never unrestricted HTML. */
      kind: 'svg';
      /** Bounded structured SVG geometry, not raw remote XML. */
      geometry: SvgIcon;
      /** Validated explicit host permission/attribution declaration, retained per asset. */
      license: FontLicense;
    }
  | {
      /** Unique validated asset key across font and icon definitions. */
      key: string;
      /** Explicit font or structured SVG icon kind; never unrestricted HTML. */
      kind: 'font';
      /** Explicit registered face reference whose emitted glyph coverage must include the icon. */
      fontKey: string;
      /** Explicit scalar glyph requiring verified emitted font coverage. */
      codePoint: number;
    };
/** Trusted project-local build plan with opt-in remote/tool capabilities and bounded staging. */
export interface FontBuildOptions {
  /** Trusted existing canonical project root, never a caller-chosen filesystem sandbox. */
  projectRoot: string;
  /** Project-relative destination without traversal/empty/dot segments. */
  outputDir: string;
  /** Canonical absolute mounted URL prefix ending in /; no origin guessing. */
  publicBase: string;
  /** Explicit bounded face records; build permits at most 64. */
  fonts: readonly BuildFont[];
  /** Optional explicit bounded icon records; build permits at most 256. */
  icons?: readonly BuildIcon[];
  /** Explicit opt-in face preload suggestion; no automatic HTML/header injection. */
  preload?: {
    /** Explicit unique preload count cap, default two and ceiling 16. */
    maxCount: number;
    /** Explicit preload byte cap, default 128 KiB and ceiling 16 MiB. */
    maxBytes: number;
  };
  /** Per-font acquired/emitted byte cap, default 8 MiB and ceiling 16 MiB. */
  maxFileBytes?: number;
  /** Total candidate output bytes, default 64 MiB and ceiling 128 MiB. */
  maxTotalBytes?: number;
  /** Caller-owned cooperative build cancellation; uncooperative transports can delay settlement. */
  signal?: AbortSignal;
  /** Optional explicitly chosen borrowed FontTools implementation; no automatic install or remote upload. */
  tool?: FontToolsTool;
  /** Optional trusted build-only Fetch transport and exact HTTPS origin approvals. */
  remote?: {
    /** Borrowed transport required for remote acquisition; redirects must remain manual. */
    fetch: typeof fetch;
    /** Exact HTTPS origins, 1–32; host owns DNS/IP/egress enforcement. */
    allowedOrigins: readonly string[];
    /** Bounded manual redirect count, default two and ceiling five. */
    maxRedirects?: number;
    /** Cooperative remote wall deadline, default 15000 ms and ceiling 120000 ms. */
    timeoutMs?: number;
  };
}
/** Deterministic public V1 asset/provenance snapshot; hashes prove bytes, not authorship or permissions. */
export interface FontAssetManifest {
  /** Manifest schema version, fixed at one. */
  schema: 1;
  /** SHA-256 of deterministic manifest content with empty digest field; not authorship/authentication. */
  digest: string;
  /** Content-addressed stylesheet record; host must serve its configured URL. */
  css: {
    /** Safe internally generated relative content-hash filename. */
    file: string;
    /** Local mounted public asset URL; never a signed remote download URL. */
    url: string;
    /** SHA-256 of actual emitted bytes, not permission or authorship. */
    sha256: string;
  };
  /** Explicit bounded face records; build permits at most 64. */
  fonts: {
    /** Unique validated asset key across font and icon definitions. */
    key: string;
    /** Authored validated font family, not an invented installed-font fact. */
    family: string;
    /** Serialized validated face weight descriptor, default 400. */
    weight: string;
    /** Serialized validated face style descriptor, default normal. */
    style: string;
    /** Local mounted public asset URL; never a signed remote download URL. */
    url: string;
    /** Safe internally generated relative content-hash filename. */
    file: string;
    /** SHA-256 of actual emitted bytes, not permission or authorship. */
    sha256: string;
    /** SHA-256 of original acquired bytes before optional subsetting. */
    sourceSha256: string;
    /** Actual emitted byte length, used for preload budgets. */
    bytes: number;
    /** Explicit supported font container format, independently signature checked. */
    format: FontBinaryFormat;
    /** Validated explicit host permission/attribution declaration, retained per asset. */
    license: FontLicense;
    /** Declared variable axes checked against native inspection when requested. */
    axes: FontAxis[];
    /** Optional explicitly chosen borrowed FontTools implementation; no automatic install or remote upload. */
    tool?: {
      /** Explicit inspector kind, fixed to fonttools when recorded. */
      name: 'fonttools';
      /** Observed tool version retained as provenance, not qualification of arbitrary host tooling. */
      version: string;
    };
    /** Explicit finite glyph selection with optional validated language/script attribution. */
    subset?: {
      /** Explicit requested Unicode scalars, at most 65536; coverage verified before/after subsetting. */
      codePoints: number[];
      /** Optional canonical locale hint; not complete linguistic/shaping coverage. */
      language?: string;
      /** Optional four-letter ISO-style script hint; not an inferred glyph table. */
      script?: string;
    };
  }[];
  /** Optional explicit bounded icon records; build permits at most 256. */
  icons: (
    | {
        /** Unique validated asset key across font and icon definitions. */
        key: string;
        /** Explicit font or structured SVG icon kind; never unrestricted HTML. */
        kind: 'svg';
        /** Local mounted public asset URL; never a signed remote download URL. */
        url: string;
        /** Safe internally generated relative content-hash filename. */
        file: string;
        /** SHA-256 of actual emitted bytes, not permission or authorship. */
        sha256: string;
        /** Actual emitted byte length, used for preload budgets. */
        bytes: number;
        /** Validated explicit host permission/attribution declaration, retained per asset. */
        license: FontLicense;
      }
    | {
        /** Unique validated asset key across font and icon definitions. */
        key: string;
        /** Explicit font or structured SVG icon kind; never unrestricted HTML. */
        kind: 'font';
        /** Explicit registered face reference whose emitted glyph coverage must include the icon. */
        fontKey: string;
        /** Explicit scalar glyph requiring verified emitted font coverage. */
        codePoint: number;
      }
  )[];
  /** Explicit deduplicated build suggestions; runtime route selection remains host-owned. */
  preloads: {
    /** Local mounted public asset URL; never a signed remote download URL. */
    url: string;
    /** Explicit font preload MIME hint, not content sniffing or permission. */
    type: string;
    /** Actual emitted byte length, used for preload budgets. */
    bytes: number;
  }[];
}
/** Hash inert asset/manifest content for cache identity, never permission.
 * @param {string | Uint8Array} data - Inert content to hash.
 * @returns {string} Lowercase SHA-256 hex. */
const hash = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');
/** Conservative stable font/icon key syntax used before selecting output filenames. */
const keyPattern = /^[a-z][a-z0-9_-]{0,63}$/;
/** Fixed supported format-to-extension map; no caller-controlled file suffix. */
const extensions = {
  woff2: 'woff2',
  woff: 'woff',
  truetype: 'ttf',
  opentype: 'otf',
};
/** Validate safe-integer build limits before resource acquisition.
 * @param {number} value - Configured or observed integer.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @returns {number} Accepted bound; invalid limits throw RangeError.
 */
function bounded(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError('Font build budget invalid');
  }
  return value;
}
/** Require explicit host redistribution permission and bounded public provenance; this is a host declaration, not legal verification.
 * @param {FontLicense} value - Trusted attribution/license fields, without signed download URLs or raw secret paths.
 * @returns {FontLicense} Copied validated provenance; unknown fields are not retained.
 */
function license(value: FontLicense): FontLicense {
  if (
    !value ||
    value.redistributionAllowed !== true ||
    typeof value.id !== 'string' ||
    !/^[A-Za-z0-9.-]{1,128}$/.test(value.id) ||
    typeof value.attribution !== 'string' ||
    !value.attribution.trim() ||
    value.attribution.length > 2048 ||
    // eslint-disable-next-line no-control-regex -- Intentionally reject control characters in validated font input.
    /[\x00-\x1f\x7f]/.test(value.attribution) ||
    typeof value.source !== 'string' ||
    value.source.length > 2048 ||
    (value.subsettingAllowed !== undefined &&
      typeof value.subsettingAllowed !== 'boolean') ||
    (value.text !== undefined &&
      (typeof value.text !== 'string' || value.text.length > 32768))
  ) {
    throw new TypeError(
      'Explicit redistribution permission/license attribution required'
    );
  }
  if (!/^local:[A-Za-z0-9._/-]{1,256}$/.test(value.source)) {
    let url: URL;
    try {
      url = new URL(value.source);
    } catch {
      throw new TypeError('Invalid attribution source');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new TypeError(
        'Attribution source must not contain credentials/tokens'
      );
    }
  }
  return {
    id: value.id,
    source: value.source,
    attribution: value.attribution,
    redistributionAllowed: true,
    ...(value.subsettingAllowed !== undefined
      ? { subsettingAllowed: value.subsettingAllowed }
      : {}),
    ...(value.text !== undefined ? { text: value.text } : {}),
  };
}
/** Check declared format against a bounded container signature, not complete font parsing/conformance.
 * @param {Uint8Array} bytes - Acquired binary, at least 48 bytes.
 * @param {FontBinaryFormat} format - Explicit supported container type.
 * @returns {void} Mismatched headers reject; optional FontTools owns deeper inspection.
 */
function signature(bytes: Uint8Array, format: FontBinaryFormat) {
  /** Owned bounded source/output byte view used for signature, copying or response assembly. */
  const data = Buffer.from(bytes);
  if (
    !Object.hasOwn(extensions, format) ||
    bytes.length < 48 ||
    !(() => {
      if (format === 'woff2') {
        return data.toString('ascii', 0, 4) === 'wOF2';
      }
      if (format === 'woff') {
        return data.toString('ascii', 0, 4) === 'wOFF';
      }
      if (format === 'opentype') {
        return data.toString('ascii', 0, 4) === 'OTTO';
      }
      return data.readUInt32BE(0) === 0x00010000;
    })()
  ) {
    throw new TypeError('Font container signature/format mismatch');
  }
}
/** Validate unique bounded four-letter axes and sort copied records deterministically.
 * @param {readonly FontAxis[]} input - At most 32 declared axes, default none.
 * @returns {FontAxis[]} Sorted copied axes; actual binary support requires separate inspection.
 */
function axes(input: readonly FontAxis[] = []): FontAxis[] {
  if (!Array.isArray(input) || input.length > 32) {
    throw new TypeError('Axis limit');
  }
  /** Axis tags already accepted in this one declaration; duplicates reject. */
  const seen = new Set<string>();
  return input
    .map((axis: FontAxis) => {
      if (
        !axis ||
        Object.keys(axis).some(
          (key) => !['tag', 'min', 'default', 'max'].includes(key)
        ) ||
        !/^[A-Za-z]{4}$/.test(axis.tag) ||
        seen.has(axis.tag) ||
        [axis.min, axis.default, axis.max].some(
          (v) => !Number.isFinite(v) || Math.abs(v) > 1000000
        ) ||
        axis.min > axis.default ||
        axis.default > axis.max
      ) {
        throw new TypeError('Invalid/duplicate variable axis');
      }
      seen.add(axis.tag);
      return {
        tag: axis.tag,
        min: axis.min,
        default: axis.default,
        max: axis.max,
      };
    })
    .sort((a, b) => (a.tag < b.tag ? -1 : 1));
}
/** Normalize the validated descriptor into its numeric minimum/maximum for overlap checks.
 * @param {BuildFont} font - Validated authored face; default weight 400, normal 400 and bold 700.
 * @returns {number[]} Inclusive minimum/maximum pair; does not alter the font binary.
 */
function weightRange(font: BuildFont) {
  /** Normalized validated weight descriptor before numeric overlap comparison. */
  const text = String(font.weight ?? 400);
  /** Numeric weight endpoints after normal/bold normalization. */
  const values = (() => {
    if (text === 'normal') {
      return [400];
    }
    if (text === 'bold') {
      return [700];
    }
    return text.split(' ').map(Number);
  })();
  return [values[0], values.at(-1)!];
}
/** Build only explicitly licensed assets into a complete private staged candidate. Optional remote/tool work runs only when configured; promotion is same-filesystem with rollback, not a crash-atomic deployment transaction.
 * @param {FontBuildOptions} options - Trusted project/output/public mount, bounded source definitions and optional borrowed transport/tool.
 * @returns {Promise<FontAssetManifest>} Detached deterministic V1 manifest after promotion; pre-promotion failure preserves the old directory, while post-promotion cleanup failure can still report an error.
 */
export async function buildFontAssets(
  options: FontBuildOptions
): Promise<FontAssetManifest> {
  if (
    !options ||
    typeof options.projectRoot !== 'string' ||
    typeof options.outputDir !== 'string' ||
    !Array.isArray(options.fonts) ||
    options.fonts.length > 64 ||
    !Array.isArray(options.icons ?? []) ||
    (options.icons?.length ?? 0) > 256 ||
    (!options.fonts.length && !options.icons?.length)
  ) {
    throw new TypeError('Explicit bounded font/icon definitions required');
  }
  if (
    !/^[A-Za-z0-9_./-]{1,256}$/.test(options.outputDir) ||
    isAbsolute(options.outputDir) ||
    options.outputDir
      .split('/')
      .some((part) => !part || part === '.' || part === '..')
  ) {
    throw new TypeError('Output must stay within the project');
  }
  if (
    typeof options.publicBase !== 'string' ||
    !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(options.publicBase)
  ) {
    throw new TypeError('Canonical absolute public base ending in / required');
  }
  /** Canonical trusted project root; raw source paths are not emitted in the manifest. */
  const root = resolve(options.projectRoot);
  /** Validated same-project destination; promotion stays on its filesystem. */
  const output = join(root, options.outputDir);
  /** Validated per-font byte ceiling, default 8 MiB and ceiling 16 MiB. */
  const maxFile = bounded(
    options.maxFileBytes ?? 8 * 1024 * 1024,
    1,
    16 * 1024 * 1024
  );
  /** Validated whole-candidate output ceiling, default 64 MiB and ceiling 128 MiB. */
  const maxTotal = bounded(
    options.maxTotalBytes ?? 64 * 1024 * 1024,
    1,
    128 * 1024 * 1024
  );
  /** Copied explicit/default preload count/byte budgets; overflow rejects. */
  const preload = {
    ...(options.preload ?? { maxCount: 2, maxBytes: 128 * 1024 }),
  };
  bounded(preload.maxCount, 0, 16);
  bounded(preload.maxBytes, 0, 16 * 1024 * 1024);
  /** Observe caller cancellation at bounded build checkpoints.
   * @returns {void} Throws a fixed cancellation error when already aborted. */
  const cancelled = () => {
    if (options.signal?.aborted) {
      throw new Error('Font build cancelled');
    }
  };
  /** Validate canonical non-symlink directories under the configured root, optionally creating private descendants.
   * @param {string} path - Internal root/descendant path, never arbitrary request input.
   * @param {boolean} create - Create missing private directories when true; defaults false.
   * @returns {Promise<void>} Validated directory; trusted filesystem ownership remains required against ancestor races.
   */
  async function secure(path: string, create = false) {
    if (path !== root && !path.startsWith(root + '/')) {
      throw new Error('Unsafe font output');
    }
    if (create && path !== root) {
      await secure(dirname(path), true);
    }
    if (create) {
      await mkdir(path, { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      });
    }
    /** No-follow directory/file shape and size observation before resource use. */
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await realpath(path)) !== path
    ) {
      throw new Error('Unsafe font directory');
    }
  }
  await secure(root);
  /** Unique asset keys across faces and both icon kinds. */
  const keys = new Set<string>();
  /** Validated face selection ranges used to reject ambiguous overlapping duplicates. */
  const faces: {
    /** Authored validated font family, not an invented installed-font fact. */
    family: string;
    /** Serialized validated face style descriptor, default normal. */
    style: string;
    /** Validated inclusive oblique-angle interval for overlap detection. */
    angles: number[];
    /** Validated inclusive stretch-percentage interval for overlap detection. */
    stretch: number[];
    /** Validated inclusive weight interval for overlap detection. */
    range: number[];
  }[] = [];
  /** Copied validated faces sorted by key before acquisition/emission. */
  const fonts = options.fonts
    .map((input: BuildFont) => {
      if (!input || !keyPattern.test(input.key) || keys.has(input.key)) {
        throw new TypeError('Duplicate font key');
      }
      keys.add(input.key);
      validateFace({ ...input, sources: [] });
      if (
        !input.source ||
        typeof input.source !== 'object' ||
        Object.keys(input.source).length !== 1 ||
        (!('path' in input.source) && !('url' in input.source))
      ) {
        throw new TypeError('Choose one font source');
      }
      if (input.preload !== undefined && typeof input.preload !== 'boolean') {
        throw new TypeError('Invalid preload option');
      }
      if (!Object.hasOwn(extensions, input.format)) {
        throw new TypeError('Unsupported font format');
      }
      /** Numeric face weight interval for duplicate/axis checks. */
      const range = weightRange(input);
      /** NFC/case-normalized identity used only for conservative duplicate detection. */
      const family = input.family.trim().normalize('NFC').toLowerCase();
      /** Validated authored style descriptor before separating angles. */
      const styleText = input.style ?? 'normal';
      /** Validated base style name used in overlap comparisons. */
      const style = styleText.split(' ')[0];
      /** Validated authored oblique angles, with compatible default angle. */
      const angleValues = styleText.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [
        14,
      ];
      /** Ordered style-angle interval used to reject overlapping face selections. */
      const angles =
        style === 'oblique' ? [angleValues[0], angleValues.at(-1)!] : [0, 0];
      /** Fixed named-stretch percentages used only for duplicate interval comparison. */
      const widthNames: Record<string, number> = {
        'ultra-condensed': 50,
        'extra-condensed': 62.5,
        condensed: 75,
        'semi-condensed': 87.5,
        normal: 100,
        'semi-expanded': 112.5,
        expanded: 125,
        'extra-expanded': 150,
        'ultra-expanded': 200,
      };
      /** Validated authored stretch descriptor, default normal. */
      const widthText = input.stretch ?? 'normal';
      /** Normalized stretch percentages for range comparisons. */
      const widths = Object.hasOwn(widthNames, widthText)
        ? [widthNames[widthText]]
        : widthText.split(' ').map(parseFloat);
      /** Inclusive stretch interval used with weight/style/family duplicate checks. */
      const stretch = [widths[0], widths.at(-1)!];
      if (
        faces.some(
          (face) =>
            face.family === family &&
            face.style === style &&
            face.angles[0] <= angles[1] &&
            angles[0] <= face.angles[1] &&
            face.stretch[0] <= stretch[1] &&
            stretch[0] <= face.stretch[1] &&
            face.range[0] <= range[1] &&
            range[0] <= face.range[1]
        )
      ) {
        throw new TypeError('Overlapping duplicate family/weight/style');
      }
      faces.push({ family, range, style, angles, stretch });
      /** Sorted validated copied axis declarations requiring an explicit inspector. */
      const declaredAxes = axes(input.axes);
      if (
        (declaredAxes.length || input.subset) &&
        (!options.tool || options.tool.name !== 'fonttools')
      ) {
        throw new Error('Explicit FontTools tool required for axes/subsetting');
      }
      /** Optional declared native weight axis checked against the face weight range. */
      const wght = declaredAxes.find((a) => a.tag === 'wght');
      if (
        wght &&
        (wght.min < 1 ||
          wght.max > 1000 ||
          range[0] < wght.min ||
          range[1] > wght.max)
      ) {
        throw new TypeError('Weight outside variable axis');
      }
      /** Copied finite glyph request with deduplicated numeric ordering. */
      const subset = input.subset
        ? {
            ...input.subset,
            codePoints: [...new Set(input.subset.codePoints)].sort(
              (a, b) => a - b
            ),
          }
        : undefined;
      if (subset) {
        if (input.license?.subsettingAllowed !== true) {
          throw new Error('Explicit font subsetting permission required');
        }
        if (
          !Array.isArray(input.subset!.codePoints) ||
          !subset.codePoints.length ||
          subset.codePoints.length > 65536 ||
          subset.codePoints.some(
            (cp) =>
              !Number.isSafeInteger(cp) ||
              cp < 0 ||
              cp > 0x10ffff ||
              (cp >= 0xd800 && cp <= 0xdfff)
          ) ||
          (subset.language !== undefined &&
            (typeof subset.language !== 'string' ||
              subset.language.length > 64)) ||
          (subset.script !== undefined &&
            !/^[A-Z][a-z]{3}$/.test(subset.script))
        ) {
          throw new TypeError('Invalid subset coverage request');
        }
        if (subset.language) {
          subset.language = Intl.getCanonicalLocales(subset.language)[0];
        }
      }
      return {
        ...input,
        source: { ...input.source },
        license: license(input.license),
        axes: declaredAxes,
        subset,
      };
    })
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  /** Copied structured font/SVG definitions sorted by key, never remote XML. */
  const icons = (options.icons ?? [])
    .map((icon: BuildIcon) => {
      if (!icon || !keyPattern.test(icon.key) || keys.has(icon.key)) {
        throw new TypeError('Duplicate icon/font key');
      }
      keys.add(icon.key);
      if (icon.kind === 'svg') {
        return {
          ...icon,
          geometry: validateSvgIcon(icon.geometry),
          license: license(icon.license),
        };
      }
      if (
        icon.kind !== 'font' ||
        !fonts.some((font) => font.key === icon.fontKey)
      ) {
        throw new TypeError('Icon font not registered');
      }
      fontIcon(
        icon.codePoint,
        fonts.find((f) => f.key === icon.fontKey)!.family
      );
      if (!options.tool) {
        throw new Error(
          'FontTools coverage inspection required for font icons'
        );
      }
      return { ...icon };
    })
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  /** Copied opt-in trusted transport/origin policy; absent means offline local acquisition only. */
  const remote = options.remote
    ? { ...options.remote, allowedOrigins: [...options.remote.allowedOrigins] }
    : undefined;
  if (
    remote &&
    (!Array.isArray(remote.allowedOrigins) ||
      !remote.allowedOrigins.length ||
      remote.allowedOrigins.length > 32 ||
      remote.allowedOrigins.some((origin) => {
        try {
          /** Parsed approved origin checked for exact HTTPS-origin equality. */
          const u = new URL(origin);
          return u.origin !== origin || u.protocol !== 'https:';
        } catch {
          return true;
        }
      }) ||
      typeof remote.fetch !== 'function')
  ) {
    throw new TypeError('Approved build transport/origins required');
  }
  /** Validated cooperative remote acquisition deadline. */
  const timeout = bounded(remote?.timeoutMs ?? 15000, 1, 120000);
  /** Validated finite manual redirect allowance. */
  const redirects = bounded(remote?.maxRedirects ?? 2, 0, 5);
  /** Read a bounded project-local source or explicitly approved build-time remote binary. Cooperative cancellation/transport settlement retains the build lease until cleanup.
   * @param {BuildFont['source']} source - Exactly one project-relative path or direct HTTPS binary URL; no stylesheet/module execution.
   * @returns {Promise<Uint8Array>} Acquired bounded bytes; remote failures use fixed errors without private URL/cause details.
   */
  async function acquire(source: BuildFont['source']): Promise<Uint8Array> {
    cancelled();
    if ('path' in source) {
      if (
        typeof source.path !== 'string' ||
        !source.path ||
        isAbsolute(source.path) ||
        source.path.split(/[\\/]/).some((p) => !p || p === '..' || p === '.') ||
        source.path.includes('\0') ||
        source.path.length > 2048
      ) {
        throw new TypeError('Font source must be project-relative');
      }
      /** Canonical project-relative source path verified before no-follow opening. */
      const path = resolve(root, source.path);
      if ((await realpath(path)) !== path || !path.startsWith(root + '/')) {
        throw new Error('Unsafe local font path');
      }
      /** Operation-owned exclusive/no-follow file handle, released in finally. */
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        /** No-follow directory/file shape and size observation before resource use. */
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > maxFile) {
          throw new RangeError('Font size limit');
        }
        /** Owned bounded source/output byte view used for signature, copying or response assembly. */
        const data = Buffer.alloc(stat.size + 1);
        let offset = 0;
        // Read one extra byte beyond the observed file size to detect growth before accepting a source.
        while (offset < data.length) {
          cancelled();
          /** Actual local source read size, checked against the observed file length. */
          const { bytesRead } = await handle.read(
            data,
            offset,
            data.length - offset,
            null
          );
          if (!bytesRead) {
            break;
          }
          offset += bytesRead;
        }
        if (offset !== stat.size) {
          throw new Error('Font changed during read');
        }
        return data.subarray(0, offset);
      } finally {
        await handle.close();
      }
    }
    if (!remote) {
      throw new Error('Remote acquisition is not configured');
    }
    if (typeof source.url !== 'string' || source.url.length > 8192) {
      throw new TypeError('Invalid remote font URL');
    }
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      throw new TypeError('Invalid remote font URL');
    }
    /** Owned remote observation controller linked to caller cancellation. */
    const controller = new AbortController();
    /** Abort the owned cooperative remote acquisition scope.
     * @returns {void} Native transport must cooperate; this does not forcibly settle JavaScript. */
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
    }
    /** Owned remote wall timer removed after actual acquisition settlement. */
    const timer = setTimeout(abort, timeout);
    try {
      // Reapprove every redirect destination under one finite cooperative acquisition deadline.
      for (let step = 0; step <= redirects; step++) {
        if (controller.signal.aborted) {
          throw new Error('Font acquisition cancelled');
        }
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.hash ||
          !remote.allowedOrigins.includes(url.origin)
        ) {
          throw new Error('Remote font destination denied');
        }
        /** Native transport response with redirects/encoding/length policy checked before retaining bytes. */
        const response = await remote.fetch(url.href, {
          signal: controller.signal,
          redirect: 'manual',
          credentials: 'omit',
        });
        if (response.redirected) {
          await response.body?.cancel();
          throw new Error('Transport followed an unapproved redirect');
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          if (step === redirects) {
            throw new Error('Font redirect limit');
          }
          /** Redirect Location re-resolved and reapproved on the next finite step. */
          const next = response.headers.get('location');
          if (!next) {
            throw new Error('Missing font redirect');
          }
          url = new URL(next, url);
          continue;
        }
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error('Remote font download failed');
        }
        if (
          response.headers.has('content-encoding') &&
          response.headers.get('content-encoding') !== 'identity'
        ) {
          await response.body.cancel();
          throw new Error('Encoded font downloads unsupported');
        }
        /** Optional advertised source byte length, never a substitute for actual counting. */
        const length = response.headers.get('content-length');
        if (
          length !== null &&
          (!/^\d+$/.test(length) || Number(length) > maxFile)
        ) {
          await response.body.cancel();
          throw new RangeError('Font download size limit');
        }
        /** Owned response reader cancelled/unlocked on all acquisition outcomes. */
        const reader = response.body.getReader();
        /** Request cancellation of the owned reader without exposing native error details.
         * @returns {void} Native cancellation failure is isolated; settlement cleanup retains ownership. */
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        controller.signal.addEventListener('abort', cancel, { once: true });
        let size = 0,
          count = 0;
        /** Copied response chunks bounded by bytes and chunk count. */
        const chunks: Uint8Array[] = [];
        try {
          // Count actual bytes/chunks before retaining them; advertised Content-Length alone is insufficient.
          while (true) {
            if (controller.signal.aborted) {
              throw new Error('Font download cancelled/deadline');
            }
            /** One settled native read observation, validated before retention. */
            const part = await reader.read();
            if (part.done) {
              break;
            }
            size += part.value.length;
            if (size > maxFile || ++count > 65536) {
              throw new RangeError('Font download size limit');
            }
            chunks.push(new Uint8Array(part.value));
          }
          if (controller.signal.aborted) {
            throw new Error('Font download cancelled/deadline');
          }
          if (length !== null && size !== Number(length)) {
            throw new Error('Font download length mismatch');
          }
          /** Owned bounded source/output byte view used for signature, copying or response assembly. */
          const data = new Uint8Array(size);
          let offset = 0;
          // Copy bounded response chunks into an exact-size independent source buffer.
          for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
          }
          return data;
        } finally {
          controller.signal.removeEventListener('abort', cancel);
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      throw new Error('Font redirect limit');
    } catch {
      throw new Error('Build-time font acquisition failed');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  await secure(dirname(output), true);
  try {
    await secure(output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  /** Check native tool output bounds and each declared axis against observed binary support.
   * @param {readonly FontAxis[]} declared - Validated declared axis subset.
   * @param {FontInspection} inspection - Borrowed tool observation with bounded version/cmap metadata.
   * @returns {void} Invalid metadata or axis mismatch rejects before candidate promotion.
   */
  function verifyInspection(
    declared: readonly FontAxis[],
    inspection: FontInspection
  ) {
    /** Validated inspector axes used to check each declared range/default. */
    const actual = axes(inspection.axes);
    if (
      typeof inspection.toolVersion !== 'string' ||
      !/^[0-9][0-9A-Za-z.+-]{0,63}$/.test(inspection.toolVersion) ||
      !Array.isArray(inspection.codePoints) ||
      inspection.codePoints.length > 200000 ||
      inspection.codePoints.some(
        (cp) =>
          !Number.isSafeInteger(cp) ||
          cp < 0 ||
          cp > 0x10ffff ||
          (cp >= 0xd800 && cp <= 0xdfff)
      )
    ) {
      throw new Error('Invalid glyph inspection');
    }
    // Compare every declared axis against native inspection rather than trusting filenames.
    for (const axis of declared) {
      /** Matching observed axis; absence or mismatched bounds reject. */
      const found = actual.find((a) => a.tag === axis.tag);
      if (
        !found ||
        axis.min < found.min ||
        axis.max > found.max ||
        axis.default !== found.default
      ) {
        throw new Error('Declared axis does not match emitted font');
      }
    }
  }
  /** Per-output exclusive private lease; stale ownership is never broken automatically. */
  const lock = join(
    root,
    '.font-build-lock-' + hash(options.outputDir).slice(0, 16)
  );
  await mkdir(lock, { mode: 0o700 }).catch(() => {
    throw new Error('Font output locked');
  });
  /** Owned private sibling candidate directory, promoted only when complete. */
  const staging = join(dirname(output), '.font-stage-' + randomUUID());
  /** Owned rollback directory for the previous output, retained for operator recovery after crashes. */
  const backup = join(dirname(output), '.font-previous-' + randomUUID());
  let promoted = false,
    moved = false,
    total = 0;
  /** Deterministically assembled V1 public provenance/asset records without source secrets. */
  const manifest: FontAssetManifest = {
    schema: 1,
    digest: '',
    css: { file: '', url: '', sha256: '' },
    fonts: [],
    icons: [],
    preloads: [],
  };
  /** Verified emitted cmap sets used to validate registered font glyph icons. */
  const coverage = new Map<string, Set<number>>();
  /** Selected deterministic font-face rules assembled in sorted face order. */
  const css: string[] = [];
  /** Count total output bytes, then write/fsync one exclusive private staging file.
   * @param {string} file - Internally generated content-hash filename or fixed manifest name.
   * @param {Uint8Array | string} data - Trusted emitted bytes/text counted as UTF-8 when textual.
   * @returns {Promise<void>} Owned handle closes after emission; quota/cancellation rejects before further output.
   */
  async function emit(file: string, data: Uint8Array | string) {
    cancelled();
    total +=
      typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (total > maxTotal) {
      throw new RangeError('Total font output limit');
    }
    /** Operation-owned exclusive/no-follow file handle, released in finally. */
    const handle = await open(join(staging, file), 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  try {
    await mkdir(staging, { mode: 0o700 });
    /** Content-hash filenames already emitted; identical bytes share a cache identity. */
    const emitted = new Set<string>();
    // Acquire/verify only explicit sorted faces and deduplicate content-addressed output files.
    for (const font of fonts) {
      let bytes = await acquire(font.source);
      signature(bytes, font.format);
      /** Hash of acquired bytes before optional explicitly approved modification. */
      const sourceSha256 = hash(bytes);
      let inspection: FontInspection | undefined;
      if (options.tool) {
        inspection = await options.tool.inspect(
          bytes,
          font.format,
          options.signal
        );
        verifyInspection(font.axes, inspection);
      }
      if (font.subset) {
        /** Explicit finite glyph list checked in both source and emitted cmap coverage. */
        const required = font.subset.codePoints;
        if (!required.every((cp) => inspection!.codePoints.includes(cp))) {
          throw new Error('Source font lacks requested glyphs');
        }
        bytes = await options.tool!.subset(
          bytes,
          font.format,
          required,
          options.signal
        );
        if (bytes.byteLength > maxFile) {
          throw new RangeError('Subset size limit');
        }
        signature(bytes, font.format);
        inspection = await options.tool!.inspect(
          bytes,
          font.format,
          options.signal
        );
        verifyInspection(font.axes, inspection);
        if (
          !Array.isArray(inspection.codePoints) ||
          !required.every((cp) => inspection!.codePoints.includes(cp))
        ) {
          throw new Error('Subset glyph coverage failed');
        }
      }
      if (inspection) {
        coverage.set(font.key, new Set(inspection.codePoints));
      }
      /** Hash of actual emitted font/SVG bytes, independent of permissions. */
      const sha256 = hash(bytes);
      /** Internally generated SHA-256 filename with fixed format extension. */
      const file = sha256 + '.' + extensions[font.format];
      /** Configured mounted public URL pointing only at locally emitted assets. */
      const url = options.publicBase + file;
      if (!emitted.has(file)) {
        await emit(file, bytes);
        emitted.add(file);
      }
      css.push(
        defineFont({ ...font, sources: [{ url, format: font.format }] })
      );
      manifest.fonts.push({
        key: font.key,
        family: font.family,
        weight: String(font.weight ?? 400),
        style: font.style ?? 'normal',
        url,
        file,
        sha256,
        sourceSha256,
        bytes: bytes.length,
        format: font.format,
        license: font.license,
        axes: font.axes,
        ...(inspection
          ? {
              tool: {
                name: 'fonttools' as const,
                version: inspection.toolVersion,
              },
            }
          : {}),
        ...(font.subset ? { subset: font.subset } : {}),
      });
      if (font.preload && !manifest.preloads.some((item) => item.url === url)) {
        manifest.preloads.push({
          url,
          type: 'font/' + extensions[font.format],
          bytes: bytes.length,
        });
      }
    }
    if (
      manifest.preloads.length > preload.maxCount ||
      manifest.preloads.reduce((sum, item) => sum + item.bytes, 0) >
        preload.maxBytes
    ) {
      throw new RangeError('Font preload budget exceeded');
    }
    // Verify font glyph coverage or emit structured SVG; never interpret raw HTML/XML.
    for (const icon of icons) {
      if (icon.kind === 'font') {
        if (!coverage.get(icon.fontKey)?.has(icon.codePoint)) {
          throw new Error('Icon glyph missing from emitted font');
        }
        manifest.icons.push({
          key: icon.key,
          kind: 'font',
          fontKey: icon.fontKey,
          codePoint: icon.codePoint,
        });
        continue;
      }
      /** Fixed safe SVG serialization from validated structured geometry. */
      const svg = svgIconMarkup(icon.geometry);
      /** Hash of actual emitted font/SVG bytes, independent of permissions. */
      const sha256 = hash(svg);
      /** Internally generated SHA-256 filename with fixed format extension. */
      const file = sha256 + '.svg';
      if (!emitted.has(file)) {
        await emit(file, svg);
        emitted.add(file);
      }
      manifest.icons.push({
        key: icon.key,
        kind: 'svg',
        file,
        url: options.publicBase + file,
        sha256,
        bytes: Buffer.byteLength(svg),
        license: icon.license,
      });
    }
    /** Joined deterministic face CSS referencing only the local public mount. */
    const stylesheet = css.join('\n');
    /** SHA-256 cache identity of exact emitted CSS bytes. */
    const styleHash = hash(stylesheet);
    /** Content-addressed local CSS filename, distinct from mutable manifest.json. */
    const styleFile = styleHash + '.css';
    await emit(styleFile, stylesheet);
    manifest.css = {
      file: styleFile,
      url: options.publicBase + styleFile,
      sha256: styleHash,
    };
    manifest.digest = hash(JSON.stringify(manifest));
    await emit('manifest.json', JSON.stringify(manifest, null, 2));
    cancelled();
    try {
      await secure(output);
      await rename(output, backup);
      moved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    try {
      await rename(staging, output);
      promoted = true;
    } catch (error) {
      if (moved) {
        await rename(backup, output);
      }
      throw error;
    }
    if (moved) {
      await rm(backup, { recursive: true });
    }
    return structuredClone(manifest);
  } finally {
    if (!promoted) {
      await rm(staging, { recursive: true, force: true });
    }
    await rmdir(lock);
  }
}
