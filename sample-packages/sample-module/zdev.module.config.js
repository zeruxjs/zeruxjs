export default {
  id: "sample-module",
  title: "Sample Module",
  description: "Example external devtools package",
  entry: "./index.js",
  assets: {
    style: "./assets/style.css",
    script: "./assets/client.js"
  },
  server: {
    api: "./server/api.js",
    websocket: "./server/websocket.js"
  }
};
