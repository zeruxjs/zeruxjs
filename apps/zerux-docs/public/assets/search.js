import { createSearchIndex } from "@zeruxjs/search";

let pending;
/** Fetch a compact versioned index and build the workspace search index only on demand.
 * @returns {Promise<object>} Search engine. Reads public document metadata and same-origin static JSON only.
 */
async function engine() {
  pending ??= (async () => {
    const base = document.body.dataset.basePath || "";
    const version = document.body.dataset.searchVersion || "";
    const response = await fetch(
      `${base}/assets/search.json?v=${encodeURIComponent(version)}`,
    );
    if (!response.ok) throw new Error("Search index unavailable");
    const data = await response.json();
    if (
      data.schema !== 2 ||
      !Array.isArray(data.pages) ||
      !Array.isArray(data.sections)
    )
      throw new Error("Invalid search index");
    const index = createSearchIndex({
      fields: ["title", "section", "text"],
      weights: { title: 8, section: 3, text: 1 },
      maxDocuments: 10000,
    });
    const pages = data.pages.map(
      ([title, section, version, url, description, text], i) => ({
        id: "page-" + i,
        title,
        section,
        version,
        url,
        description,
        text,
      }),
    );
    for (const page of pages) index.add(page);
    data.sections.forEach(([parent, title, anchor, text], i) => {
      const page = pages[parent];
      if (!page) return;
      index.add({
        ...page,
        id: "heading-" + i,
        title,
        section: `${page.title} / ${page.section}`,
        url: page.url + "#" + anchor,
        text,
      });
    });
    return index;
  })().catch((error) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
/** Query the local package search engine. @param {string} query Bounded user query. @param {string} version Documentation version. @returns {Promise<object[]>} Ranked public topics. No telemetry. */
export async function searchDocs(query, version) {
  const index = await engine();
  const words = query
    .slice(0, 120)
    .toLowerCase()
    .split(/\s+/)
    .filter(
      (word) =>
        ![
          "how",
          "do",
          "i",
          "the",
          "a",
          "an",
          "is",
          "my",
          "to",
          "for",
          "can",
        ].includes(word),
    );
  const normalized = words.join(" ") || query.slice(0, 120);
  const options = {
    limit: 12,
    prefix: true,
    filter: (document) => document.version === version,
  };
  const exact = index.search(normalized, { ...options, mode: "all" });
  return (
    exact.length ? exact : index.search(normalized, { ...options, mode: "any" })
  ).map((result) => result.document);
}
