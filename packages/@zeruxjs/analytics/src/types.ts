/** Inert scalar event vocabulary; runtime ingestion applies finite-value, consent and property budgets. */
export type EventValue = string | number | boolean | null;
/** Named scalar values; versioned scopes and reserved provenance are validated at ingestion. */
export type EventProperties = Record<string, EventValue>;
/** Untrusted event input; host consent/tenant policy and runtime validation remain separate. */
export interface AnalyticsEventInput {
  /** Bounded event name; the ingestion validator accepts at most 96 safe label characters. */
  name: string;
  /** Inert scalar event properties; legacy and registered policies validate their own bounded subsets. */
  properties?: EventProperties;
  /** Explicit registered version; omitted means latest in this generation. */
  schemaVersion?: number;
  /** Registered, consent-gated pseudonymous properties; never automatic profile collection. */
  userProperties?: EventProperties;
  /** Registered consent-gated session properties for this event; requires its opaque session identifier. */
  sessionProperties?: EventProperties;
  /** Declared web/server/email/system origin category; public collectors cannot impersonate non-web sources. */
  source?: 'web' | 'server' | 'email' | 'system';
  /** Host-authorized site/tenant binding; a browser payload cannot override a configured origin mapping. */
  site?: string;
  /** Host-minimized path label; never assume this string proves a public or authorized URL. */
  pathname?: string;
  /** An application-assigned opaque session identifier, never a raw email address. */
  sessionId?: string;
  /** Consent for web identifiers. Denied events are never persisted. */
  consent?: 'granted' | 'denied' | 'unknown';
  /** Pseudonymous, application-generated visitor token (never email/IP). Only stored with explicit consent. */
  visitorId?: string;
  /** Event occurrence epoch milliseconds within the existing accepted time window. */
  occurredAt?: number;
  /** 16-character request correlation ID, assigned once per ingress request. */
  requestId?: string;
  /** UTC calendar day of request ID reservation. */
  requestUtcDay?: string;
  /** Optional tag-manager data layer variables; not stored as raw event properties. */
  data?: EventProperties;
}
/** Validated persisted-row shape; construction is not proof that storage committed. */
export interface AnalyticsRow {
  /** Persisted event identity, distinct from browser/session identity and delivery acknowledgement. */
  id: string;
  /** Validated stored event label, not a callable function or executable expression. */
  event_name: string;
  /** Declared web/server/email/system origin category; public collectors cannot impersonate non-web sources. */
  source: string;
  /** Host-authorized site/tenant binding; a browser payload cannot override a configured origin mapping. */
  site: string;
  /** Host-minimized path label; never assume this string proves a public or authorized URL. */
  pathname: string;
  /** Stored opaque session token or empty string when absent. */
  session_id: string;
  /** Stored event occurrence epoch milliseconds, not necessarily insertion order. */
  occurred_at: number;
  /** Bounded serialized scalar/identity/schema provenance; treat values as private untrusted data. */
  properties_json: string;
}
/** Borrowed connector outcome; callers must inspect success and reliable affected counts. */
export interface DatabaseResultLike {
  /** Explicit connector operation success; missing/false never proves a committed write. */
  ok: boolean;
  /** Connector result rows; reporting code validates the expected shape before interpreting coverage. */
  rows?: unknown[];
  /** Reliable matched/affected count required for compare-and-swap semantics, when supported. */
  affectedCount?: number;
  /** Alternative reliable affected-row count for the supported connector contract. */
  rowCount?: number;
  /** Private connector failure information; telemetry warnings must not expose its values. */
  error?: {
    /** Private driver/connector error detail; hosts redact before any diagnostic exposure. */
    message?: string; /** Connector/status code used for controlled failure handling, never a permission decision. */
    code?: string;
  };
}
/** Structural analytics query/schema subset over a host-owned connection; no driver lifecycle or parity promise. */
export interface AnalyticsConnection {
  /**
   * Execute a structured event/fact insert on the borrowed named connection.
   * @param {object} operation - Explicit structured connector operation; nested fields describe the supported subset.
   * @param {string} operation.table - Explicit validated structured table identifier; never a raw SQL expression.
   * @param {| Record<string, string | number> | Array<Record<string, string | number>>} operation.values - Structured inserted/updated values, borrowed by the connector operation.
   * @returns {DatabaseResultLike | Promise<DatabaseResultLike>} Connector result; callers verify success, and no transaction is implied.
   */
  insert(operation: {
    /** Explicit validated structured table identifier; never a raw SQL expression. */
    table: string;
    /** Structured inserted/updated values, borrowed by the connector operation. */
    values:
      | Record<string, string | number>
      | Array<Record<string, string | number>>;
  }): DatabaseResultLike | Promise<DatabaseResultLike>;
  /**
   * Execute the explicit structured analytics projection/filter/aggregate subset.
   * @param {object} operation - Explicit structured connector operation; nested fields describe the supported subset.
   * @param {string} operation.table - Explicit validated structured table identifier; never a raw SQL expression.
   * @param {object | undefined} operation.columns - Declared structured column/projection definitions; raw database expressions are not accepted here.
   * @param {string[] | undefined} operation.groupBy - Validated grouping dimension or structured columns supported by the owning query.
   * @param {object | undefined} operation.where - Structured fixed predicates; caller text must not override an authenticated tenant filter.
   * @param {object | undefined} operation.orderBy - Explicit structured ordering; connector capabilities and continuation semantics still apply.
   * @param {number | undefined} operation.limit - Bounded result/page ceiling; the owning reporting method validates its range.
   * @param {object | undefined} options - Host-owned configuration; nested declarations describe bounds, consent and borrowed resources.
   * @param {AbortSignal | undefined} options.signal - See the typed field contract.
   * @param {number | undefined} options.deadline - See the typed field contract.
   * @returns {DatabaseResultLike | Promise<DatabaseResultLike>} Connector result; host owns capability negotiation, cancellation and native resource limits.
   */
  select(
    operation: {
      /** Explicit validated structured table identifier; never a raw SQL expression. */
      table: string;
      /** Declared structured column/projection definitions; raw database expressions are not accepted here. */
      columns?: Array<
        | string
        | {
            /** Explicit column or allowlisted aggregate expression, not a string SQL fragment. */
            expr:
              | {
                  /** Discriminator selects the declared structured expression subset. */
                  kind: 'column'; /** Explicit structured column, index or allowlisted native function identifier; never raw SQL. */
                  name: string;
                }
              | {
                  /** Discriminator selects the declared structured expression subset. */
                  kind: 'function';
                  /** Explicit structured column, index or allowlisted native function identifier; never raw SQL. */
                  name: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
                  /** Structured column arguments for the allowlisted native aggregate. */
                  args: Array<{
                    /** Discriminator selects the declared structured expression subset. */
                    kind: 'column'; /** Explicit structured column, index or allowlisted native function identifier; never raw SQL. */
                    name: string;
                  }>;
                };
            /** Optional result alias declared separately from the expression. */
            as?: string;
          }
      >;
      /** Validated grouping dimension or structured columns supported by the owning query. */
      groupBy?: string[];
      /** Structured fixed predicates; caller text must not override an authenticated tenant filter. */
      where?:
        | {
            /** Structured column identifier selected by the owning operation. */
            field: string;
            /** Explicit comparison operator from the supported query subset. */
            operator: 'eq' | 'gte' | 'lte' | 'gt' | 'lt';
            /** Scalar predicate/property value; never interpreted as a query fragment or code. */
            value: string | number;
          }
        | {
            /** Conjunction of explicit structured predicates. */
            and: Array<{
              /** Structured column identifier selected by the owning operation. */
              field: string;
              /** Explicit comparison operator from the supported query subset. */
              operator: 'eq' | 'gte' | 'lte' | 'gt' | 'lt';
              /** Scalar predicate/property value; never interpreted as a query fragment or code. */
              value: string | number;
            }>;
          };
      /** Explicit structured ordering; connector capabilities and continuation semantics still apply. */
      orderBy?: Array<{
        /** Structured sort-column identifier. */
        by: string; /** Explicit ascending/descending order; it does not imply a stable database snapshot. */
        direction: 'desc' | 'asc';
      }>;
      /** Bounded result/page ceiling; the owning reporting method validates its range. */
      limit?: number;
    },
    options?: {
      /** Cooperative operation cancellation; abort does not prove a query stopped or rolled back. */
      signal?: AbortSignal; /** Absolute epoch-millisecond deadline passed separately from query data. */
      deadline?: number;
    }
  ): DatabaseResultLike | Promise<DatabaseResultLike>;
  /**
   * Create the declared analytics schema only when the owning initialization step requests it.
   * @param {object} operation - Explicit structured connector operation; nested fields describe the supported subset.
   * @param {string} operation.table - Explicit validated structured table identifier; never a raw SQL expression.
   * @param {true} operation.ifNotExists - Explicit schema/index creation guard, subject to the selected connector capability.
   * @param {object} operation.columns - Declared structured column/projection definitions; raw database expressions are not accepted here.
   * @returns {DatabaseResultLike | Promise<DatabaseResultLike>} Connector DDL result; cross-process migration ownership remains with the host.
   */
  createTable(operation: {
    /** Explicit validated structured table identifier; never a raw SQL expression. */
    table: string;
    /** Explicit schema/index creation guard, subject to the selected connector capability. */
    ifNotExists: true;
    /** Declared structured column/projection definitions; raw database expressions are not accepted here. */
    columns: Array<{
      /** Explicit structured column, index or allowlisted native function identifier; never raw SQL. */
      name: string;
      /** Column storage kind from the declared analytics schema subset. */
      type: 'varchar' | 'text' | 'bigint' | 'float';
      /** Optional declared column width; connector owns native schema semantics. */
      length?: number;
      /** Marks the structured primary-key column when supported by the connector. */
      primary?: boolean;
      /** Requests a non-null column in the structured schema. */
      notNull?: boolean;
    }>;
  }): DatabaseResultLike | Promise<DatabaseResultLike>;
  /**
   * Delete only the explicitly scoped structured rows under the owning retention policy.
   * @param {object} operation - Explicit structured connector operation; nested fields describe the supported subset.
   * @param {string} operation.table - Explicit validated structured table identifier; never a raw SQL expression.
   * @param {object} operation.where - Structured fixed predicates; caller text must not override an authenticated tenant filter.
   * @returns {DatabaseResultLike | Promise<DatabaseResultLike>} Connector result; authorization/approval must precede destructive calls.
   */
  delete?(operation: {
    /** Explicit validated structured table identifier; never a raw SQL expression. */
    table: string;
    /** Structured fixed predicates; caller text must not override an authenticated tenant filter. */
    where:
      | {
          /** Structured column identifier selected by the owning operation. */
          field: string; /** Explicit comparison operator from the supported query subset. */
          operator:
            | 'eq'
            | 'lt'; /** Scalar predicate/property value; never interpreted as a query fragment or code. */
          value: string | number;
        }
      | {
          /** Conjunction of explicit structured predicates. */
          and: Array<{
            /** Structured column identifier selected by the owning operation. */
            field: string;
            /** Explicit comparison operator from the supported query subset. */
            operator: 'eq' | 'lt';
            /** Scalar predicate/property value; never interpreted as a query fragment or code. */
            value: string | number;
          }>;
        };
  }): DatabaseResultLike | Promise<DatabaseResultLike>;
  /**
   * Provision a declared structured index when the host selects analytics-managed initialization.
   * @param {object} operation - Explicit structured connector operation; nested fields describe the supported subset.
   * @param {string} operation.table - Explicit validated structured table identifier; never a raw SQL expression.
   * @param {string} operation.name - Explicit structured column, index or allowlisted native function identifier; never raw SQL.
   * @param {string[]} operation.columns - Declared structured column/projection definitions; raw database expressions are not accepted here.
   * @param {boolean | undefined} operation.unique - Requests database-enforced uniqueness; successful provisioning must be verified before relying on it.
   * @param {boolean | undefined} operation.ifNotExists - Explicit schema/index creation guard, subject to the selected connector capability.
   * @param {object | undefined} options - Host-owned configuration; nested declarations describe bounds, consent and borrowed resources.
   * @param {AbortSignal | undefined} options.signal - See the typed field contract.
   * @param {number | undefined} options.deadline - See the typed field contract.
   * @returns {DatabaseResultLike | Promise<DatabaseResultLike>} Connector DDL result; a matching name alone does not certify index definition.
   */
  createIndex?(
    operation: {
      /** Explicit validated structured table identifier; never a raw SQL expression. */
      table: string;
      /** Explicit structured column, index or allowlisted native function identifier; never raw SQL. */
      name: string;
      /** Declared structured column/projection definitions; raw database expressions are not accepted here. */
      columns: string[];
      /** Requests database-enforced uniqueness; successful provisioning must be verified before relying on it. */
      unique?: boolean;
      /** Explicit schema/index creation guard, subject to the selected connector capability. */
      ifNotExists?: boolean;
    },
    options?: {
      /** Cooperative operation cancellation; abort does not prove a query stopped or rolled back. */
      signal?: AbortSignal; /** Absolute epoch-millisecond deadline passed separately from query data. */
      deadline?: number;
    }
  ): DatabaseResultLike | Promise<DatabaseResultLike>;
  /**
   * Perform the structured compare-and-swap update with reliable affected-row reporting.
   * @param {object} operation - Explicit structured connector operation; nested fields describe the supported subset.
   * @param {string} operation.table - Explicit validated structured table identifier; never a raw SQL expression.
   * @param {Record<string, string | number>} operation.values - Structured inserted/updated values, borrowed by the connector operation.
   * @param {object} operation.where - Structured fixed predicates; caller text must not override an authenticated tenant filter.
   * @param {object} operation.where.and - Conjunction of explicit structured predicates.
   * @returns {DatabaseResultLike | Promise<DatabaseResultLike>} Connector result; implementations must preserve the declared atomic predicate.
   */
  update?(operation: {
    /** Explicit validated structured table identifier; never a raw SQL expression. */
    table: string;
    /** Structured inserted/updated values, borrowed by the connector operation. */
    values: Record<string, string | number>;
    /** Structured fixed predicates; caller text must not override an authenticated tenant filter. */
    where: {
      /** Conjunction of explicit structured predicates. */
      and: Array<{
        /** Structured column identifier selected by the owning operation. */
        field: string; /** Explicit comparison operator from the supported query subset. */
        operator: 'eq'; /** Scalar predicate/property value; never interpreted as a query fragment or code. */
        value: string | number;
      }>;
    };
  }): DatabaseResultLike | Promise<DatabaseResultLike>;
}
/** Host-owned named connection lookup; analytics never discovers or closes database providers. */
export interface DatabaseManagerLike {
  /** Explicit configured connector names; no package or connection discovery occurs. */
  connectionSlugs: readonly string[];
  /**
   * Select one existing explicitly named borrowed connection without discovering packages.
   * @param {string} name - Validated event label or explicitly configured structured connector/table name, as declared by this signature.
   * @returns {AnalyticsConnection} Connection facade owned by the host database manager, never by analytics.
   */
  getConnectionFacade(name: string): AnalyticsConnection;
}
/** Explicit best-effort collection policy; optional durable workflows have a separate owner. */
export interface AnalyticsConfig {
  /** Named @zeruxjs/db connection; omitted/missing connections warn and skip telemetry. */
  analytics?: string;
  /** Borrowed initialized database manager; analytics never owns its shutdown. */
  database?: DatabaseManagerLike;
  /** No data is collected when disabled. */
  enabled?: boolean;
  /** One warning per issue; warning handler exceptions are ignored. */
  onWarning?: (message: string) => void;
  /** Explicit validated structured table identifier; never a raw SQL expression. */
  table?: string;
  /** Set false to manage analytics indexes with external migrations. Default true. */
  indexes?: boolean;
  /** Opt-in indexed numeric event properties (max 8). Existing events need an explicit backfill. */
  numericFields?: string[];
  /** Trust an externally migrated UNIQUE(event_id, property_name) index when indexes:false. */
  numericUniqueIndexManagedExternally?: boolean;
  /** Require explicit granted consent before saving *web* events. Default is optional; denied is always dropped. */
  webConsent?: 'optional' | 'required';
  /** Optional allowlist of event names and scalar properties. Unknown names/keys reject if configured. */
  eventSchemas?: Record<
    string,
    {
      /** Inert scalar event properties; legacy and registered policies validate their own bounded subsets. */
      properties: Record<string, 'string' | 'number' | 'boolean' | 'null'>;
      /** Explicit legacy allowance for keys not declared in this event schema. */
      allowAdditionalProperties?: boolean;
    }
  >;
  /** Immutable versioned schemas; cannot be combined with legacy eventSchemas. */
  schemaRegistry?: import('./schemas.js').AnalyticsEventSchemaRegistry;
  /** Reject legacy retention on every replica sharing a durable events table. */
  durableRetention?: boolean;
  /** Explicit authorized administrator approval, required for destructive retention. */
  approveRetention?: (scope: {
    /** Host-authorized site/tenant binding; a browser payload cannot override a configured origin mapping. */
    site: string;
    /** Retention cutoff epoch milliseconds; preview and delete have separate approval boundaries. */
    before: number;
  }) => boolean | Promise<boolean>;
  /** Optional data minimization hook invoked before insertion. */
  filter?: (
    input: Readonly<AnalyticsEventInput>
  ) => AnalyticsEventInput | null | Promise<AnalyticsEventInput | null>;
}
/** Legacy bounded reporting filters; caller authorization is not inferred from a site string. */
export interface AnalyticsSummaryQuery {
  /** Bounded event name; the ingestion validator accepts at most 96 safe label characters. */
  name?: string;
  /** Declared web/server/email/system origin category; public collectors cannot impersonate non-web sources. */
  source?: string;
  /** Host-authorized site/tenant binding; a browser payload cannot override a configured origin mapping. */
  site?: string;
  /** Lower timestamp bound in epoch milliseconds; each owning API defines inclusivity. */
  since?: number;
  /** Upper timestamp bound in epoch milliseconds; each owning API defines inclusivity. */
  until?: number;
  /** Bounded result/page ceiling; the owning reporting method validates its range. */
  limit?: number;
}
/** Native persisted-count grouping over the supported structured subset. */
export interface AnalyticsAggregateQuery extends AnalyticsSummaryQuery {
  /** Validated grouping dimension or structured columns supported by the owning query. */
  groupBy: 'event' | 'source' | 'site' | 'pathname' | 'day';
}
/** Exact persisted-count result at query time, with explicit group truncation. */
export interface AnalyticsAggregateResult {
  /** Bounded grouped results; inspect truncation and coverage before interpreting totals. */
  groups: Array<{
    /** Serialized grouping label; no user identity or private property is inferred from it. */
    category: string; /** Scalar predicate/property value; never interpreted as a query fragment or code. */
    value: number;
  }>;
  /** Native aggregate total over persisted matching rows/facts, not lost ingestion. */
  total: number;
  /** More groups or rows may exist beyond the declared plan limit. */
  truncated: boolean;
  /** Actual native/materialized execution mode, not a durability assertion. */
  mode: 'database';
  /** Validated grouping dimension or structured columns supported by the owning query. */
  groupBy: AnalyticsAggregateQuery['groupBy'];
}

/** Values cover successfully materialized numeric facts, not necessarily all historical events. */
export interface AnalyticsNumericAggregateQuery extends AnalyticsAggregateQuery {
  /** Explicit numeric aggregate operation; only configured materialized fields are supported. */
  metric: 'sum' | 'average' | 'min' | 'max';
  /** Configured numeric property name; schema units and historical coverage are reported separately. */
  valueField: string;
}
/** Materialized numeric coverage is separate from complete event history or ingestion durability. */
export interface AnalyticsNumericAggregateResult {
  /** Bounded grouped results; inspect truncation and coverage before interpreting totals. */
  groups: Array<{
    /** Serialized grouping label; no user identity or private property is inferred from it. */
    category: string; /** Scalar predicate/property value; never interpreted as a query fragment or code. */
    value: number;
  }>;
  /** Native aggregate total over persisted matching rows/facts, not lost ingestion. */
  total: number;
  /** Persisted numeric facts included in the aggregate, not all historical events. */
  matchedFacts: number;
  /** More groups or rows may exist beyond the declared plan limit. */
  truncated: boolean;
  /** Actual native/materialized execution mode, not a durability assertion. */
  mode: 'materialized';
  /** Explicit storage/history coverage; indexed-only never means complete event history. */
  coverage: 'indexed-only';
  /** Units describe registered ingestion; legacy/materialization history can remain mixed. */
  schema?: {
    /** Declared registered measurement unit, without automatic unit/currency conversion. */
    unit: import('./schemas.js').AnalyticsMeasurementUnit;
    /** Version of this coverage/schema interpretation, retained for reporting clients. */
    coverageVersion: 1;
    /** Explicit storage/history coverage; indexed-only never means complete event history. */
    coverage: 'mixed-history';
  };
  /** Validated grouping dimension or structured columns supported by the owning query. */
  groupBy: AnalyticsAggregateQuery['groupBy'];
  /** Explicit numeric aggregate operation; only configured materialized fields are supported. */
  metric: AnalyticsNumericAggregateQuery['metric'];
  /** Configured numeric property name; schema units and historical coverage are reported separately. */
  valueField: string;
}
