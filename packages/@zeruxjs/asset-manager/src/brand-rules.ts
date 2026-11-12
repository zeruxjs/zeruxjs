import type { Asset } from './types.js';
export type PublicationState = 'draft' | 'review' | 'published' | 'archived';
export interface BrandRules {
  /** Bounded named #RRGGBB/#RRGGBBAA tokens normalized to lowercase. */
  colorTokens?: Record<string, string>;
  /** Explicit usage names referencing declared variants. */
  logoVariants?: Record<string, string>;
  /** Descriptive px/ratio clearances; enforced only by explicit usage validation. */
  safeArea?: {
    /** Explicit px/ratio measurement unit. */
    unit: 'px' | 'ratio';
    /** Required top clearance. */
    top: number;
    /** Required right clearance. */
    right: number;
    /** Required bottom clearance. */
    bottom: number;
    /** Required left clearance. */
    left: number;
  };
  /** Positive minimum rendered pixel dimensions. */
  minimumSize?: {
    /** Explicit px/ratio measurement unit. */
    unit: 'px'; /** Positive rendered pixel width. */
    width: number; /** Positive rendered pixel height. */
    height: number;
  };
  /** Canonical Intl locale names referencing existing variants. */
  localeVariants?: Record<string, string>;
  /** Allowlisted light/dark/highContrast references, never automatic theme selection. */
  themeVariants?: {
    /** Explicit variant used for a host-selected light theme. */
    light?: string; /** Explicit variant used for a host-selected dark theme. */
    dark?: string; /** Explicit variant for a host-selected high-contrast theme. */
    highContrast?: string;
  };
  /** At most 8192 inert text characters; host output sinks must escape them. */
  developerNotes?: string;
  /** Descriptive workflow label; never an access/publication grant. */
  publication?: PublicationState;
}
/** Require bounded plain own-data brand records with explicitly supported keys.
 * @param {unknown} value - Candidate inert brand object.
 * @param {readonly string[]} keys - Optional exact supported field names.
 * @param {number} max - Own-key bound, default 64.
 * @returns {Record<string,unknown>} Accepted record; unknown/prototype/accessor fields reject.
 */
function object(
  value: unknown,
  keys?: readonly string[],
  max = 64
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError('Invalid brand object');
  }
  /** Own-key inventory checked for bounds, prototype keys and executable accessors. */
  const entries = Reflect.ownKeys(value);
  if (
    entries.length > max ||
    entries.some(
      (key) =>
        typeof key !== 'string' ||
        ['__proto__', 'prototype', 'constructor'].includes(key) ||
        (keys && !keys.includes(key)) ||
        !('value' in Object.getOwnPropertyDescriptor(value, key)!)
    )
  ) {
    throw new TypeError('Invalid brand fields');
  }
  return value as Record<string, unknown>;
}
/** Validate finite nonnegative or explicitly positive dimensions.
 * @param {unknown} value - Host-provided dimension.
 * @param {number} max - Inclusive maximum.
 * @param {boolean} positive - Reject zero when true; default false.
 * @returns {number} Accepted measurement within its unit-specific bound.
 */
function number(value: unknown, max: number, positive = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (positive && value === 0)
  ) {
    throw new TypeError('Invalid brand dimension');
  }
  return value;
}
/** Normalize descriptive color/usage/locale/theme/publication data without rendering or enforcing it automatically.
 * @param {BrandRules} value - Untrusted brand rule record.
 * @param {Asset['variants']} variants - Existing validated named asset variants referenced by the rules.
 * @returns {BrandRules} Detached validated brand metadata; notes stay inert text.
 */
export function validateBrandRules(
  value: BrandRules,
  variants: Asset['variants']
): BrandRules {
  /** Validated allowlisted descriptive brand fields; not automatic publication or permission. */
  const input = object(value, [
    'colorTokens',
    'logoVariants',
    'safeArea',
    'minimumSize',
    'localeVariants',
    'themeVariants',
    'developerNotes',
    'publication',
  ]);
  /** Detached normalized descriptive rules with no rendering/evaluation side effects. */
  const result: BrandRules = {};
  /** Require a declared existing variant reference, without choosing or fetching it.
   * @param {unknown} value - Candidate variant name.
   * @returns {string} Registered variant name; missing references reject.
   */
  function reference(value: unknown) {
    if (
      typeof value !== 'string' ||
      !variants ||
      !Object.hasOwn(variants, value)
    ) {
      throw new TypeError('Unknown brand variant reference');
    }
    return value;
  }
  if (input.colorTokens !== undefined) {
    /** Validated bounded color-token record; arbitrary CSS functions/URLs are unavailable. */
    const colors = object(input.colorTokens);
    result.colorTokens = Object.create(null);
    // Normalize only explicitly named literal hex colors; never accept arbitrary CSS.
    for (const [key, color] of Object.entries(colors)) {
      if (
        !/^[a-z][a-z0-9_-]{0,63}$/.test(key) ||
        typeof color !== 'string' ||
        !/^#(?:[a-f0-9]{6}|[a-f0-9]{8})$/i.test(color)
      ) {
        throw new TypeError('Brand colors require #RRGGBB or #RRGGBBAA');
      }
      result.colorTokens![key] = color.toLowerCase();
    }
  }
  if (input.logoVariants !== undefined) {
    result.logoVariants = Object.create(null);
    // Every usage mapping must point to an already declared variant.
    for (const [name, value] of Object.entries(object(input.logoVariants))) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
        throw new TypeError('Invalid logo usage');
      }
      result.logoVariants![name] = reference(value);
    }
  }
  if (input.safeArea !== undefined) {
    /** Explicit safe-area measurements with only declared keys. */
    const area = object(input.safeArea, [
      'unit',
      'top',
      'right',
      'bottom',
      'left',
    ]);
    if (area.unit !== 'px' && area.unit !== 'ratio') {
      throw new TypeError('Invalid safe area unit');
    }
    /** Unit-dependent safe-area maximum: 100000px or ratio 10. */
    const max = area.unit === 'px' ? 100000 : 10;
    result.safeArea = {
      unit: area.unit,
      top: number(area.top, max),
      right: number(area.right, max),
      bottom: number(area.bottom, max),
      left: number(area.left, max),
    };
  }
  if (input.minimumSize !== undefined) {
    /** Explicit positive pixel dimensions, never inferred from binary content. */
    const minimum = object(input.minimumSize, ['unit', 'width', 'height']);
    if (minimum.unit !== 'px') {
      throw new TypeError('Minimum size requires px');
    }
    result.minimumSize = {
      unit: 'px',
      width: number(minimum.width, 100000, true),
      height: number(minimum.height, 100000, true),
    };
  }
  if (input.localeVariants !== undefined) {
    result.localeVariants = Object.create(null);
    // Canonicalize each bounded locale before detecting duplicates and resolving variants.
    for (const [locale, value] of Object.entries(
      object(input.localeVariants)
    )) {
      if (locale.length > 64) {
        throw new TypeError('Invalid brand locale');
      }
      let normalized: string;
      try {
        normalized = Intl.getCanonicalLocales(locale)[0];
      } catch {
        throw new TypeError('Invalid brand locale');
      }
      if (Object.hasOwn(result.localeVariants!, normalized)) {
        throw new TypeError('Duplicate canonical brand locale');
      }
      result.localeVariants![normalized] = reference(value);
    }
  }
  if (input.themeVariants !== undefined) {
    /** Allowlisted theme names referencing existing registered asset variants. */
    const themes = object(input.themeVariants, [
      'light',
      'dark',
      'highContrast',
    ]);
    result.themeVariants = {};
    // Only allowlisted host-selected theme names can reference variants.
    for (const [key, value] of Object.entries(themes)) {
      result.themeVariants[
        key as keyof NonNullable<BrandRules['themeVariants']>
      ] = reference(value);
    }
  }
  if (input.developerNotes !== undefined) {
    if (
      typeof input.developerNotes !== 'string' ||
      input.developerNotes.length > 8192 ||
      input.developerNotes.includes('\0')
    ) {
      throw new TypeError('Invalid developer notes');
    }
    result.developerNotes = input.developerNotes;
  }
  if (input.publication !== undefined) {
    if (
      !['draft', 'review', 'published', 'archived'].includes(
        input.publication as string
      )
    ) {
      throw new TypeError('Invalid publication state');
    }
    result.publication = input.publication as PublicationState;
  }
  return result;
}
/** Explicitly check minimum size/safe area against host measurements. No binary inspection or inferred certification occurs.
 * @param {Asset} asset - Asset whose descriptive rules are validated first.
 * @param {{
    width: number;
    height: number;
    clearance?: { top: number; right: number; bottom: number; left: number };
  }} usage - Host-measured rendered dimensions and optional clearance.
 * @param {number} usage.width - Positive host-measured rendered width.
 * @param {number} usage.height - Positive host-measured rendered height.
 * @param {{top: number, right: number, bottom: number, left: number}|undefined} usage.clearance - Explicit measured clearances required when safe-area rules exist.
 * @param {number} usage.clearance.top - Host-measured top clearance in pixels.
 * @param {number} usage.clearance.right - Host-measured right clearance in pixels.
 * @param {number} usage.clearance.bottom - Host-measured bottom clearance in pixels.
 * @param {number} usage.clearance.left - Host-measured left clearance in pixels.
 * @returns {{code: 'MINIMUM_SIZE'|'SAFE_AREA', path: string}[]} Value-free violations; malformed measurements throw.
 */
export function validateBrandUsage(
  asset: Asset,
  usage: {
    /** Positive rendered pixel width. */
    width: number;
    /** Positive rendered pixel height. */
    height: number;
    clearance?: {
      /** Required top clearance. */
      top: number; /** Required right clearance. */
      right: number; /** Required bottom clearance. */
      bottom: number; /** Required left clearance. */
      left: number;
    };
  }
): { code: 'MINIMUM_SIZE' | 'SAFE_AREA'; path: string }[] {
  /** Validated descriptive rules applied only because this explicit usage check was called. */
  const rules = asset.brand
    ? validateBrandRules(asset.brand, asset.variants)
    : {};
  /** Host-measured positive pixel width. */
  const width = number(usage.width, 100000, true);
  /** Host-measured positive pixel height. */
  const height = number(usage.height, 100000, true);
  /** Value-free usage issue codes/paths, not inferred accessibility or brand certification. */
  const issues: { code: 'MINIMUM_SIZE' | 'SAFE_AREA'; path: string }[] = [];
  if (
    rules.minimumSize &&
    (width < rules.minimumSize.width || height < rules.minimumSize.height)
  ) {
    issues.push({ code: 'MINIMUM_SIZE', path: 'minimumSize' });
  }
  if (rules.safeArea) {
    /** Host-provided measured safe-area distances. */
    const clearance = object(usage.clearance, [
      'top',
      'right',
      'bottom',
      'left',
    ]);
    // Check each explicit safe-area side against host measurements.
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      /** Validated supplied clearance for this side. */
      const actual = number(clearance[side], 100000);
      /** Required side clearance, scaling ratios by the shorter rendered dimension. */
      const required =
        rules.safeArea[side] *
        (rules.safeArea.unit === 'ratio' ? Math.min(width, height) : 1);
      if (actual < required) {
        issues.push({ code: 'SAFE_AREA', path: 'safeArea.' + side });
      }
    }
  }
  return issues;
}
