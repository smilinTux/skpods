import os from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

// Runs against the real pods-dev server. Needs the test credentials in the environment (see README).
// Starts Vite on 5174 (reuses a running one) and its own sk-consent on 8781 with a fresh database.
export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 900 },
    launchOptions: { executablePath: process.env.SKP_CHROME ?? '/usr/bin/google-chrome-stable' },
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'npx vite', url: 'http://localhost:5174', reuseExistingServer: true, timeout: 60_000 },
    {
      command: './scripts/broker.sh',
      url: 'http://localhost:8781/healthz',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...(process.env as Record<string, string>), SKCONSENT_DB: path.join(os.tmpdir(), `consent-center-e2e-${process.pid}.db`) },
    },
  ],
})
