export interface LintOptions {
  cwd?: string;
  fix?: boolean;
  files?: string[];
  maxFiles?: number;
  quiet?: boolean;
  configFile?: string;
  /** Stylelint configuration for CSS/SCSS checks; overrides configFile for that engine. */
  cssConfigFile?: string;
}
export interface LintResult {
  engine: 'eslint' | 'stylelint' | 'prettier';
  scanned: number;
  errors: number;
  warnings: number;
  changed: number;
  output: string;
  ok: boolean;
}
export interface CombinedLintResult {
  results: LintResult[];
  ok: boolean;
  errors: number;
  warnings: number;
}
