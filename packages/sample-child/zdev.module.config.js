export default {
  id: "child-module",
  title: "Child Module",
  parent: "parent-module",
  entry: "./src/index.js",
  dependencies: ["parent-module"],
  assets: {
    script: "./src/client.js"
  },
  server: {
    api: "./src/api.js"
  }
};
