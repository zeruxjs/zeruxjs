import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { planZenixApp, runCreateZenix } from "create-zenix-js";
import { writeProjectPlanAsync } from "zclivo";
const repo = process.cwd(),
  env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), "zx088-"));
function run(cwd, args, extra = {}) {
  return execFileSync(process.execPath, args, {
    cwd,
    env: { ...env, ...extra },
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
test("CLI help/version/dry-run and unsupported configurations leave no files; cancellation disposes", async () => {
  const cwd = root();
  try {
    const output = [],
      io = { cwd, out: (x) => output.push(x), err: (x) => output.push(x) };
    assert.equal(await runCreateZenix(["--version"], io), 0);
    assert.equal(output[0], "0.0.4");
    assert.equal(await runCreateZenix(["--help"], io), 0);
    assert.match(output.join("\n"), /database sqlite/);
    assert.equal(
      await runCreateZenix(
        [
          "cms",
          "--yes",
          "--dry-run",
          "--database",
          "sqlite",
          "--storage",
          "none",
        ],
        io,
      ),
      0,
    );
    for (const args of [
      ["cms", "--database", "postgres"],
      ["cms", "--storage", "s3"],
      ["cms", "--renderer", "react"],
      ["cms", "--mode", "hydrated"],
      ["cms", "--ts"],
      ["CON"],
      ["cms", "--port", "0"],
    ])
      assert.equal(await runCreateZenix(args, io), 2);
    assert.deepEqual(fs.readdirSync(cwd), []);
    fs.symlinkSync(path.join(cwd, "missing"), path.join(cwd, "occupied"));
    assert.equal(await runCreateZenix(["occupied", "--yes"], io), 1);
    const c = new AbortController();
    let disposed = 0;
    assert.equal(
      await runCreateZenix([], {
        ...io,
        signal: c.signal,
        prompt: () => ({
          async ask() {
            c.abort();
            throw Error("cancel");
          },
          close() {
            disposed++;
          },
        }),
      }),
      130,
    );
    assert.equal(disposed, 1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
test("generated isolated consumer builds; host prerequisites fail closed; explicit SQLite migration reloads", async () => {
  const parent = root(),
    cwd = path.join(parent, "cms");
  try {
    const plan = planZenixApp({ name: "cms", destination: cwd, port: 3210 });
    assert.deepEqual(
      plan.files,
      planZenixApp({ name: "cms", destination: cwd, port: 3210 }).files,
    );
    await writeProjectPlanAsync(plan);
    assert.match(plan.files[".env.example"], /ZENIX_DATABASE=\n/);
    assert.doesNotMatch(
      Object.values(plan.files).join("\n"),
      /fixture-password|host-secret|admin123/,
    );
    const pkg = JSON.parse(plan.files["package.json"]);
    assert.equal(pkg.private, true);
    assert.equal(pkg.dependencies.react, undefined);
    const mapping = {
      "@zenixjs/core": "packages/@zenixjs/core",
      "@zeruxjs/db-sqlite": "packages/@zeruxjs/db-sqllite",
      zenixjs: "packages/zenixjs",
      zeruxjs: "packages/zeruxjs",
      zyrojs: "packages/zyrojs",
    };
    execFileSync(
      "npm",
      [
        "install",
        "--offline",
        "--ignore-scripts",
        "--no-save",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
        "--cache",
        path.join(parent, "cache"),
        ...Object.keys(pkg.dependencies).map((k) =>
          path.join(repo, mapping[k]),
        ),
      ],
      { cwd, env, timeout: 30000, stdio: "pipe" },
    );
    execFileSync("npm", ["run", "build"], {
      cwd,
      env,
      timeout: 30000,
      stdio: "pipe",
    });
    execFileSync("npm", ["run", "typecheck"], {
      cwd,
      env,
      timeout: 30000,
      stdio: "pipe",
    });
    execFileSync("npm", ["test"], { cwd, env, timeout: 30000, stdio: "pipe" });
    const variables = {
      ZENIX_ORIGIN: "http://localhost:3210",
      ZENIX_DATABASE: path.join(parent, "cms.sqlite"),
      ZENIX_TENANT: "tenantA",
      ZENIX_SITE: "siteA",
    };
    assert.throws(
      () => run(cwd, ["scripts/migrate.mjs"], variables),
      /--approve/,
    );
    assert.equal(fs.existsSync(variables.ZENIX_DATABASE), false);
    run(cwd, ["scripts/migrate.mjs", "--approve"], variables);
    run(cwd, ["scripts/migrate.mjs", "--approve"], variables);
    assert.ok(fs.statSync(variables.ZENIX_DATABASE).size > 0);
    run(
      cwd,
      [
        "--input-type=module",
        "-e",
        `import assert from 'node:assert/strict';import register from './src/index.mjs';await assert.rejects(register({}),/ZENIX_HOST_POLICY_REQUIRED/);console.log('host denied');`,
      ],
      variables,
    );
    // An inert, deny-by-default synthetic host verifies application installation and teardown without credentials.
    fs.writeFileSync(
      path.join(cwd, "src/host-policy.mjs"),
      `export async function createHostPolicy(){return {resolveCorePrincipal:async()=>null,publicPrincipal:{opaque:'test'},authenticate:async()=>null,login:async()=>null,logout:async()=>({cookie:'sid=; Max-Age=0'}),authorize:async()=>false,csrf:{issue:async()=>({token:'synthetic'}),verify:async()=>false},verifySetupSecret:async()=>false,authorizeRecovery:async()=>false,admit:async()=>false};}`,
    );
    run(
      cwd,
      [
        "--input-type=module",
        "-e",
        `import assert from 'node:assert/strict';import register from './src/index.mjs';const cleanup=[];const app=await register({onDispose(fn){cleanup.push(fn)},addRoute(){}});try{const response=await app.handle(new Request('http://localhost:3210/cms/admin'));assert.ok([302,303,401,403].includes(response.status));}finally{for(const fn of cleanup.reverse())await fn();}`,
      ],
      variables,
    );
    // Missing CMS dependency is a hard failure, never a placeholder dashboard.
    fs.unlinkSync(path.join(cwd, "node_modules/zenixjs"));
    assert.throws(
      () =>
        run(
          cwd,
          ["--input-type=module", "-e", `await import('./src/index.mjs')`],
          variables,
        ),
      /zenixjs/,
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
