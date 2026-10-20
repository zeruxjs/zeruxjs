export default {
  id: "parent-module",
  title: "Parent Module",
  entry: "./src/index.js",
  assets: {
    script: "./src/client.js"
  },
  server: {
    allowChildren: true,
    api: "./src/api.js"
  }
};
