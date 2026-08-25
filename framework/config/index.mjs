/**
 * Config factories, one per platform, over a shared base.
 *
 * The orchestrator builds a config for every generated run, and a client can
 * import the same factory in their own repo — so a spec verified here behaves
 * identically when they run it themselves. That equivalence is the point: a
 * green result is only meaningful if it was produced by the same setup the
 * client will use.
 *
 * Stays plain ESM while the runtime next door is TypeScript, and the asymmetry
 * is load-bearing rather than an oversight. This module is imported by the
 * WebdriverIO *launcher*, which registers tsx for itself only when the config
 * file it was handed is TypeScript (`@wdio/cli` Launcher.initialize). A client
 * whose project predates TypeScript output still has a `wdio.*.config.mjs`, so
 * a `.ts` module here would fail their launcher with ERR_UNKNOWN_FILE_EXTENSION
 * on any Node without type stripping. The runtime has no such constraint: it is
 * only ever imported by specs, which run in a worker where tsx is always
 * registered. Types live in index.d.ts alongside.
 */

/**
 * Where specs live, by default.
 *
 * One constant rather than the same literal repeated in every factory: this is
 * the string that decides whether the runner finds a suite at all, so the
 * platforms must not be able to disagree about it. Covers both extensions
 * because a project is either TypeScript or JavaScript, never both.
 */
export const DEFAULT_SPECS = ["./test/**/*.ts", "./test/**/*.js"];

/** Everything platform-independent. */
export function baseConfig(overrides = {}) {
  return {
    runner: "local",
    maxInstances: 1,
    logLevel: "error",
    bail: 1,
    waitforTimeout: 15_000,
    connectionRetryTimeout: 120_000,
    connectionRetryCount: 2,
    framework: "mocha",
    reporters: ["spec"],
    mochaOpts: { ui: "bdd", timeout: 120_000 },

    /**
     * Screenshot on failure.
     *
     * Awaited — an unawaited saveScreenshot races the session teardown and the
     * file usually never appears, which is worse than not offering it at all,
     * because the run reports that a screenshot was taken.
     */
    afterTest: async function (test, _context, { error }) {
      if (!error || !this.screenshotDir) return;
      const safe = test.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
      try {
        await browser.saveScreenshot(`${this.screenshotDir}/${safe}-${Date.now()}.png`);
      } catch {
        // A failed screenshot must not replace the real failure in the report.
      }
    },

    ...overrides,
  };
}

export function webConfig({ headless = true, specs = DEFAULT_SPECS, ...rest } = {}) {
  return baseConfig({
    specs,
    capabilities: [
      {
        browserName: "chrome",
        "goog:chromeOptions": {
          args: [
            ...(headless ? ["--headless=new", "--disable-gpu"] : []),
            "--window-size=1440,900",
            "--no-sandbox",
          ],
        },
      },
    ],
    ...rest,
  });
}

export function androidConfig({ app, deviceName = "Android Emulator", appiumUrl, specs, ...rest } = {}) {
  const endpoint = parseEndpoint(appiumUrl ?? "http://127.0.0.1:4723");
  return baseConfig({
    specs: specs ?? DEFAULT_SPECS,
    ...endpoint,
    capabilities: [
      {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:deviceName": deviceName,
        "appium:app": app,
        "appium:autoGrantPermissions": true,
        "appium:newCommandTimeout": 120,
      },
    ],
    ...rest,
  });
}

export function iosConfig({ app, deviceName = "iPhone 15 Pro", platformVersion = "17", hub, vendor, specs, ...rest } = {}) {
  return baseConfig({
    specs: specs ?? DEFAULT_SPECS,
    ...(hub ?? {}),
    capabilities: [
      {
        platformName: "iOS",
        "appium:automationName": "XCUITest",
        "appium:deviceName": deviceName,
        "appium:platformVersion": platformVersion,
        "appium:app": app,
        ...(vendor ?? {}),
      },
    ],
    ...rest,
  });
}

function parseEndpoint(url) {
  const parsed = new URL(url);
  const secure = parsed.protocol === "https:";
  return {
    hostname: parsed.hostname,
    port: Number(parsed.port || (secure ? 443 : 4723)),
    protocol: secure ? "https" : "http",
    path: parsed.pathname === "" ? "/" : parsed.pathname,
  };
}
