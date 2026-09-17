import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const alias = {
  "@db/schema": resolve(root, "./db/schema.ts"),
  "@db": resolve(root, "./db/index.ts"),
  "@": resolve(root, "./src"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Integration tests share one database; running them in parallel
          // would have them truncating each other's rows.
          fileParallelism: false,
          setupFiles: ["tests/integration/setup.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
