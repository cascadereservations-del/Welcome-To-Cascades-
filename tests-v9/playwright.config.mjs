import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs/,
  timeout: 60000,
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'out/results.json' }]],
  outputDir: 'out/artifacts',
  use: { baseURL: 'http://127.0.0.1:4391', timezoneId: 'Asia/Manila', locale: 'en-US', viewport: { width: 390, height: 844 } },
  webServer: { command: 'node serve.mjs', url: 'http://127.0.0.1:4391/index.html', reuseExistingServer: false, timeout: 20000 },
});
