import { DocumentKnowledgeBase } from './knowledge-base.js';
import type { KnowledgeOptions, KnowledgeSnapshot } from './types.js';
import { readBoundedSnapshot, writeBoundedSnapshot } from './snapshot-io.js';
/**
 * Write a complete V1 base snapshot using bounded private atomic file replacement.
 * @param {DocumentKnowledgeBase} base - Borrowed base; host must populate it only with authorized source records.
 * @param {string} file - Trusted private snapshot path; parent ownership and cross-process coordination belong to host.
 * @returns {Promise<void>} Resolves after promotion; trusted parent ownership and cross-process coordination remain host-owned.
 */
export async function saveKnowledgeBase(
  base: DocumentKnowledgeBase,
  file: string
): Promise<void> {
  return writeBoundedSnapshot(base.snapshot(), file);
}
/**
 * Restore a bounded snapshot into a fresh staged base.
 * @param {string} file - Trusted private snapshot path; parent ownership and cross-process coordination belong to host.
 * @param {KnowledgeOptions | undefined} options - Validated optional policy; nested field declarations document units, bounds and ownership.
 * @returns {Promise<DocumentKnowledgeBase>} New validated base; input descriptor closes on all paths.
 */
export async function loadKnowledgeBase(
  file: string,
  options?: KnowledgeOptions
): Promise<DocumentKnowledgeBase> {
  /** Fresh staged base accepts a snapshot only after complete restore validation. */
  const base = new DocumentKnowledgeBase(options);
  base.restore((await readBoundedSnapshot(file)) as KnowledgeSnapshot);
  return base;
}
