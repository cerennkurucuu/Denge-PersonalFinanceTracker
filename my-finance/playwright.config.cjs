const { defineConfig } = require('@playwright/test');
const crypto = require('node:crypto');

const mysqlE2eRunId = crypto.randomUUID();
process.env.MYSQL_E2E_RUN_ID = mysqlE2eRunId;

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.cjs',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  outputDir: 'test-results/e2e',
  globalTeardown: './scripts/e2e-cleanup.cjs',
  use: {
    baseURL: 'http://127.0.0.1:4202',
    browserName: 'chromium',
    launchOptions: { channel: 'chrome' },
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/e2e-server.cjs',
    url: 'http://127.0.0.1:4202/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MYSQL_E2E_RUN_ID: mysqlE2eRunId },
  },
});
