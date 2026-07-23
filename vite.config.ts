import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export function resolvePagesBase(
  environment: { GITHUB_REPOSITORY?: string },
): string {
  const repository = environment.GITHUB_REPOSITORY?.split("/")[1];
  if (!repository || repository.toLowerCase().endsWith(".github.io")) {
    return "/";
  }
  return `/${repository}/`;
}

export default defineConfig({
  plugins: [react()],
  base: resolvePagesBase(process.env),
});
