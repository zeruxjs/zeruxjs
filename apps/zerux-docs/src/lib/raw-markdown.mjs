import { createHash } from "node:crypto";
import { site, sitePath } from "../site.config.mjs";

/** Public raw-document URL. @param {string} url HTML route. @returns {string} Markdown route. No globals. */
export function markdownPath(url) {
  return url.endsWith("/")
    ? url === sitePath("/")
      ? url + "index.md"
      : url.slice(0, -1) + ".md"
    : url.replace(/\.html$/, ".md");
}
/** Render manifest contracts as Markdown, preserving exact export values.
 * @param {object} item Public package manifest. @returns {string} Reference text. No globals.
 */
function manifestMarkdown(item) {
  return `\n\n## Public entry points\n\nManifest reference for \`${item.name}@${item.version}\`.\n\n\`\`\`json\n${JSON.stringify({ exports: item.exports ?? { ".": item.main }, engines: item.engines ?? {}, dependencies: item.dependencies ?? {}, peerDependencies: item.peerDependencies ?? {}, bin: item.bin ?? {} }, null, 2)}\n\`\`\`\n`;
}
/** Resolve public prose links while leaving fenced code examples untouched.
 * @param {string} source Markdown content. @param {object} page Document context. @param {boolean} readme README link mode.
 * @returns {string} Markdown with portable links. Reads public repository/path configuration only.
 */
function portableLinks(source, page, readme = false) {
  const base = `${site.repository}/blob/${page.versionInfo?.ref || "master"}/${page.manifest?.source}/README.md`;
  return source
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(
            /(!?\[[^\]\n]+\]\()([^\s)]+)([^)]*\))/g,
            (match, start, href, end) => {
              if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href))
                return match;
              if (readme) {
                try {
                  return start + new URL(href, base).href + end;
                } catch {
                  return match;
                }
              }
              if (/^[a-z0-9-]+\.md(?:#[\w-]+)?$/.test(href))
                return start + sitePath(`/docs/${page.version}/${href}`) + end;
              return match;
            },
          ),
    )
    .join("");
}
/** Export a page's public content without front matter or site chrome. Markdown is served as text, never executed.
 * @param {object} page Authored/generated document. @param {object[]} pages Public documents.
 * @param {object[]} inventory Public package references for the version. @returns {string} Markdown content.
 * Reads public site configuration only; never source files, secrets or environment values.
 */
export function rawMarkdown(page, pages, inventory = []) {
  let text = `# ${page.title}\n\n${page.description}\n\n${portableLinks(page.body || "", page, page.section === "Package reference")}`;
  if (page.manifest) {
    text += manifestMarkdown(page.manifest);
    if (page.section !== "Package reference" && page.readme)
      text +=
        "\n\n## Package README\n\n" + portableLinks(page.readme, page, true);
  } else if (page.slug === "api") {
    const framework = inventory.find((item) => item.name === "zeruxjs");
    if (framework) text += manifestMarkdown(framework);
  } else if (page.slug === "packages") {
    text +=
      "\n\n" +
      inventory
        .map((item) => {
          const guide = pages.find(
            (candidate) =>
              candidate.version === page.version &&
              candidate.package === item.name,
          );
          return `- [${item.name}](${guide?.url ?? "#"}) — ${item.description || "Package reference"} (v${item.version})`;
        })
        .join("\n");
  }
  if (page.sources?.length)
    text +=
      "\n\n## Implementation sources\n\n" +
      page.sources
        .map(
          (source) =>
            `- [${source}](${site.repository}/blob/${page.versionInfo?.ref || "master"}/${source})`,
        )
        .join("\n");
  return text.trimEnd() + "\n";
}
/** Digest exported Markdown for build/artifact integrity checks. @param {string} text Raw content. @returns {string} SHA-256. No globals. */
export function markdownDigest(text) {
  return createHash("sha256").update(text).digest("hex");
}
