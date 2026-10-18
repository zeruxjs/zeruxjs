import { previewMount } from "./site-preview.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sites } from "../sites.config.mjs";
import {
  repositoryRoot,
  copyStatic,
  verifySites,
  validateSites,
} from "./build-sites.mjs";

/** Run Git without a shell and keep credentials out of diagnostics.
 * @param {string} directory Working tree. @param {string[]} args Git arguments. @returns {Promise<object>} Exit status and captured output. Uses existing repository Git authentication only.
 */
async function git(directory, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
/** Require a successful Git operation. @param {string} directory Tree. @param {string[]} args Arguments. @returns {Promise<string>} Standard output. Uses repository authentication; never logs it. */
async function requireGit(directory, args) {
  const result = await git(directory, args);
  if (result.code !== 0) {
    const reason = result.stderr
      .replace(/https?:\/\/[^\s@]+@/g, "https://[redacted]@")
      .replace(/\bgh[pousr]_[A-Za-z0-9]+/g, "[redacted]");
    throw new Error(`Git ${args[0]} failed (${result.code}): ${reason.trim()}`);
  }
  return result.stdout.trim();
}
/** Publish owned files, preserving other sites and using only normal fast-forward pushes.
 * @param {{repository?:string}} options Optional repository for local verification.
 * @returns {Promise<object>} Published commit metadata. Reads generated files; writes only a temporary worktree and declared artifact output.
 */
export async function publishSites({ repository = repositoryRoot } = {}) {
  validateSites();
  if (sites.outputBranch === sites.sourceBranch)
    throw new Error("Static output must not overwrite the source branch");
  await requireGit(repository, [
    "check-ref-format",
    "--branch",
    sites.outputBranch,
  ]);
  const build = path.join(repository, sites.output),
    artifact = path.join(repository, sites.published);
  const mount = previewMount();
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(build, mount.slice(1), "site-manifest.json"),
      "utf8",
    ),
  );
  if (
    (manifest.previewMount ?? "") !== mount ||
    manifest.outputBranch !== sites.outputBranch ||
    JSON.stringify(manifest.rootOwned) !== JSON.stringify(sites.root.owned) ||
    JSON.stringify(manifest.sites) !==
      JSON.stringify(
        sites.apps.map((app) => ({ id: app.id, mount: app.mount })),
      )
  )
    throw new Error(
      "Build ownership differs from configured sites; rebuild first",
    );
  const source = await requireGit(repository, ["rev-parse", "HEAD"]);
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "zerux-site-publish-"));
  const tree = path.join(base, "tree");
  let registered = false;
  try {
    const branch = await git(repository, [
      "ls-remote",
      "--exit-code",
      "origin",
      `refs/heads/${sites.outputBranch}`,
    ]);
    if (![0, 2].includes(branch.code))
      throw new Error("Cannot inspect the output branch; verify origin access");
    if (branch.code === 0) {
      await requireGit(repository, [
        "fetch",
        "--no-tags",
        "origin",
        `refs/heads/${sites.outputBranch}`,
      ]);
      await requireGit(repository, [
        "worktree",
        "add",
        "--detach",
        tree,
        "FETCH_HEAD",
      ]);
      registered = true;
    } else {
      await requireGit(repository, [
        "worktree",
        "add",
        "--detach",
        tree,
        "HEAD",
      ]);
      registered = true;
      await requireGit(tree, ["switch", "--orphan", sites.outputBranch]);
    }
    const owned = mount
      ? [mount.slice(1), ".nojekyll"]
      : [...sites.root.owned, ...sites.apps.map((app) => app.mount.slice(1))];
    for (const entry of owned) {
      const target = path.join(tree, entry);
      let parent = tree;
      for (const segment of entry.split("/")) {
        parent = path.join(parent, segment);
        const ancestor = await fs.lstat(parent).catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        });
        if (ancestor?.isSymbolicLink())
          throw new Error("Refusing symlink in published path");
      }
      const stat = await fs.lstat(target).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      if (stat?.isSymbolicLink())
        throw new Error(`Refusing symlinked published path: ${entry}`);
      await fs.rm(target, { recursive: true, force: true });
      await copyStatic(path.join(build, entry), target);
      console.info(`[sites] UPDATE ${entry}`);
    }
    // Verify previews even when master has not produced a root site yet.
    const check = await verifySites(tree, { mount });
    await requireGit(tree, ["add", "--", ...owned]);
    const diff = await git(tree, ["diff", "--cached", "--quiet"]);
    if (![0, 1].includes(diff.code))
      throw new Error("Unable to compare generated files");
    if (diff.code === 1) {
      await requireGit(tree, [
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit",
        "-m",
        `[skip-sync] Build static sites from ${source}`,
      ]);
      await requireGit(tree, [
        "push",
        "origin",
        `HEAD:refs/heads/${sites.outputBranch}`,
      ]);
    }
    const commit = await requireGit(tree, ["rev-parse", "HEAD"]);
    if (process.env.GITHUB_OUTPUT)
      await fs.appendFile(process.env.GITHUB_OUTPUT, `commit=${commit}\n`);
    // Artifact comes from the complete output-branch tree, including preserved sites/CNAME.
    const existing = await fs.lstat(artifact).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (existing?.isSymbolicLink())
      throw new Error("Refusing linked artifact directory");
    if (existing) await fs.rm(artifact, { recursive: true, force: true });
    await copyStatic(tree, artifact);
    console.info(
      `[sites] PUBLISHED ${sites.outputBranch}@${commit}: ${sites.apps.length} configured site(s), ${check.html} HTML files. Other site paths preserved.`,
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      await fs.appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## Static sites published\n\n- Branch: \`${sites.outputBranch}\`\n- Commit: \`${commit}\`\n- Source: \`${source}\`\n- Shared homepage: \`${mount}/\`\n${sites.apps.map((app) => `- ${app.id}: \`${mount}${app.mount}/\``).join("\n")}\n- Unowned site paths and CNAME preserved.\n- ${check.html} HTML files; ${check.links} verified links.\n`,
      );
    return { branch: sites.outputBranch, commit, changed: diff.code === 1 };
  } finally {
    if (registered)
      await requireGit(repository, ["worktree", "remove", "--force", tree]);
    await fs.rm(base, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await publishSites();
