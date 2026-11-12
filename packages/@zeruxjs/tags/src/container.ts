import { inertTagJson } from './providers.js';
import type {
  TagContainer,
  TagContainerStore,
  Scalar,
  TagGovernance,
} from './types.js';
/** Bounded identifier syntax shared by public references and named values. */
const ident = /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
/** Check bounded public identifier syntax.
 * @param {unknown} name - Candidate declared identifier.
 * @returns {boolean} Whether the value matches the supported identifier grammar.
 */
const valid = (name: unknown) => typeof name === 'string' && ident.test(name);

/** Check bounded inert display text.
 * @param {unknown} s - Candidate authored label.
 * @returns {boolean} Whether the label is nonempty, within 128 characters and control-free.
 */
const label = (s: unknown) =>
  typeof s === 'string' &&
  s.length >= 1 &&
  s.length <= 128 &&
  // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
  !/[\x00-\x1f]/.test(s);
/** Check bounded finite public scalar data.
 * @param {unknown} v - Candidate literal.
 * @returns {boolean} Whether null, boolean, bounded string or finite number.
 */
const scalar = (v: unknown): v is Scalar =>
  v === null ||
  typeof v === 'boolean' ||
  (typeof v === 'string' && v.length <= 1024) ||
  (typeof v === 'number' && Number.isFinite(v));
/** Validate bounded public tag schemas and rebuild independent declared data. Reject unsupported versions, variable expressions and cyclic/deep trigger groups before a caller mutates storage.
 * @param {unknown} data - Untrusted candidate container; executable provider code and credentials never belong here.
 * @returns {TagContainer} Independent validated draft/governance snapshot; this does not authorize publication or dispatch.
 */
export function validateContainer(data: unknown): TagContainer {
  inertTagJson(data);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Invalid tag container');
  }
  /** Require only declared fields on a schema node.
   * @param {object} v - Candidate inert node.
   * @param {string[]} allowed - Exact declared field names.
   * @returns {void} Completes when no unsupported field is present.
   */
  const keys = (v: object, allowed: string[]) => {
    if (!v || Object.keys(v).some((k) => !allowed.includes(k))) {
      throw new TypeError('Unknown tag schema field');
    }
  };
  /** Untrusted candidate viewed through declared types only after the inert traversal gate. */
  const c = data as TagContainer;
  keys(c, [
    'id',
    'version',
    'name',
    'triggers',
    'tags',
    'variables',
    'governance',
  ]);
  if (
    !valid(c.id) ||
    !Number.isSafeInteger(c.version) ||
    c.version < 1 ||
    typeof c.name !== 'string' ||
    c.name.length > 128
  ) {
    throw new TypeError('Invalid container identity');
  }
  if (
    !Array.isArray(c.triggers) ||
    !Array.isArray(c.tags) ||
    !Array.isArray(c.variables) ||
    c.triggers.length > 200 ||
    c.tags.length > 200 ||
    c.variables.length > 200
  ) {
    throw new TypeError('Invalid container limits');
  }
  /** Shared namespace for trigger, variable and tag identifiers; duplicates reject. */
  const ids = new Set<string>();
  /** Register a unique public identifier within one candidate.
   * @param {unknown} id - Candidate trigger, variable or tag ID.
   * @returns {void} Completes only for supported nonduplicate syntax.
   */
  const register = (id: unknown) => {
    if (!valid(id) || ids.has(id as string)) {
      throw new TypeError('Invalid or duplicate tag ID');
    }
    ids.add(id as string);
  };
  // Validate every declared trigger before graph traversal follows any references.
  for (const t of c.triggers) {
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
    register(t.id);
    if (
      !label(t.name) ||
      ![
        'event',
        'all',
        'pageview',
        'click',
        'form',
        'history',
        'group',
      ].includes(t.type) ||
      (t.enabled !== undefined && typeof t.enabled !== 'boolean') ||
      (t.type === 'event' && !valid(t.event))
    ) {
      throw new TypeError('Invalid trigger');
    }
    if (t.conditions !== undefined) {
      if (!Array.isArray(t.conditions) || t.conditions.length > 20) {
        throw new TypeError('Too many trigger conditions');
      }
      // Conditions remain bounded scalar comparisons, never executable expressions.
      for (const cond of t.conditions) {
        if (
          !cond ||
          Object.keys(cond).some(
            (k) => !['field', 'operator', 'value'].includes(k)
          ) ||
          !valid(cond.field) ||
          !['eq', 'neq', 'contains', 'exists', 'gte', 'lte'].includes(
            cond.operator
          ) ||
          (cond.value !== undefined && !scalar(cond.value))
        ) {
          throw new TypeError('Invalid trigger condition');
        }
      }
    }
  }
  let checks = 0;
  /** Current trigger graph ancestor IDs for cycle rejection; the cumulative work counter is separate. */
  const visiting = new Set<string>();
  /** Validate every Boolean reference with cumulative graph-work and ancestor-depth limits. Groups are conditions, never authorization rules.
   * @param {string} id - Declared trigger ID within the same candidate container.
   * @param {number} depth - Current group ancestor depth, starting at zero.
   * @returns {void} Completes only for supported acyclic group references within the shared work budget.
   */
  function checkTrigger(id: string, depth = 0) {
    if (++checks > 5000 || depth > 8 || visiting.has(id)) {
      throw new TypeError('Cyclic or too-deep trigger group');
    }
    /** Declared trigger selected by exact local ID; missing references reject. */
    const trigger = c.triggers.find((t) => t.id === id);
    if (!trigger) {
      throw new TypeError('Unknown group trigger');
    }
    if (trigger.schemaVersion !== undefined && trigger.schemaVersion !== 1) {
      throw new TypeError('Unsupported trigger schema');
    }
    if (trigger.type === 'group') {
      /** Bounded all/any/not composition record; not requires one distinct reference. */
      const group = trigger.composition;
      if (
        !group ||
        Object.keys(group).some((k) => !['mode', 'triggerIds'].includes(k)) ||
        !['all', 'any', 'not'].includes(group.mode) ||
        !Array.isArray(group.triggerIds) ||
        !group.triggerIds.length ||
        group.triggerIds.length > 20 ||
        new Set(group.triggerIds).size !== group.triggerIds.length ||
        (group.mode === 'not' && group.triggerIds.length !== 1)
      ) {
        throw new TypeError('Invalid trigger group');
      }
      visiting.add(id);
      // Check each ancestor edge under the shared finite graph-work budget.
      for (const ref of group.triggerIds) {
        checkTrigger(ref, depth + 1);
      }
      visiting.delete(id);
    } else if (trigger.composition !== undefined) {
      throw new TypeError('Composition requires group trigger');
    }
  }
  // Starting at every trigger also validates disconnected groups before publication.
  for (const trigger of c.triggers) {
    checkTrigger(trigger.id);
  }
  // Validate every named variable before accepting any exact parameter binding.
  for (const v of c.variables) {
    keys(v, ['id', 'name', 'type', 'key', 'value', 'schemaVersion']);
    register(v.id);
    if (v.schemaVersion !== undefined && v.schemaVersion !== 1) {
      throw new TypeError('Unsupported variable schema');
    }
    if (
      !label(v.name) ||
      !['constant', 'event', 'dataLayer', 'context'].includes(v.type) ||
      (v.key !== undefined && !valid(v.key)) ||
      (v.value !== undefined && !scalar(v.value))
    ) {
      throw new TypeError('Invalid variable');
    }
  }
  // Validate each destination reference against the same local trigger/variable namespace.
  for (const t of c.tags) {
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
    register(t.id);
    if (
      !label(t.name) ||
      !['analytics', 'ga4', 'webhook', 'provider'].includes(t.type) ||
      !Array.isArray(t.triggerIds) ||
      !t.triggerIds.length ||
      t.triggerIds.length > 40 ||
      (t.enabled !== undefined && typeof t.enabled !== 'boolean') ||
      t.triggerIds.some(
        (id) => !c.triggers.some((trigger) => trigger.id === id)
      )
    ) {
      throw new TypeError('Invalid tag');
    }
    if (
      t.type === 'provider' &&
      (!valid(t.providerRef) ||
        !Number.isSafeInteger(t.providerVersion) ||
        t.providerVersion! < 1 ||
        t.providerVersion! > 10000 ||
        (t.publicConfig !== undefined &&
          (!t.publicConfig ||
            Array.isArray(t.publicConfig) ||
            Object.keys(t.publicConfig).length > 25 ||
            Object.entries(t.publicConfig).some(
              ([k, v]) =>
                !valid(k) ||
                /(secret|token|password|authorization|cookie|credential|privatekey)/i.test(
                  k
                ) ||
                !scalar(v)
            ))))
    ) {
      throw new TypeError('Invalid provider reference');
    }
    if (
      t.type !== 'provider' &&
      (t.providerRef !== undefined ||
        t.providerVersion !== undefined ||
        t.publicConfig !== undefined)
    ) {
      throw new TypeError('Provider options require provider tag');
    }
    if (t.eventName !== undefined && !valid(t.eventName)) {
      throw new TypeError('Invalid destination event');
    }
    if (
      t.type === 'ga4' &&
      (!t.measurementId ||
        !/^G-[A-Z0-9]{5,20}$/.test(t.measurementId) ||
        !valid(t.credentialRef))
    ) {
      throw new TypeError('Invalid GA4 tag');
    }
    if (t.type === 'webhook' && !valid(t.destinationRef)) {
      throw new TypeError('Invalid destination reference');
    }
    if (
      t.clientIdVariable !== undefined &&
      !c.variables.some((v) => v.id === t.clientIdVariable)
    ) {
      throw new TypeError('Unknown client ID variable');
    }
    if (t.parameters !== undefined) {
      if (
        !t.parameters ||
        Array.isArray(t.parameters) ||
        Object.keys(t.parameters).length > 25
      ) {
        throw new TypeError('Invalid parameters');
      }
      // Accept only exact registered bindings, never fragments of a JavaScript expression.
      for (const [key, value] of Object.entries(t.parameters)) {
        if (
          !valid(key) ||
          [
            'zRequestId',
            'zRequestUtcDay',
            '__proto__',
            'constructor',
            'prototype',
          ].includes(key) ||
          !scalar(value)
        ) {
          throw new TypeError('Invalid parameter');
        }
        if (
          typeof value === 'string' &&
          (value.includes('{{') || value.includes('}}'))
        ) {
          /** Exact registered-variable binding match; arbitrary string interpolation is unsupported. */
          const match = /^\{\{([A-Za-z][A-Za-z0-9_.:-]{0,95})\}\}$/.exec(value);
          if (
            !match ||
            !c.variables.some((variable) => variable.id === match[1])
          ) {
            throw new TypeError('Unknown or malformed parameter variable');
          }
        }
      }
    }
  }
  // Rebuild only declared public fields; executable/server configuration never belongs here.
  /** Independent reconstructed declared public fields; extra server configuration is discarded/rejected. */
  const base = JSON.parse(
    JSON.stringify({
      id: c.id,
      version: c.version,
      name: c.name,
      triggers: c.triggers.map(
        ({
          id,
          name,
          type,
          event,
          conditions,
          enabled,
          schemaVersion,
          composition,
        }) => ({
          id,
          name,
          type,
          event,
          conditions,
          enabled,
          schemaVersion,
          composition,
        })
      ),
      variables: c.variables.map(
        ({ id, name, type, key, value, schemaVersion }) => ({
          id,
          name,
          type,
          key,
          value,
          schemaVersion,
        })
      ),
      tags: c.tags.map(
        ({
          id,
          name,
          type,
          triggerIds,
          enabled,
          eventName,
          measurementId,
          credentialRef,
          destinationRef,
          clientIdVariable,
          parameters,
          providerRef,
          providerVersion,
          publicConfig,
        }) => ({
          id,
          name,
          type,
          triggerIds,
          enabled,
          eventName,
          measurementId,
          credentialRef,
          destinationRef,
          clientIdVariable,
          parameters,
          providerRef,
          providerVersion,
          publicConfig,
        })
      ),
    })
  ) as TagContainer;
  if (c.governance !== undefined) {
    /** Candidate server-owned governance envelope requiring coherent immutable snapshots. */
    const g = c.governance as TagGovernance;
    if (
      !g ||
      typeof g !== 'object' ||
      Array.isArray(g) ||
      !Number.isSafeInteger(g.release) ||
      g.release < 1 ||
      !Array.isArray(g.history) ||
      g.history.length < 1 ||
      g.history.length > 12
    ) {
      throw new TypeError('Invalid release metadata');
    }
    /** Validate a retained definition-only snapshot.
     * @param {TagContainer} raw - Candidate historical public definition.
     * @returns {TagContainer} Independent validated definition belonging to this container.
     */
    const snapshot = (raw: TagContainer): TagContainer => {
      if (!raw || typeof raw !== 'object' || Object.hasOwn(raw, 'governance')) {
        throw new TypeError('Nested releases are forbidden');
      }
      /** Independent validated historical definition; never mutates a retained caller object. */
      const value = validateContainer(raw);
      if (value.id !== base.id) {
        throw new TypeError('Cross-container release rejected');
      }
      return value;
    };
    /** Independent validated current live snapshot. */
    const published = snapshot(g.published);
    /** Validated bounded chronological release records whose final snapshot must equal the live definition. */
    const history = g.history.map((entry) => {
      if (
        !entry ||
        !Number.isSafeInteger(entry.id) ||
        entry.id < 1 ||
        typeof entry.at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T/.test(entry.at) ||
        !['initial', 'publish', 'rollback'].includes(entry.action)
      ) {
        throw new TypeError('Invalid release history');
      }
      return {
        id: entry.id,
        at: entry.at,
        action: entry.action,
        container: snapshot(entry.container),
      };
    });
    if (
      history.some((entry, i) => i > 0 && entry.id <= history[i - 1].id) ||
      history.at(-1)?.id !== g.release ||
      JSON.stringify(history.at(-1)?.container) !== JSON.stringify(published)
    ) {
      throw new TypeError('Incoherent release history');
    }
    base.governance = { release: g.release, published, history };
  }
  return base;
}
/** Create isolated volatile development state with independent reads and process-local synchronous CAS decisions. It is not durable or a distributed lock.
 * @param {TagContainer} initial - Candidate initial container validated before storing any state.
 * @returns {TagContainerStore} In-memory borrowed-by-manager store with no resources or close API.
 */
export function createMemoryTagStore(initial: TagContainer): TagContainerStore {
  let current = validateContainer(initial);
  return {
    async load() {
      return structuredClone(current);
    },
    async save(next, expected) {
      if (expected !== current.version || next.version !== expected + 1) {
        return false;
      }
      current = validateContainer(next);
      return true;
    },
  };
}
/** Build the explicit default public definition, including its enabled internal analytics tag.
 * @param {string} id - Host-selected container identifier, default default.
 * @returns {TagContainer} Fresh development/default definition; no persistence or dispatch occurs.
 */
export const emptyTagContainer = (id = 'default'): TagContainer => ({
  id,
  name: 'Default',
  version: 1,
  triggers: [
    { id: 'all_events', name: 'All Events', type: 'all', enabled: true },
  ],
  tags: [
    {
      id: 'internal_analytics',
      name: 'Internal Analytics',
      type: 'analytics',
      triggerIds: ['all_events'],
      enabled: true,
    },
  ],
  variables: [],
});
