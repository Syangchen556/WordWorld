import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
process.env.WORDWORLD_TEST_PGLITE_PATH ||= resolve(
  `data/browser-postgres-${Date.now()}`,
);
process.env.WORDWORLD_TEST_SETUP_TOKEN ||=
  randomBytes(32).toString("base64url");
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 180000,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:3100", channel: "msedge", headless: true },
  webServer: {
    command: "node --import tsx scripts/browser-server.ts",
    url: "http://localhost:3100/api/health",
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      APP_ORIGIN: "http://localhost:3100",
      NEXT_DIST_DIR: ".next-e2e",
      WORDWORLD_TEST_PGLITE_PATH: process.env.WORDWORLD_TEST_PGLITE_PATH,
      WORDWORLD_TEST_SETUP_TOKEN: process.env.WORDWORLD_TEST_SETUP_TOKEN,
    },
  },
  outputDir: "./test-results",
});
