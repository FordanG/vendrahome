import { defineConfig } from "@playwright/test";
import { E2E_DB, E2E_PORT } from "./e2e/accounts";

// End-to-end tests run against their own database (.data/e2e) and build folder
// (.next/e2e), so they work while `pnpm dev` is running and never touch real data.
// Uses the Google Chrome installed on this machine; no browser download needed.
export default defineConfig({
  testDir: "./e2e",
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    channel: "chrome",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `tsx e2e/setup-db.ts && next dev -p ${E2E_PORT}`,
    env: { PGLITE_DIR: E2E_DB, NEXT_DIST_DIR: ".next/e2e" },
    url: `http://localhost:${E2E_PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
