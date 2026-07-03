import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: { baseURL: 'http://localhost:4321' },
  webServer: {
    command: 'bun run build && bun run preview',
    port: 4321,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
