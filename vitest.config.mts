import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Safety logic is plain TypeScript with no DOM dependency — keep the test
    // environment as node so `npm test` stays fast enough to run on every save.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig.json. Vitest does not read
    // tsconfig paths on its own, so this has to be stated twice.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
