import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  resolve: {
    alias: {
      "@preflight/domain": path.resolve(__dirname, "../../packages/domain/src/index.ts"),
      "@preflight/scanner": path.resolve(__dirname, "../../packages/scanner/src/index.ts"),
    },
  },
});
