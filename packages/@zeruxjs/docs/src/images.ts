import { record, list } from './validation.js';

/** Explicit raster/SVG image location; stored contents are never interpreted as HTML. */
export interface DocumentationImageSource {
  /** Root-relative local URL or HTTPS URL without queries, fragments or credentials. */
  src: string;
  /** Positive responsive intrinsic width, at most 16384 pixels. */
  width: number;
  /** Optional SHA-256 SRI pin checked by the Node build inventory. */
  integrity?: string;
}
/** Version-owned image metadata; binary serving, licensing and actual dimensions remain host-owned. */
export interface DocumentationImage {
  /** Canonical local/HTTPS source, never fetched by the catalog or Markdown renderer. */
  src: string;
  /** Required positive intrinsic dimensions, at most 16384 pixels each. */
  width: number;
  /** Required positive intrinsic height in pixels. */
  height: number;
  /** Optional inert reusable alternative text, at most 512 characters. */
  alt?: string;
  /** Explicit decorative images emit empty alt; never guess from filenames. */
  decorative?: boolean;
  /** Only explicit public images may appear on public pages. Omission is private. */
  access?: 'public' | 'private';
  /** Optional dark-scheme source governed by the same URL/origin policy. */
  darkSrc?: string;
  /** Optional SHA-256 SRI pin for the primary image. */
  integrity?: string;
  /** Optional SHA-256 SRI pin for darkSrc; requires that source. */
  darkIntegrity?: string;
  /** At most eight unique ascending source widths; no arbitrary sizes/media expressions. */
  sources?: readonly DocumentationImageSource[];
}
/** Validate a resource URL before storing it; remote delivery additionally needs renderer approval.
 * @param {unknown} value - Authored image URL.
 * @returns {string} Canonical safe path or HTTPS address.
 */
export function imageUrl(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    /[\\%\s<>"'`?#]/u.test(value)
  ) {
    throw new TypeError('Invalid documentation image URL');
  }
  /** Synthetic origin validates local paths without consulting request Host headers. */
  const url = new URL(value, 'https://documentation.invalid');
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(url.pathname) ||
    !/^\/[A-Za-z0-9_./-]+$/.test(url.pathname) ||
    url.pathname.split('/').some((part) => part.startsWith('.'))
  ) {
    throw new TypeError('Invalid documentation image URL');
  }
  if (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    url.pathname === value
  ) {
    return value;
  }
  if (
    !value.startsWith('https://') ||
    url.protocol !== 'https:' ||
    url.href !== value
  ) {
    throw new TypeError('Images require canonical local paths or HTTPS URLs');
  }
  return value;
}
/** Validate an optional declared binary pin without treating it as proof of authorship.
 * @param {unknown} value - Authored SHA-256 SRI string.
 * @returns {string} Canonical shape, verified against actual bytes only by /build.
 */
function integrity(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new TypeError('Invalid documentation image integrity');
  }
  return value;
}
/** Validate one detached image, including dimensions, responsive candidates and publication policy.
 * @param {unknown} value - Inert version registry record.
 * @returns {DocumentationImage} Deeply immutable validated metadata.
 */
export function validateImage(value: unknown): DocumentationImage {
  /** Getter/prototype checks precede reading any field. */
  const image = record(value);
  for (const key of ['width', 'height']) {
    if (
      typeof image[key] !== 'number' ||
      !Number.isSafeInteger(image[key]) ||
      image[key] < 1 ||
      image[key] > 16384
    ) {
      throw new TypeError('Invalid documentation image dimensions');
    }
  }
  if (
    image.alt !== undefined &&
    (typeof image.alt !== 'string' || image.alt.length > 512)
  ) {
    throw new TypeError('Invalid documentation image alt');
  }
  if (image.decorative !== undefined && typeof image.decorative !== 'boolean') {
    throw new TypeError('Invalid decorative image flag');
  }
  if (
    image.access !== undefined &&
    image.access !== 'public' &&
    image.access !== 'private'
  ) {
    throw new TypeError('Invalid image publication policy');
  }
  /** Responsive candidates are sorted deterministically after validating duplicate widths. */
  const sources =
    image.sources === undefined
      ? undefined
      : list(image.sources, 8)
          .map((candidate) => {
            /** Each nested candidate remains plain inert data. */
            const source = record(candidate);
            if (
              typeof source.width !== 'number' ||
              !Number.isSafeInteger(source.width) ||
              source.width < 1 ||
              source.width > 16384
            ) {
              throw new TypeError('Invalid responsive image width');
            }
            return Object.freeze({
              src: imageUrl(source.src),
              width: source.width,
              ...(source.integrity === undefined
                ? {}
                : { integrity: integrity(source.integrity) }),
            });
          })
          .sort((a, b) => a.width - b.width);
  if (
    sources &&
    new Set(sources.map((source) => source.width)).size !== sources.length
  ) {
    throw new TypeError('Duplicate responsive image width');
  }
  if (image.darkIntegrity !== undefined && image.darkSrc === undefined) {
    throw new TypeError('Dark image integrity requires darkSrc');
  }
  return Object.freeze({
    ...(image.integrity === undefined
      ? {}
      : { integrity: integrity(image.integrity) }),
    ...(image.darkIntegrity === undefined
      ? {}
      : { darkIntegrity: integrity(image.darkIntegrity) }),
    src: imageUrl(image.src),
    width: image.width as number,
    height: image.height as number,
    access: image.access === 'public' ? 'public' : 'private',
    ...(image.alt === undefined ? {} : { alt: image.alt as string }),
    ...(image.decorative === undefined
      ? {}
      : { decorative: image.decorative as boolean }),
    ...(image.darkSrc === undefined
      ? {}
      : { darkSrc: imageUrl(image.darkSrc) }),
    ...(sources === undefined ? {} : { sources: Object.freeze(sources) }),
  });
}
