import {
  escapeHtmlAttribute,
  escapeHtmlText,
} from '@zeruxjs/security/encoding';
import { record, list } from './validation.js';
import { validateImage, type DocumentationImage } from './images.js';

/** Renderer policy is host code/configuration, never inferred from Markdown URLs. */
export interface DocumentationMarkdownOptions {
  /** Explicit version-owned aliases; only asset:alias Markdown references resolve. */
  images?: Readonly<Record<string, DocumentationImage>>;
  /** At most 16 exact HTTPS origins approved for remote browser image requests. */
  allowedImageOrigins?: readonly string[];
  /** Emit srcset/dark picture candidates; defaults true, static legacy adapters can disable it. */
  responsiveImages?: boolean;
  /** Only after host page authorization; actual private asset HTTP access remains host-owned. */
  includePrivateImages?: boolean;
}
/** Fixed issue codes avoid disclosing denied private source URLs. */
export interface DocumentationImageIssue {
  /** Literal source alias, not a resolved private URL. */
  alias: string;
  /** Reason the reference stayed inert alternative text. */
  code:
    | 'unregistered-image'
    | 'private-image'
    | 'image-origin-denied'
    | 'missing-image-alt';
}
/** Prepare a bounded host image policy without fetching resources.
 * @param {DocumentationMarkdownOptions} options - Trusted host options; nested data is still validated.
 * @returns {object} Validated image registry and approved exact origins.
 */
export function imagePolicy(options: DocumentationMarkdownOptions) {
  /** Accessor checks prevent hostile option records from evaluating getters. */
  const input = record(options);
  if (
    input.includePrivateImages !== undefined &&
    typeof input.includePrivateImages !== 'boolean'
  ) {
    throw new TypeError('Invalid private image policy');
  }
  if (
    input.responsiveImages !== undefined &&
    typeof input.responsiveImages !== 'boolean'
  ) {
    throw new TypeError('Invalid responsive image policy');
  }
  /** Registries may include metadata for private pages; only referenced aliases are consumed. */
  const images = input.images === undefined ? {} : record(input.images);
  if (Object.keys(images).length > 1000) {
    throw new RangeError('Documentation image registry limit');
  }
  /** Remote delivery requires explicit origin equality, never suffix/wildcard matching. */
  const origins = new Set(
    (input.allowedImageOrigins === undefined
      ? []
      : list(input.allowedImageOrigins, 16)
    ).map((value) => {
      if (typeof value !== 'string' || value.length > 2048) {
        throw new TypeError('Invalid image origin');
      }
      /** Exact canonical origin excludes paths, credentials and query parameters. */
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.origin !== value) {
        throw new TypeError('Invalid image origin');
      }
      return value;
    })
  );
  return {
    images,
    origins,
    includePrivate: input.includePrivateImages === true,
    responsive: input.responsiveImages !== false,
  };
}
/** Render one registered image; denied references never emit an image request.
 * @param {string} href - Literal Markdown source, expected asset:alias.
 * @param {string} text - Authored Markdown alternative text.
 * @param {ReturnType<typeof imagePolicy>} policy - Validated host delivery policy.
 * @param {DocumentationImageIssue[]} issues - Operation-owned diagnostics, without private URLs.
 * @returns {string} Escaped image/picture markup or inert fallback alternative text.
 */
export function renderImage(
  href: string,
  text: string,
  policy: ReturnType<typeof imagePolicy>,
  issues: DocumentationImageIssue[]
): string {
  /** Fallback never manufactures descriptive labels from a file path. */
  const fallback = escapeHtmlText(text);
  /** Registry identifiers deliberately do not accept paths or arbitrary schemes. */
  const alias = /^asset:([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})$/.exec(href)?.[1];
  if (!alias || !Object.hasOwn(policy.images, alias)) {
    issues.push({ alias: alias ?? '', code: 'unregistered-image' });
    return fallback;
  }
  /** Only referenced candidates are cloned/validated; catalogs already validated their entire registry. */
  const image = validateImage(policy.images[alias]);
  if (image.access !== 'public' && !policy.includePrivate) {
    issues.push({ alias, code: 'private-image' });
    return fallback;
  }
  /** Every responsive/dark candidate must pass the same policy before any URL is emitted. */
  const urls = [
    image.src,
    ...(policy.responsive && image.darkSrc ? [image.darkSrc] : []),
    ...(policy.responsive ? (image.sources ?? []) : []).map(
      (source) => source.src
    ),
  ];
  if (
    urls.some(
      (url) => !url.startsWith('/') && !policy.origins.has(new URL(url).origin)
    )
  ) {
    issues.push({ alias, code: 'image-origin-denied' });
    return fallback;
  }
  if (text.length > 512) {
    throw new RangeError('Documentation image alt limit');
  }
  /** Explicit decorative content emits empty alt; meaningful content needs authored text. */
  const alt = image.decorative ? '' : text.trim() || image.alt || '';
  if (!image.decorative && !alt.trim()) {
    issues.push({ alias, code: 'missing-image-alt' });
    return fallback;
  }
  /** Srcset tokens come from validated paths/URLs and bounded integer widths only. */
  const srcset =
    policy.responsive && image.sources?.length
      ? ` srcset="${escapeHtmlAttribute(image.sources.map((source) => source.src + ' ' + source.width + 'w').join(', '))}"`
      : '';
  /** Intrinsic dimensions and lazy delivery are hints, not a no-layout-shift guarantee. */
  const html = `<img src="${escapeHtmlAttribute(image.src)}" alt="${escapeHtmlAttribute(alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async" referrerpolicy="no-referrer"${srcset}>`;
  return policy.responsive && image.darkSrc
    ? `<picture><source media="(prefers-color-scheme: dark)" srcset="${escapeHtmlAttribute(image.darkSrc)}">${html}</picture>`
    : html;
}
