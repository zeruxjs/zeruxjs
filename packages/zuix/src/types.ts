export type ThemeValue = string | number;
export type ThemeScale = Record<string, ThemeValue>;
export interface ZuixTheme {
  colors: ThemeScale;
  spacing: ThemeScale;
  fontSize: ThemeScale;
  fontWeight: ThemeScale;
  radius: ThemeScale;
  screens: ThemeScale;
  shadows: ThemeScale;
  zIndex: ThemeScale;
  [key: string]: ThemeScale;
}
export interface ZuixPluginAPI {
  addUtilities(utilities: Record<string, Record<string, string | number>>): void;
  addComponents(components: Record<string, Record<string, string | number>>): void;
  addBase(css: string): void;
  theme(path: string, fallback?: string): string;
}
export type ZuixPlugin = (api: ZuixPluginAPI) => void;
export interface ZuixConfig {
  content?: string[];
  exclude?: string[];
  output?: string;
  prefix?: string;
  important?: boolean;
  darkMode?: 'class' | 'media';
  preflight?: boolean;
  minify?: boolean;
  safelist?: string[];
  theme?: Partial<{[K in keyof ZuixTheme]: ThemeScale}>;
  extend?: Partial<{[K in keyof ZuixTheme]: ThemeScale}>;
  plugins?: ZuixPlugin[];
  /** Emit CSS for each matching source file, with optional shared CSS. */
  perFile?: boolean | {dir?: string; shared?: boolean};
  /** Remove unneeded spaces and group identical declaration blocks. */
  optimize?: boolean;
  /** Custom reusable animation keyframes (name -> CSS frames body). */
  keyframes?: Record<string,string>;
}
export interface GenerateResult { css: string; classes: string[]; unmatched: string[] }
