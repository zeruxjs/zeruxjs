export default {
  id: "sample-os",
  title: "Sample OS",
  version: "1.0.0",
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
