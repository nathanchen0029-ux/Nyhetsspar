import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: [],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
