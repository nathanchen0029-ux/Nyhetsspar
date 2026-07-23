import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["tests/**/*.test.{ts,tsx}"],
          exclude: ["tests/web/**"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "web",
          include: ["tests/web/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["tests/web/setup.ts"],
        },
      },
    ],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
