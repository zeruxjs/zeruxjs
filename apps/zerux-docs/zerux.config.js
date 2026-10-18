/** Shared application configuration. The documentation namespace is consumed by this app's static exporter.
 * Runtime options follow ZeruxConfig; documentation options are app-specific, not generic zerux build flags.
 * This static exporter does not bootstrap db/cache or other runtime services. Importing this object never starts them.
 * No environment values, credentials or browser state are read.
 * @type {import('zeruxjs').ZeruxConfig}
 */
export default {
  type: "fix",
  outDir: ".zerux",
  documentation: {
    title: "ZeruxJS",
    basePath: "/zeruxjs",
    // Set the deployed domain origin to emit canonical URLs and a sitemap.
    origin: null,
    description: "Build applications with the ZeruxJS runtime and ecosystem.",
    repository: "https://github.com/zeruxjs/zeruxjs",
    latest: "0.0.2",
    versions: [
      {
        id: "0.0.2",
        label: "0.0.2",
        status: "Early development",
        reference: "workspace",
        ref: "master",
      },
    ],
    sections: [
      "Getting started",
      "Fundamentals",
      "Runtime",
      "Data and services",
      "Frontend",
      "Operations",
      "API reference",
      "Packages",
      "Contributing",
    ],
  },
};
