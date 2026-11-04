export function getFeedContentType(format: "rss" | "atom" | "json"): string {
  if (!["rss", "atom", "json"].includes(format))
    throw new TypeError("Invalid feed format");
  return {
    rss: "application/rss+xml; charset=utf-8",
    atom: "application/atom+xml; charset=utf-8",
    json: "application/feed+json; charset=utf-8",
  }[format];
}
