import type { Declarations } from './utilities.js';
import type { ZuixTheme } from './types.js';
import { safeCssValue } from './safety.js';

/** Deliberately small named families. No resets, plugins or browser globals are installed. */
const families: Record<string, Declarations> = {
  'box-border': { 'box-sizing': 'border-box' },
  'box-content': { 'box-sizing': 'content-box' },
  'flow-root': { display: 'flow-root' },
  'flex-wrap-reverse': { 'flex-wrap': 'wrap-reverse' },
  'self-auto': { 'align-self': 'auto' },
  'self-stretch': { 'align-self': 'stretch' },
  'grid-flow-row': { 'grid-auto-flow': 'row' },
  'grid-flow-col': { 'grid-auto-flow': 'column' },
  'grid-flow-dense': { 'grid-auto-flow': 'dense' },
  'grid-flow-row-dense': { 'grid-auto-flow': 'row dense' },
  'grid-flow-col-dense': { 'grid-auto-flow': 'column dense' },
  'text-start': { 'text-align': 'start' },
  'text-end': { 'text-align': 'end' },
  'whitespace-normal': { 'white-space': 'normal' },
  'whitespace-pre-wrap': { 'white-space': 'pre-wrap' },
  'whitespace-pre-line': { 'white-space': 'pre-line' },
  'whitespace-break-spaces': { 'white-space': 'break-spaces' },
  'break-keep': { 'word-break': 'keep-all' },
  'wrap-anywhere': { 'overflow-wrap': 'anywhere' },
  'decoration-solid': { 'text-decoration-style': 'solid' },
  'decoration-double': { 'text-decoration-style': 'double' },
  'decoration-dotted': { 'text-decoration-style': 'dotted' },
  'decoration-dashed': { 'text-decoration-style': 'dashed' },
  'decoration-wavy': { 'text-decoration-style': 'wavy' },
  'appearance-auto': { appearance: 'auto' },
  'resize-none': { resize: 'none' },
  resize: { resize: 'both' },
  'resize-x': { resize: 'horizontal' },
  'resize-y': { resize: 'vertical' },
  'accent-auto': { 'accent-color': 'auto' },
  'caret-auto': { 'caret-color': 'auto' },
  'outline-solid': { 'outline-style': 'solid' },
  'outline-dashed': { 'outline-style': 'dashed' },
  'outline-dotted': { 'outline-style': 'dotted' },
  'outline-double': { 'outline-style': 'double' },
  'outline-none': { 'outline-style': 'none' },
  'container-inline-size': { 'container-type': 'inline-size' },
};

/** Resolve named layout/typography/form families as inert declarations, validated again before emission.
 * @param {string} name - Base utility token without variants or importance prefix.
 * @param {ZuixTheme} theme - Resolved application-owned scales.
 * @returns {Declarations | undefined} Registered family declarations, or undefined for unsupported/invalid tokens.
 */
export function familyUtility(
  name: string,
  theme: ZuixTheme
): Declarations | undefined {
  if (Object.hasOwn(families, name)) {
    return families[name];
  }
  /** Successful size-family match; its nonoptional capture supplies the width/height value. */
  const size = /^size-(.+)$/.exec(name);
  if (size) {
    /** Required matched theme/arbitrary key; optional captures are not asserted present. */
    const key = size[1]!;
    /** Decoded arbitrary or registered theme value, checked before returning declarations. */
    let value;
    if (key === 'full') {
      value = '100%';
    } else {
      if (key.startsWith('[') && key.endsWith(']')) {
        value = key.slice(1, -1).replace(/_/g, ' ');
      } else {
        if (Object.hasOwn(theme.spacing, key)) {
          value = String(theme.spacing[key]);
        } else {
          value = undefined;
        }
      }
    }
    if (value && safeCssValue(value)) {
      return { width: value, height: value };
    }
  }
  /** Bounded underline/decoration width match, limited to sixteen pixels. */
  const decoration = /^(underline-offset|decoration)-(\d{1,2})$/.exec(name);
  if (decoration && Number(decoration[2]) <= 16) {
    return {
      [decoration[1] === 'decoration'
        ? 'text-decoration-thickness'
        : 'text-underline-offset']: `${Number(decoration[2])}px`,
    };
  }
  /** Positive fraction syntax for width, height or flex basis. */
  const fraction = /^(w|h|basis)-(\d{1,3})\/(\d{1,3})$/.exec(name);
  if (fraction) {
    /** Matched fraction numerator; zero and ratios greater than one reject. */
    const numerator = Number(fraction[2]);
    /** Matched fraction denominator; zero rejects before CSS generation. */
    const denominator = Number(fraction[3]);
    if (!numerator || !denominator || numerator > denominator) {
      return;
    }
    /** Native CSS property selected only from the matched family allowlist. */
    const property = { w: 'width', h: 'height', basis: 'flex-basis' }[
      fraction[1] as 'w' | 'h' | 'basis'
    ];
    return { [property]: `calc(${numerator} / ${denominator} * 100%)` };
  }
  /** Accent/caret family match whose value remains subject to restricted CSS validation. */
  const color = /^(accent|caret)-(.+)$/.exec(name);
  if (color) {
    /** Required matched theme/arbitrary key; optional captures are not asserted present. */
    const key = color[2]!;
    /** Decoded arbitrary or registered theme value, checked before returning declarations. */
    let value;
    if (key.startsWith('[') && key.endsWith(']')) {
      value = key.slice(1, -1).replace(/_/g, ' ');
    } else {
      if (Object.hasOwn(theme.colors, key)) {
        value = String(theme.colors[key]);
      } else {
        value = undefined;
      }
    }
    if (value && safeCssValue(value)) {
      return { [`${color[1]!}-color`]: value };
    }
  }
}
