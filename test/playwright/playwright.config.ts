import { PlaywrightTestConfig } from '@playwright/test';

const port = parseInt(process.env.PORT ?? '3000');

const config: PlaywrightTestConfig = {
  testDir: '.',
  timeout: 10000,
  projects: [
    {
      name: 'Chromium',
      use: {
        browserName: 'chromium'
      }
    },
    {
      name: 'FirefoxStable',
      use: {
        browserName: 'firefox'
      }
    },
    {
      name: 'WebKit',
      use: {
        browserName: 'webkit'
      }
    }
  ],
  reporter: 'list',
  webServer: {
    command: 'npm start',
    port,
    timeout: 120000,
    reuseExistingServer: !process.env.CI
  }
};
export default config;
