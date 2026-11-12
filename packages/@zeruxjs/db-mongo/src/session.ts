import type {
  DatabaseExecutionContext,
  PinnedTransactionAdapter,
  DatabaseResult,
  QueryOperation,
} from '@zeruxjs/db';
import { createDatabaseError } from '@zeruxjs/db';
import type {
  MongoClientLike,
  MongoDbLike,
  MongoSessionLike,
} from './connector.js';
/** Create fixed private-cause diagnostics for session lifecycle failures.
 * @param {string} code - Fixed internal classification.
 * @param {unknown} cause - Optional private native cause.
 * @returns {Error & {details: import("@zeruxjs/db").DatabaseErrorShape}} Abstraction error without raw connection values in its message. */
const fail = (code: string, cause?: unknown) =>
  createDatabaseError({
    code,
    message: code.toLowerCase().replaceAll('_', ' '),
    ...(cause !== undefined ? { cause } : {}),
  });
export interface MongoTransactionPolicy {
  /** Default one; integer 1–3 native commit calls, never callback retries. */
  maxCommitAttempts: number;
  /** Default 10000ms; integer 1–60000 passed to native startTransaction. */
  maxCommitTimeMS: number;
  /** Default 32; integer 1–1024 retained until actual cleanup. */
  maxSessions: number;
  /** Default 5000ms; integer 1–60000 bounding hello observation. */
  probeTimeoutMS: number;
}
/** Run the explicit bounded hello prerequisite probe before enabling sessions.
 * @param {MongoClientLike} client - Explicit connected native-compatible client, borrowed by default.
 * @param {MongoTransactionPolicy} policy - Validated session/commit/probe limits.
 * @returns {Promise<void>} Session/wire/topology prerequisites observed; permissions/FCV remain native concerns.
 */
export async function verifyTransactionDeployment(
  client: MongoClientLike,
  policy: MongoTransactionPolicy
) {
  if (typeof client.startSession !== 'function') {
    throw fail('UNSUPPORTED_MONGO_SESSIONS');
  }
  /** Borrowed admin database handle used only for the explicit read-only hello probe. */
  const admin = client.db('admin');
  if (typeof admin.command !== 'function') {
    throw fail('MISSING_MONGO_DEPLOYMENT_PROBE');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    /** Observed deployment facts; success does not certify FCV, authorization or failover. */
    const hello = await Promise.race([
      Promise.resolve().then(() =>
        admin.command!({ hello: 1 }, { maxTimeMS: policy.probeTimeoutMS })
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(fail('MONGO_DEPLOYMENT_PROBE_TIMEOUT')),
          policy.probeTimeoutMS
        );
      }),
    ]);
    /** Whether the probe reports a nonempty replica-set name. */
    const replica =
      typeof hello.setName === 'string' && hello.setName.length > 0;
    /** Whether hello identifies mongos rather than a standalone server. */
    const sharded = hello.msg === 'isdbgrid';
    if (
      !Number.isFinite(hello.logicalSessionTimeoutMinutes) ||
      Number(hello.logicalSessionTimeoutMinutes) <= 0 ||
      !Number.isSafeInteger(hello.maxWireVersion) ||
      Number(hello.maxWireVersion) < (sharded ? 8 : 7) ||
      (!replica && !sharded)
    ) {
      throw fail('UNSUPPORTED_MONGO_TRANSACTION_DEPLOYMENT');
    }
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
/** Inject one acquired session at every reviewed CRUD/cursor creation boundary.
 * @param {MongoDbLike} db - Borrowed native database matching this client/session.
 * @param {MongoSessionLike} session - Exact native session acquired for the callback.
 * @returns {MongoDbLike} Borrowed database view with per-call session injection, no global state.
 */
export function sessionDatabase(
  db: MongoDbLike,
  session: MongoSessionLike
): MongoDbLike {
  /** Fixed CRUD/cursor option positions at which the native session is injected. */
  const positions: Record<string, number> = {
    insertOne: 1,
    insertMany: 1,
    find: 1,
    aggregate: 1,
    updateMany: 2,
    deleteMany: 1,
  };
  return {
    /** Wrap one borrowed native collection while preserving method receivers.
     * @param {string} name - Validated authored collection identity.
     * @returns {import("./connector.js").MongoCollectionLike} Session-injecting collection view.
     */
    collection(name) {
      /** Borrowed native collection; wrapped methods retain its actual receiver. */
      const collection = db.collection(name);
      return new Proxy(collection, {
        /** Intercept only reviewed native methods and bind their acquired session.
         * @param {import("./connector.js").MongoCollectionLike} target - Actual borrowed native collection receiver.
         * @param {PropertyKey} key - Native member requested by the wrapper.
         * @returns {unknown} Native value or explicitly session-bound callable.
         */
        get(target, key) {
          /** Native member read without executing arbitrary model/query code. */
          const value = Reflect.get(target, key);
          if (
            typeof key !== 'string' ||
            !Object.hasOwn(positions, key) ||
            typeof value !== 'function'
          ) {
            return value;
          }
          return (...args: unknown[]) => {
            /** Reviewed native options argument slot; caller session cannot override the acquired pin. */
            const position = positions[key];
            args[position] = {
              ...(args[position] as Record<string, unknown> | undefined),
              session,
            };
            return Reflect.apply(value, target, args);
          };
        },
      });
    },
  };
}
/** Own acquired sessions through abort/endSession without replaying application callbacks.
 * @param {MongoClientLike} client - Explicit connected native-compatible client, borrowed by default.
 * @param {MongoTransactionPolicy} policy - Validated session/commit/probe limits.
 * @param {(
    operation: QueryOperation,
    context: DatabaseExecutionContext,
    session: MongoSessionLike
  ) => Promise<DatabaseResult>} execute - Trusted operation dispatcher accepting this explicit native session.
 * @param {(context: DatabaseExecutionContext) => void} check - Owner lifecycle/cancellation fence.
 * @returns {object} Pinned adapter and actual-session drain barrier.
 */
export function transactionAdapter(
  client: MongoClientLike,
  policy: MongoTransactionPolicy,
  execute: (
    operation: QueryOperation,
    context: DatabaseExecutionContext,
    session: MongoSessionLike
  ) => Promise<DatabaseResult>,
  check: (context: DatabaseExecutionContext) => void
) {
  /** Acquired session lifetimes retained until actual endSession settlement. */
  const leases = new Set<Promise<void>>();
  /** Explicit snapshot-only pinned extension; never uses withTransaction callback replay. */
  const adapter: PinnedTransactionAdapter = {
    capabilities: {
      isolationLevels: ['snapshot'],
      timeout: 'cooperative',
      savepoints: false,
      transactionalDdl: false,
    },
    /** Acquire one native session within the configured live-session ceiling.
     * @param {DatabaseExecutionContext} ctx - Connection-bound cooperative execution context.
     * @returns {Promise<import("@zeruxjs/db").PinnedTransactionSession>} Session pin; invalid acquisition still attempts native endSession.
     */
    async acquire(ctx) {
      check(ctx);
      if (leases.size >= policy.maxSessions) {
        throw fail('MONGO_SESSION_LIMIT');
      }
      /** One acquired native session used for every operation and finalization. */
      const session = client.startSession!();
      if (
        !session ||
        [
          'startTransaction',
          'commitTransaction',
          'abortTransaction',
          'endSession',
        ].some(
          (k) =>
            typeof (session as unknown as Record<string, unknown>)[k] !==
            'function'
        )
      ) {
        await session?.endSession?.();
        throw fail('INVALID_MONGO_SESSION');
      }
      let release!: () => void;
      /** Actual session cleanup receipt removed only after endSession settles. */
      const life = new Promise<void>((resolve) => {
        release = resolve;
      });
      leases.add(life);
      let begun = false,
        done = false,
        ended = false;
      return {
        /** Begin snapshot/majority/primary work only on this acquired session.
         * @param {import("@zeruxjs/db").TransactionOptions} options - Negotiated snapshot/cooperative lifetime policy.
         * @returns {Promise<void>} Native begin completion; callback execution remains once.
         */
        async begin(options) {
          if (
            begun ||
            !options ||
            (options.isolation !== undefined &&
              options.isolation !== 'snapshot')
          ) {
            throw fail('UNSUPPORTED_MONGO_ISOLATION');
          }
          check(ctx);
          begun = true;
          await session.startTransaction({
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary',
            maxCommitTimeMS: policy.maxCommitTimeMS,
          });
        },
        /** Execute allowed CRUD work with the exact acquired session.
         * @param {QueryOperation} operation - Validated CRUD operation bound to the pin.
         * @param {DatabaseExecutionContext} context - Current cooperative execution controls.
         * @returns {Promise<DatabaseResult>} Native result; no DDL/database switch inside the pin.
         */
        execute(operation, context) {
          if (!begun || done || ended) {
            throw fail('MONGO_TRANSACTION_CLOSED');
          }
          check(context);
          if (
            !['select', 'insert', 'update', 'delete'].includes(operation.op)
          ) {
            throw fail('UNSUPPORTED_MONGO_TRANSACTION_OPERATION');
          }
          return execute(operation, context, session);
        },
        /** Retry only uncertain native commit calls under the finite attempt budget.
         * @returns {Promise<void>} Confirmed commit or explicit uncertain failure; writes/callbacks are not replayed.
         */
        async commit() {
          if (!begun || done || ended) {
            throw fail('MONGO_TRANSACTION_CLOSED');
          }
          // Retry only labeled uncertain commit calls on the same session; never replay callback writes.
          for (let attempt = 1; ; attempt++) {
            check(ctx);
            try {
              await session.commitTransaction();
              done = true;
              return;
            } catch (error) {
              /** Private native error label view; only uncertain commit labels allow bounded commit retry. */
              const labeled = error as {
                hasErrorLabel?: (label: string) => boolean;
              };
              if (
                attempt >= policy.maxCommitAttempts ||
                typeof labeled?.hasErrorLabel !== 'function' ||
                !labeled.hasErrorLabel('UnknownTransactionCommitResult')
              ) {
                throw error;
              }
            }
          }
        },
        /** Abort only an active uncommitted native transaction.
         * @returns {Promise<void>} Native abort receipt; cleanup still follows failure.
         */
        async rollback() {
          if (begun && !done) {
            await session.abortTransaction();
            done = true;
          }
        },
        /** End the acquired session exactly once before releasing its lifetime slot.
         * @returns {Promise<void>} Actual session cleanup receipt, even after endSession failure.
         */
        async release() {
          if (ended) {
            return;
          }
          ended = true;
          try {
            await session.endSession();
          } finally {
            leases.delete(life);
            release();
          }
        },
      };
    },
  };
  return {
    adapter,
    /** Await actual settlement of every currently retained session lifetime.
     * @returns {Promise<void>} No session transport is forcibly cancelled.
     */
    async drain() {
      await Promise.allSettled([...leases]);
    },
  };
}
