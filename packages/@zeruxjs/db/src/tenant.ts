import type {
  DatabaseFacade,
  DatabaseResult,
  DatabaseQueryOptions,
  DeleteOperation,
  InsertOperation,
  JsonPrimitive,
  MaybePromise,
  SelectOperation,
  UpdateOperation,
  WhereClause,
} from './types.js';
import { assertJsonSerializable, createDatabaseError } from './utils.js';

/**
 * Opt-in fail-closed tenant projection for JSON-first data operations.
 * Does not expose schema changes, raw SQL, native connections, joins, subqueries or cross-connection routes.
 * An application MUST still authorize the current principal and resource ownership before constructing it.
 */
export interface TenantDatabase {
  /** Server-verified opaque tenant string or safe integer; never a client claim. */
  readonly tenantId: string | number;
  /** Read through the mandatory tenant predicate and table mapping.
   * @param {Omit<SelectOperation, 'op' | 'connection'>} operation - Restricted logical-table CRUD candidate.
   * @param {DatabaseQueryOptions} options - Separate query cancellation/deadline/requirements, outside operation JSON.
   * @returns {MaybePromise<DatabaseResult>} Connector result; row byte limits remain connector-owned.
   */
  select(
    operation: Omit<SelectOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Insert only rows carrying the verified tenant identity.
   * @param {Omit<InsertOperation, 'op' | 'connection'>} operation - Restricted logical-table CRUD candidate.
   * @param {DatabaseQueryOptions} options - Separate query cancellation/deadline/requirements, outside operation JSON.
   * @returns {MaybePromise<DatabaseResult>} Connector result; no transaction is implied.
   */
  insert(
    operation: Omit<InsertOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Update only scoped rows while forbidding tenant-field changes.
   * @param {Omit<UpdateOperation, 'op' | 'connection'>} operation - Restricted logical-table CRUD candidate.
   * @param {DatabaseQueryOptions} options - Separate query cancellation/deadline/requirements, outside operation JSON.
   * @returns {MaybePromise<DatabaseResult>} Connector result preserving zero-row CAS outcomes.
   */
  update(
    operation: Omit<UpdateOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Delete only rows within the explicit verified tenant boundary.
   * @param {Omit<DeleteOperation, 'op' | 'connection'>} operation - Restricted logical-table CRUD candidate.
   * @param {DatabaseQueryOptions} options - Separate query cancellation/deadline/requirements, outside operation JSON.
   * @returns {MaybePromise<DatabaseResult>} Connector result; host must separately authorize deletion.
   */
  delete(
    operation: Omit<DeleteOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
}

export interface TenantDatabaseOptions {
  /** Server-verified opaque tenant string or safe integer; never a client claim. */
  tenantId: string | number;
  /** Explicit allowlist of logical table names mapped to actual physical table names. */
  tables: Record<string, string>;
  /** Validated tenant field name, default tenant_id. */
  tenantColumn?: string;
}

/** Conservative logical/physical tenant-table identifier grammar. */
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Fail closed on an unsupported tenant operation or scope.
 * @param {string} message - Fixed policy diagnostic supplied by this module.
 * @returns {never} Always throws TENANT_SCOPE_DENIED. */
const refuse = (message: string): never => {
  throw createDatabaseError({ code: 'TENANT_SCOPE_DENIED', message });
};

/** Reject subqueries and unsupported predicates before adding the tenant condition.
 * @param {WhereClause|undefined} where - Candidate existing filter tree.
 * @returns {void} Accepts the restricted filter shape or denies. */
const inspectWhere = (where: WhereClause | undefined): void => {
  if (!where) {
    return;
  }
  if ('and' in where) {
    if (!Array.isArray(where.and) || !where.and.length) {
      refuse('Invalid tenant WHERE');
    }
    where.and.forEach(inspectWhere);
  } else if ('or' in where) {
    if (!Array.isArray(where.or) || !where.or.length) {
      refuse('Invalid tenant WHERE');
    }
    where.or.forEach(inspectWhere);
  } else if ('not' in where) {
    inspectWhere(where.not);
  } else if (
    where.query ||
    ['exists', 'notExists', 'any', 'all'].includes(where.operator)
  ) {
    refuse('Tenant subqueries are forbidden');
  }
};

/** Create a restricted CRUD projection from a host-verified tenant identity and table allowlist.
 * @param {Pick<DatabaseFacade, 'select' | 'insert' | 'update' | 'delete'>} base - Borrowed CRUD executor, including a transaction pin when supplied.
 * @param {TenantDatabaseOptions} options - Separate query cancellation/deadline/requirements, outside operation JSON.
 * @returns {TenantDatabase} Frozen facade without raw/schema/join/cross-connection APIs.
 */
export function createTenantDatabaseFacade(
  base: Pick<DatabaseFacade, 'select' | 'insert' | 'update' | 'delete'>,
  options: TenantDatabaseOptions
): TenantDatabase {
  /** Identity supplied only from host-verified principal context, never a browser assertion. */
  const { tenantId } = options;
  /** Configured tenant field, default tenant_id, validated as an identifier. */
  const tenantColumn = options.tenantColumn ?? 'tenant_id';
  if (
    !(
      (typeof tenantId === 'string' &&
        tenantId.length > 0 &&
        tenantId.length <= 256) ||
      (typeof tenantId === 'number' && Number.isSafeInteger(tenantId))
    ) ||
    !identifier.test(tenantColumn) ||
    !options.tables ||
    Array.isArray(options.tables) ||
    Object.keys(options.tables).length === 0
  ) {
    refuse('Invalid tenant scope configuration');
  }
  /** Detached allowlist mapping logical table names to physical names. */
  const tables = new Map<string, string>();
  // Detach only safe explicit logical-to-physical table mappings.
  for (const [logical, physical] of Object.entries(options.tables)) {
    if (
      !identifier.test(logical) ||
      typeof physical !== 'string' ||
      !identifier.test(physical)
    ) {
      refuse('Unsafe tenant table mapping');
    }
    tables.set(logical, physical);
  }
  /** Clone and restrict a CRUD operation before injecting the verified tenant boundary.
   * @param {T} op - Supported select/insert/update/delete candidate.
   * @returns {T} Tenant-bound copy; caller data stays unchanged. */
  const prepare = <
    T extends
      | SelectOperation
      | InsertOperation
      | UpdateOperation
      | DeleteOperation,
  >(
    op: T
  ): T => {
    assertJsonSerializable(op, 'Tenant operation');
    /** JSON-cloned operation mutated only within this facade. */
    const copy = JSON.parse(JSON.stringify(op)) as T;
    /** Physical table selected strictly from the detached allowlist. */
    const table = tables.get(copy.table);
    if (!table) {
      refuse('Table is outside tenant allowlist');
    }
    // `into` is a qualified database selector; `use` is a prior-result mapping.
    if (
      copy.connection ||
      copy.dependsOn !== undefined ||
      copy.use !== undefined ||
      ('into' in copy && copy.into !== undefined)
    ) {
      refuse('Cross-connection and cross-database access denied');
    }
    copy.table = table!;
    if (
      copy.op === 'select' &&
      (copy.joins?.length || copy.union?.length || copy.unionAll?.length)
    ) {
      refuse('Tenant joins/unions require a separately audited API');
    }
    if (copy.op !== 'insert') {
      inspectWhere(copy.where);
      /** Mandatory verified-tenant equality combined outside caller filters. */
      const tenantPredicate: WhereClause = {
        field: tenantColumn,
        operator: 'eq',
        value: tenantId as JsonPrimitive,
      };
      copy.where = copy.where
        ? { and: [copy.where, tenantPredicate] }
        : tenantPredicate;
    } else {
      /** Normalized insertion rows, each checked before tenant-field injection. */
      const rows = Array.isArray(copy.values) ? copy.values : [copy.values];
      if (rows.length === 0) {
        refuse('Empty tenant insert');
      }
      // Reject conflicting tenant identities before injecting the verified tenant field.
      for (const row of rows) {
        if (!row || Array.isArray(row) || typeof row !== 'object') {
          refuse('Invalid tenant insert row');
        }
        if (
          Object.prototype.hasOwnProperty.call(row, tenantColumn) &&
          row[tenantColumn] !== tenantId
        ) {
          refuse('Tenant identifier cannot be changed');
        }
        row[tenantColumn] = tenantId;
      }
    }
    if (
      copy.op === 'update' &&
      Object.prototype.hasOwnProperty.call(copy.values, tenantColumn)
    ) {
      refuse('Tenant identifier cannot be updated');
    }
    return copy;
  };
  return Object.freeze({
    tenantId,
    select: (
      operation: Omit<SelectOperation, 'op' | 'connection'>,
      queryOptions?: DatabaseQueryOptions
    ) => base.select(prepare({ ...operation, op: 'select' }), queryOptions),
    insert: (
      operation: Omit<InsertOperation, 'op' | 'connection'>,
      queryOptions?: DatabaseQueryOptions
    ) => base.insert(prepare({ ...operation, op: 'insert' }), queryOptions),
    update: (
      operation: Omit<UpdateOperation, 'op' | 'connection'>,
      queryOptions?: DatabaseQueryOptions
    ) => base.update(prepare({ ...operation, op: 'update' }), queryOptions),
    delete: (
      operation: Omit<DeleteOperation, 'op' | 'connection'>,
      queryOptions?: DatabaseQueryOptions
    ) => base.delete(prepare({ ...operation, op: 'delete' }), queryOptions),
  });
}
