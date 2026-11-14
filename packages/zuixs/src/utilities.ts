import type { ZuixTheme } from './types.js';
import { safeCssValue, safeDeclaration, splitToken } from './safety.js';
import { familyUtility } from './families.js';
export type Declarations = Record<string, string>;
/** Built-in base declarations; public lookup returns a fresh copy rather than these shared records. */
const staticRules: Record<string, Declarations> = {
  block: { display: 'block' },
  inline: { display: 'inline' },
  'inline-block': { display: 'inline-block' },
  flex: { display: 'flex' },
  'inline-flex': { display: 'inline-flex' },
  grid: { display: 'grid' },
  'inline-grid': { display: 'inline-grid' },
  hidden: { display: 'none' },
  contents: { display: 'contents' },
  flow: { display: 'flow-root' },
  relative: { position: 'relative' },
  absolute: { position: 'absolute' },
  fixed: { position: 'fixed' },
  sticky: { position: 'sticky' },
  static: { position: 'static' },
  'flex-row': { 'flex-direction': 'row' },
  'flex-col': { 'flex-direction': 'column' },
  'flex-row-reverse': { 'flex-direction': 'row-reverse' },
  'flex-col-reverse': { 'flex-direction': 'column-reverse' },
  'flex-wrap': { 'flex-wrap': 'wrap' },
  'flex-nowrap': { 'flex-wrap': 'nowrap' },
  'flex-1': { flex: '1 1 0%' },
  'flex-auto': { flex: '1 1 auto' },
  'flex-none': { flex: 'none' },
  grow: { 'flex-grow': '1' },
  'grow-0': { 'flex-grow': '0' },
  shrink: { 'flex-shrink': '1' },
  'shrink-0': { 'flex-shrink': '0' },
  'items-center': { 'align-items': 'center' },
  'items-start': { 'align-items': 'flex-start' },
  'items-end': { 'align-items': 'flex-end' },
  'items-stretch': { 'align-items': 'stretch' },
  'items-baseline': { 'align-items': 'baseline' },
  'justify-center': { 'justify-content': 'center' },
  'justify-between': { 'justify-content': 'space-between' },
  'justify-around': { 'justify-content': 'space-around' },
  'justify-evenly': { 'justify-content': 'space-evenly' },
  'justify-start': { 'justify-content': 'flex-start' },
  'justify-end': { 'justify-content': 'flex-end' },
  'self-center': { 'align-self': 'center' },
  'self-start': { 'align-self': 'flex-start' },
  'self-end': { 'align-self': 'flex-end' },
  'place-items-center': { 'place-items': 'center' },
  'overflow-hidden': { overflow: 'hidden' },
  'overflow-auto': { overflow: 'auto' },
  'overflow-scroll': { overflow: 'scroll' },
  'overflow-visible': { overflow: 'visible' },
  'overflow-x-auto': { 'overflow-x': 'auto' },
  'overflow-y-auto': { 'overflow-y': 'auto' },
  'cursor-pointer': { cursor: 'pointer' },
  'cursor-default': { cursor: 'default' },
  'cursor-not-allowed': { cursor: 'not-allowed' },
  'pointer-events-none': { 'pointer-events': 'none' },
  'pointer-events-auto': { 'pointer-events': 'auto' },
  'select-none': { 'user-select': 'none' },
  'select-text': { 'user-select': 'text' },
  'sr-only': {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    'white-space': 'nowrap',
    border: '0',
  },
  'not-sr-only': {
    position: 'static',
    width: 'auto',
    height: 'auto',
    padding: '0',
    margin: '0',
    overflow: 'visible',
    clip: 'auto',
    'white-space': 'normal',
  },
  'text-left': { 'text-align': 'left' },
  'text-center': { 'text-align': 'center' },
  'text-right': { 'text-align': 'right' },
  'text-justify': { 'text-align': 'justify' },
  'font-sans': { 'font-family': 'ui-sans-serif,system-ui,sans-serif' },
  'font-serif': { 'font-family': 'ui-serif,Georgia,serif' },
  'font-mono': { 'font-family': 'ui-monospace,monospace' },
  italic: { 'font-style': 'italic' },
  'not-italic': { 'font-style': 'normal' },
  uppercase: { 'text-transform': 'uppercase' },
  lowercase: { 'text-transform': 'lowercase' },
  capitalize: { 'text-transform': 'capitalize' },
  'normal-case': { 'text-transform': 'none' },
  underline: { 'text-decoration-line': 'underline' },
  'no-underline': { 'text-decoration-line': 'none' },
  'line-through': { 'text-decoration-line': 'line-through' },
  truncate: {
    overflow: 'hidden',
    'text-overflow': 'ellipsis',
    'white-space': 'nowrap',
  },
  'whitespace-nowrap': { 'white-space': 'nowrap' },
  'whitespace-pre': { 'white-space': 'pre' },
  'break-all': { 'word-break': 'break-all' },
  'break-words': { 'overflow-wrap': 'break-word' },
  'rounded-none': { 'border-radius': '0' },
  'border-solid': { 'border-style': 'solid' },
  'border-dashed': { 'border-style': 'dashed' },
  'border-none': { 'border-style': 'none' },
  'object-cover': { 'object-fit': 'cover' },
  'object-contain': { 'object-fit': 'contain' },
  'object-fill': { 'object-fit': 'fill' },
  'object-center': { 'object-position': 'center' },
  'w-full': { width: '100%' },
  'h-full': { height: '100%' },
  'w-screen': { width: '100vw' },
  'h-screen': { height: '100vh' },
  'min-h-screen': { 'min-height': '100vh' },
  'max-w-full': { 'max-width': '100%' },
  'w-auto': { width: 'auto' },
  'h-auto': { height: 'auto' },
  'w-fit': { width: 'fit-content' },
  'h-fit': { height: 'fit-content' },
  'aspect-square': { 'aspect-ratio': '1 / 1' },
  'aspect-video': { 'aspect-ratio': '16 / 9' },
  'appearance-none': { appearance: 'none' },
  antialiased: { '-webkit-font-smoothing': 'antialiased' },
  transition: {
    transition:
      'color,background-color,border-color,box-shadow,transform,opacity 150ms ease',
  },
  'transition-all': { transition: 'all 150ms ease' },
  'transition-none': { transition: 'none' },
  transform: { transform: 'translateZ(0)' },
  'animate-spin': { animation: 'zuix-spin 1s linear infinite' },
  'animate-pulse': {
    animation: 'zuix-pulse 2s cubic-bezier(.4,0,.6,1) infinite',
  },
  'container-normal': { 'container-type': 'normal' },
  'container-size': { 'container-type': 'size' },
  'container-inline': { 'container-type': 'inline-size' },
  isolate: { isolation: 'isolate' },
  'isolation-auto': { isolation: 'auto' },
  invisible: { visibility: 'hidden' },
  visible: { visibility: 'visible' },
  'content-auto': { 'content-visibility': 'auto' },
  'content-hidden': { 'content-visibility': 'hidden' },
  'content-visible': { 'content-visibility': 'visible' },
  'overscroll-none': { 'overscroll-behavior': 'none' },
  'overscroll-contain': { 'overscroll-behavior': 'contain' },
  'overscroll-auto': { 'overscroll-behavior': 'auto' },
  'scroll-smooth': { 'scroll-behavior': 'smooth' },
  'scroll-auto': { 'scroll-behavior': 'auto' },
  'snap-x': { 'scroll-snap-type': 'x mandatory' },
  'snap-y': { 'scroll-snap-type': 'y mandatory' },
  'snap-both': { 'scroll-snap-type': 'both mandatory' },
  'snap-none': { 'scroll-snap-type': 'none' },
  'snap-start': { 'scroll-snap-align': 'start' },
  'snap-center': { 'scroll-snap-align': 'center' },
  'snap-end': { 'scroll-snap-align': 'end' },
  'touch-none': { 'touch-action': 'none' },
  'touch-auto': { 'touch-action': 'auto' },
  'touch-pan-x': { 'touch-action': 'pan-x' },
  'touch-pan-y': { 'touch-action': 'pan-y' },
  'touch-manipulation': { 'touch-action': 'manipulation' },
  'text-balance': { 'text-wrap': 'balance' },
  'text-pretty': { 'text-wrap': 'pretty' },
  'text-nowrap': { 'text-wrap': 'nowrap' },
  'text-wrap': { 'text-wrap': 'wrap' },
  'break-normal': { 'overflow-wrap': 'normal', 'word-break': 'normal' },
  'hyphens-auto': { hyphens: 'auto' },
  'hyphens-none': { hyphens: 'none' },
  'writing-vertical-rl': { 'writing-mode': 'vertical-rl' },
  'writing-vertical-lr': { 'writing-mode': 'vertical-lr' },
  'writing-horizontal': { 'writing-mode': 'horizontal-tb' },
  'subgrid-cols': { 'grid-template-columns': 'subgrid' },
  'subgrid-rows': { 'grid-template-rows': 'subgrid' },
  'animate-none': { animation: 'none' },
  'animate-bounce': { animation: 'zuix-bounce 1s infinite' },
  'animate-ping': { animation: 'zuix-ping 1s cubic-bezier(0,0,.2,1) infinite' },
  'transition-discrete': { 'transition-behavior': 'allow-discrete' },
  'backface-hidden': { 'backface-visibility': 'hidden' },
  'backface-visible': { 'backface-visibility': 'visible' },
  'view-transition-none': { 'view-transition-name': 'none' },
  'field-sizing-content': { 'field-sizing': 'content' },
  'field-sizing-fixed': { 'field-sizing': 'fixed' },
  'will-change-auto': { 'will-change': 'auto' },
  'will-change-transform': { 'will-change': 'transform' },
  'will-change-scroll': { 'will-change': 'scroll-position' },
  'color-scheme-light': { 'color-scheme': 'light' },
  'color-scheme-dark': { 'color-scheme': 'dark' },
  'color-scheme-normal': { 'color-scheme': 'normal' },
  'forced-color-adjust-none': { 'forced-color-adjust': 'none' },
  'forced-color-adjust-auto': { 'forced-color-adjust': 'auto' },
  'bg-fixed': { 'background-attachment': 'fixed' },
  'bg-scroll': { 'background-attachment': 'scroll' },
  'bg-local': { 'background-attachment': 'local' },
  'bg-cover': { 'background-size': 'cover' },
  'bg-contain': { 'background-size': 'contain' },
  'bg-center': { 'background-position': 'center' },
  'bg-no-repeat': { 'background-repeat': 'no-repeat' },
  'mix-blend-multiply': { 'mix-blend-mode': 'multiply' },
  'mix-blend-screen': { 'mix-blend-mode': 'screen' },
  'mix-blend-overlay': { 'mix-blend-mode': 'overlay' },
  'backdrop-blur-none': { 'backdrop-filter': 'none' },
  'blur-none': { filter: 'none' },
  table: { display: 'table' },
  'table-row': { display: 'table-row' },
  'table-cell': { display: 'table-cell' },
  'border-collapse': { 'border-collapse': 'collapse' },
  'border-separate': { 'border-collapse': 'separate' },
  'list-none': { 'list-style-type': 'none' },
  'list-disc': { 'list-style-type': 'disc' },
  'list-decimal': { 'list-style-type': 'decimal' },
};
/** Families whose spacing grammar permits an explicit negative value. */
const negativeAllowed = new Set([
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'ms',
  'me',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-x',
  'inset-y',
  'translate-x',
  'translate-y',
]);
/** Decode a bracket value only when restricted CSS validation admits it.
 * @param {string} value - Bracketed literal utility value.
 * @returns {string | undefined} Decoded inert value or undefined for rejected syntax.
 */
function arbitrary(value: string): string | undefined {
  if (!/^\[[^;{}]+\]$/.test(value)) {
    return;
  }
  /** Bracket value with underscore spaces decoded before restricted CSS validation. */
  const decoded = value.slice(1, -1).replace(/_/g, ' ');
  return safeCssValue(decoded) ? decoded : undefined;
}
/** Resolve an arbitrary value before looking up the requested theme scale.
 * @param {ZuixTheme} theme - Resolved application scales.
 * @param {keyof ZuixTheme} group - Requested scale name.
 * @param {string} value - Literal arbitrary or scale key.
 * @returns {string | undefined} Resolved string value, or undefined for an unknown key.
 */
function scale(theme: ZuixTheme, group: keyof ZuixTheme, value: string) {
  return (
    arbitrary(value) ??
    (theme[group]![value] === undefined
      ? undefined
      : String(theme[group]![value]))
  );
}
/** Map a supported spacing prefix to its native property list.
 * @param {string} prefix - Recognized base spacing family.
 * @returns {string[] | undefined} Native properties or undefined for unsupported prefixes.
 */
function spacingProps(prefix: string): string[] | undefined {
  /** Native properties selected by the supported spacing-family prefix. */
  const props: Record<string, string[]> = {
    p: ['padding'],
    px: ['padding-left', 'padding-right'],
    py: ['padding-top', 'padding-bottom'],
    pt: ['padding-top'],
    pr: ['padding-right'],
    pb: ['padding-bottom'],
    pl: ['padding-left'],
    ps: ['padding-inline-start'],
    pe: ['padding-inline-end'],
    m: ['margin'],
    mx: ['margin-left', 'margin-right'],
    my: ['margin-top', 'margin-bottom'],
    mt: ['margin-top'],
    mr: ['margin-right'],
    mb: ['margin-bottom'],
    ml: ['margin-left'],
    ms: ['margin-inline-start'],
    me: ['margin-inline-end'],
    gap: ['gap'],
    'gap-x': ['column-gap'],
    'gap-y': ['row-gap'],
    space: [],
    top: ['top'],
    right: ['right'],
    bottom: ['bottom'],
    left: ['left'],
    inset: ['inset'],
    'inset-x': ['left', 'right'],
    'inset-y': ['top', 'bottom'],
  };
  return props[prefix];
}
/** Construct one declaration record for a set of native properties.
 * @param {string[]} properties - Allowlisted native CSS property names.
 * @param {string} value - Previously resolved value to apply to each property.
 * @returns {Declarations} New declaration record.
 */
function declarations(properties: string[], value: string): Declarations {
  return Object.fromEntries(properties.map((p) => [p, value]));
}
/** Resolve trusted configured utilities, built-ins and bounded named/arbitrary families in precedence order.
 * @param {string} input - Base utility token without variants or importance.
 * @param {ZuixTheme} theme - Resolved application scales.
 * @param {Record<string, Declarations>} additional - Trusted plugin/component declarations, checked before use.
 * @returns {Declarations | undefined} Internal declaration record or undefined for unsupported/unsafe syntax.
 */
function resolveUtility(
  input: string,
  theme: ZuixTheme,
  additional: Record<string, Declarations> = {}
): Declarations | undefined {
  if (typeof input !== 'string' || input.length > 4096 || !splitToken(input)) {
    return;
  }
  if (Object.hasOwn(additional, input)) {
    // The preceding own-property check proves this configured utility exists.
    /** Configured/resolved declaration record; validated before exposing a fresh public copy. */
    const declarations = additional[input]!;
    if (
      Object.entries(declarations).every(([property, value]) =>
        safeDeclaration(property, String(value))
      )
    ) {
      return declarations;
    }
    return;
  }
  if (Object.hasOwn(staticRules, input)) {
    return staticRules[input];
  }
  /** Named layout/typography/form lookup before general theme/arbitrary resolution. */
  const family = familyUtility(input, theme);
  if (family) {
    return family;
  }
  /** Whether the base utility requests a negative numeric/spacing transform. */
  const negative = input.startsWith('-');
  /** Base token after removing only the leading negative marker. */
  const name = negative ? input.slice(1) : input;
  /** Recognized spacing family and mandatory value captures. */
  const spacing =
    /^(inset-x|inset-y|gap-x|gap-y|[pm][xytrblse]?|gap|top|right|bottom|left|inset)-(.+)$/.exec(
      name
    );
  if (spacing) {
    /** Native properties selected by the supported spacing-family prefix. */
    const props = spacingProps(spacing[1]!);
    /** Decoded/theme-derived value subject to restricted declaration validation. */
    let value = scale(theme, 'spacing', spacing[2]!);
    if (value === undefined) {
      if (spacing[2]! === 'auto') {
        value = 'auto';
      } else if (spacing[2]! === 'full') {
        value = '100%';
      }
    }
    if (
      props?.length &&
      value &&
      (!negative || negativeAllowed.has(spacing[1]!))
    ) {
      return declarations(props, negative ? `calc(${value} * -1)` : value);
    }
  }
  /** Allowlisted width/height/flex-basis family match. */
  const dimensions = /^(w|h|min-w|min-h|max-w|max-h|basis)-(.+)$/.exec(name);
  if (dimensions) {
    /** Native dimension property selected from the matched allowlist. */
    const prop = (
      {
        w: 'width',
        h: 'height',
        'min-w': 'min-width',
        'min-h': 'min-height',
        'max-w': 'max-width',
        'max-h': 'max-height',
        basis: 'flex-basis',
      } as Record<string, string>
    )[dimensions[1]!]!;
    /** Resolved theme/arbitrary value; absence leaves the utility unsupported. */
    const v =
      scale(theme, 'spacing', dimensions[2]!) ??
      (
        {
          full: '100%',
          auto: 'auto',
          screen: dimensions[1]!.endsWith('w') ? '100vw' : '100vh',
          min: 'min-content',
          max: 'max-content',
          fit: 'fit-content',
          none: 'none',
        } as Record<string, string>
      )[dimensions[2]!];
    if (v) {
      return { [prop]: v };
    }
  }
  // Resolve ambiguous arbitrary values before color lookup, following utility-first typed hints.
  /** Explicit type hint disambiguating font, border or text arbitrary values. */
  const typed =
    /^(text|border|font)-\[(length|color|family|weight):(.+)\]$/.exec(name);
  if (typed) {
    /** Decoded/theme-derived value subject to restricted declaration validation. */
    const value = arbitrary('[' + typed[3]! + ']');
    /** Native CSS property selected from the matched family/type allowlist. */
    const property = (
      {
        text: { length: 'font-size', color: 'color' },
        border: { length: 'border-width', color: 'border-color' },
        font: { family: 'font-family', weight: 'font-weight' },
      } as Record<string, Record<string, string>>
    )[typed[1]!]![typed[2]!];
    if (value && property) {
      return { [property]: value };
    }
    return;
  }
  /** Untyped arbitrary text/border candidate tested as a length before color lookup. */
  const sized = /^(text|border)-\[(.+)\]$/.exec(name);
  if (sized) {
    /** Decoded/theme-derived value subject to restricted declaration validation. */
    const value = arbitrary('[' + sized[2]! + ']');
    if (
      value &&
      (/^(?:\d*\.)?\d+(?:px|rem|em|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb|cqmin|cqmax|pt|pc|in|cm|mm|q|%)$/i.test(
        value
      ) ||
        /^(?:calc|min|max|clamp)\(/.test(value))
    ) {
      return { [sized[1]! === 'text' ? 'font-size' : 'border-width']: value };
    }
  }
  /** Matched color family and mandatory key, with optional opacity outside brackets. */
  const color =
    /^(bg|text|border|ring|fill|stroke|decoration|placeholder)-(.+)$/.exec(
      name
    );
  if (color) {
    /** Matched color-property family; arbitrary user property names cannot select this table. */
    const group = color[1]!;
    /** Required matched theme key; optional regex captures retain explicit fallbacks. */
    const key = color[2]!;
    let depth = 0,
      slash = -1;
    for (let i = 0; i < key.length; i++) {
      if (key[i] === '[') {
        depth++;
      } else if (key[i] === ']') {
        depth--;
      } else if (key[i] === '/' && depth === 0) {
        if (slash >= 0) {
          return;
        }
        slash = i;
      }
    }
    /** Color key before any top-level slash opacity suffix. */
    const colorKey = slash < 0 ? key : key.slice(0, slash);
    /** Optional numeric opacity suffix, validated independently of the color value. */
    const opacity = slash < 0 ? undefined : key.slice(slash + 1);
    if (
      opacity !== undefined &&
      (!/^\d{1,3}$/.test(opacity) || Number(opacity) > 100)
    ) {
      return;
    }
    /** Resolved theme/arbitrary value; absence leaves the utility unsupported. */
    const v = scale(theme, 'colors', colorKey);
    if (v) {
      /** Native CSS property selected from the matched family/type allowlist. */
      const property = (
        {
          bg: 'background-color',
          text: 'color',
          border: 'border-color',
          ring: '--zuix-ring-color',
          fill: 'fill',
          stroke: 'stroke',
          decoration: 'text-decoration-color',
          placeholder: '--zuix-placeholder-color',
        } as Record<string, string>
      )[group]!;
      /** Resolved color with an admitted opacity mix, or the original validated value. */
      const colorValue =
        opacity && /^\d+$/.test(opacity)
          ? `color-mix(in srgb, ${v} ${Math.min(100, Number(opacity))}%, transparent)`
          : v;
      return { [property]: colorValue };
    }
  }
  /** Font-weight family match; font-family arbitrary hints are handled earlier. */
  const font = /^font-(.+)$/.exec(name);
  if (font) {
    /** Resolved theme/arbitrary value; absence leaves the utility unsupported. */
    const v = scale(theme, 'fontWeight', font[1]!);
    if (v) {
      return { 'font-weight': v };
    }
  }
  /** Font-size family match after color resolution. */
  const text = /^text-(.+)$/.exec(name);
  if (text) {
    /** Resolved theme/arbitrary value; absence leaves the utility unsupported. */
    const v = scale(theme, 'fontSize', text[1]!);
    if (v) {
      return { 'font-size': v };
    }
  }
  /** Radius match whose optional capture intentionally falls back to DEFAULT. */
  const rounded = /^rounded(?:-(.+))?$/.exec(name);
  if (rounded) {
    /** Resolved theme/arbitrary value; absence leaves the utility unsupported. */
    const v = scale(theme, 'radius', rounded[1] ?? 'DEFAULT');
    if (v) {
      return { 'border-radius': v };
    }
  }
  /** Shadow match whose optional capture intentionally falls back to DEFAULT. */
  const shadow = /^shadow(?:-(.+))?$/.exec(name);
  if (shadow) {
    /** Resolved theme/arbitrary value; absence leaves the utility unsupported. */
    const v = scale(theme, 'shadows', shadow[1] ?? 'DEFAULT');
    if (v) {
      return { 'box-shadow': v };
    }
  }
  /** Z-index scale lookup match. */
  const z = /^z-(.+)$/.exec(name);
  if (z) {
    /** Resolved theme/arbitrary value; absence leaves the utility unsupported. */
    const v = scale(theme, 'zIndex', z[1]!);
    if (v) {
      return { 'z-index': v };
    }
  }
  /** Optional numeric opacity suffix, validated independently of the color value. */
  const opacity = /^opacity-(\d+)$/.exec(name);
  if (opacity && Number(opacity[1]) <= 100) {
    return { opacity: String(Number(opacity[1]) / 100) };
  }
  /** Bounded positive grid column-count match. */
  const columns = /^grid-cols-(\d+)$/.exec(name);
  if (columns && Number(columns[1]) <= 24 && Number(columns[1]) > 0) {
    return { 'grid-template-columns': `repeat(${columns[1]},minmax(0,1fr))` };
  }
  /** Bounded positive grid row-count match. */
  const rows = /^grid-rows-(\d+)$/.exec(name);
  if (rows && Number(rows[1]) <= 24 && Number(rows[1]) > 0) {
    return { 'grid-template-rows': `repeat(${rows[1]},minmax(0,1fr))` };
  }
  /** Grid-column span or explicit full-width match. */
  const span = /^col-span-(\d+|full)$/.exec(name);
  if (span) {
    return {
      'grid-column':
        span[1] === 'full' ? '1 / -1' : `span ${span[1]} / span ${span[1]}`,
    };
  }
  /** Border width match retaining its optional one-pixel default. */
  const border = /^border(?:-(\d+))?$/.exec(name);
  if (border) {
    return { 'border-width': `${border[1] ?? 1}px` };
  }
  /** Line-height lookup match, supporting registered spacing and named ratios. */
  const line = /^leading-(.+)$/.exec(name);
  if (line) {
    /** Named native value scale for this line-height or tracking family. */
    const vals: Record<string, string> = {
      none: '1',
      tight: '1.25',
      snug: '1.375',
      normal: '1.5',
      relaxed: '1.625',
      loose: '2',
    };
    /** Resolved theme/arbitrary value; absence leaves the utility unsupported. */
    const v =
      arbitrary(line[1]!) ??
      vals[line[1]!] ??
      (Object.hasOwn(theme.spacing, line[1]!)
        ? String(theme.spacing[line[1]!])
        : undefined);
    if (v) {
      return { 'line-height': v };
    }
  }
  /** Letter-spacing family match. */
  const tracking = /^tracking-(.+)$/.exec(name);
  if (tracking) {
    /** Named native value scale for this line-height or tracking family. */
    const vals: Record<string, string> = {
      tighter: '-.05em',
      tight: '-.025em',
      normal: '0',
      wide: '.025em',
      wider: '.05em',
      widest: '.1em',
    };
    /** Resolved theme/arbitrary value; absence leaves the utility unsupported. */
    const v = arbitrary(tracking[1]!) ?? vals[tracking[1]!];
    if (v) {
      return { 'letter-spacing': v };
    }
  }
  /** Numeric transition-duration match, expressed in milliseconds. */
  const duration = /^duration-(\d+)$/.exec(name);
  if (duration) {
    return { 'transition-duration': `${duration[1]}ms` };
  }
  /** Numeric rotation match, with the separately parsed negative marker. */
  const rotate = /^rotate-(\d+)$/.exec(name);
  if (rotate) {
    return { transform: `rotate(${negative ? '-' : ''}${rotate[1]}deg)` };
  }
  /** Translate/scale match; numeric scale and spacing translation stay distinct. */
  const transform = /^(translate-[xy]|scale)-(.*)$/.exec(name);
  if (transform) {
    /** Resolved theme/arbitrary value; absence leaves the utility unsupported. */
    let v;
    if (transform[1]! === 'scale') {
      if (/^\d{1,5}(?:\.\d+)?$/.test(transform[2]!)) {
        v = String(Number(transform[2]!) / 100);
      } else {
        v = undefined;
      }
    } else {
      v = scale(theme, 'spacing', transform[2]!);
    }
    if (v) {
      return {
        transform:
          transform[1]! === 'scale'
            ? `scale(${v})`
            : `translate${transform[1]!.endsWith('x') ? 'X' : 'Y'}(${negative ? '-' : ''}${v})`,
      };
    }
  }
  /** Allowlisted native property family requiring a bracketed arbitrary value. */
  const arbitraryGeneric =
    /^(container-name|container|anchor-name|position-anchor|position-area|view-transition-name|scroll-timeline|scroll-timeline-name|scroll-timeline-axis|view-timeline|view-timeline-name|view-timeline-axis|animation-timeline|animation-range|animation-range-start|animation-range-end|animation-duration|animation-delay|animation-direction|animation-fill-mode|animation-iteration-count|animation-play-state|animation-timing-function|transition-behavior|transition-property|transition-duration|transition-delay|transition-timing-function|filter|backdrop-filter|clip-path|mask|mask-image|mask-size|mask-position|mask-repeat|color-scheme|accent-color|caret-color|outline-color|outline-offset|outline-width|outline-style|grid-template-columns|grid-template-rows|grid-area|grid-column|grid-row|object-position|object-fit|aspect-ratio|columns|column-count|column-width|scroll-padding|scroll-margin|text-wrap|text-decoration|text-underline-offset|font-variation-settings|font-feature-settings|font-optical-sizing|font-palette|shape-outside|shape-margin|offset-path|offset-distance|offset-rotate|perspective|perspective-origin|transform-origin|transform-style|rotate|scale|translate)-(.+)$/.exec(
      name
    );
  if (arbitraryGeneric) {
    /** Decoded/theme-derived value subject to restricted declaration validation. */
    const value = arbitrary(arbitraryGeneric[2]!);
    if (value) {
      return { [arbitraryGeneric[1]!]: value };
    }
  }
  /** Recognized numeric/arbitrary timing, blur and outline family match. */
  const values =
    /^(ease|delay|duration|repeat|animate-delay|animate-duration|outline-offset|outline|blur|backdrop-blur)-(.+)$/.exec(
      name
    );
  if (values) {
    // Both captures are mandatory in the successful pattern above.
    /** Both captures are mandatory after the successful family pattern; optional captures elsewhere keep fallbacks. */
    const [, kind, key] = values as unknown as [string, string, string];
    /** Admitted numeric/arbitrary family value before adding its required native unit. */
    const val =
      arbitrary(key) ?? (/^(?:\d+(?:\.\d+)?)$/.test(key) ? key : undefined);
    if (val) {
      if (kind === 'ease') {
        return { 'transition-timing-function': val };
      }
      if (kind === 'delay') {
        return { 'transition-delay': `${val}ms` };
      }
      if (kind === 'duration') {
        return { 'transition-duration': `${val}ms` };
      }
      if (kind === 'repeat') {
        return { 'animation-iteration-count': val };
      }
      if (kind === 'animate-delay') {
        return { 'animation-delay': `${val}ms` };
      }
      if (kind === 'animate-duration') {
        return { 'animation-duration': `${val}ms` };
      }
      if (kind === 'outline-offset') {
        return { 'outline-offset': `${val}px` };
      }
      if (kind === 'outline') {
        return { 'outline-width': `${val}px` };
      }
      if (kind === 'blur' || kind === 'backdrop-blur') {
        return {
          [kind === 'blur' ? 'filter' : 'backdrop-filter']:
            `blur(${/^[0-9.]+$/.test(val) ? val + 'px' : val})`,
        };
      }
    }
  }
  /** Grid line start/end match, distinct from grid gap spacing. */
  const gridGap = /^(col-start|col-end|row-start|row-end)-(\d+|auto)$/.exec(
    name
  );
  if (gridGap) {
    return { [`grid-${gridGap[1]!.replace('col-', 'column-')}`]: gridGap[2]! };
  }
  /** Order/grow/shrink numeric match. */
  const flexOrder = /^(order|grow|shrink)-(\d+)$/.exec(name);
  if (flexOrder) {
    return {
      [flexOrder[1]! === 'order' ? 'order' : `flex-${flexOrder[1]!}`]:
        flexOrder[2]!,
    };
  }
  /** Bracketed animation shorthand match; function/escape restrictions still apply. */
  const anim = /^animate-\[(.+)\]$/.exec(name);
  if (anim) {
    /** Decoded/theme-derived value subject to restricted declaration validation. */
    const value = arbitrary('[' + anim[1] + ']');
    if (value) {
      return { animation: value };
    }
  }
  /** Restricted custom/native arbitrary property syntax; executable legacy properties reject. */
  const arbitraryProperty =
    /^\[((?:--[a-zA-Z_][\w-]*|-?[a-zA-Z][a-zA-Z-]*)):([^;{}]+)\]$/.exec(name);
  if (
    arbitraryProperty &&
    !/^(behavior|-moz-binding)$/i.test(arbitraryProperty[1]!) &&
    safeCssValue(arbitraryProperty[2]!.replace(/_/g, ' '))
  ) {
    return {
      [arbitraryProperty[1]!]: arbitraryProperty[2]!.replace(/_/g, ' '),
    };
  }
  return undefined;
}

/** Expose a fresh validated declaration record without emitting partial or unsafe rules.
 * @param {string} input - Base utility token.
 * @param {ZuixTheme} theme - Resolved application scales.
 * @param {Record<string, Declarations>} additional - Trusted explicitly registered declarations.
 * @returns {Declarations | undefined} Cloned declarations or undefined; returned mutation cannot change built-ins.
 */
export function utilityFor(
  input: string,
  theme: ZuixTheme,
  additional: Record<string, Declarations> = {}
): Declarations | undefined {
  /** Configured/resolved declaration record; validated before exposing a fresh public copy. */
  const declarations = resolveUtility(input, theme, additional);
  if (
    !declarations ||
    !Object.entries(declarations).every(([property, value]) =>
      safeDeclaration(property, String(value))
    )
  ) {
    return;
  }
  return { ...declarations };
}
