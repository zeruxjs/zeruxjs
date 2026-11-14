import type { ZeruxConfig } from './index.js';
import type { ZeruxRequestContext } from './bootstrap/types.js';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeConfig {
  /** Default preference when no supported cookie value is present. */
  default?: ThemeMode;
  /** Host-selected preference cookie name. */
  cookieName?: string;
  /** Legacy spelling retained for configuration compatibility. */
  disablePrefrenceHeader?: boolean;
  /** Corrected input spelling; the legacy spelling takes precedence. */
  disablePreferenceHeader?: boolean;
  /** Authored theme bootstrap insertion location. */
  scriptPosition?: 'head' | 'body-top' | 'body';
  /** Authored bootstrap script mode. */
  scriptType?: 'module' | 'nomodule';
  /** Authored bootstrap loading attribute. */
  scriptLoadType?: 'async' | 'defer';
}

export interface ResolvedThemeConfig {
  /** Default preference when no supported cookie value is present. */
  default: ThemeMode;
  /** Host-selected preference cookie name. */
  cookieName: string;
  /** Legacy spelling retained for configuration compatibility. */
  disablePrefrenceHeader: boolean;
  /** Authored theme bootstrap insertion location. */
  scriptPosition: 'head' | 'body-top' | 'body';
  /** Authored bootstrap script mode. */
  scriptType: 'module' | 'nomodule';
  /** Authored bootstrap loading attribute. */
  scriptLoadType: 'async' | 'defer';
}

/** Authored mode classes removed before applying the next explicit preference. */
const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];

/** Recognize supported preferences without coercing arbitrary cookie values.
 * @param {unknown} value - Untrusted preference candidate.
 * @returns {boolean} Whether the candidate is light, dark or system.
 */
const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'system';

/** Resolve compatibility spellings and defaults without browser access.
 * @param {ZeruxConfig | null | undefined} config - Optional host configuration.
 * @returns {ResolvedThemeConfig} Resolved theme policy.
 */
const normalizeConfig = (config?: ZeruxConfig | null): ResolvedThemeConfig => {
  /** Host-authored theme settings; defaults below preserve legacy configuration behavior. */
  const theme = (config?.theme ?? {}) as ThemeConfig;

  return {
    default: isThemeMode(theme.default) ? theme.default : 'system',
    cookieName:
      typeof theme.cookieName === 'string' && theme.cookieName.trim()
        ? theme.cookieName.trim()
        : 'theme',
    disablePrefrenceHeader:
      theme.disablePrefrenceHeader ?? theme.disablePreferenceHeader ?? false,
    scriptPosition:
      theme.scriptPosition === 'body-top' || theme.scriptPosition === 'body'
        ? theme.scriptPosition
        : 'head',
    scriptType: theme.scriptType === 'nomodule' ? 'nomodule' : 'module',
    scriptLoadType: theme.scriptLoadType === 'defer' ? 'defer' : 'async',
  };
};

/** Parse a cookie header without executing values; malformed percent encoding remains literal.
 * @param {string | string[] | undefined} value - Native request header or browser cookie string.
 * @returns {Map<string, string>} Last value for each encountered cookie name.
 */
const parseCookieHeader = (value?: string | string[]) => {
  /** Normalized header text, or the first client hint value when repeated. */
  const header = Array.isArray(value) ? value.join(';') : (value ?? '');
  /** Per-call cookie map; preferences are never shared between requests. */
  const cookies = new Map<string, string>();

  for (const part of header.split(';')) {
    /** Cookie name and remaining equals-delimited value fragments; malformed names are skipped. */
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) {
      continue;
    }
    try {
      cookies.set(rawName, decodeURIComponent(rawValue.join('=')));
    } catch {
      cookies.set(rawName, rawValue.join('='));
    }
  }

  return cookies;
};

/** Read an optional browser cookie while remaining import-safe without a DOM.
 * @param {string} name - Configured cookie name.
 * @returns {string | undefined} Stored value, when a document exists.
 */
const browserCookie = (name: string) => {
  if (typeof document === 'undefined') {
    return undefined;
  }
  return parseCookieHeader(document.cookie).get(name);
};

/** Read only the supplied request cookie, without falling back to browser state.
 * @param {ZeruxRequestContext | undefined} context - Borrowed request context.
 * @param {string} name - Configured cookie name.
 * @returns {string | undefined} Request-local preference value.
 */
const requestCookie = (
  context: ZeruxRequestContext | undefined,
  name: string
) => parseCookieHeader(context?.req.headers.cookie).get(name);

/** Distinguish the existing context shape from a direct configuration object.
 * @param {ZeruxRequestContext | ZeruxConfig | undefined} value - Context or configuration candidate.
 * @returns {boolean} Whether request and configuration fields are present.
 */
const isRequestContext = (
  value?: ZeruxRequestContext | ZeruxConfig
): value is ZeruxRequestContext =>
  Boolean(value && 'req' in value && 'config' in value);

/** Select configuration without reading another request’s state.
 * @param {ZeruxRequestContext | ZeruxConfig | undefined} value - Explicit context or configuration.
 * @returns {ZeruxConfig | undefined} Borrowed host configuration.
 */
const resolveConfigInput = (value?: ZeruxRequestContext | ZeruxConfig) =>
  isRequestContext(value) ? value.config : value;

/** Resolve theme defaults without mutating the supplied configuration.
 * @param {ZeruxConfig | null | undefined} config - Optional host configuration.
 * @returns {ResolvedThemeConfig} Fresh resolved theme settings.
 */
export const getThemeConfig = (
  config?: ZeruxConfig | null
): ResolvedThemeConfig => normalizeConfig(config);

/** Resolve an explicit cookie preference, otherwise the configured default.
 * @param {ZeruxRequestContext | ZeruxConfig | undefined} contextOrConfig - Request-local context or direct configuration.
 * @returns {ThemeMode} Supported preference; system is not yet a resolved color.
 */
export const getThemeMode = (
  contextOrConfig?: ZeruxRequestContext | ZeruxConfig
): ThemeMode => {
  /** Explicit request context, if supplied; never an ambient shared request. */
  const context = isRequestContext(contextOrConfig)
    ? contextOrConfig
    : undefined;
  /** Resolved host theme policy used by this operation. */
  const config = normalizeConfig(resolveConfigInput(contextOrConfig));
  /** Cookie preference checked against the supported mode set before use. */
  const value = context
    ? requestCookie(context, config.cookieName)
    : browserCookie(config.cookieName);

  return isThemeMode(value) ? value : config.default;
};

/** Resolve browser media preference or the explicit request client hint.
 * @param {ZeruxRequestContext | undefined} context - Optional request providing a color-scheme client hint.
 * @returns {ResolvedTheme} Dark only for an affirmative preference; otherwise light.
 */
export const getThemeByPrefersColor = (
  context?: ZeruxRequestContext
): ResolvedTheme => {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  /** Borrowed color-scheme client hint; arbitrary header contents are not inserted into markup. */
  const rawHeader = context?.req.headers['sec-ch-prefers-color-scheme'];
  /** Normalized header text, or the first client hint value when repeated. */
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  /** Unquoted lowercase hint used only for a fixed dark/light comparison. */
  const normalized =
    typeof header === 'string' ? header.replace(/"/g, '').toLowerCase() : '';

  return normalized === 'dark' ? 'dark' : 'light';
};

/** Resolve system preference while preserving explicit light/dark choices.
 * @param {ThemeMode} mode - Validated selected mode.
 * @param {ZeruxRequestContext | undefined} context - Optional request hint source.
 * @returns {ResolvedTheme} Concrete color scheme.
 */
export const getResolvedTheme = (
  mode: ThemeMode,
  context?: ZeruxRequestContext
): ResolvedTheme =>
  mode === 'system' ? getThemeByPrefersColor(context) : mode;

/** Return the fixed English label for an authored mode.
 * @param {ThemeMode} mode - Supported mode.
 * @returns {string} Static label; translation remains a host concern.
 */
export const getThemeLabel = (mode: ThemeMode): string =>
  ({
    system: 'System',
    dark: 'Dark',
    light: 'Light',
  })[mode];

/** Return only package-authored decorative SVG, never caller-supplied markup.
 * @param {ThemeMode | undefined} mode - Optional explicit mode.
 * @param {ZeruxRequestContext | undefined} context - Optional request used when the mode is absent.
 * @returns {string} Fixed decorative SVG for the active preference.
 */
export const getThemeIcon = (
  mode?: ThemeMode,
  context?: ZeruxRequestContext
): string => {
  /** Explicit mode or the validated cookie/default preference. */
  const activeMode = mode ?? getThemeMode(context);
  /** Static authored decorative SVG; no untrusted values are interpolated. */
  const icons: Record<ThemeMode, string> = {
    system: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>`,
    dark: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6.36 6.36 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>`,
    light: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>`,
  };

  return icons[activeMode];
};

/** Apply an explicit browser preference and emit the compatibility change event.
 * @param {ThemeMode} mode - Selected preference; invalid runtime values use the host default.
 * @param {ZeruxConfig | undefined} configInput - Optional host cookie/default settings.
 * @returns {void} Synchronous DOM/cookie update, or no operation without a document.
 */
export const setTheme = (mode: ThemeMode, configInput?: ZeruxConfig): void => {
  if (typeof document === 'undefined') {
    return;
  }

  /** Resolved host theme policy used by this operation. */
  const config = normalizeConfig(configInput);
  /** Validated preference or the configured fallback. */
  const selectedMode = isThemeMode(mode) ? mode : config.default;
  /** Concrete browser scheme applied alongside the selected preference class. */
  const resolvedTheme = getResolvedTheme(selectedMode);
  /** Borrowed root class list; unrelated authored classes are preserved. */
  const classList = document.documentElement.classList;

  classList.remove(...THEME_MODES);
  classList.add(selectedMode);
  if (selectedMode === 'system') {
    classList.add(resolvedTheme);
  }

  document.documentElement.style.colorScheme = resolvedTheme;
  document.cookie = `${encodeURIComponent(config.cookieName)}=${encodeURIComponent(selectedMode)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.dispatchEvent(
    new CustomEvent('zerux:themechange', {
      detail: {
        mode: selectedMode,
        theme: resolvedTheme,
      },
    })
  );
};
