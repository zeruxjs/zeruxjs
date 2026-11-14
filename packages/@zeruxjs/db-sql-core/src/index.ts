import {
  snapshotSqlOperation,
  validateSqlOperation,
  sqlObject,
  sqlList,
  refuseSql,
} from './validation.js';
import type {
  AlterTableAction,
  ColumnDefinition,
  ComparisonOperator,
  CreateIndexOperation,
  CreateTableOperation,
  DatabaseConnector,
  DatabaseExecutionContext,
  DatabaseFunctionName,
  DatabaseResult,
  DeleteOperation,
  DropIndexOperation,
  InsertOperation,
  JoinDefinition,
  MaybePromise,
  OrderByClause,
  QueryExpression,
  QueryOperation,
  SelectColumn,
  SelectOperation,
  UpdateOperation,
  WhereClause,
  WherePredicate,
} from '@zeruxjs/db';
import { createDatabaseError } from '@zeruxjs/db';

export interface SqlDialectDefinition {
  /** Explicit dialect label used only for supported policy branches. */
  kind: string;
  /** Quote one already validated identifier segment.
   * @param {string} identifier - Authored identifier checked before native quoting.
   * @returns {string} Native identifier spelling; this callback is trusted host code.
   */
  quoteIdentifier(identifier: string): string;
  /** Generate the native marker for the allocated one-based parameter position.
   * @param {number} index - One-based position allocated by the shared compiler.
   * @returns {string} Native placeholder; parameter values stay separate.
   */
  placeholder(index: number): string;
  /** Reviewed shared-to-native function-name mappings; values must be safe identifiers. */
  functions: Partial<Record<DatabaseFunctionName, string>>;
  /** Explicit support for generated RETURNING; omission rejects requested returns. */
  supportsReturning?: boolean;
  /** False rejects structured schema/index work; omission preserves compatible defaults. */
  supportsDdl?: boolean;
  /** False rejects auto-increment schema; not a promise to retrieve every generated ID. */
  supportsGeneratedKeys?: boolean;
  /** Explicit native index-guard support; requested unsupported guards reject. */
  supportsIfNotExistsIndex?: boolean;
  /** Explicit FETCH support including ordered WITH TIES policy. */
  supportsFetch?: boolean;
  /** Allowlisted ILIKE/LIKE spelling; dialect restrictions still apply. */
  ilikeOperator?: string;
  /** Reviewed fixed native generated-key keyword. */
  autoIncrementKeyword: string;
}

export interface SqlConnectorOptions extends Record<string, unknown> {
  /** Owner declares a strictly synchronous executor, including multi-statement DDL. */
  synchronous?: boolean;
  /** Explicit trusted borrowed execution callback; never discovered automatically. */
  executor?: (
    statement: string,
    params: unknown[],
    operation: QueryOperation
  ) => MaybePromise<unknown>;
  /** Optional borrowed native transport; this facade never closes it. */
  client?: {
    query?: (statement: string, params?: unknown[]) => MaybePromise<unknown>;
    execute?: (statement: string, params?: unknown[]) => MaybePromise<unknown>;
  };
  /** Optional borrowed native pool; transaction/lifecycle remains with its owner. */
  pool?: {
    query?: (statement: string, params?: unknown[]) => MaybePromise<unknown>;
    execute?: (statement: string, params?: unknown[]) => MaybePromise<unknown>;
  };
  /** Explicit fixed database policy used to reject switching. */
  database?: string;
  /** Prevent structured database switching. */
  fixedDatabase?: boolean;
  /** Compatible destructive database-operation lock. */
  lockDatabase?: boolean;
  /** Compatible destructive database-operation lock. */
  locked?: boolean;
}

export interface SqlCompilation {
  /** Generated SQL statements in authored execution order. */
  statements: string[];
  /** One private native parameter array for each generated statement. */
  params: unknown[][];
}

type StructuredQueryExpression = Exclude<
  QueryExpression,
  string | number | boolean | null
>;

/** Recognize an explicit own kind discriminator without treating arbitrary objects as SQL text.
 * @param {unknown} input - Validated data node.
 * @returns {boolean} Whether the node uses the structured expression form. */
const isStructuredQueryExpression = (
  input: unknown
): input is StructuredQueryExpression =>
  typeof input === 'object' && input !== null && Object.hasOwn(input, 'kind');

/** Per-operation compiler owner; parameter buffers and DDL literal mode never cross requests. */
class SqlCompiler {
  /** Detached validated dialect policy; callbacks remain trusted host code. */
  readonly #dialect: SqlDialectDefinition;
  /** Lexically allocated values for only the current generated statement. */
  readonly #params: unknown[] = [];
  /** Explicit DDL CHECK/index mode encodes validated literals instead of dropping parameters. */
  #checkLiteral = false;

  /** Snapshot reviewed dialect metadata/callbacks; they remain trusted executable host code.
   * @param {SqlDialectDefinition} dialect - Reviewed immutable-by-snapshot native compiler policy.
   */
  constructor(dialect: SqlDialectDefinition) {
    if (
      !dialect ||
      typeof dialect.kind !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,32}$/.test(dialect.kind) ||
      typeof dialect.quoteIdentifier !== 'function' ||
      typeof dialect.placeholder !== 'function' ||
      !dialect.functions ||
      typeof dialect.functions !== 'object' ||
      Array.isArray(dialect.functions)
    ) {
      refuseSql('INVALID_DIALECT');
    }
    // Validate every optional dialect support flag before snapshotting its metadata.
    for (const flag of [
      'supportsReturning',
      'supportsDdl',
      'supportsGeneratedKeys',
      'supportsIfNotExistsIndex',
      'supportsFetch',
    ] as const) {
      if (dialect[flag] !== undefined && typeof dialect[flag] !== 'boolean') {
        refuseSql('INVALID_DIALECT');
      }
    }
    if (
      ![
        'AUTO_INCREMENT',
        'AUTOINCREMENT',
        'GENERATED BY DEFAULT AS IDENTITY',
        'GENERATED ALWAYS AS IDENTITY',
      ].includes(dialect.autoIncrementKeyword) ||
      (dialect.ilikeOperator !== undefined &&
        !['ILIKE', 'LIKE'].includes(dialect.ilikeOperator))
    ) {
      refuseSql('INVALID_DIALECT');
    }
    // Validate every mapped native function name before trusting the dialect callbacks.
    for (const value of Object.values(dialect.functions)) {
      if (
        typeof value !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
      ) {
        refuseSql('INVALID_DIALECT');
      }
    }
    this.#dialect = Object.freeze({
      ...dialect,
      functions: Object.freeze(
        Object.assign(Object.create(null), dialect.functions)
      ),
    });
  }

  /** Read the snapshotted native support/callback contract.
   * @returns {SqlDialectDefinition} Validated frozen metadata; callback closure behavior stays host-owned.
   */
  get dialect(): SqlDialectDefinition {
    return this.#dialect;
  }

  /** Validate one snapshotted operation and enforce the explicit dialect capability subset.
   * @param {QueryOperation} operation - Bounded own-data structured operation.
   * @returns {SqlCompilation} Generated statements with one parameter list per statement; no connection opens.
   */
  compile(operation: QueryOperation): SqlCompilation {
    validateSqlOperation(operation);
    /** Trusted snapshotted dialect label used for explicit feature guards. */
    const kind = this.#dialect.kind;
    if (
      this.#dialect.supportsDdl === false &&
      !['select', 'insert', 'update', 'delete'].includes(operation.op)
    ) {
      refuseSql('UNSUPPORTED_DDL');
    }
    if (
      (kind === 'sqlite' &&
        ['createDb', 'dropDb', 'switchDB'].includes(operation.op)) ||
      (['pgsql', 'postgres', 'postgresql'].includes(kind) &&
        operation.op === 'switchDB')
    ) {
      refuseSql('UNSUPPORTED_DDL');
    }
    if (
      operation.op === 'createDb' &&
      operation.ifNotExists &&
      kind !== 'mysql'
    ) {
      refuseSql('UNSUPPORTED_DDL');
    }
    if (operation.op === 'dropDb' && operation.force) {
      refuseSql('UNSUPPORTED_DDL');
    }
    if (
      (operation.op === 'dropTable' || operation.op === 'turcunateTable') &&
      operation.cascade &&
      ['mysql', 'sqlite'].includes(kind)
    ) {
      refuseSql('UNSUPPORTED_DDL');
    }
    if (
      operation.op === 'turcunateTable' &&
      operation.restartIdentity &&
      ['mysql', 'sqlite'].includes(kind)
    ) {
      refuseSql('UNSUPPORTED_DDL');
    }
    if (operation.op === 'turcunateTable' && kind === 'sqlite') {
      return {
        statements: [`DELETE FROM ${this.#quote(operation.table)}`],
        params: [[]],
      };
    }
    switch (operation.op) {
      case 'createDb':
        return {
          statements: [
            `CREATE DATABASE${operation.ifNotExists ? ' IF NOT EXISTS' : ''} ${this.#quote(operation.name)}`,
          ],
          params: [[]],
        };
      case 'dropDb':
        return {
          statements: [
            `DROP DATABASE${operation.ifExists ? ' IF EXISTS' : ''} ${this.#quote(operation.name)}`,
          ],
          params: [[]],
        };
      case 'switchDB':
        return {
          statements: [`USE ${this.#quote(operation.name)}`],
          params: [[]],
        };
      case 'createTable':
        return this.#compileCreateTable(operation);
      case 'dropTable':
        return {
          statements: [
            `DROP TABLE${operation.ifExists ? ' IF EXISTS' : ''} ${this.#quote(operation.table)}${operation.cascade ? ' CASCADE' : ''}`,
          ],
          params: [[]],
        };
      case 'alterTable':
        return this.#compileAlterTable(operation.table, operation.actions);
      case 'turcunateTable':
        return {
          statements: [
            `TRUNCATE TABLE ${this.#quote(operation.table)}${operation.restartIdentity ? ' RESTART IDENTITY' : ''}${operation.cascade ? ' CASCADE' : ''}`,
          ],
          params: [[]],
        };
      case 'createIndex':
        return {
          statements: [this.#buildCreateIndex(operation)],
          params: [[]],
        };
      case 'dropIndex':
        return {
          statements: [this.#buildDropIndex(operation)],
          params: [[]],
        };
      case 'insert':
        return this.#compileInsert(operation);
      case 'select':
        return this.#compileSelect(operation);
      case 'update':
        return this.#compileUpdate(operation);
      case 'delete':
        return this.#compileDelete(operation);
      default:
        throw createDatabaseError({
          code: 'UNSUPPORTED_OPERATION',
          message: `Unsupported SQL operation "${(operation as QueryOperation).op}"`,
        });
    }
  }

  /** Compile validated columns/indexes without discarding DDL literal semantics.
   * @param {CreateTableOperation} operation - Bounded own-data structured operation.
   * @returns {SqlCompilation} Ordered CREATE statements; caller owns actual transactionality.
   */
  #compileCreateTable(operation: CreateTableOperation): SqlCompilation {
    if (!operation.columns.length || operation.columns.length > 256) {
      throw createDatabaseError({
        code: 'INVALID_COLUMNS',
        message: 'Invalid table column count',
      });
    }
    if (
      new Set(operation.columns.map((c) => c.name)).size !==
      operation.columns.length
    ) {
      refuseSql('INVALID_COLUMNS');
    }
    /** Validated column inventory compiled in authored order. */
    const columns = operation.columns.map((column) =>
      this.#buildColumn(column)
    );
    /** Ordered generated SQL statements; multi-statement output is not a transaction. */
    const statements = [
      `CREATE TABLE${operation.ifNotExists ? ' IF NOT EXISTS' : ''} ${this.#quote(operation.table)} (${columns.join(', ')})`,
    ];
    /** Detached parameter list corresponding to this exact generated statement. */
    const params = [[] as unknown[]];

    // Compile each validated same-table index after its create-table statement.
    for (const index of operation.indexes ?? []) {
      if (index.table !== operation.table) {
        refuseSql('INVALID_INDEX');
      }
      sqlObject(index, [
        'op',
        'connection',
        'dependsOn',
        'use',
        'table',
        'name',
        'columns',
        'unique',
        'ifNotExists',
        'using',
      ]);
      statements.push(this.#buildCreateIndex(index));
      params.push([]);
    }

    return { statements, params };
  }

  /** Compile only supported explicit schema alterations.
   * @param {string} table - Validated authored table identifier.
   * @param {AlterTableAction[]} actions - Ordered structured alter-table actions.
   * @returns {SqlCompilation} Ordered statements with empty DDL parameter lists.
   */
  #compileAlterTable(
    table: string,
    actions: AlterTableAction[]
  ): SqlCompilation {
    if (!actions.length) {
      refuseSql('INVALID_SQL_SHAPE');
    }
    /** Ordered generated SQL statements; multi-statement output is not a transaction. */
    const statements = actions.map((action) => {
      /** Exact clause/discriminator allowlists for structured schema or expression validation. */
      const fields: Record<string, string[]> = {
        addColumn: ['column'],
        dropColumn: ['name'],
        renameColumn: ['from', 'to'],
        renameTable: ['to'],
        modifyColumn: ['column'],
        addIndex: [
          'op',
          'table',
          'name',
          'columns',
          'unique',
          'ifNotExists',
          'using',
        ],
        dropIndex: ['op', 'table', 'name', 'ifExists'],
      };
      if (!action || !Object.hasOwn(fields, action.type)) {
        refuseSql('UNSUPPORTED_ALTER_ACTION');
        throw new TypeError('SQL alter action fields are missing');
      }
      /** Operation-specific field table selected after validating the action kind. */
      const actionFields = fields[action.type];
      if (!actionFields) {
        throw new TypeError('SQL alter action fields are missing');
      }
      sqlObject(action, ['type', ...actionFields]);
      if (
        (action.type === 'addIndex' || action.type === 'dropIndex') &&
        action.table !== undefined &&
        action.table !== table
      ) {
        refuseSql('INVALID_INDEX');
      }
      if (
        (action.type === 'addIndex' || action.type === 'dropIndex') &&
        action.op !== undefined &&
        action.op !== (action.type === 'addIndex' ? 'createIndex' : 'dropIndex')
      ) {
        refuseSql('INVALID_INDEX');
      }
      if (action.type === 'modifyColumn' && this.#dialect.kind !== 'mysql') {
        refuseSql('UNSUPPORTED_ALTER_ACTION');
      }
      switch (action.type) {
        case 'addColumn':
          return `ALTER TABLE ${this.#quote(table)} ADD COLUMN ${this.#buildColumn(action.column)}`;
        case 'dropColumn':
          return `ALTER TABLE ${this.#quote(table)} DROP COLUMN ${this.#quote(action.name)}`;
        case 'renameColumn':
          return `ALTER TABLE ${this.#quote(table)} RENAME COLUMN ${this.#quote(action.from)} TO ${this.#quote(action.to)}`;
        case 'renameTable':
          return `ALTER TABLE ${this.#quote(table)} RENAME TO ${this.#quote(action.to)}`;
        case 'modifyColumn':
          return `ALTER TABLE ${this.#quote(table)} MODIFY COLUMN ${this.#buildColumn(action.column)}`;
        case 'addIndex':
          return this.#buildCreateIndex(action);
        case 'dropIndex':
          return this.#buildDropIndex({
            ...action,
            table: action.table ?? table,
          });
        default:
          throw createDatabaseError({
            code: 'UNSUPPORTED_ALTER_ACTION',
            message: `Unsupported alter table action "${(action as AlterTableAction).type}"`,
          });
      }
    });

    return {
      statements,
      params: statements.map(() => []),
    };
  }

  /** Validate uniform own-column row sets before binding values in authored lexical order.
   * @param {InsertOperation} operation - Bounded own-data structured operation.
   * @returns {SqlCompilation} One insertion plus supported RETURNING.
   */
  #compileInsert(operation: InsertOperation): SqlCompilation {
    /** Validated insertion rows with identical nonempty own column sets. */
    const rows = Array.isArray(operation.values)
      ? operation.values
      : [operation.values];
    if (rows.length === 0) {
      throw createDatabaseError({
        code: 'EMPTY_INSERT',
        message: 'Insert operation must contain at least one row',
      });
    }

    if (!rows[0] || typeof rows[0] !== 'object' || Array.isArray(rows[0])) {
      refuseSql('INVALID_INSERT');
    }
    /** First row used to establish the validated insert column set. */
    const firstRow = rows[0];
    if (!firstRow || typeof firstRow !== 'object' || Array.isArray(firstRow)) {
      refuseSql('INVALID_INSERT');
      throw new TypeError('Insert row is invalid');
    }
    /** Validated column inventory compiled in authored order. */
    const columns = Object.keys(firstRow);
    if (
      columns.length === 0 ||
      rows.length > 10_000 ||
      rows.some(
        (row) =>
          !row ||
          Array.isArray(row) ||
          Object.keys(row).length !== columns.length ||
          columns.some(
            (column) => !Object.prototype.hasOwnProperty.call(row, column)
          )
      )
    ) {
      throw createDatabaseError({
        code: 'INVALID_INSERT',
        message: 'Insert rows must have identical nonempty columns',
      });
    }
    /** Prepared insertion value tuples; every value enters the compiler parameter order. */
    const values = rows.map(
      (row) =>
        `(${columns.map((column) => this.#compileValue(row[column] as QueryExpression | unknown)).join(', ')})`
    );

    if (operation.returning?.length && !this.#dialect.supportsReturning) {
      throw createDatabaseError({
        code: 'UNSUPPORTED_RETURNING',
        message: 'This connector does not support RETURNING',
      });
    }
    /** Generated returned-column clause only after explicit dialect capability approval. */
    const returning =
      operation.returning &&
      operation.returning.length > 0 &&
      this.#dialect.supportsReturning
        ? ` RETURNING ${operation.returning.map((column) => this.#quote(column)).join(', ')}`
        : '';

    return {
      statements: [
        `INSERT INTO ${this.#qualifiedTable(operation.into, operation.table)} (${columns.map((column) => this.#quote(column)).join(', ')}) VALUES ${values.join(', ')}${returning}`,
      ],
      params: [this.#drainParams()],
    };
  }

  /** Build a bounded supported SELECT and detach its exact parameter list.
   * @param {SelectOperation} operation - Bounded own-data structured operation.
   * @returns {SqlCompilation} One prepared select with lexical placeholder order.
   */
  #compileSelect(operation: SelectOperation): SqlCompilation {
    /** Complete generated SQL in lexical placeholder order. */
    const statement = this.#buildSelect(operation);
    return {
      statements: [statement],
      params: [this.#drainParams()],
    };
  }

  /** Bind assignments before structured filters and supported RETURNING.
   * @param {UpdateOperation} operation - Bounded own-data structured operation.
   * @returns {SqlCompilation} One update; no rowcount/transaction semantics are invented.
   */
  #compileUpdate(operation: UpdateOperation): SqlCompilation {
    if (
      !operation.values ||
      typeof operation.values !== 'object' ||
      Array.isArray(operation.values)
    ) {
      refuseSql('INVALID_UPDATE');
    }
    if (Object.keys(operation.values).length === 0) {
      throw createDatabaseError({
        code: 'INVALID_UPDATE',
        message: 'Update must contain values',
      });
    }
    /** Ordered named-field update assignments; values remain bound. */
    const assignments = Object.entries(operation.values).map(
      ([column, value]) =>
        `${this.#quote(column)} = ${this.#compileValue(value)}`
    );
    /** Generated structured filter fragment, never raw caller WHERE text. */
    const where = operation.where
      ? ` WHERE ${this.#compileWhere(operation.where)}`
      : '';
    if (operation.returning?.length && !this.#dialect.supportsReturning) {
      throw createDatabaseError({
        code: 'UNSUPPORTED_RETURNING',
        message: 'This connector does not support RETURNING',
      });
    }
    /** Generated returned-column clause only after explicit dialect capability approval. */
    const returning =
      operation.returning &&
      operation.returning.length > 0 &&
      this.#dialect.supportsReturning
        ? ` RETURNING ${operation.returning.map((column) => this.#quote(column)).join(', ')}`
        : '';

    return {
      statements: [
        `UPDATE ${this.#quote(operation.table)} SET ${assignments.join(', ')}${where}${returning}`,
      ],
      params: [this.#drainParams()],
    };
  }

  /** Compile structured deletion and supported RETURNING.
   * @param {DeleteOperation} operation - Bounded own-data structured operation.
   * @returns {SqlCompilation} One deletion; authorization remains host-owned.
   */
  #compileDelete(operation: DeleteOperation): SqlCompilation {
    /** Generated structured filter fragment, never raw caller WHERE text. */
    const where = operation.where
      ? ` WHERE ${this.#compileWhere(operation.where)}`
      : '';
    if (operation.returning?.length && !this.#dialect.supportsReturning) {
      throw createDatabaseError({
        code: 'UNSUPPORTED_RETURNING',
        message: 'This connector does not support RETURNING',
      });
    }
    /** Generated returned-column clause only after explicit dialect capability approval. */
    const returning =
      operation.returning &&
      operation.returning.length > 0 &&
      this.#dialect.supportsReturning
        ? ` RETURNING ${operation.returning.map((column) => this.#quote(column)).join(', ')}`
        : '';

    return {
      statements: [
        `DELETE FROM ${this.#quote(operation.table)}${where}${returning}`,
      ],
      params: [this.#drainParams()],
    };
  }

  /** Build only validated SELECT clauses/arms while preserving parameter allocation order.
   * @param {SelectOperation} operation - Bounded own-data structured operation.
   * @returns {string} Generated SQL; unsupported compound pagination rejects.
   */
  #buildSelect(operation: SelectOperation): string {
    validateSqlOperation(operation);
    if (operation.op !== 'select') {
      refuseSql('INVALID_SQL_SHAPE');
    }
    if (
      (operation.union?.length || operation.unionAll?.length) &&
      (operation.orderBy?.length ||
        operation.limit !== undefined ||
        operation.offset !== undefined ||
        operation.top !== undefined ||
        operation.fetch !== undefined)
    ) {
      refuseSql('UNSUPPORTED_COMPOUND_PAGINATION');
    }
    // Reject unsupported per-arm pagination instead of silently changing compound SELECT semantics.
    for (const arm of [
      ...(operation.union ?? []),
      ...(operation.unionAll ?? []),
    ]) {
      if (
        arm.orderBy?.length ||
        arm.limit !== undefined ||
        arm.offset !== undefined ||
        arm.top !== undefined ||
        arm.fetch !== undefined
      ) {
        refuseSql('UNSUPPORTED_COMPOUND_PAGINATION');
      }
    }
    /** Validated column inventory compiled in authored order. */
    const columns =
      operation.columns && operation.columns.length > 0
        ? operation.columns
            .map((column) => this.#buildSelectColumn(column))
            .join(', ')
        : '*';
    if (operation.as !== undefined) {
      this.#flat(operation.as);
    }
    /** Validated/quoted qualified table plus optional flat alias. */
    const table = `${this.#qualifiedTable(operation.into, operation.table)}${operation.as ? ` AS ${this.#quote(operation.as)}` : ''}`;
    /** Generated allowlisted joins in authored order. */
    const joins = (operation.joins ?? [])
      .map((join) => this.#buildJoin(join))
      .join(' ');
    /** Generated structured filter fragment, never raw caller WHERE text. */
    const where = operation.where
      ? ` WHERE ${this.#compileWhere(operation.where)}`
      : '';
    if (
      operation.groupBy?.some((c) => typeof c === 'string' && c.includes('*'))
    ) {
      refuseSql('INVALID_IDENTIFIER');
    }
    /** Generated supported grouping fragment with validated operands. */
    const groupBy =
      operation.groupBy && operation.groupBy.length > 0
        ? ` GROUP BY ${operation.groupBy.map((entry) => this.#compileSelectable(entry)).join(', ')}`
        : '';
    /** Generated structured post-group filter. */
    const having = operation.having
      ? ` HAVING ${this.#compileWhere(operation.having)}`
      : '';
    /** Generated supported ordering fragment. */
    const orderBy =
      operation.orderBy && operation.orderBy.length > 0
        ? ` ORDER BY ${operation.orderBy.map((entry) => this.#buildOrderBy(entry)).join(', ')}`
        : '';
    /** Validated pagination fragment; conflicting/unsupported semantics reject. */
    const limit = this.#buildLimit(operation);

    /** Complete base SELECT assembled only after its clauses allocate placeholders in lexical order. */
    const base = `SELECT${operation.distinct ? ' DISTINCT' : ''} ${columns} FROM ${table}${joins}${where}${groupBy}${having}${orderBy}${limit}`;
    /** Validated union arms compiled after the base statement parameters. */
    const unions = [
      ...(operation.union ?? []).map(
        (entry) => ` UNION ${this.#buildSelect(entry)}`
      ),
      ...(operation.unionAll ?? []).map(
        (entry) => ` UNION ALL ${this.#buildSelect(entry)}`
      ),
    ];

    return `${base}${unions.join('')}`;
  }

  /** Compile an explicit selectable/flat alias without accepting raw SQL.
   * @param {string | SelectColumn} column - Validated named column/projection/schema candidate.
   * @returns {string} Validated projection fragment.
   */
  #buildSelectColumn(column: string | SelectColumn): string {
    if (typeof column === 'string') {
      return this.#compileSelectable(column);
    }

    sqlObject(column, ['expr', 'as']);
    if (column.as !== undefined) {
      this.#flat(column.as);
      if (typeof column.expr === 'string' && column.expr.includes('*')) {
        refuseSql('INVALID_ALIAS');
      }
    }
    /** Compiled validated selectable operand or normalized native result. */
    const value = this.#compileSelectable(column.expr);
    return column.as ? `${value} AS ${this.#quote(column.as)}` : value;
  }

  /** Generate only supported named-table joins and structured predicates.
   * @param {JoinDefinition} join - Validated join kind/table/alias/filter.
   * @returns {string} Native join fragment; unsupported dialect forms reject.
   */
  #buildJoin(join: JoinDefinition): string {
    sqlObject(join, ['type', 'table', 'as', 'on']);
    if (join.as !== undefined) {
      this.#flat(join.as);
    }
    if (
      (this.#dialect.kind === 'mysql' && join.type === 'full') ||
      (this.#dialect.kind === 'sqlite' && ['right', 'full'].includes(join.type))
    ) {
      refuseSql('UNSUPPORTED_JOIN');
    }
    if (!['inner', 'left', 'right', 'full', 'self'].includes(join.type)) {
      throw createDatabaseError({
        code: 'INVALID_JOIN',
        message: 'Unsafe SQL join type',
      });
    }
    /** Fixed generated join keyword; self uses the supported INNER JOIN form. */
    const joinKeyword =
      join.type === 'self' ? 'INNER JOIN' : `${join.type.toUpperCase()} JOIN`;
    return ` ${joinKeyword} ${this.#quote(join.table)}${join.as ? ` AS ${this.#quote(join.as)}` : ''} ON ${this.#compileWhere(join.on)}`;
  }

  /** Compile allowlisted direction/null ordering over a supported operand.
   * @param {string | OrderByClause} entry - Authored ordering operand and explicit direction/null policy.
   * @returns {string} Native ordering fragment, never caller SQL.
   */
  #buildOrderBy(entry: string | OrderByClause): string {
    if (typeof entry !== 'string') {
      sqlObject(entry, ['by', 'direction', 'nulls']);
      if (entry.nulls !== undefined && this.#dialect.kind === 'mysql') {
        refuseSql('UNSUPPORTED_NULLS_ORDER');
      }
    }
    if (
      typeof entry !== 'string' &&
      ((entry.direction !== undefined &&
        !['asc', 'desc'].includes(entry.direction)) ||
        (entry.nulls !== undefined && !['first', 'last'].includes(entry.nulls)))
    ) {
      throw createDatabaseError({
        code: 'INVALID_ORDER',
        message: 'Unsafe SQL order specification',
      });
    }
    if (
      typeof entry === 'string'
        ? entry.includes('*')
        : typeof entry.by === 'string' && entry.by.includes('*')
    ) {
      refuseSql('INVALID_ORDER');
    }
    if (typeof entry === 'string') {
      return `${this.#compileSelectable(entry)} ASC`;
    }

    /** Allowlisted native sort direction, default ASC. */
    const direction = entry.direction?.toUpperCase() ?? 'ASC';
    /** Optional explicit native null-placement clause; unsupported dialects reject. */
    const nulls = entry.nulls ? ` NULLS ${entry.nulls.toUpperCase()}` : '';
    return `${this.#compileSelectable(entry.by)} ${direction}${nulls}`;
  }

  /** Reject conflicting or unsupported pagination rather than silently rewriting semantics.
   * @param {SelectOperation} operation - Bounded own-data structured operation.
   * @returns {string} Native limit/offset/fetch fragment, including explicit zero limit.
   */
  #buildLimit(operation: SelectOperation): string {
    // Validate limit/top/offset types before native pagination formatting.
    for (const value of [operation.limit, operation.top, operation.offset]) {
      if (value !== undefined && typeof value !== 'number') {
        refuseSql('INVALID_LIMIT');
      }
    }
    if (
      [operation.limit, operation.top, operation.fetch].filter(
        (v) => v !== undefined
      ).length > 1
    ) {
      refuseSql('CONFLICTING_LIMIT');
    }
    if (operation.fetch !== undefined && typeof operation.fetch !== 'number') {
      sqlObject(operation.fetch, ['count', 'withTies']);
      if (typeof operation.fetch.count !== 'number') {
        refuseSql('INVALID_LIMIT');
      }
      if (
        operation.fetch.withTies !== undefined &&
        typeof operation.fetch.withTies !== 'boolean'
      ) {
        refuseSql('INVALID_LIMIT');
      }
      if (
        operation.fetch.withTies &&
        (!this.#dialect.supportsFetch || !operation.orderBy?.length)
      ) {
        refuseSql('UNSUPPORTED_FETCH_TIES');
      }
    }
    /** Compatible limit/top/fetch precedence after conflict/type validation. */
    const effectiveLimit =
      operation.limit ??
      operation.top ??
      (typeof operation.fetch === 'number'
        ? operation.fetch
        : operation.fetch?.count);

    /** Explicit nonnegative native offset, default zero. */
    const offset = operation.offset ?? 0;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 1_000_000 ||
      (effectiveLimit !== undefined &&
        (!Number.isSafeInteger(effectiveLimit) ||
          effectiveLimit < 0 ||
          effectiveLimit > 100_000))
    ) {
      throw createDatabaseError({
        code: 'INVALID_LIMIT',
        message: 'SQL pagination must be bounded nonnegative integers',
      });
    }
    if (effectiveLimit === undefined) {
      if (offset > 0 && ['mysql', 'sqlite'].includes(this.#dialect.kind)) {
        refuseSql('UNSUPPORTED_OFFSET');
      }
      return offset > 0 ? ` OFFSET ${offset}` : '';
    }

    if (this.#dialect.supportsFetch && operation.fetch !== undefined) {
      /** Native WITH TIES suffix only when declared and ordered. */
      const ties =
        typeof operation.fetch === 'object' && operation.fetch.withTies
          ? ' WITH TIES'
          : '';
      return ` OFFSET ${offset} ROWS FETCH NEXT ${effectiveLimit} ROWS${ties || ' ONLY'}`;
    }

    return ` LIMIT ${effectiveLimit}${offset > 0 ? ` OFFSET ${offset}` : ''}`;
  }

  /** Validate guard/method/expressions and use inline DDL literals without losing values.
   * @param {CreateIndexOperation} operation - Bounded own-data structured operation.
   * @returns {string} One native index statement; unsupported guards reject.
   */
  #buildCreateIndex(operation: CreateIndexOperation): string {
    if (
      !Array.isArray(operation.columns) ||
      operation.columns.length < 1 ||
      operation.columns.length > 32
    ) {
      throw createDatabaseError({
        code: 'INVALID_INDEX',
        message: 'Invalid SQL index columns',
      });
    }
    if (operation.ifNotExists && !this.#dialect.supportsIfNotExistsIndex) {
      refuseSql('UNSUPPORTED_INDEX_GUARD');
    }
    // Require Boolean index guard/uniqueness flags before generating native syntax.
    for (const flag of ['unique', 'ifNotExists'] as const) {
      if (
        operation[flag] !== undefined &&
        typeof operation[flag] !== 'boolean'
      ) {
        refuseSql('INVALID_INDEX');
      }
    }
    /** Native index existence guard only when explicitly supported. */
    const ifNotExists =
      operation.ifNotExists && this.#dialect.supportsIfNotExistsIndex
        ? ' IF NOT EXISTS'
        : '';
    /** Generated native uniqueness keyword. */
    const unique = operation.unique ? 'UNIQUE ' : '';
    if (
      operation.using !== undefined &&
      (typeof operation.using !== 'string' ||
        !/^(?:btree|hash|gin|gist|brin|spgist)$/i.test(operation.using))
    ) {
      throw createDatabaseError({
        code: 'INVALID_INDEX_METHOD',
        message: 'Unsafe SQL index method',
      });
    }
    if (operation.using && this.#dialect.kind === 'sqlite') {
      throw createDatabaseError({
        code: 'UNSUPPORTED_INDEX_METHOD',
        message: 'SQLite does not support USING on CREATE INDEX',
      });
    }
    if (
      operation.using &&
      this.#dialect.kind === 'mysql' &&
      !['btree', 'hash'].includes(operation.using.toLowerCase())
    ) {
      refuseSql('UNSUPPORTED_INDEX_METHOD');
    }
    /** Validated allowlisted native index method. */
    const using = operation.using
      ? ` USING ${operation.using.toUpperCase()}`
      : '';
    if (
      operation.columns.some((c) => typeof c === 'string' && c.includes('*'))
    ) {
      refuseSql('INVALID_INDEX');
    }
    if (
      operation.columns.some((c) => typeof c === 'object') &&
      this.#dialect.kind === 'mysql'
    ) {
      refuseSql('UNSUPPORTED_INDEX_EXPRESSION');
    }
    if (
      operation.columns.some(
        (c) =>
          typeof c !== 'string' &&
          (!c || typeof c !== 'object' || c.kind === 'value')
      )
    ) {
      refuseSql('UNSUPPORTED_INDEX_EXPRESSION');
    }
    /** Caller literal-mode flag restored after index-expression compilation. */
    const previous = this.#checkLiteral;
    let columns: string;
    this.#checkLiteral = true;
    try {
      columns = operation.columns
        .map((column) => this.#compileSelectable(column))
        .join(', ');
    } finally {
      this.#checkLiteral = previous;
    }
    /** Validated quoted index/table prefix before dialect-specific method placement. */
    const target = `CREATE ${unique}INDEX${ifNotExists} ${this.#quote(operation.name)} ON ${this.#quote(operation.table)}`;
    return this.#dialect.kind === 'mysql'
      ? `${target} (${columns})${using}`
      : `${target}${using} (${columns})`;
  }

  /** Enforce dialect-specific table/guard requirements before index removal.
   * @param {DropIndexOperation} operation - Bounded own-data structured operation.
   * @returns {string} One validated native statement.
   */
  #buildDropIndex(operation: DropIndexOperation): string {
    if (operation.table !== undefined) {
      this.#quote(operation.table);
    }
    if (
      operation.ifExists !== undefined &&
      typeof operation.ifExists !== 'boolean'
    ) {
      refuseSql('INVALID_INDEX');
    }
    if (this.#dialect.kind === 'mysql') {
      if (!operation.table || operation.ifExists) {
        throw createDatabaseError({
          code: 'UNSUPPORTED_DROP_INDEX',
          message:
            'MySQL DROP INDEX requires a table and does not support IF EXISTS',
        });
      }
      return `DROP INDEX ${this.#quote(operation.name)} ON ${this.#quote(operation.table)}`;
    }
    return `DROP INDEX${operation.ifExists ? ' IF EXISTS' : ''} ${this.#quote(operation.name)}`;
  }

  /** Compile validated type/constraints, explicit literal CHECK and referential actions.
   * @param {ColumnDefinition} column - Validated named column/projection/schema candidate.
   * @returns {string} Native column fragment; raw CHECK text is forbidden.
   */
  #buildColumn(column: ColumnDefinition): string {
    sqlObject(column, [
      'name',
      'type',
      'primary',
      'unique',
      'foreign',
      'notNull',
      'default',
      'check',
      'autoIncrement',
      'length',
      'precision',
      'scale',
    ]);
    this.#flat(column.name);
    // Validate every generated-column constraint flag before compiling native schema.
    for (const flag of [
      'primary',
      'unique',
      'notNull',
      'autoIncrement',
    ] as const) {
      if (column[flag] !== undefined && typeof column[flag] !== 'boolean') {
        refuseSql('INVALID_COLUMNS');
      }
    }
    if (column.autoIncrement && this.#dialect.supportsGeneratedKeys === false) {
      refuseSql('UNSUPPORTED_GENERATED_KEYS');
    }
    if (column.autoIncrement && column.default !== undefined) {
      refuseSql('CONFLICTING_GENERATED_KEY');
    }
    /** Validated native column type/size mapping. */
    const type = this.#buildColumnType(column);
    /** Ordered generated column constraints and validated DDL literals. */
    const parts = [`${this.#quote(column.name)} ${type}`];

    if (
      column.autoIncrement &&
      !['integer', 'number', 'bigint'].includes(column.type)
    ) {
      throw createDatabaseError({
        code: 'INVALID_AUTOINCREMENT',
        message: 'Auto-increment requires an integral column',
      });
    }
    if (column.autoIncrement && this.#dialect.kind === 'sqlite') {
      if (!column.primary || !['integer', 'number'].includes(column.type)) {
        throw createDatabaseError({
          code: 'INVALID_AUTOINCREMENT',
          message: 'SQLite AUTOINCREMENT requires INTEGER PRIMARY KEY',
        });
      }
      parts.push('PRIMARY KEY', this.#dialect.autoIncrementKeyword);
    } else {
      if (column.autoIncrement) {
        parts.push(this.#dialect.autoIncrementKeyword);
      }
      if (column.primary) {
        parts.push('PRIMARY KEY');
      }
    }

    if (column.unique) {
      parts.push('UNIQUE');
    }

    if (column.notNull) {
      parts.push('NOT NULL');
    }

    if (column.default !== undefined) {
      parts.push(`DEFAULT ${this.#compileDefaultValue(column.default)}`);
    }

    if (column.check !== undefined) {
      if (typeof column.check === 'string') {
        throw createDatabaseError({
          code: 'UNSAFE_SQL_CHECK',
          message:
            'Raw SQL CHECK text is forbidden; use structured expressions',
        });
      }
      this.#checkLiteral = true;
      try {
        parts.push(
          `CHECK (${typeof column.check === 'object' && column.check !== null && ('operator' in column.check || 'and' in column.check || 'or' in column.check || 'not' in column.check) ? this.#compileWhere(column.check as WhereClause) : this.#compileDefaultValue(column.check)})`
        );
      } finally {
        this.#checkLiteral = false;
      }
    }

    if (column.foreign !== undefined) {
      sqlObject(column.foreign, ['table', 'column', 'onDelete', 'onUpdate']);
      this.#flat(column.foreign.column);
      parts.push(
        `REFERENCES ${this.#quote(column.foreign.table)} (${this.#quote(column.foreign.column)})`
      );

      if (column.foreign.onDelete !== undefined) {
        parts.push(
          `ON DELETE ${this.#formatReferenceAction(column.foreign.onDelete)}`
        );
      }

      if (column.foreign.onUpdate !== undefined) {
        parts.push(
          `ON UPDATE ${this.#formatReferenceAction(column.foreign.onUpdate)}`
        );
      }
    }

    return parts.join(' ');
  }

  /** Validate type/size options and map only documented dialect-native types.
   * @param {ColumnDefinition} column - Validated named column/projection/schema candidate.
   * @returns {string} Native type fragment; unused/unsupported size semantics reject.
   */
  #buildColumnType(column: ColumnDefinition): string {
    /** Explicit supported schema type vocabulary; no raw native type text. */
    const supported = new Set([
      'bigint',
      'binary',
      'blob',
      'boolean',
      'char',
      'date',
      'datetime',
      'decimal',
      'double',
      'float',
      'integer',
      'json',
      'number',
      'numeric',
      'smallint',
      'text',
      'time',
      'timestamp',
      'uuid',
      'varchar',
    ]);
    if (
      !supported.has(column.type) ||
      (column.length !== undefined &&
        (!Number.isSafeInteger(column.length) ||
          column.length < 1 ||
          column.length > 65535)) ||
      (column.precision !== undefined &&
        (!Number.isSafeInteger(column.precision) ||
          column.precision < 1 ||
          column.precision > 65)) ||
      (column.scale !== undefined &&
        (!Number.isSafeInteger(column.scale) ||
          column.scale < 0 ||
          column.scale > (column.precision ?? 10)))
    ) {
      throw createDatabaseError({
        code: 'INVALID_COLUMN_TYPE',
        message: 'Invalid SQL column type or size',
      });
    }
    /** Whether this declared dialect uses the supported PostgreSQL type mappings. */
    const pg = ['pgsql', 'postgres', 'postgresql'].includes(this.#dialect.kind);
    if (
      column.length !== undefined &&
      ![
        'char',
        'varchar',
        ...(this.#dialect.kind === 'mysql' ? ['binary'] : []),
      ].includes(column.type)
    ) {
      refuseSql('UNSUPPORTED_COLUMN_SIZE');
    }
    if (
      (column.precision !== undefined || column.scale !== undefined) &&
      !['decimal', 'numeric'].includes(column.type)
    ) {
      refuseSql('UNSUPPORTED_COLUMN_SIZE');
    }
    if (pg && ['blob', 'binary'].includes(column.type)) {
      return 'BYTEA';
    }
    if (pg && column.type === 'datetime') {
      return 'TIMESTAMP';
    }
    if (pg && column.type === 'double') {
      return 'DOUBLE PRECISION';
    }
    if (this.#dialect.kind === 'mysql' && column.type === 'uuid') {
      return 'CHAR(36)';
    }
    if (
      this.#dialect.kind === 'mysql' &&
      column.type === 'binary' &&
      column.length !== undefined
    ) {
      return `BINARY(${column.length})`;
    }
    switch (column.type) {
      case 'varchar':
      case 'char':
        return `${column.type.toUpperCase()}(${column.length ?? 255})`;
      case 'decimal':
      case 'numeric':
        return `${column.type.toUpperCase()}(${column.precision ?? 10}, ${column.scale ?? 0})`;
      case 'integer':
      case 'number':
        return 'INTEGER';
      case 'boolean':
        return 'BOOLEAN';
      case 'datetime':
        return 'DATETIME';
      default:
        return column.type.toUpperCase();
    }
  }

  /** Map only allowlisted native foreign-key actions.
   * @param {string} action - Validated native reference action.
   * @returns {string} Fixed native action keyword.
   */
  #formatReferenceAction(action: string): string {
    if (action === 'setDefault' && this.#dialect.kind === 'mysql') {
      refuseSql('UNSUPPORTED_REFERENCE_ACTION');
    }
    switch (action) {
      case 'setNull':
        return 'SET NULL';
      case 'setDefault':
        return 'SET DEFAULT';
      case 'noAction':
        return 'NO ACTION';
      case 'cascade':
      case 'restrict':
        return action.toUpperCase();
      default:
        throw createDatabaseError({
          code: 'INVALID_REFERENCE_ACTION',
          message: 'Unsupported foreign-key action',
        });
    }
  }

  /** Recurse through one validated logical form or a structured scalar predicate.
   * @param {WhereClause} where - Structured logical/scalar filter tree.
   * @returns {string} Generated filter fragment; no raw textual predicate.
   */
  #compileWhere(where: WhereClause): string {
    if (!where || typeof where !== 'object' || Array.isArray(where)) {
      refuseSql('INVALID_WHERE');
    }
    /** Own logical predicate keys; mixed Boolean forms reject. */
    const groups = ['and', 'or', 'not'].filter((k) => Object.hasOwn(where, k));
    if (groups.length > 1) {
      refuseSql('INVALID_WHERE');
    }
    if (groups.length) {
      sqlObject(where, groups);
    }
    if ('and' in where) {
      if (!Array.isArray(where.and) || !where.and.length) {
        throw createDatabaseError({
          code: 'INVALID_WHERE',
          message: 'Empty AND clause',
        });
      }
      return `(${where.and.map((entry) => this.#compileWhere(entry)).join(' AND ')})`;
    }

    if ('or' in where) {
      if (!Array.isArray(where.or) || !where.or.length) {
        throw createDatabaseError({
          code: 'INVALID_WHERE',
          message: 'Empty OR clause',
        });
      }
      return `(${where.or.map((entry) => this.#compileWhere(entry)).join(' OR ')})`;
    }

    if ('not' in where) {
      return `(NOT ${this.#compileWhere(where.not)})`;
    }

    return this.#compilePredicate(where);
  }

  /** Validate operator-specific fields and bind scalar operands in lexical order.
   * @param {WherePredicate} predicate - Operator-specific structured predicate.
   * @returns {string} Generated predicate; NULL/membership/quantifier policies remain explicit.
   */
  #compilePredicate(predicate: WherePredicate): string {
    /** Exact clause/discriminator allowlists for structured schema or expression validation. */
    const fields: Record<string, string[]> = {
      exists: ['query'],
      notExists: ['query'],
      between: ['field', 'from', 'to'],
      in: ['field', 'values'],
      notIn: ['field', 'values'],
      isNull: ['field'],
      isNotNull: ['field'],
      any: ['field', 'query'],
      all: ['field', 'query'],
      eq: ['field', 'value'],
      ne: ['field', 'value'],
      gt: ['field', 'value'],
      gte: ['field', 'value'],
      lt: ['field', 'value'],
      lte: ['field', 'value'],
      like: ['field', 'value'],
      ilike: ['field', 'value'],
    };
    if (!Object.hasOwn(fields, predicate.operator)) {
      refuseSql('INVALID_OPERATOR');
      throw new TypeError('SQL predicate fields are missing');
    }
    /** Predicate-specific field table selected from the fixed operator union. */
    const predicateFields = fields[predicate.operator];
    if (!predicateFields) {
      throw new TypeError('SQL predicate fields are missing');
    }
    sqlObject(predicate, ['operator', ...predicateFields]);
    if (this.#checkLiteral && predicate.query) {
      refuseSql('UNSUPPORTED_CHECK');
    }
    if (predicate.operator === 'exists' || predicate.operator === 'notExists') {
      if (!predicate.query) {
        throw createDatabaseError({
          code: 'INVALID_WHERE',
          message: `${predicate.operator} predicates require a query`,
        });
      }

      /** Fixed EXISTS/NOT EXISTS keyword selected from the validated operator. */
      const keyword = predicate.operator === 'exists' ? 'EXISTS' : 'NOT EXISTS';
      return `${keyword} (${this.#buildSelect(predicate.query)})`;
    }

    if (typeof predicate.field === 'string' && predicate.field.includes('*')) {
      refuseSql('INVALID_IDENTIFIER');
    }
    /** Validated compiled predicate operand, required for scalar comparisons. */
    const field = predicate.field
      ? this.#compileSelectable(predicate.field)
      : '';
    if (!field) {
      refuseSql('INVALID_WHERE');
    }
    if (
      (predicate.operator === 'eq' || predicate.operator === 'ne') &&
      predicate.value === null
    ) {
      return `${field} IS${predicate.operator === 'ne' ? ' NOT' : ''} NULL`;
    }
    if ('value' in predicate && predicate.value === null) {
      refuseSql('INVALID_NULL_COMPARISON');
    }
    /** Fixed allowlisted native comparison operator. */
    const operator = ['any', 'all'].includes(predicate.operator)
      ? '='
      : this.#mapOperator(predicate.operator);

    switch (predicate.operator) {
      case 'between':
        if (predicate.from === undefined || predicate.to === undefined) {
          throw createDatabaseError({
            code: 'INVALID_WHERE',
            message: 'BETWEEN requires bounds',
          });
        }
        return `${field} BETWEEN ${this.#compileValue(predicate.from)} AND ${this.#compileValue(predicate.to)}`;
      case 'in':
      case 'notIn':
        if (
          !Array.isArray(predicate.values) ||
          predicate.values.length === 0 ||
          predicate.values.length > 10000
        ) {
          throw createDatabaseError({
            code: 'INVALID_WHERE',
            message: 'IN requires bounded values',
          });
        }
        return `${field} ${operator} (${(predicate.values ?? []).map((entry) => this.#compileValue(entry)).join(', ')})`;
      case 'isNull':
      case 'isNotNull':
        return `${field} ${operator}`;
      case 'any':
      case 'all':
        if (this.#dialect.kind === 'sqlite') {
          refuseSql('UNSUPPORTED_QUANTIFIER');
        }
        if (!predicate.query) {
          throw createDatabaseError({
            code: 'INVALID_WHERE',
            message: `${predicate.operator} predicates require a query`,
          });
        }
        return `${field} = ${predicate.operator.toUpperCase()} (${this.#buildSelect(predicate.query)})`;
      default:
        if (!field || predicate.value === undefined) {
          throw createDatabaseError({
            code: 'INVALID_WHERE',
            message: 'WHERE requires field and value',
          });
        }
        return `${field} ${operator} ${this.#compileValue(predicate.value)}`;
    }
  }

  /** Map only supported native comparison keywords.
   * @param {ComparisonOperator} operator - Allowlisted comparison/binary operator, never SQL text.
   * @returns {string} Fixed native operator.
   */
  #mapOperator(operator: ComparisonOperator): string {
    switch (operator) {
      case 'eq':
        return '=';
      case 'ne':
        return '<>';
      case 'gt':
        return '>';
      case 'gte':
        return '>=';
      case 'lt':
        return '<';
      case 'lte':
        return '<=';
      case 'like':
        return 'LIKE';
      case 'ilike':
        if (this.#dialect.kind === 'sqlite' || this.#dialect.kind === 'mysql') {
          refuseSql('UNSUPPORTED_ILIKE');
        }
        return this.#dialect.ilikeOperator ?? 'ILIKE';
      case 'in':
        return 'IN';
      case 'notIn':
        return 'NOT IN';
      case 'isNull':
        return 'IS NULL';
      case 'isNotNull':
        return 'IS NOT NULL';
      default:
        throw createDatabaseError({
          code: 'INVALID_OPERATOR',
          message: 'Unsupported SQL comparison operator',
        });
    }
  }

  /** Compile named columns, supported functions/binary expressions or explicit literals.
   * @param {string | QueryExpression} input - Validated inert operand/literal candidate.
   * @returns {string} Validated SQL operand; caller objects never become raw code.
   */
  #compileSelectable(input: string | QueryExpression): string {
    if (typeof input === 'string') {
      if (input === '*') {
        return '*';
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*\.\*$/.test(input)) {
        return `${this.#quote(input.slice(0, -2))}.*`;
      }
      return this.#quote(input);
    }

    if (
      typeof input === 'number' ||
      typeof input === 'boolean' ||
      input === null
    ) {
      return this.#compileValue(input);
    }

    if (!input || typeof input !== 'object') {
      refuseSql('INVALID_EXPRESSION');
    }
    /** Exact structured expression fields per recognized discriminator. */
    const expressionFields: Record<string, string[]> = {
      column: ['name', 'table'],
      value: ['value'],
      function: ['name', 'args'],
      binary: ['operator', 'left', 'right'],
    };
    if (
      !Object.hasOwn(input, 'kind') ||
      !Object.hasOwn(expressionFields, input.kind)
    ) {
      refuseSql('INVALID_EXPRESSION');
      throw new TypeError('SQL expression fields are missing');
    }
    /** Expression-specific field table selected from the fixed input kind. */
    const inputFields = expressionFields[input.kind];
    if (!inputFields) {
      throw new TypeError('SQL expression fields are missing');
    }
    sqlObject(input, ['kind', ...inputFields]);
    if (input.kind === 'function' && input.args !== undefined) {
      sqlList(input.args, 64);
    }
    switch (input.kind) {
      case 'column':
        if (input.table !== undefined) {
          this.#quote(input.table);
        }
        return input.table
          ? `${this.#quote(input.table)}.${this.#quote(input.name)}`
          : this.#quote(input.name);
      case 'value':
        if (!Object.hasOwn(input, 'value')) {
          refuseSql('INVALID_EXPRESSION');
        }
        if (this.#checkLiteral) {
          return this.#compileDefaultValue(input.value);
        }
        return this.#bindValue(input.value);
      case 'function': {
        /** Validated mapped native function and arity before formatting arguments. */
        const functionName = this.#safeFunction(
          input.name,
          (input.args ?? []).length
        );
        /** Compiled function operands in their existing parameter/literal mode. */
        const args = (input.args ?? [])
          .map((entry) => this.#compileSelectable(entry))
          .join(', ');
        return ['CURRENT_DATE', 'CURRENT_TIMESTAMP'].includes(functionName)
          ? functionName
          : `${functionName}(${args})`;
      }
      case 'binary':
        return `(${this.#compileSelectable(input.left)} ${this.#mapBinaryOperator(input.operator)} ${this.#compileSelectable(input.right)})`;
      default:
        throw createDatabaseError({
          code: 'INVALID_EXPRESSION',
          message: `Unsupported query expression "${
            (
              input as QueryExpression & {
                /** Explicit dialect label used only for supported policy branches. */
                kind?: string;
              }
            ).kind
          }"`,
        });
    }
  }

  /** Bind ordinary query data or compile the explicit structured expression form.
   * @param {unknown} input - Validated inert operand/literal candidate.
   * @returns {string} Placeholder/operand in the current statement order.
   */
  #compileValue(input: unknown): string {
    if (this.#checkLiteral) {
      return this.#compileDefaultValue(input);
    }
    if (isStructuredQueryExpression(input)) {
      return this.#compileSelectable(input as QueryExpression);
    }

    return this.#bindValue(input);
  }

  /** Append a detached JSON value before requesting its one-based native placeholder.
   * @param {unknown} input - Validated inert operand/literal candidate.
   * @returns {string} Native parameter marker, never interpolated content.
   */
  #bindValue(input: unknown): string {
    // AST snapshots have null prototypes; driver JSON values retain ordinary JSON object prototypes.
    this.#params.push(
      input !== null && typeof input === 'object'
        ? JSON.parse(JSON.stringify(input))
        : input
    );
    return this.#dialect.placeholder(this.#params.length);
  }

  /** Encode only supported validated DDL literals/expressions inline.
   * @param {unknown} input - Validated inert operand/literal candidate.
   * @returns {string} Native DDL literal; unsafe text/control/backslash semantics reject.
   */
  #compileDefaultValue(input: unknown): string {
    if (isStructuredQueryExpression(input)) {
      /** Explicit structured default/CHECK expression, never arbitrary SQL. */
      const expression = input;
      /** Exact clause/discriminator allowlists for structured schema or expression validation. */
      const fields: Record<string, string[]> = {
        column: ['name', 'table'],
        value: ['value'],
        function: ['name', 'args'],
        binary: ['operator', 'left', 'right'],
      };
      if (!Object.hasOwn(fields, expression.kind)) {
        refuseSql('INVALID_DEFAULT');
        throw new TypeError('SQL default expression fields are missing');
      }
      /** Default-expression field table selected from the fixed expression kind. */
      const defaultFields = fields[expression.kind];
      if (!defaultFields) {
        throw new TypeError('SQL default expression fields are missing');
      }
      sqlObject(expression, ['kind', ...defaultFields]);
      if (expression.kind === 'function' && expression.args !== undefined) {
        sqlList(expression.args, 64);
      }

      switch (expression.kind) {
        case 'value':
          return this.#compileDefaultValue(expression.value);
        case 'function': {
          /** Validated mapped native function and arity before formatting arguments. */
          const functionName = this.#safeFunction(
            expression.name,
            (expression.args ?? []).length
          );
          /** Validated default-expression arguments before inline compilation. */
          const argsList = expression.args ?? [];

          if (
            argsList.length === 0 &&
            (functionName === 'CURRENT_TIMESTAMP' ||
              functionName === 'CURRENT_DATE')
          ) {
            return functionName;
          }

          /** Compiled function operands in their existing parameter/literal mode. */
          const args = argsList
            .map((entry) => this.#compileDefaultValue(entry))
            .join(', ');
          return `${functionName}(${args})`;
        }
        case 'column':
          if (!this.#checkLiteral) {
            refuseSql('UNSUPPORTED_DEFAULT');
          }
          if (expression.table !== undefined) {
            this.#quote(expression.table);
          }
          return expression.table
            ? `${this.#quote(expression.table)}.${this.#quote(expression.name)}`
            : this.#quote(expression.name);
        case 'binary':
          return `(${this.#compileDefaultValue(expression.left)} ${this.#mapBinaryOperator(expression.operator)} ${this.#compileDefaultValue(expression.right)})`;
        default:
          throw createDatabaseError({
            code: 'INVALID_DEFAULT',
            message: `Unsupported default expression "${
              (
                expression as QueryExpression & {
                  /** Explicit dialect label used only for supported policy branches. */
                  kind?: string;
                }
              ).kind
            }"`,
          });
      }
    }

    if (typeof input === 'string') {
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      if (/[\x00-\x1f\x7f]/.test(input) || input.includes('\\')) {
        refuseSql('UNSUPPORTED_DDL_LITERAL');
      }
      return `'${input.replace(/'/g, "''")}'`;
    }

    if (typeof input === 'number') {
      if (!Number.isFinite(input)) {
        throw createDatabaseError({
          code: 'INVALID_DEFAULT',
          message: 'Numeric default values must be finite',
        });
      }

      return String(input);
    }

    if (typeof input === 'bigint') {
      return input.toString();
    }

    if (typeof input === 'boolean') {
      return input ? 'TRUE' : 'FALSE';
    }

    if (input === null) {
      return 'NULL';
    }

    throw createDatabaseError({
      code: 'INVALID_DEFAULT',
      message: `Unsupported default value type "${typeof input}"`,
    });
  }

  /** Check function arity, dialect and DDL literal restrictions before selecting a mapped name.
   * @param {DatabaseFunctionName} name - Shared allowlisted function name.
   * @param {number} count - Explicit validated argument count.
   * @returns {string} Safe fixed native function spelling.
   */
  #safeFunction(name: DatabaseFunctionName, count: number): string {
    /** Fixed argument-count bounds for supported functions. */
    const arity: Record<string, [number, number]> = {
      ABS: [1, 1],
      AVG: [1, 1],
      COALESCE: [2, 64],
      CONCAT: [2, 64],
      COUNT: [1, 1],
      CURRENT_DATE: [0, 0],
      CURRENT_TIMESTAMP: [0, 0],
      DAY: [1, 1],
      DATE_DIFF: [2, 2],
      LEN: [1, 1],
      LOWER: [1, 1],
      LTRIM: [1, 1],
      MAX: [1, 1],
      MIN: [1, 1],
      MONTH: [1, 1],
      NOW: [0, 0],
      ROUND: [1, 2],
      RTRIM: [1, 1],
      SUBSTRING: [2, 3],
      SUM: [1, 1],
      TRIM: [1, 1],
      UPPER: [1, 1],
      YEAR: [1, 1],
    };
    /** Supported function arity interval selected from the fixed SQL function table. */
    const bounds = arity[name];
    if (!bounds || count < bounds[0] || count > bounds[1]) {
      refuseSql('INVALID_FUNCTION');
    }
    /** Supported shared function names, further restricted by dialect and literal context. */
    const valid = new Set([
      'ABS',
      'AVG',
      'COALESCE',
      'CONCAT',
      'COUNT',
      'CURRENT_DATE',
      'CURRENT_TIMESTAMP',
      'DAY',
      'DATE_ADD',
      'DATE_DIFF',
      'LEN',
      'LOWER',
      'LTRIM',
      'MAX',
      'MIN',
      'MONTH',
      'NOW',
      'ROUND',
      'RTRIM',
      'SUBSTRING',
      'SUM',
      'TRIM',
      'UPPER',
      'YEAR',
    ]);
    if (!valid.has(name)) {
      throw createDatabaseError({
        code: 'INVALID_FUNCTION',
        message: 'Unsupported SQL function',
      });
    }
    if (
      name === 'DATE_ADD' ||
      (name === 'DATE_DIFF' && this.#dialect.kind !== 'mysql') ||
      (['DAY', 'MONTH', 'YEAR'].includes(name) &&
        this.#dialect.kind !== 'mysql') ||
      (name === 'CONCAT' && this.#dialect.kind === 'sqlite')
    ) {
      refuseSql('UNSUPPORTED_FUNCTION');
    }
    if (
      this.#checkLiteral &&
      [
        'AVG',
        'COUNT',
        'MAX',
        'MIN',
        'SUM',
        'NOW',
        'CURRENT_DATE',
        'CURRENT_TIMESTAMP',
      ].includes(name)
    ) {
      refuseSql('UNSUPPORTED_CHECK');
    }
    /** Reviewed dialect-native function spelling; no user SQL name passthrough. */
    const fallback: Partial<Record<DatabaseFunctionName, string>> = {
      LEN: this.#dialect.kind === 'mysql' ? 'CHAR_LENGTH' : 'LENGTH',
      NOW: this.#dialect.kind === 'sqlite' ? 'CURRENT_TIMESTAMP' : 'NOW',
      DATE_DIFF: 'DATEDIFF',
    };
    /** Validated mapped native function identifier. */
    const resolved = this.#dialect.functions[name] ?? fallback[name] ?? name;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(resolved)) {
      throw createDatabaseError({
        code: 'INVALID_FUNCTION',
        message: 'Unsafe dialect SQL function',
      });
    }
    return resolved;
  }

  /** Map only the supported binary operator vocabulary.
   * @param {string} operator - Allowlisted comparison/binary operator, never SQL text.
   * @returns {string} Fixed native operator; MySQL binary concat rejects.
   */
  #mapBinaryOperator(operator: string): string {
    switch (operator) {
      case 'add':
        return '+';
      case 'sub':
        return '-';
      case 'mul':
        return '*';
      case 'div':
        return '/';
      case 'mod':
        return '%';
      case 'concat':
        if (this.#dialect.kind === 'mysql') {
          refuseSql('UNSUPPORTED_CONCAT');
        }
        return '||';
      default:
        throw createDatabaseError({
          code: 'INVALID_OPERATOR',
          message: `Unsupported binary operator "${operator}"`,
        });
    }
  }

  /** Quote validated optional database and table identifiers separately.
   * @param {string | undefined} databaseName - Optional validated native database identity.
   * @param {string} table - Validated authored table identifier.
   * @returns {string} Qualified native table reference.
   */
  #qualifiedTable(databaseName: string | undefined, table: string): string {
    if (databaseName !== undefined) {
      this.#quote(databaseName);
    }
    return databaseName
      ? `${this.#quote(databaseName)}.${this.#quote(table)}`
      : this.#quote(table);
  }

  /** Require a flat validated identifier for aliases/DDL column names.
   * @param {string} identifier - Authored identifier checked before native quoting.
   * @returns {void} Rejects qualified aliases rather than truncating them.
   */
  #flat(identifier: string): void {
    if (typeof identifier !== 'string' || identifier.includes('.')) {
      refuseSql('INVALID_IDENTIFIER');
    }
    this.#quote(identifier);
  }

  /** Validate each identifier segment before invoking the trusted dialect quote callback.
   * @param {string} identifier - Authored identifier checked before native quoting.
   * @returns {string} Native quoted identifier.
   */
  #quote(identifier: string): string {
    if (
      typeof identifier !== 'string' ||
      identifier.length > 255 ||
      !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(
        identifier
      ) ||
      identifier
        .split('.')
        .some(
          (segment) =>
            segment.length > 128 ||
            ['__proto__', 'constructor', 'prototype'].includes(
              segment.toLowerCase()
            )
        )
    ) {
      throw createDatabaseError({
        code: 'INVALID_IDENTIFIER',
        message: 'Unsafe SQL identifier',
      });
    }
    return identifier
      .split('.')
      .map((segment) => this.#dialect.quoteIdentifier(segment))
      .join('.');
  }

  /** Detach and reset this statement parameter buffer.
   * @returns {unknown[]} Parameters belonging only to the completed statement.
   */
  #drainParams(): unknown[] {
    /** Detached parameter list corresponding to this exact generated statement. */
    const params = [...this.#params];
    this.#params.length = 0;
    return params;
  }
}

/** Snapshot bounded own JSON and compile using a fresh per-operation compiler.
 * @param {SqlDialectDefinition} dialect - Reviewed immutable-by-snapshot native compiler policy.
 * @param {QueryOperation} operation - Bounded own-data structured operation.
 * @returns {SqlCompilation} No connection opens; trusted dialect callbacks are not sandboxed.
 */
export function compileSql(
  dialect: SqlDialectDefinition,
  operation: QueryOperation
): SqlCompilation {
  return new SqlCompiler(dialect).compile(snapshotSqlOperation(operation));
}

/** Preserve native count/identity precision while keeping SQL, parameters and raw results private.
 * @param {QueryOperation} operation - Actual structured operation discriminator.
 * @param {DatabaseExecutionContext} context - Configured private connection identity.
 * @param {string} statement - Generated prepared SQL.
 * @param {unknown[]} params - Separate private bound values.
 * @param {unknown} native - Private native driver result.
 * @returns {DatabaseResult} Normalized result; post-write validation does not roll back native work. */
const normalizeResult = (
  operation: QueryOperation,
  context: DatabaseExecutionContext,
  statement: string,
  params: unknown[],
  native: unknown
): DatabaseResult => {
  /** Native result interpreted only for the supported rows/count/generated-key fields. */
  const result = (native ?? {}) as
    | {
        rows?: unknown[];
        rowCount?: number;
        affectedRows?: number;
        insertId?: number | string;
        changes?: number;
        lastInsertRowid?: number | bigint;
      }
    | unknown[];

  if (Array.isArray(result)) {
    return {
      ok: true,
      connection: context.connection.slug,
      connector: context.connection.connector,
      operation: operation.op,
      rows: result,
      rowCount: result.length,
      native,
      query: statement,
      params,
    };
  }

  // Reject malformed native counts without replacing zero or inventing affected rows.
  for (const count of [result.rowCount, result.affectedRows, result.changes]) {
    if (
      count !== undefined &&
      count !== null &&
      (!Number.isSafeInteger(count) || count < 0)
    ) {
      refuseSql('INVALID_RESULT_COUNT');
    }
  }
  if (operation.op === 'insert') {
    // Inspect generated numeric IDs only for actual inserts; lost precision is never guessed.
    for (const key of [result.insertId, result.lastInsertRowid]) {
      if (typeof key === 'number' && !Number.isSafeInteger(key)) {
        refuseSql('UNSAFE_GENERATED_KEY');
      }
    }
  }
  return {
    ok: true,
    connection: context.connection.slug,
    connector: context.connection.connector,
    operation: operation.op,
    rows: result.rows,
    rowCount: result.rowCount ?? result.rows?.length,
    counts: {
      affected:
        (result.affectedRows ??
          result.changes ??
          (['insert', 'update', 'delete'].includes(operation.op)
            ? result.rowCount
            : undefined)) !== undefined
          ? 'exact'
          : 'unknown',
      affectedMeaning: 'engine',
    },
    affectedCount:
      result.affectedRows ??
      result.changes ??
      (['insert', 'update', 'delete'].includes(operation.op)
        ? result.rowCount
        : undefined),
    // Preserve native ID precedence and read order; only inserts expose generated identities.
    insertedIds: (() => {
      if (operation.op !== 'insert') {
        return undefined;
      }
      if (result.insertId !== undefined) {
        return [result.insertId];
      }
      if (result.lastInsertRowid !== undefined) {
        return [
          typeof result.lastInsertRowid === 'bigint'
            ? result.lastInsertRowid.toString()
            : result.lastInsertRowid,
        ];
      }
      return undefined;
    })(),
    native,
    query: statement,
    params,
  };
};

/** Invoke the explicitly configured borrowed executor/client/pool without opening or closing it.
 * @param {SqlConnectorOptions} options - Trusted executable native transport.
 * @param {string} statement - Prepared generated SQL.
 * @param {unknown[]} params - Separate private native values.
 * @param {QueryOperation} operation - Validated structured source operation.
 * @returns {MaybePromise<unknown>} Native sync/async result; failure is never replayed. */
const runSql = (
  options: SqlConnectorOptions,
  statement: string,
  params: unknown[],
  operation: QueryOperation
): MaybePromise<unknown> => {
  if (typeof options.executor === 'function') {
    return options.executor(statement, params, operation);
  }

  /** Explicit borrowed client or pool; host owns lifecycle and transport configuration. */
  const client = options.client ?? options.pool;
  if (client?.execute) {
    return client.execute(statement, params);
  }

  if (client?.query) {
    return client.query(statement, params);
  }

  throw createDatabaseError({
    code: 'MISSING_EXECUTOR',
    message:
      'SQL connector requires options.executor, options.client, or options.pool',
  });
};

/** Snapshot trusted dialect metadata and bind the shared compiler to an explicit borrowed executor.
 * @param {SqlDialectDefinition} dialect - Reviewed quote/placeholder/function callbacks and support flags.
 * @param {SqlConnectorOptions} options - Trusted executor/client/pool and optional strict sync policy.
 * @returns {DatabaseConnector} Inert facade; owns no native connection and exposes no fake transaction guarantee. */
export const createSqlConnector = (
  dialect: SqlDialectDefinition,
  options: SqlConnectorOptions
): DatabaseConnector => {
  dialect = new SqlCompiler(dialect).dialect;
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    refuseSql('INVALID_EXECUTOR');
  }
  if (
    options.synchronous !== undefined &&
    typeof options.synchronous !== 'boolean'
  ) {
    refuseSql('INVALID_EXECUTOR');
  }
  if (
    options.executor !== undefined &&
    typeof options.executor !== 'function'
  ) {
    refuseSql('INVALID_EXECUTOR');
  }
  options = { ...options };
  return {
    kind: dialect.kind,
    capabilities: {
      returning: dialect.supportsReturning ? 'supported' : 'unsupported',
      transactions: 'unsupported',
      cancellation: 'unsupported',
      schema: dialect.supportsDdl === false ? 'unsupported' : 'supported',
      indexes: dialect.supportsDdl === false ? 'unsupported' : 'supported',
      nativeAggregation: 'unsupported',
    },
    options,
    /** Compile fully before dispatch, preserving strict synchronous and ordered async paths.
     * @param {QueryOperation} operation - Bounded own-data structured operation.
     * @param {DatabaseExecutionContext} context - Explicit private connection identity and native execution controls.
     * @returns {MaybePromise<DatabaseResult>} Private normalized result; facade owns no injected native resource.
     */
    execute(operation, context) {
      operation = snapshotSqlOperation(operation);
      if (
        (operation.op === 'createDb' || operation.op === 'dropDb') &&
        (options.locked || options.lockDatabase)
      ) {
        throw createDatabaseError({
          code: 'DATABASE_LOCKED',
          message: `Operation "${operation.op}" is locked for connection "${context.connection.slug}"`,
        });
      }

      if (
        operation.op === 'switchDB' &&
        (options.fixedDatabase || options.database)
      ) {
        throw createDatabaseError({
          code: 'DATABASE_FIXED',
          message: `Connection "${context.connection.slug}" uses a fixed database and cannot be switched`,
        });
      }

      /** Validated statement/parameter pairs before the first native call. */
      const compilation = compileSql(dialect, operation);
      if (compilation.statements.length === 1) {
        /** Complete generated SQL in lexical placeholder order. */
        const statement = compilation.statements[0];
        if (!statement) {
          refuseSql('EMPTY_STATEMENT');
          throw new TypeError('Compiled SQL statement is missing');
        }
        /** Detached parameter list corresponding to this exact generated statement. */
        const params = compilation.params[0] ?? [];
        /** Actual native completion; strict synchronous mode rejects thenables without issuing a later tail. */
        const native = runSql(options, statement, params, operation);

        if (
          native &&
          (typeof native === 'object' || typeof native === 'function') &&
          typeof (native as { then?: unknown }).then === 'function'
        ) {
          if (options.synchronous) {
            void Promise.resolve(native).catch(() => {});
            refuseSql('ASYNCHRONOUS_EXECUTOR');
          }
          return Promise.resolve(native).then((value) =>
            normalizeResult(operation, context, statement, params, value)
          );
        }

        return normalizeResult(operation, context, statement, params, native);
      }

      if (options.synchronous) {
        /** Ordered native outcomes; multiple statements remain independently committed unless the host pins them. */
        const results = compilation.statements.map((statement, index) => {
          /** Detached parameter list corresponding to this exact generated statement. */
          const params = compilation.params[index] ?? [];
          /** Actual native completion; strict synchronous mode rejects thenables without issuing a later tail. */
          const native = runSql(options, statement, params, operation);
          if (
            native &&
            (typeof native === 'object' || typeof native === 'function') &&
            typeof (native as { then?: unknown }).then === 'function'
          ) {
            void Promise.resolve(native).catch(() => {});
            refuseSql('ASYNCHRONOUS_EXECUTOR');
          }
          return normalizeResult(operation, context, statement, params, native);
        });
        /** Final normalized result used for the operation-level return value. */
        const lastResult = results[results.length - 1];
        if (!lastResult) {
          throw new TypeError('Compiled SQL result is missing');
        }
        return {
          ...lastResult,
          native: results.map((result) => result.native),
          warnings: [`Executed ${results.length} SQL statements`],
        };
      }
      return (async () => {
        /** Ordered native outcomes; multiple statements remain independently committed unless the host pins them. */
        const results: DatabaseResult[] = [];

        // Execute async multi-statement output in authored order; no transaction is implied.
        for (const [index, statement] of compilation.statements.entries()) {
          if (!statement) {
            throw new TypeError('Compiled SQL statement is missing');
          }
          /** Detached parameter list corresponding to this exact generated statement. */
          const params = compilation.params[index] ?? [];
          /** Actual native completion; strict synchronous mode rejects thenables without issuing a later tail. */
          const native = await runSql(options, statement, params, operation);
          results.push(
            normalizeResult(operation, context, statement, params, native)
          );
        }

        /** Final normalized result used for the operation-level return value. */
        const lastResult = results[results.length - 1];
        if (!lastResult) {
          throw new TypeError('Compiled SQL result is missing');
        }
        return {
          ...lastResult,
          native: results.map((entry) => entry.native),
          warnings: [`Executed ${results.length} SQL statements`],
        };
      })();
    },
  };
};
