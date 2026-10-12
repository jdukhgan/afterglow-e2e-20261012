module.exports = {
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:8778', viewport: { width: 1366, height: 850 }, reducedMotion: 'no-preference', trace: 'retain-on-failure' },
  webServer: { command: 'python3 tests/browser_server.py', url: 'http://127.0.0.1:8778/api/health', reuseExistingServer: false, timeout: 10000 },
};
