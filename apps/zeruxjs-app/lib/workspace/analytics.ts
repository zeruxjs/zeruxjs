import { createHash } from 'node:crypto';
import {
  createAnalytics,
  createEventSchemaRegistry,
  type AnalyticsConnection,
  createDatabaseRequestIdStore,
} from '@zeruxjs/analytics';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';
import { createTagManager, validateContainer } from '@zeruxjs/tags';
import type { QueryOperation } from '@zeruxjs/db';

/** Fixed host scope. No event/property supplied by a browser can select a site or tenant. */
export async function createWorkspaceAnalytics(
  database: SqliteConnector,
  tenant: string,
  site: string
) {
  const scope = createHash('sha256')
    .update(JSON.stringify([tenant, site]))
    .digest('hex');
  const execute = (operation: QueryOperation) =>
    database.execute(operation, {
      connection: {
        name: 'Workspace',
        slug: 'workspace',
        connector: '@zeruxjs/db-sqlite',
        options: {},
      },
    });
  const connection: AnalyticsConnection = {
    insert: (operation) => execute({ ...operation, op: 'insert' }),
    select: (operation) => execute({ ...operation, op: 'select' }),
    createTable: (operation) => execute({ ...operation, op: 'createTable' }),
    createIndex: (operation) => execute({ ...operation, op: 'createIndex' }),
  };
  const registry = createEventSchemaRegistry([
    {
      name: 'workspace.sample',
      version: 1,
      properties: {
        section: {
          kind: 'dimension',
          type: 'string',
          values: ['notebook', 'files', 'protocols'],
          maxCardinality: 3,
          required: true,
        },
        duration_ms: {
          kind: 'metric',
          unit: 'milliseconds',
          min: 0,
          max: 60_000,
          required: true,
        },
      },
    },
  ]);
  const analytics = createAnalytics({
    analytics: 'workspace',
    database: {
      connectionSlugs: ['workspace'],
      getConnectionFacade(name) {
        if (name !== 'workspace') throw new Error('ANALYTICS_SCOPE_DENIED');
        return connection;
      },
    },
    schemaRegistry: registry,
    numericFields: ['duration_ms'],
    webConsent: 'required',
    onWarning: () => {
      /* Reports return explicit unavailable; never log event bodies. */
    },
  });
  if (!(await analytics.initialize()))
    throw new Error('WORKSPACE_ANALYTICS_UNAVAILABLE');
  const requestIds = createDatabaseRequestIdStore(
    connection,
    'workspace_tag_requests'
  );
  if (!(await requestIds.initialize()))
    throw new Error('WORKSPACE_TAG_IDS_UNAVAILABLE');
  const container = validateContainer({
    id: 'workspace',
    version: 1,
    name: 'Local sample collection',
    variables: [],
    triggers: [
      {
        id: 'sample',
        name: 'Explicit sample event',
        type: 'event',
        event: 'workspace.sample',
      },
    ],
    tags: [
      {
        id: 'local',
        name: 'Local SQLite analytics',
        type: 'analytics',
        triggerIds: ['sample'],
        eventName: 'workspace.sample',
      },
    ],
  });
  const tags = createTagManager({
    analytics,
    requestIds,
    container,
    site: scope,
    defaultConsent: 'denied',
    requireBrowserConsent: true,
    maxConcurrentDispatches: 4,
    dispatchTimeoutMs: 3000,
    onWarning: () => {},
  });
  return {
    async tagSample(consent: 'granted' | 'denied') {
      const astag = tags.createAstag({ site: scope });
      await astag('consent', consent);
      return await astag('event', 'workspace.sample', {
        section: 'protocols',
        duration_ms: 0,
      });
    },
    tagDefinition: () => structuredClone(container),
    close: () => tags.close(),
    async record(section: string, duration: string, consent: string) {
      if (
        !['notebook', 'files', 'protocols'].includes(section) ||
        !/^\d{1,5}$/.test(duration) ||
        Number(duration) > 60_000 ||
        !['granted', 'denied'].includes(consent)
      )
        throw new Error('INVALID_ANALYTICS_SAMPLE');
      const id = await analytics.track(
        registry.event('workspace.sample', {
          source: 'web',
          site: scope,
          consent: consent as 'granted' | 'denied',
          properties: {
            section: section as 'notebook' | 'files' | 'protocols',
            duration_ms: Number(duration),
          },
        })
      );
      return {
        outcome:
          consent === 'denied'
            ? 'consent-denied'
            : id
              ? 'persisted'
              : 'unavailable',
      };
    },
    aggregate: () =>
      analytics.aggregate({ site: scope, groupBy: 'event', limit: 20 }),
  };
}
