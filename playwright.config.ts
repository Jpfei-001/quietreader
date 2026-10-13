import { defineConfig, devices } from '@playwright/test';

export const testPort = Number(process.env.READER_TEST_PORT ?? 1421);
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) throw new Error('Invalid READER_TEST_PORT');
export const testOrigin = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: testOrigin,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: 'chromium',
  },
  webServer: {
    command: `npm run dev -- --port ${testPort} --strictPort`,
    env: { QUIET_READER_DIAGNOSTICS_TEST: '1' },
    url: testOrigin,
    reuseExistingServer: false, // Tests must start their own test-mode collector, never reuse a user's service.
    timeout: 30000,
  },
});
