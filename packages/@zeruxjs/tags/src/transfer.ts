import { validateContainer } from './container.js';
import {
  validateTagProviders,
  type TagProviderRegistry,
  inertTagJson,
} from './providers.js';
import type { TagContainer } from './types.js';
/** Validate and export a definition-only V1 envelope. Governance/history remains private and no save or publish occurs.
 * @param {TagContainer} container - Trusted candidate public container; runtime schema validation still applies.
 * @param {TagProviderRegistry} registry - Explicit borrowed registry required when custom provider tags are present.
 * @returns {string} At-most 58,000-byte JSON envelope with no executable callbacks or release history.
 */
export function exportTagDefinition(
  container: TagContainer,
  registry?: TagProviderRegistry
): string {
  /** Validated public fields only; private governance is deliberately excluded from transfer. */
  const { governance: _private, ...definition } = validateContainer(container);
  validateTagProviders(definition, registry);
  /** Versioned definition envelope checked against the portable transfer byte budget. */
  const value = {
    format: 'zerux-tags',
    schemaVersion: 1,
    container: definition,
  };
  inertTagJson(value, 58000);
  return JSON.stringify(value);
}
/** Parse and validate a bounded V1 definition before any caller mutates storage. Imports never activate drafts or execute source code.
 * @param {string} text - At-most 58,000-byte UTF-8 envelope without governance or unknown fields.
 * @param {TagProviderRegistry} registry - Borrowed provider-version/schema registry used for compatibility checks.
 * @returns {TagContainer} Validated independent definition; host authorization, CAS and publication remain separate.
 */
export function importTagDefinition(
  text: string,
  registry?: TagProviderRegistry
): TagContainer {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 58000) {
    throw new RangeError('Tag import byte limit');
  }
  /** Parsed untrusted JSON subjected to inert/schema/provider checks before returning. */
  const input = JSON.parse(text);
  inertTagJson(input, 58000);
  if (
    !input ||
    Object.keys(input).some(
      (k) => !['format', 'schemaVersion', 'container'].includes(k)
    ) ||
    input.format !== 'zerux-tags' ||
    input.schemaVersion !== 1 ||
    !input.container ||
    Object.hasOwn(input.container, 'governance')
  ) {
    throw new TypeError('Unsupported tag import');
  }
  /** Reject undeclared imported fields before rebuilding the public definition.
   * @param {object} value - Parsed candidate schema node.
   * @param {string[]} allowed - Explicit field names for this node type.
   * @returns {void} Completes only when every own field is declared.
   */
  const keys = (value: object, allowed: string[]) => {
    if (!value || Object.keys(value).some((k) => !allowed.includes(k))) {
      throw new TypeError('Unknown imported field');
    }
  };
  keys(input.container, [
    'id',
    'version',
    'name',
    'triggers',
    'tags',
    'variables',
  ]);
  // Validate each tag before any definition can reach a draft write.
  for (const t of input.container.tags ?? []) {
    keys(t, [
      'id',
      'name',
      'type',
      'triggerIds',
      'enabled',
      'eventName',
      'measurementId',
      'credentialRef',
      'destinationRef',
      'clientIdVariable',
      'parameters',
      'providerRef',
      'providerVersion',
      'publicConfig',
    ]);
  }
  // Reject unsupported variable fields without evaluating bindings.
  for (const v of input.container.variables ?? []) {
    keys(v, ['id', 'name', 'type', 'key', 'value', 'schemaVersion']);
  }
  // Check trigger composition fields before validating the bounded graph.
  for (const t of input.container.triggers ?? []) {
    keys(t, [
      'id',
      'name',
      'type',
      'event',
      'conditions',
      'enabled',
      'schemaVersion',
      'composition',
    ]);
  }
  /** Reconstructed validated public definition, not an automatically published release. */
  const container = validateContainer(input.container);
  validateTagProviders(container, registry);
  return container;
}
