import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/** Resolve an explicit source branch to an isolated public mount.
 * @param {string} branch Branch name from CI, never shell-interpolated.
 * @returns {string} Empty for master/local builds or /branch/<suffix>. Reads no secrets.
 */
export function previewMount(branch = process.env.SITE_SOURCE_BRANCH ?? "") {
  if (!branch || branch === "master") return "";
  if (
    !/^version\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(branch) ||
    branch.length > 180
  )
    throw new Error("Site previews require a safe version/<name> branch");
  return "/branch/" + branch.slice("version/".length);
}

/** Relocate a verified static tree, including browser/search URLs and Markdown hashes.
 * @param {string} directory Generated staging directory.
 * @param {string} mount Validated preview URL prefix.
 * @returns {Promise<void>} Completion. Reads/writes generated files only.
 */
export async function mountPreview(directory, mount) {
  if (!mount) return;
  if (previewMount("version/" + mount.slice("/branch/".length)) !== mount)
    throw new Error("Invalid preview mount");
  const entries = await fs.readdir(directory);
  const files = [];
  async function visit(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symlink in preview output");
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  await visit(directory);
  const roots = entries
    .filter((name) => !name.startsWith("."))
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  // Restrict rewriting to rooted URL literals/Markdown destinations; external URLs are untouched.
  const urls = new RegExp(
    `(["'\x60(=])/(?!/)(?=(?:${roots})(?:/|["'\x60)#?\\s])|["'\x60)#?])`,
    "g",
  );
  for (const file of files) {
    if (!/\.(?:html|css|js|json|md|xml|txt)$/.test(file)) continue;
    let text = await fs.readFile(file, "utf8");
    text = text.replace(urls, (_, opening) => opening + mount + "/");
    if (file.endsWith(".html"))
      text = text.replace(
        "</head>",
        '<meta name="robots" content="noindex,nofollow"></head>',
      );
    await fs.writeFile(file, text);
  }
  // Hashes describe the relocated Markdown, not the original deployment paths.
  for (const file of files.filter((file) =>
    /(?:build|site)-manifest\.json$/.test(file),
  )) {
    const manifest = JSON.parse(await fs.readFile(file, "utf8"));
    for (const url of Object.keys(manifest.markdownFiles ?? {})) {
      const local = url.startsWith(mount + "/")
        ? url.slice(mount.length + 1)
        : url.slice(1);
      manifest.markdownFiles[url] = createHash("sha256")
        .update(await fs.readFile(path.join(directory, local)))
        .digest("hex");
    }
    if (path.basename(file) === "site-manifest.json") {
      manifest.previewMount = mount;
      for (const site of manifest.sites ?? [])
        if (site.mount.startsWith(mount + "/"))
          site.mount = site.mount.slice(mount.length);
    }
    await fs.writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
  }
  const destination = path.join(directory, mount.slice(1));
  await fs.mkdir(destination, { recursive: true });
  for (const entry of entries)
    await fs.rename(path.join(directory, entry), path.join(destination, entry));
  await fs.writeFile(path.join(directory, ".nojekyll"), "");
  console.info(`[sites] PREVIEW ${mount}/`);
}
