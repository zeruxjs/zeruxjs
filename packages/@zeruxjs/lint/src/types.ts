/** Host-owned engine options; configuration and native fixes are trusted operations. */
export interface LintOptions {
  /** Trusted project root; defaults to process.cwd(). */
  cwd?: string;
  /** Explicitly apply supported fixes; defaults to false and never enables custom-rule rewrites. */
  fix?: boolean;
  /** Explicit files/directories for bounded discovery or native ESLint patterns. */
  files?: string[];
  /** Discovery cap for Prettier/Stylelint; defaults to 10,000, maximum 100,000. */
  maxFiles?: number;
  /** Ask Stylelint to suppress warnings; does not change ESLint or Prettier reporting. */
  quiet?: boolean;
  /** Trusted native engine config path; JavaScript configs/plugins can execute code. */
  configFile?: string;
  /** Stylelint configuration for CSS/SCSS checks; overrides configFile for that engine. */
  cssConfigFile?: string;
}
/** One engine outcome; diagnostics are not safe public HTTP response data. */
export interface LintResult {
  /** Owning native engine for this result. */
  engine: 'eslint' | 'stylelint' | 'prettier';
  /** Engine-reported number of inspected inputs; skipped files do not count. */
  scanned: number;
  /** Error count determining pass/fail; formatting differences are errors in check mode. */
  errors: number;
  /** Warning count, reported separately from errors. */
  warnings: number;
  /** Fix candidates or actual changed files depending on engine and explicit fix mode. */
  changed: number;
  /** Human-readable engine output; may contain source text and private local paths. */
  output: string;
  /** Whether this result has no errors; combined results require every engine to pass. */
  ok: boolean;
}
/** Combined completion record; rejected engine work does not become a passing result. */
export interface CombinedLintResult {
  /** Individual engine results in ESLint, Stylelint, Prettier order. */
  results: LintResult[];
  /** Whether this result has no errors; combined results require every engine to pass. */
  ok: boolean;
  /** Error count determining pass/fail; formatting differences are errors in check mode. */
  errors: number;
  /** Warning count, reported separately from errors. */
  warnings: number;
}
