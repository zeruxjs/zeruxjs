import {
  ownsTransaction,
  transactionError,
  negotiateTransaction,
  runPinnedTransaction,
} from './transactions.js';
import type {
  PinnedTransactionAdapter,
  TransactionDatabase,
  TransactionOptions,
} from './transactions.js';
import {
  capabilities,
  executionPolicy,
  queryOptions,
  checkCapabilities,
  executionError,
} from './execution.js';
import type {
  DatabaseCapabilities,
  DatabaseExecutionPolicy,
  DatabaseQueryOptions,
  DatabaseQueryMetric,
} from './types.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  AlterTableOperation,
  CreateDbOperation,
  CreateIndexOperation,
  CreateTableOperation,
  DatabaseConnector,
  DatabaseFacade,
  DatabaseManager,
  DatabaseManagerConfig,
  DatabaseResult,
  DeleteOperation,
  DropDbOperation,
  DropIndexOperation,
  DropTableOperation,
  InsertOperation,
  MaybePromise,
  NormalizedConnectionConfig,
  QueryOperation,
  SelectOperation,
  SwitchDbOperation,
  TruncateTableOperation,
  UpdateOperation,
} from './types.js';
import {
  createDatabaseError,
  assertJsonSerializable,
  extractConnectorFactory,
  isPromiseLike,
  mapMaybePromise,
  normalizeManagerConfig,
  redactConnectionOptions,
  resolveReferences,
  validateOperation,
} from './utils.js';

interface ConnectionState {
  /** Private normalized connector identity/options, never a public response. */
  config: NormalizedConnectionConfig;
  /** Acquired native lifecycle owner. */
  connector: DatabaseConnector;
  /** Detached structured API guarantee snapshot. */
  capabilities: Readonly<DatabaseCapabilities>;
}

/** Resolve only configured package specifiers from the application before package-local import.
 * @param {string} packageName - Trusted host-selected connector package; arbitrary paths reject.
 * @returns {Promise<Record<string,unknown>>} Imported executable module namespace, never request-selected. */
const importConnectorPackage = async (
  packageName: string
): Promise<Record<string, unknown>> => {
  if (
    !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[a-z0-9][a-z0-9._/-]*)?$/i.test(
      packageName
    ) ||
    packageName.includes('..')
  ) {
    throw createDatabaseError({
      code: 'INVALID_CONNECTOR',
      message: 'Database connector must be a package specifier',
    });
  }
  /** Application-local resolver rooted at the current project package manifest. */
  const appRequire = createRequire(path.join(process.cwd(), 'package.json'));
  let resolved: string | undefined;
  try {
    resolved = appRequire.resolve(packageName);
  } catch {
    /* Workspaces can resolve dependencies relative to their own package. */
  }
  return (await import(
    resolved ? pathToFileURL(resolved).href : packageName
  )) as Record<string, unknown>;
};

/**
 * Title: Database manager implementation
 * Description: Validates config, loads connector packages, and routes JSON-only operations to the correct connection.
 * Global Variables: none
 */
class DatabaseManagerImpl implements DatabaseManager {
  /** Configured default identity, fixed for this manager lifetime. */
  public readonly defaultConnectionSlug: string;
  /** Configured inventory snapshot; native owners remain in the private map. */
  public readonly connectionSlugs: string[];

  /** Acquired connector owners, released in reverse order. */
  readonly #connections: Map<string, ConnectionState>;
  /** Permanent admission fence; set before signalling active work. */
  #closed = false;
  /** Validated package-owned execution/drain limits. */
  #policy: ReturnType<typeof executionPolicy>;
  /** Accepted work retained until native settlement, independently from caller waits. */
  #pending = new Set<{ controller: AbortController; settled: Promise<void> }>();
  /** Idempotent disconnect promise shared by all callers. */
  #closing?: Promise<void>;

  /** Own the acquired connection map and validated execution policy.
   * @param {string} defaultConnectionSlug - Validated default registered slug.
   * @param {Map<string, ConnectionState>} connections - Acquired connector states transferred into this manager owner.
   * @param {DatabaseExecutionPolicy} policy - Package-owned pending/batch/shutdown policy.
   */
  constructor(
    defaultConnectionSlug: string,
    connections: Map<string, ConnectionState>,
    policy: DatabaseExecutionPolicy = {}
  ) {
    this.#policy = executionPolicy(policy);
    this.defaultConnectionSlug = defaultConnectionSlug;
    this.connectionSlugs = [...connections.keys()];
    this.#connections = connections;
  }

  /** Bind facade dispatch to an explicit registered connection.
   * @param {string} slug - Explicit configured connection slug, default the selected manager default.
   * @returns {DatabaseFacade} Facade rechecks lifecycle; native access is privileged.
   */
  getConnectionFacade(slug = this.defaultConnectionSlug): DatabaseFacade {
    /** Registered connection state looked up only while the manager is open. */
    const state = this.#getConnectionState(slug);

    return {
      transaction: (run, options) => this.transaction(run, options, slug),
      transactionCapabilities: () => this.transactionCapabilities(slug),
      capabilities: () => state.capabilities,
      slug: state.config.slug,
      name: state.config.name,
      connector: state.config.connector,
      options: redactConnectionOptions(state.config.options),
      query: (operation, options) =>
        this.query(this.#assignConnection(operation, slug), options),
      createDb: (operation, options) =>
        this.createDb(
          { ...operation, op: 'createDb', connection: slug },
          options
        ),
      dropDb: (operation, options) =>
        this.dropDb({ ...operation, op: 'dropDb', connection: slug }, options),
      switchDB: (operation, options) =>
        this.switchDB(
          { ...operation, op: 'switchDB', connection: slug },
          options
        ),
      createTable: (operation, options) =>
        this.createTable(
          { ...operation, op: 'createTable', connection: slug },
          options
        ),
      dropTable: (operation, options) =>
        this.dropTable(
          { ...operation, op: 'dropTable', connection: slug },
          options
        ),
      alterTable: (operation, options) =>
        this.alterTable(
          { ...operation, op: 'alterTable', connection: slug },
          options
        ),
      turcunateTable: (operation, options) =>
        this.turcunateTable(
          { ...operation, op: 'turcunateTable', connection: slug },
          options
        ),
      createIndex: (operation, options) =>
        this.createIndex(
          { ...operation, op: 'createIndex', connection: slug },
          options
        ),
      dropIndex: (operation, options) =>
        this.dropIndex(
          { ...operation, op: 'dropIndex', connection: slug },
          options
        ),
      insert: (operation, options) =>
        this.insert({ ...operation, op: 'insert', connection: slug }, options),
      select: (operation, options) =>
        this.select({ ...operation, op: 'select', connection: slug }, options),
      update: (operation, options) =>
        this.update({ ...operation, op: 'update', connection: slug }, options),
      delete: (operation, options) =>
        this.delete({ ...operation, op: 'delete', connection: slug }, options),
      native: () => {
        if (ownsTransaction(this)) {
          throw transactionError('TRANSACTION_SCOPE_REQUIRED');
        }
        /** Rechecked native connection state, preventing stale facade access after shutdown. */
        const current = this.#getConnectionState(slug);
        return current.connector.getNativeConnection?.() ?? current.connector;
      },
    };
  }

  /** Return connection metadata through the compatibility redaction helper.
   * @returns {NormalizedConnectionConfig[]} Known sensitive option names removed; custom secrets still require host review.
   */
  listConnections(): NormalizedConnectionConfig[] {
    return [...this.#connections.values()].map(({ config }) => ({
      ...config,
      options: redactConnectionOptions(config.options),
    }));
  }

  /** Expose a configured connector only outside the active pinned callback.
   * @param {string} slug - Explicit configured connection slug, default the selected manager default.
   * @returns {DatabaseConnector} Trusted escape hatch, invalid after disconnect.
   */
  dbAccess(slug: string): DatabaseConnector {
    if (ownsTransaction(this)) {
      throw transactionError('TRANSACTION_SCOPE_REQUIRED');
    }
    return this.#getConnectionState(slug).connector;
  }

  /** Report negotiated native pin guarantees without acquiring a session.
   * @param {string} slug - Explicit configured connection slug, default the selected manager default.
   * @returns {Readonly<import("./transactions.js").PinnedTransactionCapabilities>|undefined} Detached guarantees or absent extension.
   */
  transactionCapabilities(slug = this.defaultConnectionSlug) {
    /** Registered connection state looked up only while the manager is open. */
    const state = this.#getConnectionState(slug);
    if (
      state.capabilities.transactions !== 'supported' ||
      !state.connector.transactionAdapter
    ) {
      return undefined;
    }
    negotiateTransaction(state.connector.transactionAdapter);
    /** Negotiated native pin guarantees copied before public exposure. */
    const caps = state.connector.transactionAdapter.capabilities;
    return Object.freeze({
      ...caps,
      isolationLevels: Object.freeze([...caps.isolationLevels]),
    });
  }

  /** Run application work on one negotiated native pin through actual cleanup.
   * @param {(db: TransactionDatabase) => MaybePromise<T>} run - Trusted callback; use only its pinned facade and await work.
   * @param {TransactionOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @param {string} slug - Explicit configured connection slug, default the selected manager default.
   * @returns {Promise<T>} Callback result after commit/rollback/release; indeterminate commit failures remain explicit.
   */
  async transaction<T>(
    run: (db: TransactionDatabase) => MaybePromise<T>,
    options: TransactionOptions = {},
    slug = this.defaultConnectionSlug
  ): Promise<T> {
    if (ownsTransaction(this)) {
      throw transactionError('NESTED_TRANSACTION_UNSUPPORTED');
    }
    /** Registered connection state looked up only while the manager is open. */
    const state = this.#getConnectionState(slug);
    /** Explicit native pinned extension for this selected connector. */
    const adapter = state.connector.transactionAdapter;
    if (state.capabilities.transactions !== 'supported') {
      throw transactionError('UNSUPPORTED_TRANSACTION');
    }
    negotiateTransaction(adapter, options);
    if (this.#pending.size >= this.#policy.maxPending) {
      throw executionError('QUERY_LIMIT');
    }
    /** Manager-owned cooperative cancellation retained through actual accepted work. */
    const controller = new AbortController();
    let settle!: () => void;
    /** Admission slot and settlement receipt; caller cancellation does not free native capacity. */
    const pending = {
      controller,
      settled: new Promise<void>((resolve) => (settle = resolve)),
    };
    this.#pending.add(pending);
    try {
      return await runPinnedTransaction(
        this,
        adapter!,
        { connection: state.config },
        run,
        (execute) => {
          /** Private manager dispatch bound to the one acquired session executor. */
          const pinned = new DatabaseManagerImpl(
            slug,
            new Map([
              [
                slug,
                {
                  ...state,
                  connector: {
                    kind: state.connector.kind,
                    options: state.config.options,
                    execute,
                  },
                },
              ],
            ]),
            this.#policy
          );
          return pinned.getConnectionFacade(slug);
        },
        {
          ...options,
          signal: AbortSignal.any([
            controller.signal,
            ...(options.signal ? [options.signal] : []),
          ]),
        }
      );
    } finally {
      this.#pending.delete(pending);
      settle();
    }
  }

  /** Read normalized structured-connector guarantees.
   * @param {string} slug - Explicit configured connection slug, default the selected manager default.
   * @returns {Readonly<DatabaseCapabilities>} Known support or unknown; native engine features are separate.
   */
  capabilities(slug = this.defaultConnectionSlug) {
    return this.#getConnectionState(slug).capabilities;
  }

  /** Dispatch bounded JSON operations; arrays remain nontransactional unless used inside an actual pin.
   * @param {QueryOperation | QueryOperation[]} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult|DatabaseResult[]>} Validated connector results; native causes/results stay private.
   */
  query(
    operation: QueryOperation | QueryOperation[],
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult | DatabaseResult[]> {
    options = queryOptions(options);
    if (this.#closed) {
      throw createDatabaseError({
        code: 'MANAGER_CLOSED',
        message: 'Database manager has been disconnected',
      });
    }
    if (Array.isArray(operation)) {
      if (operation.length > this.#policy.maxBatch) {
        throw executionError('BATCH_LIMIT');
      }
      assertJsonSerializable(operation, 'Database batch');
      /** Validated detached configuration or operation inventory before dispatch. */
      const normalized = operation.map((entry) => validateOperation(entry));
      normalized.forEach((entry) => {
        if (
          entry.op === 'insert' &&
          Array.isArray(entry.values) &&
          entry.values.length > this.#policy.maxBatch
        ) {
          throw executionError('BATCH_LIMIT');
        }
        /** Registered connection state looked up only while the manager is open. */
        const state = this.#getConnectionState(
          entry.connection ?? this.defaultConnectionSlug
        );
        checkCapabilities(entry, state.capabilities, options);
      });
      /** Whether prior-result dependencies force authored sequential evaluation. */
      const requiresSequential = normalized.some(
        (entry) => entry.dependsOn !== undefined
      );

      if (!requiresSequential) {
        if (normalized.length + this.#pending.size > this.#policy.maxPending) {
          throw executionError('QUERY_LIMIT');
        }
        /** Accepted independent results; the whole batch was preflighted before starting. */
        const parallelResult = normalized.map((entry) =>
          this.#dispatch(entry, options)
        );
        return parallelResult.some(isPromiseLike)
          ? Promise.all(parallelResult as Promise<DatabaseResult>[])
          : (parallelResult as DatabaseResult[]);
      }

      /** Collected prior results used only by the dependent batch path. */
      const results: DatabaseResult[] = [];
      let current: MaybePromise<DatabaseResult[]> = results;

      normalized.forEach((entry) => {
        current = mapMaybePromise(current, (collected) => {
          /** Operation copy with previous-result references resolved before dispatch. */
          const resolved = resolveReferences(
            entry,
            collected
          ) as QueryOperation;
          // Normalize only the compatible dependency shapes; retain authored index ordering.
          let dependencies: number[] = [];
          if (Array.isArray(resolved.dependsOn)) {
            dependencies = resolved.dependsOn;
          } else if (resolved.dependsOn !== undefined) {
            dependencies = [resolved.dependsOn];
          }

          if (
            dependencies.some((index) => index < 0 || index >= collected.length)
          ) {
            throw createDatabaseError({
              code: 'INVALID_DEPENDENCY',
              message: `Operation "${resolved.op}" depends on an unavailable previous result`,
            });
          }

          if (typeof resolved.use === 'string' && dependencies.length === 1) {
            /** Sole resolved dependency used by the shorthand service configuration. */
            const dependency = dependencies[0];
            if (dependency === undefined) {
              throw new TypeError('Missing query dependency');
            }
            (
              resolved as QueryOperation & { previousValue?: unknown }
            ).previousValue = (
              collected[dependency] as unknown as
                | Record<string, unknown>
                | undefined
            )?.[resolved.use];
          }

          return mapMaybePromise(
            this.#dispatch(resolved, options),
            (result) => {
              collected.push(result);
              return collected;
            }
          );
        }) as MaybePromise<DatabaseResult[]>;
      });

      return current;
    }

    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch supported database creation through explicit connector policy.
   * @param {CreateDbOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  createDb(
    operation: CreateDbOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch explicit database removal; host authorization is separate.
   * @param {DropDbOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  dropDb(
    operation: DropDbOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch supported database selection outside pinned callbacks.
   * @param {SwitchDbOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific outcome.
   */
  switchDB(
    operation: SwitchDbOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch validated structured schema creation.
   * @param {CreateTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific supported schema outcome.
   */
  createTable(
    operation: CreateTableOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch explicit table removal.
   * @param {DropTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific supported schema outcome.
   */
  dropTable(
    operation: DropTableOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch only the selected connector supported alteration subset.
   * @param {AlterTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  alterTable(
    operation: AlterTableOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Preserve the legacy truncate spelling and native semantics.
   * @param {TruncateTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native outcome; no universal identity/reset guarantee.
   */
  turcunateTable(
    operation: TruncateTableOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch supported structured index creation.
   * @param {CreateIndexOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific index outcome.
   */
  createIndex(
    operation: CreateIndexOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch explicit supported index removal.
   * @param {DropIndexOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific index outcome.
   */
  dropIndex(
    operation: DropIndexOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch bounded prepared insertion rows.
   * @param {InsertOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native counts/identities; a batch is not automatically atomic.
   */
  insert(
    operation: InsertOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch a structured read with caller/connector-owned result limits.
   * @param {SelectOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Returned rows; manager input budgets do not cap result bytes.
   */
  select(
    operation: SelectOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch structured updates with native affected/matched/changed semantics.
   * @param {UpdateOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native count metadata; unknown/approximate counts cannot prove CAS.
   */
  update(
    operation: UpdateOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Dispatch explicit structured deletion without automatic retry.
   * @param {DeleteOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native counts; timeout does not prove rollback.
   */
  delete(
    operation: DeleteOperation,
    options: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    return this.#dispatch(validateOperation(operation), options);
  }

  /** Fail closed on disconnected/unknown connection identity.
   * @param {string} slug - Explicit configured connection slug, default the selected manager default.
   * @returns {ConnectionState} Registered live state.
   */
  #getConnectionState(slug: string): ConnectionState {
    if (this.#closed) {
      throw createDatabaseError({
        code: 'MANAGER_CLOSED',
        message: 'Database manager has been disconnected',
      });
    }
    /** Registered connection state looked up only while the manager is open. */
    const state = this.#connections.get(slug);
    if (!state) {
      throw createDatabaseError({
        code: 'UNKNOWN_CONNECTION',
        message: `Database connection "${slug}" is not registered`,
      });
    }

    return state;
  }

  /** Copy explicit routing into operations without overriding an authored connection.
   * @param {QueryOperation | QueryOperation[]} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {string} slug - Explicit configured connection slug, default the selected manager default.
   * @returns {QueryOperation|QueryOperation[]} New routed operation inventory.
   */
  #assignConnection(
    operation: QueryOperation | QueryOperation[],
    slug: string
  ): QueryOperation | QueryOperation[] {
    if (Array.isArray(operation)) {
      return operation.map((entry) => ({
        ...entry,
        connection: entry.connection ?? slug,
      }));
    }

    return {
      ...operation,
      connection: operation.connection ?? slug,
    };
  }

  /** Reject new work, signal pending contexts, then reverse-close connectors after the bounded grace.
   * @returns {Promise<void>} Idempotent native cleanup receipt; uncooperative drivers retain their own limits.
   */
  async disconnect(): Promise<void> {
    if (ownsTransaction(this)) {
      throw transactionError('TRANSACTION_SCOPE_REQUIRED');
    }
    if (this.#closing) {
      return this.#closing;
    }
    this.#closed = true;
    this.#closing = Promise.resolve().then(async () => {
      // Signal callers before waiting for actual accepted native settlement.
      for (const pending of this.#pending) {
        pending.controller.abort();
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([...this.#pending].map((p) => p.settled)),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.#policy.shutdownGraceMs);
          }),
        ]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
      /** Native disconnect failures collected without hiding earlier cleanup attempts. */
      const failures: unknown[] = [];
      // Release connectors in reverse acquisition order, collecting every failure.
      for (const { connector } of [...this.#connections.values()].reverse()) {
        try {
          await connector.disconnect?.();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) {
        throw new AggregateError(
          failures,
          'One or more database connectors failed to disconnect'
        );
      }
    });
    return this.#closing;
  }

  /** Validate admission/capabilities and retain native capacity independently from caller waiting.
   * @param {QueryOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} rawOptions - Separate query execution controls before normalization.
   * @returns {MaybePromise<DatabaseResult>} Scoped result or explicit cancellation/failure; no write replay.
   */
  #dispatch(
    operation: QueryOperation,
    rawOptions: DatabaseQueryOptions = {}
  ): MaybePromise<DatabaseResult> {
    if (ownsTransaction(this)) {
      throw transactionError('TRANSACTION_SCOPE_REQUIRED');
    }
    /** Validated execution controls separate from JSON operation data. */
    const options = queryOptions(rawOptions);
    /** Registered connection state looked up only while the manager is open. */
    const state = this.#getConnectionState(
      operation.connection ?? this.defaultConnectionSlug
    );
    checkCapabilities(operation, state.capabilities, options);
    if (
      operation.op === 'insert' &&
      Array.isArray(operation.values) &&
      operation.values.length > this.#policy.maxBatch
    ) {
      throw executionError('BATCH_LIMIT');
    }
    if (options.signal?.aborted) {
      throw executionError('QUERY_CANCELLED');
    }
    if (options.deadline !== undefined && options.deadline <= Date.now()) {
      throw executionError('QUERY_DEADLINE');
    }
    if (this.#pending.size >= this.#policy.maxPending) {
      throw executionError('QUERY_LIMIT');
    }
    /** Manager-owned cooperative cancellation retained through actual accepted work. */
    const controller = new AbortController();
    let settle!: () => void;
    /** Admission slot and settlement receipt; caller cancellation does not free native capacity. */
    const pending = {
      controller,
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    this.#pending.add(pending);
    /** Monotonic start used for redacted query duration. */
    const start = performance.now();
    let reported = false;
    /** Emit at most one frozen bounded-label observation; hook failures never alter the query.
     * @param {DatabaseQueryMetric['outcome']} outcome - Fixed terminal classification.
     * @param {DatabaseResult|undefined} result - Optional result used only for a safe count.
     * @returns {void} No query body, parameter, credential or raw error is logged. */
    const metric = (
      outcome: DatabaseQueryMetric['outcome'],
      result?: DatabaseResult
    ) => {
      if (reported) {
        return;
      }
      reported = true;
      /** Only a conservative identifier is eligible as a metric label. */
      const table =
        'table' in operation &&
        typeof operation.table === 'string' &&
        /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(operation.table)
          ? operation.table
          : undefined;
      /** Native affectedCount preferred even when zero; rowCount is only a fallback. */
      const count = result?.affectedCount ?? result?.rowCount;
      /** Frozen fixed-shape metric without SQL, values, connection details or native failures. */
      const event = Object.freeze({
        operation: operation.op,
        ...(table ? { table } : {}),
        durationMs: Math.max(0, performance.now() - start),
        ...(typeof count === 'number' &&
        Number.isSafeInteger(count) &&
        count >= 0
          ? { count }
          : {}),
        outcome,
      });
      try {
        Promise.resolve(this.#policy.onMetric?.(event)).catch(() => {});
      } catch {
        /* Diagnostics never change query results. */
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    let timedOut = false;
    /** Release the admission slot only when native work actually settles.

 * @returns {void} Resolves manager drain observation for this work. */
    const cleanup = () => {
      this.#pending.delete(pending);
      settle();
    };
    /** Remove timers and caller listeners independently from native settlement.

 * @returns {void} Does not free native admission or claim engine cancellation. */
    const callerCleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      options.signal?.removeEventListener('abort', externalAbort);
      if (abort) {
        controller.signal.removeEventListener('abort', abort);
      }
    };
    /** Translate caller cancellation into the owned execution signal.

 * @returns {void} Asks the connector to cooperate; no rollback guarantee. */
    const externalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', externalAbort, { once: true });
    if (options.deadline !== undefined) {
      timer = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        Math.min(2147483647, Math.max(0, options.deadline - Date.now()))
      );
    }
    /** Validate result/count shape without inventing affected counts from returned rows.
     * @param {DatabaseResult} result - Native connector outcome.
     * @returns {DatabaseResult} Result with configured identity and unknown metadata defaults. */
    const normalize = (result: DatabaseResult) => {
      if (!result || typeof result.ok !== 'boolean') {
        throw createDatabaseError({
          code: 'INVALID_RESULT',
          message: 'Invalid database result',
        });
      }
      // Validate every supplied native count without inferring it from returned rows.
      for (const count of [
        result.affectedCount,
        result.matchedCount,
        result.changedCount,
        result.rowCount,
      ]) {
        if (
          count !== undefined &&
          (!Number.isSafeInteger(count) || count < 0)
        ) {
          throw createDatabaseError({
            code: 'INVALID_RESULT',
            message: 'Invalid database result count',
          });
        }
      }
      return {
        ...result,
        counts: result.counts ?? {
          affected: 'unknown' as const,
          matched: 'unknown' as const,
          changed: 'unknown' as const,
        },
        connection: result.connection || state.config.slug,
        connector: result.connector || state.config.connector,
        operation: result.operation || operation.op,
      };
    };
    let execution: MaybePromise<DatabaseResult>;
    try {
      execution = state.connector.execute(operation, {
        connection: state.config,
        signal: controller.signal,
        deadline: options.deadline,
      });
    } catch (error) {
      cleanup();
      callerCleanup();
      metric('failure');
      throw error;
    }
    if (!isPromiseLike(execution)) {
      cleanup();
      callerCleanup();
      if (
        controller.signal.aborted ||
        (options.deadline !== undefined && options.deadline <= Date.now())
      ) {
        metric(
          options.deadline !== undefined && options.deadline <= Date.now()
            ? 'deadline'
            : 'cancelled'
        );
        throw executionError(
          options.deadline !== undefined && options.deadline <= Date.now()
            ? 'QUERY_DEADLINE'
            : 'QUERY_CANCELLED'
        );
      }
      let result: DatabaseResult;
      try {
        result = normalize(execution);
      } catch (error) {
        metric('failure');
        throw error;
      }
      metric(result.ok ? 'success' : 'failure', result);
      return result;
    }
    /** Observed native completion retained independently from the cancelled caller race. */
    const result = Promise.resolve(execution).then(
      (value) => {
        cleanup();
        return normalize(value);
      },
      (error) => {
        cleanup();
        throw error;
      }
    );
    /** Caller-facing cancellation promise; native settlement retains the admission slot. */
    const cancelled = new Promise<never>((_, reject) => {
      abort = () =>
        reject(executionError(timedOut ? 'QUERY_DEADLINE' : 'QUERY_CANCELLED'));
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) {
        abort();
      }
    });
    return Promise.race([result, cancelled])
      .then(
        (value) => {
          metric(value.ok ? 'success' : 'failure', value);
          return value;
        },
        (error) => {
          let outcome: DatabaseQueryMetric['outcome'] = 'failure';
          if (controller.signal.aborted) {
            outcome = timedOut ? 'deadline' : 'cancelled';
          }
          metric(outcome);
          throw error;
        }
      )
      .finally(callerCleanup);
  }
}

let activeManager: DatabaseManager | null = null;

/** Acquire configured connectors sequentially and reverse-close earlier acquisitions on failure.
 * @param {DatabaseManagerConfig} config - Trusted explicit connection packages/options and execution policy.
 * @returns {Promise<DatabaseManager>} Scoped manager; await disconnect when its generation ends. */
export const createDatabaseManager = async (
  config: DatabaseManagerConfig
): Promise<DatabaseManager> => {
  executionPolicy(config?.execution);
  /** Validated detached configuration or operation inventory before dispatch. */
  const normalized = normalizeManagerConfig(config);
  /** Acquired connector states retained for reverse rollback and shutdown. */
  const states = new Map<string, ConnectionState>();

  try {
    // Acquire each explicitly configured connector and retain it for rollback.
    for (const connection of normalized.connections) {
      /** Explicit configured executable connector namespace. */
      const imported = await importConnectorPackage(connection.connector);
      /** Verified supported connector factory export. */
      const factory = extractConnectorFactory(
        imported as Record<string, unknown>
      );
      /** Acquired connector with native lifecycle and capability declarations. */
      const connector = await factory(connection.options, connection);
      let reportedCapabilities: Readonly<DatabaseCapabilities>;
      try {
        reportedCapabilities = capabilities(connector.capabilities);
        await connector.connect?.();
      } catch (error) {
        try {
          await connector.disconnect?.();
        } catch {
          /* preserve connect error */
        }
        throw error;
      }
      states.set(connection.slug, {
        config: connection,
        connector,
        capabilities: reportedCapabilities!,
      });
    }
    return new DatabaseManagerImpl(
      normalized.defaultSlug,
      states,
      config.execution
    );
  } catch (error) {
    // Reverse-close earlier acquisitions without replacing the original startup failure.
    for (const { connector } of [...states.values()].reverse()) {
      try {
        await connector.disconnect?.();
      } catch {
        /* preserve initial error */
      }
    }
    throw error;
  }
};

/** Replace the process-global compatibility pointer without disposing its previous owner.
 * @param {DatabaseManager} manager - Explicit manager retained and disconnected by the host.
 * @returns {void} Changes only the active facade target. */
export const setActiveDatabaseManager = (manager: DatabaseManager): void => {
  activeManager = manager;
};

/** Read the explicitly configured compatibility manager.

 * @returns {DatabaseManager} Current manager or an initialization error. */
export const getActiveDatabaseManager = (): DatabaseManager => {
  if (!activeManager) {
    throw createDatabaseError({
      code: 'DATABASE_MANAGER_NOT_INITIALIZED',
      message: 'Database manager has not been initialized yet',
    });
  }

  return activeManager;
};

/** Create a scoped manager and publish it as the compatibility target.
 * @param {DatabaseManagerConfig} config - Trusted connector configuration.
 * @returns {Promise<DatabaseManager>} New owner; previous active managers are not closed automatically. */
export const configureDatabaseManager = async (
  config: DatabaseManagerConfig
): Promise<DatabaseManager> => {
  /** Scoped owner retained by the public configurator or inert pinned runner. */
  const manager = await createDatabaseManager(config);
  setActiveDatabaseManager(manager);
  return manager;
};

/** Build an inert runner over an explicit verified adapter without acquiring a connection.
 * @param {PinnedTransactionAdapter} adapter - Explicit verified native pin implementation.
 * @param {NormalizedConnectionConfig} connection - Normalized host-selected connection identity/options.
 * @param {DatabaseExecutionPolicy} policy - Package-owned pending/batch/shutdown policy.
 * @returns {import("./transactions.js").DatabaseTransaction} Application callback runner; native pin acquisition happens only on invocation.
 */
export function createPinnedTransaction(
  adapter: PinnedTransactionAdapter,
  connection: NormalizedConnectionConfig,
  policy: DatabaseExecutionPolicy = {}
): import('./transactions.js').DatabaseTransaction {
  negotiateTransaction(adapter);
  executionPolicy(policy);
  /** Validated detached configuration or operation inventory before dispatch. */
  const normalized = normalizeManagerConfig({ connections: [connection] })
    .connections[0];
  if (!normalized) {
    throw new TypeError('Pinned transaction connection is missing');
  }
  connection = normalized;
  /** Acquired connector with native lifecycle and capability declarations. */
  const connector: DatabaseConnector = {
    kind: 'pinned',
    options: connection.options,
    capabilities: { transactions: 'supported' },
    transactionAdapter: adapter,
    execute() {
      throw transactionError('TRANSACTION_SCOPE_REQUIRED');
    },
  };
  /** Scoped owner retained by the public configurator or inert pinned runner. */
  const manager = new DatabaseManagerImpl(
    connection.slug,
    new Map([
      [
        connection.slug,
        {
          config: connection,
          connector,
          capabilities: capabilities(connector.capabilities),
        },
      ],
    ]),
    policy
  );
  return (run, options) => manager.transaction(run, options);
}
