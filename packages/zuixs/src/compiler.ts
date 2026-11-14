import { compileRecipes } from './recipes.js';
import { resolveTheme } from './theme.js';
import { utilityFor } from './utilities.js';
import type { Declarations } from './utilities.js';
import type { ZuixConfig, GenerateResult, ZuixPluginAPI } from './types.js';
import {
  cssEscapeClass,
  resolveLimits,
  safeCondition,
  safeDeclaration,
  splitToken,
  balancedSyntax,
} from './safety.js';
/** Optional reset emitted once before plugin bases, keyframes, recipes and generated utilities. */
export const preflight = `*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:currentColor}html{line-height:1.5;-webkit-text-size-adjust:100%;font-family:ui-sans-serif,system-ui,sans-serif}body{margin:0;line-height:inherit}button,input,select,textarea{font:inherit}button{cursor:pointer}img,svg,video,canvas{display:block;max-width:100%}a{color:inherit;text-decoration:inherit}h1,h2,h3,h4,h5,h6,p{margin:0}ol,ul{list-style:none;margin:0;padding:0}`;

/** Return balanced token segments for cascade comparison.
 * @param {string} input - Literal token to split.
 * @returns {string[]} Segments, or an empty list for malformed syntax.
 */
function splitVariants(input: string): string[] {
  return splitToken(input) ?? [];
}
/** Validate an entire declaration record before serializing any of it.
 * @param {Declarations} decls - Resolved native property/value record.
 * @param {boolean} important - Whether to mark every declaration important.
 * @returns {string | undefined} Serialized declarations, or undefined if empty/unsafe.
 */
function cssDeclarations(
  decls: Declarations,
  important: boolean
): string | undefined {
  /** Declaration entries checked together so one unsafe value rejects the whole rule. */
  const entries = Object.entries(decls);
  if (
    !entries.length ||
    entries.some(([prop, val]) => !safeDeclaration(prop, String(val)))
  ) {
    return;
  }
  return entries
    .map(
      ([prop, val]) =>
        `${prop}:${String(val)}${important ? ' !important' : ''};`
    )
    .join('');
}
/** Explicit supported pseudo selectors; own-property lookup excludes inherited names. */
const pseudo: Record<string, string> = {
  'first-letter': '::first-letter',
  'first-line': '::first-line',
  marker: '::marker',
  backdrop: '::backdrop',
  file: '::file-selector-button',
  open: ':is([open],:popover-open)',
  target: ':target',
  only: ':only-child',
  'first-of-type': ':first-of-type',
  'last-of-type': ':last-of-type',
  'only-of-type': ':only-of-type',
  'read-only': ':read-only',
  'read-write': ':read-write',
  autofill: ':autofill',
  indeterminate: ':indeterminate',
  'in-range': ':in-range',
  'out-of-range': ':out-of-range',
  'placeholder-shown': ':placeholder-shown',
  default: ':default',
  optional: ':optional',
  autofocus: ':focus-visible',
  hover: ':hover',
  focus: ':focus',
  'focus-visible': ':focus-visible',
  'focus-within': ':focus-within',
  active: ':active',
  disabled: ':disabled',
  enabled: ':enabled',
  checked: ':checked',
  required: ':required',
  invalid: ':invalid',
  valid: ':valid',
  first: ':first-child',
  last: ':last-child',
  odd: ':nth-child(odd)',
  even: ':nth-child(even)',
  visited: ':visited',
  empty: ':empty',
  before: '::before',
  after: '::after',
  placeholder: '::placeholder',
  selection: '::selection',
};
/** Apply the restricted condition grammar to an arbitrary at-rule value.
 * @param {string} value - Decoded native condition.
 * @returns {boolean} Whether the condition can be serialized.
 */
function safeQuery(value: string): boolean {
  return safeCondition(value);
}
/** Admit a bounded balanced has/not selector argument.
 * @param {string} value - Nested selector literal.
 * @returns {boolean} Whether the supported selector subset admits the value.
 */
function safeSelector(value: string): boolean {
  return (
    balancedSyntax(value) &&
    value.length <= 120 &&
    /^[a-zA-Z0-9.#:[\]_'"()=~+* >|-]+$/.test(value)
  );
}
/** Create a standalone compiler with explicitly trusted plugin registration and no runtime framework dependency.
 * @param {ZuixConfig} config - Application-owned theme, plugins, recipes and resource limits.
 * @returns {object} Compiler configuration, resolved theme and compile/generate methods.
 */
export function createZuix(config: ZuixConfig = {}) {
  /** Resolved per-compiler scales; no network or filesystem access is performed. */
  const theme = resolveTheme(config);
  /** Validated per-compiler token and work budgets. */
  const limits = resolveLimits(config.limits);
  /** Trusted plugin utilities overriding built-in lookups for the same base token. */
  const utilities: Record<string, Declarations> = {};
  /** Trusted plugin component declarations merged after plugin utilities. */
  const components: Record<string, Declarations> = {};
  /** Trusted plugin-authored base CSS emitted before generated rules. */
  const base: string[] = [];
  /** Explicit plugin registration surface; plugins execute as trusted application code. */
  const api: ZuixPluginAPI = {
    /** Register trusted plugin utility declarations before generation.
     * @param {Record<string, Record<string, string | number>>} items - Explicit selectors and native declarations.
     * @returns {void} Updates only this compiler’s plugin registry.
     */
    addUtilities(items) {
      for (const [key, value] of Object.entries(items)) {
        utilities[key.replace(/^\./, '')] = Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, String(v)])
        );
      }
    },
    /** Register trusted plugin component declarations with explicit utility precedence.
     * @param {Record<string, Record<string, string | number>>} items - Explicit selectors and native declarations.
     * @returns {void} Updates only this compiler’s component registry.
     */
    addComponents(items) {
      for (const [key, value] of Object.entries(items)) {
        components[key.replace(/^\./, '')] = Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, String(v)])
        );
      }
    },
    /** Append trusted authored base CSS without treating it as sanitized utility input.
     * @param {string} css - Trusted authored CSS.
     * @returns {void} Base CSS is retained in registration order.
     */
    addBase(css) {
      base.push(css);
    },
    /** Read one resolved theme value using a dotted path.
     * @param {string} path - Scale and key path.
     * @param {string} fallback - String returned for a missing value.
     * @returns {string} Resolved theme value or explicit fallback.
     */
    theme(path, fallback = '') {
      /** Theme path components; split always supplies a first category string, including an empty one. */
      const [category, ...rest] = path.split('.');
      return String(theme[category!]?.[rest.join('.')] ?? fallback);
    },
  };
  for (const plugin of config.plugins ?? []) {
    plugin(api);
  }
  /** Compile one fully supported literal utility/variant chain or reject the whole token.
   * @param {string} token - Literal token; raw visitor input is not a supported source.
   * @returns {string | undefined} Escaped selector/conditions and validated declarations, or undefined.
   */
  function compileClass(token: string): string | undefined {
    if (
      typeof token !== 'string' ||
      !token ||
      token.length > limits.maxTokenLength ||
      // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
      /[\u0000-\u001f\u007f{};\\]/.test(token)
    ) {
      return;
    }
    /** Balanced token segments, or final stylesheet sections in explicit cascade order. */
    const chunks = splitToken(token);
    if (!chunks) {
      return;
    }
    let name = chunks.pop() ?? '';
    /** Variant segments preceding the base utility. */
    const variants = chunks;
    if (config.prefix) {
      if (!name.startsWith(config.prefix)) {
        return;
      }
      name = name.slice(config.prefix.length);
    }
    /** Effective importance from either the token marker or compiler configuration. */
    const important = name.startsWith('!') || Boolean(config.important);
    if (name.startsWith('!')) {
      name = name.slice(1);
    }
    /** Resolved base declarations, still validated before selector serialization. */
    const decl = utilityFor(name, theme, { ...utilities, ...components });
    if (!decl) {
      return;
    }
    /** Validated declaration block or undefined when any declaration rejects. */
    const body = cssDeclarations(decl, important);
    if (!body) {
      return;
    }
    let selector = `.${cssEscapeClass(token)}`;
    /** Conditions wrapped in reverse order to preserve authored variant nesting. */
    const atRules: string[] = [];
    let groupPeer = '';
    for (const variant of variants) {
      if (Object.hasOwn(theme.screens, variant)) {
        /** Registered breakpoint checked for a supported absolute/relative length grammar. */
        const screen = String(theme.screens[variant]);
        if (!/^(?:\d+(?:\.\d+)?)(?:px|rem|em)$/.test(screen)) {
          return;
        }
        atRules.push(`@media (min-width: ${screen})`);
        continue;
      }
      if (variant === 'dark') {
        if (config.darkMode === 'media') {
          atRules.push('@media (prefers-color-scheme: dark)');
        } else {
          selector = `:is(.dark ${selector},[data-theme="dark"] ${selector})`;
        }
        continue;
      }
      if (variant === 'print') {
        atRules.push('@media print');
        continue;
      }
      if (variant === 'motion-reduce') {
        atRules.push('@media (prefers-reduced-motion: reduce)');
        continue;
      }
      if (variant === 'motion-safe') {
        atRules.push('@media (prefers-reduced-motion: no-preference)');
        continue;
      }
      if (variant === 'portrait' || variant === 'landscape') {
        atRules.push(`@media (orientation: ${variant})`);
        continue;
      }
      if (variant === 'motion' || variant === 'hoverable') {
        atRules.push('@media (hover: hover) and (pointer: fine)');
        continue;
      }
      if (variant === 'forced-colors') {
        atRules.push('@media (forced-colors: active)');
        continue;
      }
      if (variant === 'contrast-more' || variant === 'contrast-less') {
        atRules.push(
          `@media (prefers-contrast: ${variant === 'contrast-more' ? 'more' : 'less'})`
        );
        continue;
      }
      if (variant === 'rtl' || variant === 'ltr') {
        selector = `:where([dir="${variant}"]) ${selector}`;
        continue;
      }
      if (variant === 'starting') {
        atRules.push('@starting-style');
        continue;
      }
      if (variant.startsWith('supports-[') && variant.endsWith(']')) {
        /** Decoded condition checked before it can enter an at-rule. */
        const query = variant.slice(10, -1).replace(/_/g, ' ');
        if (!safeQuery(query)) {
          return;
        }
        atRules.push(
          `@supports ${query.startsWith('(') ? query : `(${query})`}`
        );
        continue;
      }
      if (variant.startsWith('media-[') && variant.endsWith(']')) {
        /** Decoded condition checked before it can enter an at-rule. */
        const query = variant.slice(7, -1).replace(/_/g, ' ');
        if (!safeQuery(query)) {
          return;
        }
        atRules.push(
          `@media ${query.startsWith('(') || query === 'print' || query === 'screen' ? query : `(${query})`}`
        );
        continue;
      }
      if (variant.startsWith('container-[') && variant.endsWith(']')) {
        /** Decoded condition checked before it can enter an at-rule. */
        const query = variant.slice(11, -1).replace(/_/g, ' ');
        if (!safeQuery(query)) {
          return;
        }
        atRules.push(
          `@container ${query.startsWith('(') ? query : `(${query})`}`
        );
        continue;
      }
      /** Named container/breakpoint pattern with mandatory bounded name and key captures. */
      const namedContainer = /^cq-([a-zA-Z][\w-]{0,47})-([a-zA-Z0-9]+)$/.exec(
        variant
      );
      if (namedContainer && Object.hasOwn(theme.screens, namedContainer[2]!)) {
        /** Base or matched container name; reserved container keywords reject. */
        const name = namedContainer[1]!;
        /** Registered breakpoint checked for a supported absolute/relative length grammar. */
        const screen = String(theme.screens[namedContainer[2]!]);
        if (
          /^(?:none|and|or|not|initial|inherit|unset|revert|revert-layer)$/i.test(
            name
          ) ||
          !/^\d+(?:\.\d+)?(?:px|rem|em)$/.test(screen)
        ) {
          return;
        }
        atRules.push(`@container ${name} (min-width: ${screen})`);
        continue;
      }
      if (variant.startsWith('cq-')) {
        /** Theme breakpoint key selected only through explicit variant syntax. */
        const key = variant.slice(3);
        if (!Object.hasOwn(theme.screens, key)) {
          return;
        }
        /** Registered breakpoint checked for a supported absolute/relative length grammar. */
        const screen = String(theme.screens[key]);
        if (!/^(?:\d+(?:\.\d+)?)(?:px|rem|em)$/.test(screen)) {
          return;
        }
        atRules.push(`@container (min-width: ${screen})`);
        continue;
      }
      if (variant === 'group-hover' || variant === 'group-focus') {
        groupPeer = `.group:${variant.slice(6)} ` + groupPeer;
        continue;
      }
      if (variant === 'peer-checked' || variant === 'peer-focus') {
        groupPeer = `.peer:${variant.slice(5)} ~ ` + groupPeer;
        continue;
      }
      if (Object.hasOwn(pseudo, variant)) {
        selector += pseudo[variant];
        continue;
      }
      if (variant.startsWith('has-[') && variant.endsWith(']')) {
        /** Restricted has/not selector argument checked independently of the outer token. */
        const nested = variant.slice(5, -1);
        if (!safeSelector(nested)) {
          return;
        }
        selector += `:has(${nested})`;
        continue;
      }
      if (variant.startsWith('not-[') && variant.endsWith(']')) {
        /** Restricted has/not selector argument checked independently of the outer token. */
        const nested = variant.slice(5, -1);
        if (!safeSelector(nested)) {
          return;
        }
        selector += `:not(${nested})`;
        continue;
      }
      if (variant.startsWith('aria-')) {
        /** Bounded ARIA/data attribute suffix, excluding arbitrary attribute syntax. */
        const attr = variant.slice(5);
        if (!/^[a-z-]+$/.test(attr)) {
          return;
        }
        selector += `[aria-${attr}="true"]`;
        continue;
      }
      if (variant.startsWith('data-')) {
        /** Bounded ARIA/data attribute suffix, excluding arbitrary attribute syntax. */
        const attr = variant.slice(5);
        if (!/^[a-z-]+$/.test(attr)) {
          return;
        }
        selector += `[data-${attr}]`;
        continue;
      }
      return;
    }
    selector = groupPeer + selector;
    let rule = `${selector}{${body}}`;
    for (const atRule of atRules.reverse()) {
      rule = `${atRule}{${rule}}`;
    }
    return rule;
  }
  /** Generate deterministic CSS with bounded visits and explicit unsupported-token diagnostics.
   * @param {Iterable<string>} tokens - Finite iterable of literal utility tokens.
   * @returns {GenerateResult} CSS and ordered token lists; resource exhaustion throws.
   */
  function generate(tokens: Iterable<string>): GenerateResult {
    let visits = 0;
    /** Unique class tokens bounded separately from total iterable visits. */
    const classSet = new Set<string>();
    /** Validate token type/length and total visits before growing the unique token set.
     * @param {string} token - Literal utility token.
     * @returns {void} Adds the token or throws a declared resource error.
     */
    const add = (token: string) => {
      if (typeof token !== 'string') {
        throw new Error('zuix: class tokens must be strings');
      }
      if (token.length > limits.maxTokenLength) {
        throw new Error('zuix: maxTokenLength limit exceeded');
      }
      if (++visits > limits.maxClasses * 16) {
        throw new Error('zuix: token iteration limit exceeded');
      }
      classSet.add(token);
      if (classSet.size > limits.maxClasses) {
        throw new Error('zuix: maxClasses limit exceeded');
      }
    };
    for (const token of tokens) {
      add(token);
    }
    for (const token of config.safelist ?? []) {
      add(token);
    }
    /** Base utilities precede variants; larger min-width breakpoints override smaller ones.
     * @param {string} token - Class token.
     * @returns {number[]} Cascade ordering tuple computed from resolved theme only.
     */
    const cascadeOrder = (token: string): number[] => {
      /** Variant segments preceding the base utility. */
      const variants = splitVariants(token).slice(0, -1);
      /** Normalized responsive widths; max-width conditions use negative widths for reverse ordering. */
      const widths = variants.flatMap((variant) => {
        if (variant.startsWith('media-[')) {
          /** Decoded condition checked before it can enter an at-rule. */
          const query = variant.slice(7, -1).replace(/_/g, ' ');
          /** Successful native width match with required numeric/unit captures. */
          const match = /\b(min|max)-width:\s*(\d+(?:\.\d+)?)(px|rem|em)/.exec(
            query
          );
          if (match) {
            return [
              Number(match[2]) *
                (match[3] === 'px' ? 1 : 16) *
                (match[1] === 'max' ? -1 : 1),
            ];
          }
        }
        /** Named-container breakpoint match with a required key capture. */
        const named = /^cq-[a-zA-Z][\w-]{0,47}-([a-zA-Z0-9]+)$/.exec(variant);
        /** Theme breakpoint key selected only through explicit variant syntax. */
        let key;
        if (named && Object.hasOwn(theme.screens, named[1]!)) {
          key = named[1]!;
        } else {
          if (variant.startsWith('cq-')) {
            key = variant.slice(3);
          } else {
            key = variant;
          }
        }
        /** Registered breakpoint checked for a supported absolute/relative length grammar. */
        const screen = theme.screens[key];
        if (screen === undefined) {
          return [];
        }
        /** Successful native width match with required numeric/unit captures. */
        const match = /^(\d+(?:\.\d+)?)(px|rem|em)$/.exec(String(screen));
        return match ? [Number(match[1]) * (match[2] === 'px' ? 1 : 16)] : [];
      });
      return [
        widths.length ? 1 : 0,
        widths.length ? Math.max(...widths) : 0,
        variants.length,
      ];
    };
    /** Unique nonempty tokens sorted by responsive precedence then literal lexical order. */
    const classes = [...classSet].filter(Boolean).sort((a, b) => {
      /** First fixed-length cascade tuple in the deterministic token comparator. */
      const first = cascadeOrder(a);
      /** Second fixed-length cascade tuple with the same three positions. */
      const second = cascadeOrder(b);
      for (let index = 0; index < first.length; index++) {
        if (first[index] !== second[index]) {
          return first[index]! - second[index]!;
        }
      }
      if (a < b) {
        return -1;
      } else {
        if (a > b) {
          return 1;
        } else {
          return 0;
        }
      }
    });
    /** Unknown or unsafe tokens reported explicitly rather than silently accepted. */
    const unmatched: string[] = [];
    /** Validated per-token rules in established cascade order. */
    const rules: string[] = [];
    for (const name of classes) {
      /** Compiled rule retained only when the entire token is supported. */
      const rule = compileClass(name);
      if (rule) {
        rules.push(rule);
      } else {
        unmatched.push(name);
      }
    }
    // Merge identical declaration blocks only when they occupy the same at-rule context.
    // Never merge distinct declarations or reorder conflicting rules.
    /** Rules with exact duplicate strings removed without reordering conflicts. */
    const merged: string[] = [];
    /** Exact emitted rule strings; differing at-rule contexts remain separate. */
    const seen = new Set<string>();
    for (const rule of rules) {
      if (!seen.has(rule)) {
        seen.add(rule);
        merged.push(rule);
      }
    }
    /** Built-in keyframe bodies emitted only when requested by actual rules. */
    const builtin: Record<string, string> = {
      'zuix-spin': 'to{transform:rotate(360deg)}',
      'zuix-pulse': '50%{opacity:.5}',
      'zuix-bounce':
        '0%,100%{transform:translateY(-25%);animation-timing-function:cubic-bezier(.8,0,1,1)}50%{transform:none;animation-timing-function:cubic-bezier(0,0,.2,1)}',
      'zuix-ping': '75%,100%{transform:scale(2);opacity:0}',
    };
    /** Built-in and explicitly configured keyframes with application overrides. */
    const frames = { ...builtin, ...config.keyframes };
    /** Validated ordered recipe rules preceding explicit utility rules. */
    const recipes = compileRecipes(
      config.recipes ?? [],
      compileClass,
      limits.maxClasses
    );
    /** Recipe/utility text used solely to detect referenced keyframe names. */
    const usedRules = [...recipes, ...merged].join('');
    /** Only referenced keyframe definitions with bounded identifier names. */
    const keyframes = Object.entries(frames)
      .filter(
        ([name]) =>
          /^[a-zA-Z][\w-]{0,79}$/.test(name) &&
          usedRules.includes(name) &&
          new RegExp(
            `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
          ).test(usedRules)
      )
      .map(([name, value]) => `@keyframes ${name}{${value}}`);
    /** Balanced token segments, or final stylesheet sections in explicit cascade order. */
    const chunks = [
      config.preflight === false ? '' : preflight,
      ...base,
      ...keyframes,
      ...recipes,
      ...merged,
    ].filter(Boolean);
    return { css: chunks.join(config.minify ? '' : '\n'), classes, unmatched };
  }

  return { config, theme, compileClass, generate };
}
/** Generate CSS using a fresh per-call standalone compiler.
 * @param {Iterable<string>} classes - Finite literal-token iterable.
 * @param {ZuixConfig} config - Optional application compiler configuration.
 * @returns {string} Generated stylesheet; inspect createZuix().generate for unmatched tokens.
 */
export function generateCSS(
  classes: Iterable<string>,
  config: ZuixConfig = {}
): string {
  return createZuix(config).generate(classes).css;
}
