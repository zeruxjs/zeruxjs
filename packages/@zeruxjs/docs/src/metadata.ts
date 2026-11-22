import { identifier, list, pageSlug } from './validation.js';

/** Optional inert page metadata; navigation visibility never grants or removes authorization. */
export interface DocumentationPageMetadata {
  /** Authored plain-text summary, at most 512 characters. */
  description?: string;
  /** At most 16 plain search terms, each at most 64 characters. */
  keywords?: readonly string[];
  /** Hide from sidebar/adjacent navigation only; direct access still follows access policy. */
  hidden?: boolean;
  /** Exclude an otherwise public page from optional search indexes. */
  searchable?: boolean;
  /** Show the generated table of contents; defaults true. */
  toc?: boolean;
  /** Optional registered version-owned cover image alias; no raw URL or HTML. */
  cover?: string;
  /** At most 16 stable slugs in the same release; host link validation checks targets. */
  related?: readonly string[];
  /** Explicit UTC calendar date YYYY-MM-DD; never generated from the build time. */
  updatedAt?: string;
}
/** Human-authored release presentation, independent of route IDs and package versions. */
export interface DocumentationVersionMetadata {
  /** Human label such as “Version 4”; route identity stays unchanged. */
  label?: string;
  /** Lifecycle banner shown by optional article rendering. */
  status?: 'stable' | 'preview' | 'deprecated' | 'archived';
  /** Explicit UTC calendar release date YYYY-MM-DD. */
  releasedAt?: string;
}
/** Validate an explicit real UTC calendar date without silently normalizing February overflow.
 * @param {unknown} value - Authored date candidate.
 * @returns {string} Valid YYYY-MM-DD date.
 */
function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-') ||
    !Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) ||
    new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError('Invalid documentation calendar date');
  }
  return value;
}
/** Validate optional page fields and detach every collection.
 * @param {Record<string,unknown>} input - Already validated own-data record.
 * @returns {DocumentationPageMetadata} Only supported metadata, with frozen lists.
 */
export function pageMetadata(
  input: Record<string, unknown>
): DocumentationPageMetadata {
  /** Fresh result never borrows the caller's arrays. */
  const output: DocumentationPageMetadata = {};
  if (input.description !== undefined) {
    if (
      typeof input.description !== 'string' ||
      input.description.length > 512
    ) {
      throw new TypeError('Invalid documentation description');
    }
    output.description = input.description;
  }
  for (const key of ['hidden', 'searchable', 'toc'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') {
        throw new TypeError('Invalid documentation visibility option');
      }
      output[key] = input[key];
    }
  }
  if (input.keywords !== undefined) {
    output.keywords = Object.freeze(
      list(input.keywords, 16).map((value) => {
        if (typeof value !== 'string' || !value.trim() || value.length > 64) {
          throw new TypeError('Invalid documentation keyword');
        }
        return value;
      })
    );
  }
  if (input.cover !== undefined) {
    output.cover = identifier(input.cover);
  }
  if (input.related !== undefined) {
    output.related = Object.freeze(list(input.related, 16).map(pageSlug));
  }
  if (input.updatedAt !== undefined) {
    output.updatedAt = date(input.updatedAt);
  }
  return output;
}
/** Validate release labels/state without inheriting a parent's release status or dates.
 * @param {Record<string,unknown>} input - Already validated own-data release definition.
 * @returns {DocumentationVersionMetadata} Detached optional metadata.
 */
export function versionMetadata(
  input: Record<string, unknown>
): DocumentationVersionMetadata {
  /** A child release owns its status and dates, even when inheriting all prose. */
  const output: DocumentationVersionMetadata = {};
  if (input.label !== undefined) {
    if (
      typeof input.label !== 'string' ||
      !input.label.trim() ||
      input.label.length > 128
    ) {
      throw new TypeError('Invalid documentation version label');
    }
    output.label = input.label;
  }
  if (input.status !== undefined) {
    if (
      !['stable', 'preview', 'deprecated', 'archived'].includes(
        input.status as string
      )
    ) {
      throw new TypeError('Invalid documentation version status');
    }
    output.status = input.status as DocumentationVersionMetadata['status'];
  }
  if (input.releasedAt !== undefined) {
    output.releasedAt = date(input.releasedAt);
  }
  return output;
}
