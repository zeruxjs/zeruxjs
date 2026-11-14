export type ThemeValue = string | number;
export type ThemeScale = Record<string, ThemeValue>;
export interface ZuixTheme {
  /** Named colors/keywords used by supported color utility families. */
  colors: ThemeScale;
  /** Named lengths used by spacing, dimensions and translation families. */
  spacing: ThemeScale;
  /** Named font-size values. */
  fontSize: ThemeScale;
  /** Named numeric/string font weights. */
  fontWeight: ThemeScale;
  /** Named border radii, including optional DEFAULT key. */
  radius: ThemeScale;
  /** Named min-width breakpoints with supported px/rem/em lengths. */
  screens: ThemeScale;
  /** Named box-shadow values. */
  shadows: ThemeScale;
  /** Named stacking values. */
  zIndex: ThemeScale;
  [key: string]: ThemeScale;
}
export interface ZuixPluginAPI {
  /** Register explicitly trusted plugin utilities.
   * @param {Record<string, Record<string, string | number>>} utilities - Selector-to-declaration records.
   * @returns {void} Adds to this compiler instance only.
   */
  addUtilities(
    utilities: Record<string, Record<string, string | number>>
  ): void;
  /** Register explicitly trusted component declaration records.
   * @param {Record<string, Record<string, string | number>>} components - Selector-to-declaration records.
   * @returns {void} Adds to this compiler instance only.
   */
  addComponents(
    components: Record<string, Record<string, string | number>>
  ): void;
  /** Register trusted authored base CSS without utility-value sanitization.
   * @param {string} css - Host-authored CSS, never visitor input.
   * @returns {void} Appends base CSS in registration order.
   */
  addBase(css: string): void;
  /** Read a dotted path from the resolved theme.
   * @param {string} path - Scale and key path.
   * @param {string} fallback - Value to use when the path is absent.
   * @returns {string} Resolved value or fallback.
   */
  theme(path: string, fallback?: string): string;
}
export type ZuixPlugin = (api: ZuixPluginAPI) => void;
import type { ZuixLimits } from './safety.js';
/** Reusable utility composition for components, document elements and browser states. */
export interface ZuixRecipe {
  /** Trusted application selector; never derived from visitor input. */
  selector: string;
  /** Base utility tokens, including configured prefix. Use selector for state variants. */
  apply: readonly string[];
  /** Optional media query, such as print or (max-width: 700px). */
  media?: string;
  /** Optional feature query, such as (display: grid). */
  supports?: string;
  /** Optional container query. */
  container?: string;
}
export interface ZuixConfig {
  /** Explicit output-only host/renderer manifest; publicPath mounts the shared output directory. */
  buildManifest?: {
    /** Project-relative public manifest destination, validated by the Node output owner. */
    file: string;
    /** Absolute slash-terminated mount for the shared output directory. */
    publicPath: string;
    /** Explicitly enable external file-level maps; disabled by default. */
    sourceMap?: boolean;
    /** Separately opt in to embedding source text; development-only host decision. */
    includeSources?: boolean;
  };
  /** Upper bounds for filesystem scanning and CSS token generation. */
  limits?: ZuixLimits;
  /** Explicit source globs; omission uses the documented finite default extensions. */
  content?: string[];
  /** Source exclusion globs, separate from watcher path-prefix ignores. */
  exclude?: string[];
  /** Project-contained shared stylesheet destination, default zuix.css. */
  output?: string;
  /** Literal base utility prefix required before lookup. */
  prefix?: string;
  /** Mark generated utility declarations important. */
  important?: boolean;
  /** Class selector or prefers-color-scheme condition for dark variants. */
  darkMode?: 'class' | 'media';
  /** Emit the built-in reset unless explicitly false. */
  preflight?: boolean;
  /** Join generated sections without added newlines; not a general CSS optimizer. */
  minify?: boolean;
  /** Literal tokens included even when static scanning does not discover them. */
  safelist?: string[];
  /** Application scale values merged over copied defaults. */
  theme?: Partial<{ [K in keyof ZuixTheme]: ThemeScale }>;
  /** Additional scale values merged after theme values. */
  extend?: Partial<{ [K in keyof ZuixTheme]: ThemeScale }>;
  /** Explicit trusted code invoked per compiler construction; never loaded by package discovery. */
  plugins?: ZuixPlugin[];
  /** Ordered utility recipes, emitted before scanned utility classes. */
  recipes?: readonly ZuixRecipe[];
  /** Emit CSS for each matching source file, with optional shared CSS. */
  perFile?:
    | boolean
    | {
        /** Project-contained destination for generated per-source styles. */
        dir?: string;
        /** Whether per-file builds also emit the shared stylesheet. */
        shared?: boolean;
      };
  /** Reserved compatibility option; generation currently ignores it. Exact duplicate rules are always deduplicated. */
  optimize?: boolean;
  /** Custom reusable animation keyframes (name -> CSS frames body). */
  keyframes?: Record<string, string>;
}
export interface GenerateResult {
  /** Generated stylesheet text. */
  css: string;
  /** Unique tokens in deterministic cascade order. */
  classes: string[];
  /** Unknown or unsafe tokens that produced no rules. */
  unmatched: string[];
}

/** Public styles only; never source filenames, executable handlers or configuration. */
export interface ZuixBuildManifest {
  /** Public output-manifest schema discriminator. */
  version: 1;
  /** Public output-only records without source paths or executable configuration. */
  stylesheets: {
    /** Stable opaque output identity; shared identifies the global stylesheet. */
    id: string;
    /** Mounted public asset URL under the declared public path. */
    url: string;
    /** SHA-256 identity for the exact emitted stylesheet bytes. */
    integrity: string;
    /** Explicitly enable external file-level maps; disabled by default. */
    sourceMap?: string;
  }[];
}
