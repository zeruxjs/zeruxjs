import type { FontDefinition } from './types.js';
import { defineFont } from './css.js';
/** Process-local copied face definitions with compatible upserts, not a DOM/native resource owner. */
export interface FontRegistry {
  /** Validate before upserting a face; copy its outer definition and source records before retention.
   * @param {string} key - Nonblank authored key; replacing a key preserves its original map position.
   * @param {FontDefinition} definition - Borrowed trusted descriptors, validated before registry mutation.
   * @returns {void} Registered/upserted definition; invalid definitions leave the previous value intact.
   */
  add(key: string, definition: FontDefinition): void;
  /** Remove one exact registry key without removing any host font or binary file.
   * @param {string} key - Literal registered key.
   * @returns {boolean} Whether this registry contained the key.
   */
  delete(key: string): boolean;
  /** Check exact local key membership without loading a font.
   * @param {string} key - Literal authored key.
   * @returns {boolean} Whether this registry contains the key.
   */
  has(key: string): boolean;
  /** Serialize current registered faces in map insertion order.
   * @returns {string} Joined deterministic CSS for this registry state; no implicit preload or fetch.
   */
  css(): string;
  /** Project copied definitions and source records without sharing mutable registry storage.
   * @returns {readonly (readonly [string, FontDefinition])[]} Detached entry list; readonly typing is not runtime freezing.
   */
  entries(): readonly (readonly [string, FontDefinition])[];
  /** Clear registered definitions without touching host/CSS-owned font faces or files.
   * @returns {void} The process-local registry becomes empty; no disposal resource is inferred.
   */
  clear(): void;
}
/** Create a process-local registry of explicitly authored face definitions. No DOM/native resources or remote acquisition are owned.
 * @returns {FontRegistry} Mutable registry with compatible key upserts and insertion-ordered CSS.
 */
export function createFontRegistry(): FontRegistry {
  /** Process-local insertion-ordered definitions; mutable source inputs/outputs are copied. */
  const store = new Map<string, FontDefinition>();
  return {
    /** Validate before upserting a face; copy its outer definition and source records before retention.
     * @param {string} key - Nonblank authored key; replacing a key preserves its original map position.
     * @param {FontDefinition} definition - Borrowed trusted descriptors, validated before registry mutation.
     * @returns {void} Registered/upserted definition; invalid definitions leave the previous value intact.
     */
    add(key, definition) {
      if (!key.trim()) {
        throw new TypeError('Font key required');
      }
      defineFont(definition);
      store.set(key, {
        ...definition,
        sources: definition.sources.map((s) => ({ ...s })),
      });
    },
    /** Remove one exact registry key without removing any host font or binary file.
     * @param {string} key - Literal registered key.
     * @returns {boolean} Whether this registry contained the key.
     */
    delete(key) {
      return store.delete(key);
    },
    /** Check exact local key membership without loading a font.
     * @param {string} key - Literal authored key.
     * @returns {boolean} Whether this registry contains the key.
     */
    has(key) {
      return store.has(key);
    },
    /** Serialize current registered faces in map insertion order.
     * @returns {string} Joined deterministic CSS for this registry state; no implicit preload or fetch.
     */
    css() {
      return [...store.values()].map(defineFont).join('\n');
    },
    /** Project copied definitions and source records without sharing mutable registry storage.
     * @returns {readonly (readonly [string, FontDefinition])[]} Detached entry list; readonly typing is not runtime freezing.
     */
    entries() {
      return [...store.entries()].map(
        ([k, v]) =>
          [k, { ...v, sources: v.sources.map((s) => ({ ...s })) }] as const
      );
    },
    /** Clear registered definitions without touching host/CSS-owned font faces or files.
     * @returns {void} The process-local registry becomes empty; no disposal resource is inferred.
     */
    clear() {
      store.clear();
    },
  };
}
