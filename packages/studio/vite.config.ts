import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Dev only: talk to a daemon started with `brusshy start --dev` in BRUSSHY_DIR. */
const projectDir = path.resolve(process.env.BRUSSHY_DIR ?? path.resolve(__dirname, "../../.dev-project"));
const daemonInfo = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, "brusshy/.daemon.json"), "utf8")) as { port: number; token: string };
  } catch {
    return { port: 4848, token: "" };
  }
};

const injectToken = (): Plugin => ({
  name: "brusshy-dev-token",
  apply: "serve",
  transformIndexHtml: (html) => html.replace("</head>", `<meta name="brusshy-token" content="${daemonInfo().token}"></head>`),
});

const target = `http://127.0.0.1:${daemonInfo().port}`;

export default defineConfig({
  plugins: [react(), injectToken()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: false },
      "/refs": { target },
      "/brand": { target },
      "/ws": { target: target.replace("http", "ws"), ws: true },
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
});
