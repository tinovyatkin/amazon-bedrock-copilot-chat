// @ts-check
import { defineConfig } from "@vscode/test-cli";

process.env.NODE_ENV = "test";

export default defineConfig({
  files: "out/test/**/*.test.js",
  srcDir: "src",
  mocha: {
    ui: "tdd",
    timeout: 20000,
    forbidOnly: !!process.env.CI,
    color: true,
  },
});
