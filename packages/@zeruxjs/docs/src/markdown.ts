import { Marked } from 'marked';
import {
  imagePolicy,
  renderImage,
  type DocumentationMarkdownOptions,
  type DocumentationImageIssue,
} from './markdown-images.js';
import type { DocumentationCatalog, DocumentationSnapshot } from './index.js';
import {
  escapeHtmlText,
  escapeHtmlAttribute,
  validateNavigationUrl,
} from '@zeruxjs/security/encoding';

/** Render bounded Markdown without raw HTML, scripts or automatically requested remote images.
 * @param {string} body - Inert Markdown text, at most 1 MiB of UTF-16 units.
 * @param {DocumentationMarkdownOptions} [options] - Explicit registered image/origin policy; default images remain inert.
 * @returns {string} HTML fragment; native Markdown links retain a separate HTTP(S)/relative URL policy.
 */
export function renderDocumentationMarkdown(
  body: string,
  options: DocumentationMarkdownOptions = {}
): string {
  return parseMarkdown(body, false, options).html;
}
/** Parse article Markdown with deterministic anchors and a bounded heading inventory.
 * @param {string} body - Inert authored Markdown.
 * @param {boolean} article - Demote body H1 headings below the page-owned H1.
 * @param {DocumentationMarkdownOptions} [options] - Trusted image resource policy; no URL is fetched.
 * @returns {object} Safe HTML, literal links and source-order headings.
 */
function parseMarkdown(
  body: string,
  article: boolean,
  options: DocumentationMarkdownOptions = {}
) {
  if (typeof body !== 'string' || body.length > 1_048_576) {
    throw new RangeError('Documentation Markdown limit');
  }
  /** Each rendering operation owns validated resource policy and private-free diagnostics. */
  const policy = imagePolicy(options);
  /** Reference/issue counts share the page's fixed image ceiling. */
  const imageReferences: string[] = [];
  /** Denied sources stay alternative text and never appear as browser requests. */
  const imageIssues: DocumentationImageIssue[] = [];
  /** Per-document inventories never share mutable state between requests. */
  const headings: { id: string; title: string; level: number }[] = [];
  /** Only literal Markdown link destinations participate in release diagnostics. */
  const links: string[] = [];
  /** Collision counters produce stable anchors for repeated multilingual headings. */
  const ids = new Map<string, number>();
  let quoteDepth = 0;
  let codeBlocks = 0;
  /** Per-call parser avoids shared mutable plugin/renderer configuration. */
  const parser: Marked = new Marked({
    gfm: true,
    async: false,
    renderer: {
      /** Render fenced code as escaped data with a nonexecuting language label.
       * @param {import('marked').Tokens.Code} token - Authored code token; no compiler or highlighter runs.
       * @returns {string} Native pre/code markup, optionally enhanced by /browser copy controls.
       */
      code({ text, lang }) {
        if (++codeBlocks > 200) {
          throw new RangeError('Documentation code-block limit');
        }
        /** Language hints are simple identifiers, never module names to import. */
        const language = /^[a-zA-Z0-9_+-]{1,32}$/.test(lang ?? '')
          ? lang!
          : 'text';
        return `<figure class="zerux-docs-code"><figcaption>${escapeHtmlText(language)}</figcaption><pre data-docs-code tabindex="0"><code class="language-${escapeHtmlAttribute(language)}">${escapeHtmlText(text)}</code></pre></figure>`;
      },
      /** Render familiar GFM notice blockquotes as native inert asides.
       * @param {import('marked').Tokens.Blockquote} token - Authored quote tokens.
       * @returns {string} Bounded nested Markdown; no stored callbacks or HTML are evaluated.
       */
      blockquote({ text, tokens }): string {
        if (++quoteDepth > 16) {
          quoteDepth--;
          throw new RangeError('Documentation quote nesting limit');
        }
        try {
          /** Only the named notice family may select presentation classes/labels. */
          const notice =
            /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s|$)/.exec(text);
          if (!notice) {
            return `<blockquote>${this.parser.parse(tokens)}</blockquote>`;
          }
          return `<aside class="zerux-docs-notice" role="note" aria-label="${notice[1]!.toLowerCase()}"><strong>${notice[1]}</strong>${this.parser.parse(parser.lexer(text.slice(notice[0].length)))}</aside>`;
        } finally {
          quoteDepth--;
        }
      },
      /** Assign source-order anchors; authored body headings cannot duplicate the page H1.
       * @param {import('marked').Tokens.Heading} token - Inert parsed heading.
       * @returns {string} Escaped heading with a deterministic anchor.
       */
      heading({ text, depth, tokens }) {
        if (headings.length >= 4096) {
          throw new RangeError('Documentation heading limit');
        }
        /** Unicode letters/numbers survive; punctuation never becomes HTML syntax. */
        const base =
          text
            .normalize('NFC')
            .toLowerCase()
            .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 96) || 'heading';
        /** Repeated headings retain distinct stable targets within this page. */
        const count = (ids.get(base) ?? 0) + 1;
        ids.set(base, count);
        /** Always append an ordinal so naturally suffixed headings cannot collide. */
        const id = base + '--' + count;
        /** Only level one is demoted; existing section nesting stays intact. */
        const level = article ? Math.max(2, depth) : depth;
        headings.push({ id, title: text, level });
        return article
          ? `<h${level} id="${escapeHtmlAttribute(id)}">${this.parser.parseInline(tokens)}</h${level}>\n`
          : `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
      /** Escape authored HTML tokens instead of treating them as trusted markup.
       * @param {object} token - Maintained parser's literal HTML token.
       * @param {string} token.text - Untrusted source text.
       * @returns {string} Inert displayed HTML spelling.
       */
      html({ text }) {
        return escapeHtmlText(text);
      },
      /** Render images as inert alternative text; no implicit tracking/resource fetch occurs.
       * @param {object} token - Maintained parser image token.
       * @param {string} token.text - Authored alternative text.
       * @returns {string} Escaped image description.
       */
      image({ text, href }) {
        if (imageReferences.length >= 256) {
          throw new RangeError('Documentation image reference limit');
        }
        imageReferences.push(href);
        return renderImage(href, text, policy, imageIssues);
      },
      /** Keep links inert unless their destination passes the navigation URL policy.
       * @param {object} token - Maintained parser link token.
       * @param {string} token.href - Authored navigation destination.
       * @param {import('marked').Token[]} token.tokens - Parsed inline label tokens.
       * @returns {string} Safe link or its inline label when denied.
       */
      link({ href, tokens }) {
        if (links.length >= 4096) {
          throw new RangeError('Documentation link limit');
        }
        links.push(href);
        /** Existing parser owns inline Markdown semantics; raw HTML still uses the escaped renderer above. */
        const label = this.parser.parseInline(tokens);
        try {
          validateNavigationUrl(href, {
            baseUrl: 'https://documentation.invalid/',
          });
        } catch {
          return label;
        }
        return `<a href="${escapeHtmlAttribute(href)}" rel="noopener noreferrer">${label}</a>`;
      },
    },
  });
  return {
    html: parser.parse(body, { async: false }),
    headings,
    links,
    imageReferences,
    imageIssues,
  };
}

/** Render article content with a single page-owned H1 and stable heading links.
 * @param {string} body - Bounded inert Markdown text.
 * @param {DocumentationMarkdownOptions} [options] - Optional version registry and delivery policy.
 * @returns {object} Safe article HTML and detached heading/link inventories.
 */
export function analyzeDocumentationMarkdown(
  body: string,
  options: DocumentationMarkdownOptions = {}
) {
  return parseMarkdown(body, true, options);
}
/** Check literal local page/heading links without fetching URLs or disclosing private content.
 * @param {DocumentationCatalog} catalog - Host-authorized complete catalog.
 * @param {string} version - Exact release to inspect.
 * @param {Omit<DocumentationMarkdownOptions,'images'>} [options] - Host origin/private-image validation policy; registry always comes from the catalog.
 * @returns {object[]} Source-addressable diagnostics; external links are not fetched or certified.
 */
export function validateDocumentationLinks(
  catalog: DocumentationCatalog,
  version: string,
  options: Omit<DocumentationMarkdownOptions, 'images'> = {}
) {
  if (!catalog.versions.includes(version)) {
    throw new TypeError('Unknown documentation release');
  }
  /** Preparse once per page; cross-version links resolve only against explicitly registered pages. */
  const pages = new Map(
    catalog.pages().map((page) => [
      page.url,
      {
        page,
        content: analyzeDocumentationMarkdown(
          (page.cover ? '![](asset:' + page.cover + ')\n\n' : '') + page.body,
          {
            ...options,
            images: catalog.images(page.version),
            includePrivateImages:
              page.access === 'private' &&
              options.includePrivateImages === true,
          }
        ),
      },
    ])
  );
  /** Inert diagnostic codes avoid copying document bodies or outbound credentials. */
  const issues: {
    slug: string;
    code:
      | 'missing-page'
      | 'missing-heading'
      | 'private-target'
      | 'invalid-link'
      | DocumentationImageIssue['code'];
  }[] = [];
  for (const { page, content } of pages.values()) {
    if (page.version !== version) {
      continue;
    }
    for (const issue of content.imageIssues) {
      issues.push({ slug: page.slug, code: issue.code });
    }
    for (const related of page.related ?? []) {
      /** Metadata relationships follow the same public/private boundary as Markdown links. */
      const target = catalog.get(page.version, related);
      if (!target) {
        issues.push({ slug: page.slug, code: 'missing-page' });
      } else if (page.access === 'public' && target.access !== 'public') {
        issues.push({ slug: page.slug, code: 'private-target' });
      }
    }
    for (const href of content.links) {
      try {
        validateNavigationUrl(href, {
          baseUrl: 'https://documentation.invalid' + page.url,
        });
        /** Absolute and protocol-relative destinations are outside local release validation. */
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
          continue;
        }
        /** Resolve relative links against the exact version-owned page URL. */
        const target = new URL(
          href,
          'https://documentation.invalid' + page.url
        );
        if (target.origin !== 'https://documentation.invalid') {
          throw new TypeError('Invalid local link');
        }
        /** Host routes outside the catalog mount are deliberately not certified. */
        if (
          !target.pathname.startsWith(
            catalog.basePath === '/' ? '/' : catalog.basePath + '/'
          )
        ) {
          continue;
        }
        /** Stored canonical page routes always end with a slash. */
        const destination = pages.get(
          target.pathname.endsWith('/')
            ? target.pathname
            : target.pathname + '/'
        );
        if (!destination) {
          issues.push({ slug: page.slug, code: 'missing-page' });
        } else if (
          page.access === 'public' &&
          destination.page.access !== 'public'
        ) {
          issues.push({ slug: page.slug, code: 'private-target' });
        } else if (
          target.hash &&
          !destination.content.headings.some(
            (heading) => heading.id === decodeURIComponent(target.hash.slice(1))
          )
        ) {
          issues.push({ slug: page.slug, code: 'missing-heading' });
        }
      } catch {
        issues.push({ slug: page.slug, code: 'invalid-link' });
      }
    }
  }
  return issues;
}
/** Prepare a detached expanded release only after local link validation succeeds.
 * @param {DocumentationCatalog} catalog - Host-authorized catalog; snapshots may contain private prose.
 * @param {string} version - Release to freeze independently from future shared-part edits.
 * @param {Omit<DocumentationMarkdownOptions,'images'>} [options] - Explicit host image validation policy for the release.
 * @returns {DocumentationSnapshot} Validated one-release data; host owns persistence and approval.
 */
export function createDocumentationRelease(
  catalog: DocumentationCatalog,
  version: string,
  options: Omit<DocumentationMarkdownOptions, 'images'> = {}
): DocumentationSnapshot {
  if (validateDocumentationLinks(catalog, version, options).length) {
    throw new TypeError('Documentation release has invalid local links');
  }
  /** Snapshot data contains no live inheritance or reusable-part references. */
  const snapshot = catalog.snapshot();
  return {
    ...snapshot,
    latest: version,
    versions: snapshot.versions.filter((item) => item.id === version),
  };
}

export type {
  DocumentationMarkdownOptions,
  DocumentationImageIssue,
} from './markdown-images.js';
