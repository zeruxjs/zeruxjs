/** Optional installed-Chrome check. CDP pipes + intercepted files: no HTTP server or external requests. */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { once } from "node:events";
import { root } from "../src/lib/content.mjs";
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "zx089-chrome-"));
const browser = spawn(
  process.env.CHROME_BIN || "/usr/bin/google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-pipe",
    "--user-data-dir=" + profile,
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let next = 0,
  buffer = Buffer.alloc(0),
  stderr = "";
const pending = new Map(),
  listeners = new Set();
browser.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-3000);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++next,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Chrome deadline: " + method));
      }, 15000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }) + "\0",
    );
  });
browser.stdio[4].on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  let end;
  while ((end = buffer.indexOf(0)) !== -1) {
    const message = JSON.parse(buffer.subarray(0, end).toString());
    buffer = buffer.subarray(end + 1);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) continue;
      pending.delete(message.id);
      clearTimeout(item.timer);
      message.error
        ? item.reject(Error(JSON.stringify(message.error)))
        : item.resolve(message.result);
    } else for (const listener of listeners) listener(message);
  }
});
browser.on("exit", () => {
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(Error("Chrome exited: " + stderr));
  }
  pending.clear();
});
const errors = [];
try {
  const version = await send("Browser.getVersion");
  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const call = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.text +
          JSON.stringify(result.exceptionDetails.exception),
      );
    return result.result.value;
  };
  const directory = path.join(root, "dist");
  listeners.add((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused")
      void (async () => {
        const { requestId, request } = message.params;
        try {
          const url = new URL(request.url);
          if (url.origin !== "https://docs.invalid")
            throw Error("External destination denied");
          let pathname = decodeURIComponent(url.pathname);
          if (pathname.endsWith("/")) pathname += "index.html";
          const location = path.resolve(directory, "." + pathname);
          if (!location.startsWith(directory + path.sep))
            throw Error("Traversal denied");
          const bytes = await fs.readFile(location);
          const type = location.endsWith(".html")
            ? "text/html; charset=utf-8"
            : location.endsWith(".js")
              ? "text/javascript"
              : location.endsWith(".css")
                ? "text/css"
                : location.endsWith(".json")
                  ? "application/json"
                  : location.endsWith(".svg")
                    ? "image/svg+xml"
                    : "application/octet-stream";
          await call("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: "content-type", value: type }],
            body: bytes.toString("base64"),
          });
        } catch {
          await call("Fetch.fulfillRequest", {
            requestId,
            responseCode: 404,
            body: "",
          });
        }
      })().catch((error) => errors.push(error.message));
  });
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  const visit = async (slug, width, dark = false, noJavaScript = false) => {
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 760,
    });
    await call("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
        { name: "prefers-reduced-motion", value: "reduce" },
      ],
    });
    await call("Emulation.setScriptExecutionDisabled", { value: noJavaScript });
    await call("Page.navigate", {
      url:
        "https://docs.invalid/zeruxjs/" + (slug ? `docs/0.0.4/${slug}/` : ""),
    });
    for (let i = 0; i < 150; i++) {
      if (
        await evaluate(
          "document.readyState==='complete' && !!document.querySelector('.docs-tabs')",
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const result = await evaluate(
      `({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,tabs:document.querySelectorAll('.docs-tabs a').length,h1:document.querySelectorAll('h1').length,active:document.querySelector('.docs-tabs [aria-current=page]')?.textContent,background:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()})`,
    );
    assert.equal(result.tabs, 6);
    assert.equal(result.h1, 1);
    assert.equal(result.overflow, false, JSON.stringify({ slug, ...result }));
    return result;
  };
  const results = [];
  for (const [slug, width, dark, noJS] of [
    ["introduction", 1440, false, false],
    ["structure", 1440, true, false],
    ["examples", 390, false, false],
    ["api", 390, true, true],
    ["", 1440, false, true],
  ]) {
    results.push({
      slug,
      width,
      dark,
      noJS,
      ...(await visit(slug, width, dark, noJS)),
    });
    if (process.env.DOCS_SCREENSHOTS) {
      await fs.mkdir(process.env.DOCS_SCREENSHOTS, { recursive: true });
      const shot = await call("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(
        path.join(
          process.env.DOCS_SCREENSHOTS,
          (slug || "home") + "-" + width + ".png",
        ),
        Buffer.from(shot.data, "base64"),
      );
    }
  }
  await visit("introduction", 1440);
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "k",
    code: "KeyK",
    modifiers: 2,
  });
  assert.equal(
    await evaluate("document.querySelector('#search-dialog').open"),
    true,
  );
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  assert.equal(
    await evaluate("document.querySelector('#search-dialog').open"),
    false,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        browser: version.product,
        results,
        searchKeyboard: "passed",
        externalNetwork: "intercepted",
      },
      null,
      2,
    ),
  );
} finally {
  const closed =
    browser.exitCode === null ? once(browser, "close") : Promise.resolve();
  const killTimer = setTimeout(() => {
    if (browser.exitCode === null) browser.kill("SIGKILL");
  }, 3000);
  try {
    await send("Browser.close");
  } catch {}
  await closed;
  clearTimeout(killTimer);
  for (const item of pending.values()) clearTimeout(item.timer);
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
