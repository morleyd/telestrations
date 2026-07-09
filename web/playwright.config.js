import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(webDir, '..')

// Isolated ports/data so the suite never collides with a dev server or touches
// the real pb_data (global-setup.js seeds .e2e-pb-data from a copy).
const PB_PORT = 8091
const WEB_PORT = 5199

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // The Vite dev server compiles route chunks on first request, so the very
  // first navigation of a cold run can be slow; a retry runs it warm. Not
  // masking real failures — those fail on the retry too.
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.js',
  globalTeardown: './tests/e2e/global-teardown.js',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // Real backend, but against a throwaway copy of pb_data on a test port.
      command: `go run . serve --dir .e2e-pb-data --http 127.0.0.1:${PB_PORT}`,
      cwd: repoRoot,
      url: `http://127.0.0.1:${PB_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Frontend pointed at the test backend.
      command: `./node_modules/.bin/vite --host 127.0.0.1 --port ${WEB_PORT}`,
      cwd: webDir,
      env: { ...process.env, VITE_POCKETBASE_URL: `http://127.0.0.1:${PB_PORT}/` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
