import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build (vite preview). The AI
 * functions don't run under preview, so specs that need them stub /api/ai/*
 * with page.route; everything else is the real app on the real data pack.
 *
 * PW_CHROMIUM points at a preinstalled Chromium where the bundled one isn't
 * downloaded (e.g. a sandbox); CI installs Playwright's own.
 */
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } },
  ],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
