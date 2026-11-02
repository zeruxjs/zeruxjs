import { createConnector } from "@zeruxjs/db-sqlite";
import { createQueueService } from "@zeruxjs/queue-bullmq";
import { createZyroRenderer } from "zeruxjs/renderers";
import { h, renderToString } from "zyrojs/dom";

/** Explicit operator action on a NEW disposable tutorial database. Never called by registration. */
export async function initializeTutorialDatabase(filename) {
  const db = await createConnector({ filename, driver: "node" });
  try {
    db.transactionSync((tx) => {
      tx.execute({
        op: "createTable",
        table: "tutorial_items",
        columns: [
          { name: "id", type: "integer", primary: true },
          { name: "label", type: "text" },
        ],
      });
      tx.insert({
        table: "tutorial_items",
        values: { id: 1, label: "A public synthetic note" },
      });
    });
  } finally {
    await db.disconnect();
  }
}
/** Public, synthetic-only example. Host policy must be added before reading private records. */
export async function registerTutorial(
  api,
  { filename, redisUrl },
  queueFactory = createQueueService,
) {
  if (
    typeof filename !== "string" ||
    !filename ||
    typeof redisUrl !== "string" ||
    !/^rediss?:\/\//.test(redisUrl)
  )
    throw new TypeError("Explicit tutorial database and Redis URL required");
  const db = await createConnector({
    filename,
    driver: "node",
    busyTimeoutMs: 1000,
  });
  let queues,
    closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await queues?.close();
    } finally {
      await db.disconnect();
    }
  };
  try {
    const rows = () =>
      db.transactionSync(
        (tx) => tx.select({ table: "tutorial_items", limit: 10 }),
        { mode: "deferred" },
      ).rows;
    rows(); // Existing schema is required; no automatic request/startup migration.
    queues = await queueFactory({
      redis: { url: redisUrl },
      prefix: "docs-tutorial",
      queues: ["snapshots"],
      workers: {
        snapshots: {
          concurrency: 1,
          processor: async (job) => {
            if (
              job.name !== "snapshot" ||
              job.data.reference !== "public-demo-v1"
            )
              throw Error("Unknown tutorial reference");
            return { count: rows().length }; // repeatable read, no emails/payments or private payload logging
          },
        },
      },
    });
    const renderer = api
      .renderers()
      .register(
        createZyroRenderer((view) => "<!doctype html>" + renderToString(view)),
      );
    api.onDispose(close);
    api.addRoute({
      pattern: "/",
      method: "GET",
      handler: (ctx) =>
        ctx.render(
          renderer,
          h(
            "html",
            { lang: "en" },
            h(
              "head",
              null,
              h("meta", { charset: "utf-8" }),
              h("title", null, "Public notes"),
            ),
            h(
              "body",
              null,
              h(
                "main",
                null,
                h("h1", null, "Public notes"),
                h("ul", null, ...rows().map((row) => h("li", null, row.label))),
              ),
            ),
          ),
        ),
    });
    return {
      close,
      enqueueSnapshot: () =>
        queues
          .queue("snapshots")
          .add(
            "snapshot",
            { reference: "public-demo-v1" },
            { removeOnComplete: 10, removeOnFail: 10 },
          ),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
