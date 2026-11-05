import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  splitting: true,
  clean: true,
  // The core package is private: bundle it into the published CLI.
  noExternal: ["@brusshy/core", "@brusshy/shapes"],
  banner: { js: "" },
  define: { __BRUSSHY_BUILD__: JSON.stringify(String(Date.now())) },
});
