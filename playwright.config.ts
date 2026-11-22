import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the sign-in flows. The Supabase-backed specs need the
 * project's public URL and anon key (both non-secret); without them those
 * specs skip. Completing a real OTP sign-in additionally needs Supabase
 * "test OTP" configured (a fixed code for a test identifier) -- see
 * docs/auth-production-checklist.md -- and is gated behind E2E_TEST_OTP.
 */
const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Pixel 5 is Chromium-based, so the whole suite runs on one browser.
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
