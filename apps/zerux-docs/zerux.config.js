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
    origin: "https://zeruxjs.shubkb.me",
    deploymentPath: "/branch/v0.0.4",
    description: "Build applications with the ZeruxJS runtime and ecosystem.",
    repository: "https://github.com/zeruxjs/zeruxjs",
    latest: "0.0.4",
    versions: [
      {
        id: "0.0.4",
        label: "0.0.4",
        status: "Preview",
        packageVersion: "0.0.3",
        reference: "workspace",
        ref: "version/v0.0.4",
      },
    ],
    sections: [
      "Getting started",
      "Learning",
      "Fundamentals",
      "Configuration",
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
