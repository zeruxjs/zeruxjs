import {createAnalytics, createEventSchemaRegistry, type DatabaseManagerLike} from '@zeruxjs/analytics';

export const schemas = createEventSchemaRegistry([{
  name: 'page.view', version: 1,
  properties: {
    section: {kind: 'dimension', type: 'string', values: ['home', 'docs'], maxCardinality: 2, required: true},
    duration_ms: {kind: 'metric', unit: 'milliseconds', min: 0, max: 60000}
  }
}]);

// The caller owns the existing named database and its shutdown.
export async function recordPage(database: DatabaseManagerLike) {
  const analytics = createAnalytics({
    analytics: 'reporting', database, schemaRegistry: schemas,
    numericFields: ['duration_ms'], webConsent: 'required'
  });
  if (!await analytics.initialize()) return undefined;
  return analytics.track(schemas.event('page.view', {
    source: 'web', site: 'verified-site', consent: 'granted',
    properties: {section: 'docs', duration_ms: 240}
  }));
}
