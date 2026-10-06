import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  webServer: { command: 'python3 -m http.server 4173', port: 4173, reuseExistingServer: true },
  use: { baseURL: 'http://localhost:4173/' },
  projects: [
    { name: 'desktop', testMatch: /desktop\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    { name: 'touch', testMatch: /touch\.spec\.js/, use: { ...devices['Pixel 7'] } },
  ],
});
