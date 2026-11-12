import {
  createAnalytics,
  createEventSchemaRegistry,
  type DatabaseManagerLike,
} from '@zeruxjs/analytics';

/** Finite public page vocabulary and duration units validated before collection. */
export const schemas = createEventSchemaRegistry([
  {
    name: 'page.view',
    version: 1,
    properties: {
      section: {
        kind: 'dimension',
        type: 'string',
        values: ['home', 'docs'],
        maxCardinality: 2,
        required: true,
      },
      duration_ms: { kind: 'metric', unit: 'milliseconds', min: 0, max: 60000 },
    },
  },
]);

/** Record a synthetic consented page view through a borrowed named database.
 * The host must verify site/consent before using real request data.
 * @param {DatabaseManagerLike} database - Existing named connections; the caller owns shutdown.
 * @returns {Promise<string|undefined>} Persisted event ID, or undefined on unavailable best-effort storage.
 */
export async function recordPage(database: DatabaseManagerLike) {
  /** Best-effort manager borrows reporting storage and owns no closeable handle. */
  const analytics = createAnalytics({
    analytics: 'reporting',
    database,
    schemaRegistry: schemas,
    numericFields: ['duration_ms'],
    webConsent: 'required',
  });
  if (!(await analytics.initialize())) {
    return undefined;
  }
  return analytics.track(
    schemas.event('page.view', {
      source: 'web',
      site: 'verified-site',
      consent: 'granted',
      properties: { section: 'docs', duration_ms: 240 },
    })
  );
}
