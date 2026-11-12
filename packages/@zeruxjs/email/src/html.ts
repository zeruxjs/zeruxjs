/** Encode scalar text for HTML text/quoted-attribute contexts only.
 * @param {unknown} value - Candidate scalar or optional width.
 * @returns {string} Escaped string; not a URL/CSS/JavaScript policy or sanitizer.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  );
}
export interface EmailLayoutOptions {
  /** Bounded integer 320–1000, default 600 pixels. */
  maxWidth?: number;
  /** Bounded literal color spelling; defaults to #f5f5f5. */
  background?: string;
  /** Authored ltr/rtl layout direction; default ltr. */
  direction?: 'ltr' | 'rtl';
  /** Authored document language escaped as an HTML attribute; default en. */
  language?: string;
  /** Optional escaped hidden preview text, truncated after encoding. */
  preheader?: string;
}
/** Require a bounded integer email layout width.
 * @param {number} value - Candidate scalar or optional width.
 * @returns {number} Width 320–1000, default 600 pixels.
 */
function width(value?: number) {
  if (value === undefined) {
    return 600;
  }
  if (!Number.isSafeInteger(value) || value < 320 || value > 1000) {
    throw new RangeError('Invalid email width');
  }
  return value;
}
/** Allow only the existing bounded color spelling subset.
 * @param {string} v - Optional bounded background-color spelling.
 * @param {string} fallback - Explicit trusted fallback color, default #f5f5f5.
 * @returns {string} Validated color or explicit fallback; no CSS parser is implied.
 */
function safeColor(v?: string, fallback = '#f5f5f5') {
  if (!v) {
    return fallback;
  }
  if (!/^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})$/.test(v)) {
    throw new TypeError('Invalid background color');
  }
  return v;
}
/** Wrap trusted body markup in presentation tables for mainstream email clients.
 * @param {string} content - Trusted template body HTML; not escaped by the layout wrapper.
 * @param {EmailLayoutOptions} opts - Optional bounded layout settings; default object.
 * @returns {string} Authored HTML wrapper; embedded content must already be trusted/sanitized.
 */
export function createEmailLayout(
  content: string,
  opts: EmailLayoutOptions = {}
): string {
  /** Validated maximum table width used consistently in HTML and inline styles. */
  const w = width(opts.maxWidth);
  /** Validated bounded color spelling, not arbitrary CSS. */
  const background = safeColor(opts.background);
  /** Authored direction defaulting to ltr; caller owns its declared option contract. */
  const direction = opts.direction ?? 'ltr';
  /** Optional escaped preview text; body markup remains separately trusted. */
  const preheader = opts.preheader
    ? `<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${escapeHtml(opts.preheader).slice(0, 400)}</div>`
    : '';
  return `<!doctype html><html lang="${escapeHtml(opts.language ?? 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title></title></head><body style="margin:0;padding:0;width:100%;background-color:${background};" dir="${direction}">${preheader}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;background-color:${background}"><tr><td align="center" valign="top"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${w}" style="border-collapse:collapse;width:100%;max-width:${w}px;"><tr><td>${content}</td></tr></table></td></tr></table></body></html>`;
}
/** Render authored cell markup in explicit presentation-table columns.
 * @param {readonly string[]} cells - One to eight trusted authored cell markup strings.
 * @param {readonly number[]} widths - Optional positive finite relative widths matching the cells.
 * @returns {string} Table HTML; cell content remains trusted authored markup.
 */
export function emailRow(
  cells: readonly string[],
  widths?: readonly number[]
): string {
  if (!cells.length || cells.length > 8) {
    throw new RangeError('Email row requires 1–8 cells');
  }
  if (
    widths &&
    (widths.length !== cells.length ||
      widths.some((w) => !Number.isFinite(w) || w <= 0))
  ) {
    throw new TypeError('Invalid column widths');
  }
  /** Positive finite relative width sum, or equal-width cell count. */
  const total = widths?.reduce((n, w) => n + w, 0) ?? cells.length;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%"><tr>${cells.map((cell, i) => `<td valign="top" width="${Math.round((10000 * (widths?.[i] ?? 1)) / total) / 100}%" style="vertical-align:top">${cell}</td>`).join('')}</tr></table>`;
}
/** Render an escaped text/link button with explicit HTTP(S) URL policy.
 * @param {string} text - Human-visible button text, escaped before rendering.
 * @param {string} url - Absolute HTTP(S) destination; never fetched here.
 * @param {string} background - Validated button background, default #1267dc.
 * @returns {string} Presentation-table link; no remote request occurs.
 */
export function emailButton(
  text: string,
  url: string,
  background = '#1267dc'
): string {
  /** Parsed absolute button destination checked for HTTP(S) before attribute encoding. */
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new TypeError('Invalid email link');
  }
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${safeColor(background, '#1267dc')}" style="padding:12px 22px;border-radius:4px"><a href="${escapeHtml(target.href)}" style="color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:16px;display:inline-block">${escapeHtml(text)}</a></td></tr></table>`;
}
export interface HtmlConversionOptions extends EmailLayoutOptions {
  /** False returns sanitized inline body only; otherwise wraps in the email layout. */
  layout?: boolean;
  /** UTF-8 ceiling 1–10000000, default 1000000 bytes. */
  maxInputBytes?: number;
  /** False removes images; default allows explicitly sanitized img markup. */
  allowImages?: boolean;
  /** False permits only cid image sources; no remote images are fetched here. */
  allowRemoteImages?: boolean;
}
/** Bound UTF-8 input, sanitize supported markup and inline supported styles lazily.
 * @param {string} input - Untrusted HTML string checked against the configured UTF-8 byte ceiling.
 * @param {HtmlConversionOptions} options - Explicit sanitizer/layout bounds and image policy; defaults apply when omitted.
 * @returns {Promise<string>} Sanitized/inlined markup with optional layout; not universal client parity.
 */
export async function convertHtmlToEmail(
  input: string,
  options: HtmlConversionOptions = {}
): Promise<string> {
  /** Validated input UTF-8 byte ceiling before loading converters. */
  const max = options.maxInputBytes ?? 1_000_000;
  if (!Number.isSafeInteger(max) || max < 1 || max > 10_000_000) {
    throw new RangeError('Invalid HTML size bound');
  }
  if (typeof input !== 'string' || Buffer.byteLength(input) > max) {
    throw new RangeError('HTML input too large');
  }
  /** Lazy maintained sanitization and CSS-inlining modules; importing this helper does not load them. */
  const [{ default: sanitizeHtml }, { default: juice }] = await Promise.all([
    import('sanitize-html'),
    import('juice'),
  ]);
  /** Explicit supported HTML subset; optional images are appended separately. */
  const tags = [
    'p',
    'br',
    'div',
    'span',
    'a',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'hr',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'pre',
    'code',
    'small',
    'sup',
    'sub',
    'center',
  ];
  if (options.allowImages !== false) {
    tags.push('img');
  }
  /** Markup stripped to the declared tags/attributes/schemes before CSS inlining. */
  const sanitized = sanitizeHtml(input, {
    allowedTags: tags,
    allowedAttributes: {
      '*': [
        'class',
        'id',
        'style',
        'dir',
        'align',
        'width',
        'height',
        'role',
        'cellpadding',
        'cellspacing',
        'border',
        'bgcolor',
        'valign',
      ],
      a: ['href', 'title', 'target'],
      img: ['src', 'alt', 'width', 'height', 'title'],
    },
    allowedSchemes: ['https', 'http', 'mailto', 'cid'],
    allowedSchemesByTag: {
      img:
        options.allowRemoteImages === false
          ? ['cid']
          : ['https', 'http', 'cid'],
    },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: false,
    parseStyleAttributes: true,
  });
  // Preserve media queries for responsive clients and apply common CSS styles inline.
  /** Sanitized HTML with supported CSS applied inline; media-query preservation is explicit. */
  const inlined = juice(sanitized, {
    applyStyleTags: true,
    removeStyleTags: true,
    preserveMediaQueries: true,
  });
  return options.layout === false
    ? inlined
    : createEmailLayout(inlined, options);
}
/** Convert authored HTML to plain text through the maintained lazy converter.
 * @param {string} html - HTML for the maintained plain-text converter.
 * @returns {Promise<string>} Plain text with images skipped and bounded word wrapping.
 */
export async function plainTextFromHtml(html: string): Promise<string> {
  /** Lazy maintained text converter; no remote fetch or SMTP submission occurs. */
  const { convert } = await import('html-to-text');
  return convert(html, {
    wordwrap: 100,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
    ],
  });
}
