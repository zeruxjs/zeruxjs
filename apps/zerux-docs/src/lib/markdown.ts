import { Marked } from 'marked';
import { sitePath } from '../site.config.ts';

/** Escape HTML text/attributes. @param {unknown} value Input. @returns {string} Escaped text. No globals. */
export function escape(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]
  );
}
/** Make a stable heading identifier. @param {string} text Heading. @returns {string} URL fragment. No globals. */
export function slugify(text) {
  return (
    Array.from(text.matchAll(/[^<>]+|[<>]/g))
      .reduce(
        (state, token) => {
          if (token[0] === '<') state.tag = true;
          else if (token[0] === '>') state.tag = false;
          else if (!state.tag) state.text += token[0];
          return state;
        },
        { text: '', tag: false }
      )
      .text.toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}
/** Render author-controlled Markdown with raw HTML disabled and safe links.
 * @param {string} source Markdown source. @param {{version:string,sourceUrl?:string}} options Link context.
 * @returns {{html:string,toc:object[]}} Rendered content and table of contents. No environment access.
 */
export function markdown(source, { version, sourceUrl }) {
  /** Heading metadata collected during one parse; never shared between pages. */
  const toc = [],
    seen = new Map();
  /** Separate approved prose URL resolution from text/attribute HTML encoding. */
  const resolve = (href) => {
    if (!href) return '#';
    if (sourceUrl) {
      try {
        /** Standard URL resolution against an explicit source reference; only HTTP(S) reference links survive. */
        const url = new URL(href, sourceUrl);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
      } catch {
        return null;
      }
    }
    if (/^(https?:|mailto:)/i.test(href) || href.startsWith('#')) return href;
    if (href.startsWith('/') && !href.startsWith('//')) return sitePath(href);
    if (/^[a-z0-9-]+\.md(?:#[\w-]+)?$/.test(href)) {
      /** Authored local document identity and optional heading anchor, mounted within this docs version. */
      const [name, fragment] = href.split('#');
      return sitePath(
        `/docs/${version}/${name.slice(0, -3)}/${fragment ? '#' + fragment : ''}`
      );
    }
    throw new Error(`Unsupported documentation link: ${href}`);
  };
  /** Trusted Markdown render callbacks; raw HTML is escaped rather than executed or trusted. */
  const renderer = {
    html({ text }) {
      return escape(text);
    },
    heading({ tokens, depth }) {
      /** Heading text extracted from tokens before stable slug generation. */
      const text = tokens
        .map((token) => token.text ?? token.raw ?? '')
        .join('');
      /** Stable heading slug before duplicate counters are appended. */
      const base = slugify(text),
        count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      /** Per-page unique heading ID; deterministic duplicates retain stable document order. */
      const id = base + (count ? '-' + count : '');
      if (depth <= 3)
        toc.push({ id, title: text.replace(/[`*_]/g, ''), depth });
      /** Articles own their single h1 outside Markdown, so authored headings start at h2. */
      const level = Math.max(2, depth);
      return `<h${level} id="${id}">${this.parser.parseInline(tokens)}<a class="anchor" href="#${id}" aria-label="Link to ${escape(text)}">#</a></h${level}>`;
    },
    code({ text, lang }) {
      /** Display-only language identifier, escaped before it becomes a CSS class. */
      const language = lang?.split(/\s+/)[0] || 'text';
      /** Optional authored code label, escaped before HTML insertion. */
      const title = /title="([^"]+)"/.exec(lang || '')?.[1] || language;
      return `<div class="code-block"><div class="code-bar ui-flex ui-items-center ui-justify-between"><span>${escape(title)}</span><button type="button" class="copy-code" aria-label="Copy code" hidden>Copy</button></div><pre><code class="language-${escape(language)}">${escape(text)}</code></pre></div>`;
    },
    link({ href, title, tokens }) {
      /** Standard URL resolution against an explicit source reference; only HTTP(S) reference links survive. */
      const url = resolve(href);
      if (!url) return this.parser.parseInline(tokens);
      return `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
    },
    image({ href, text }) {
      /** Standard URL resolution against an explicit source reference; only HTTP(S) reference links survive. */
      const url = resolve(href);
      return url
        ? `<img src="${escape(url)}" alt="${escape(text)}" loading="lazy">`
        : escape(text);
    },
  };
  /** Per-document Markdown parser; its callbacks retain only this page’s heading state. */
  const parser = new Marked({ gfm: true, breaks: false, renderer });
  /** Complete rendered article; raw author HTML was escaped by the explicit renderer. */
  const html = parser.parse(source);
  let current;
  let headingIndex = 0;
  for (const token of parser.lexer(source)) {
    if (token.type === 'heading' && token.depth <= 3) {
      current = toc[headingIndex++];
      if (current) current.text = '';
    } else if (current && token.type !== 'code')
      current.text += ' ' + (token.raw || '');
  }
  return { html, toc };
}
