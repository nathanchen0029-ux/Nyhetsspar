import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    port: 5173,
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    colorScheme: "light",
  },
  projects: [
    {
      name: "mobile-375",
      use: { browserName: "chromium", viewport: { width: 375, height: 812 } },
    },
    {
      name: "mobile-landscape",
      use: { browserName: "chromium", viewport: { width: 812, height: 375 } },
    },
    {
      name: "tablet-768",
      use: { browserName: "chromium", viewport: { width: 768, height: 1024 } },
    },
    {
      name: "laptop-1024",
      use: { browserName: "chromium", viewport: { width: 1024, height: 768 } },
    },
    {
      name: "wide-1440",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
  ],
});
