import { defineConfig } from '@playwright/test';
import developmentConfig, { testPort, testOrigin } from './playwright.config';

export default defineConfig({
  ...developmentConfig,
  webServer: {
    env: { QUIET_READER_DIAGNOSTICS_TEST: '1' },
    command: `npm run preview -- --host 127.0.0.1 --port ${testPort} --strictPort`,
    url: testOrigin,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
