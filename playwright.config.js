// Web tests: pnpm run test:web  (builds public/index.test.html from tests/config.test.json first)
// GitHub, the OAuth page and the Cloudflare Worker are simulated with page.route() (tests/helpers/fake-github.js).
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests/web",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:8301", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "node tests/helpers/static.js 8301", url: "http://127.0.0.1:8301/research/", reuseExistingServer: false },
});
