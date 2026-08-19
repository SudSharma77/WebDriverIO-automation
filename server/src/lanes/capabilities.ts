import { config } from "../config.js";
import type { Platform, RunTarget } from "../types.js";

export interface LanePlan {
  /** Arguments for the MCP `start_session` tool during exploration. */
  sessionArgs: Record<string, unknown>;
  /** WebDriver endpoint + capabilities for the independent verify replay. */
  runner: {
    hostname: string;
    port: number;
    protocol: "http" | "https";
    path: string;
    user?: string;
    key?: string;
    capabilities: Record<string, unknown>;
  };
  /** Where the agent should begin, stated in the task prompt. */
  entryPoint: string;
}

/**
 * Single source of truth for "what does this platform connect to".
 *
 * Exploration (MCP) and verification (wdio runner) must agree on the target or
 * a spec can pass exploration and fail replay for reasons that have nothing to
 * do with the test — so both shapes are derived here, side by side.
 */
export function planFor(platform: Platform, target: RunTarget, headless: boolean): LanePlan {
  switch (platform) {
    case "web":
      return planWeb(target, headless);
    case "android":
      return planAndroid(target);
    case "ios":
      return planIos(target);
  }
}

function planWeb(target: RunTarget, headless: boolean): LanePlan {
  const url = target.webUrl!;
  return {
    sessionArgs: {
      platform: "browser",
      browser: "chrome",
      headless,
      windowWidth: 1440,
      windowHeight: 900,
    },
    runner: {
      hostname: "127.0.0.1",
      port: 0, // 0 → let WebdriverIO manage its own chromedriver
      protocol: "http",
      path: "/",
      capabilities: {
        browserName: "chrome",
        "goog:chromeOptions": {
          args: [
            ...(headless ? ["--headless=new", "--disable-gpu"] : []),
            "--window-size=1440,900",
            "--no-sandbox",
          ],
        },
      },
    },
    entryPoint: `Web app at ${url}`,
  };
}

function planAndroid(target: RunTarget): LanePlan {
  const app = target.androidApp!;
  const deviceName = config.ANDROID_DEVICE_NAME ?? "Android Emulator";
  const appium = new URL(config.APPIUM_URL);

  return {
    sessionArgs: {
      platform: "android",
      appPath: app,
      deviceName,
      autoGrantPermissions: true,
    },
    runner: {
      hostname: appium.hostname,
      port: Number(appium.port || (appium.protocol === "https:" ? 443 : 4723)),
      protocol: appium.protocol === "https:" ? "https" : "http",
      path: appium.pathname === "/" ? "/" : appium.pathname,
      capabilities: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:deviceName": deviceName,
        "appium:app": app,
        "appium:autoGrantPermissions": true,
        "appium:newCommandTimeout": 120,
      },
    },
    entryPoint: `Android app ${app} on ${deviceName}`,
  };
}

function planIos(target: RunTarget): LanePlan {
  // Guarded by preflight — iOS without a farm never reaches here.
  const cloud = config.cloud!;
  const app = target.iosApp!;
  const deviceName = target.iosDeviceName ?? "iPhone 15 Pro";
  const platformVersion = target.iosPlatformVersion ?? "17";

  const vendorCaps =
    cloud.provider === "browserstack"
      ? {
          "bstack:options": {
            deviceName,
            platformVersion,
            projectName: "wdio-ai-test-lab",
            buildName: "prompt-to-test",
            appiumVersion: "2.6.0",
          },
        }
      : {
          "sauce:options": {
            name: "wdio-ai-test-lab",
            appiumVersion: "2.0.0",
          },
        };

  return {
    sessionArgs: {
      provider: cloud.provider,
      platform: "ios",
      app,
      deviceName,
      platformVersion,
    },
    runner: {
      hostname: cloud.hostname,
      port: cloud.port,
      protocol: cloud.protocol,
      path: cloud.path,
      user: cloud.user,
      key: cloud.key,
      capabilities: {
        platformName: "iOS",
        "appium:automationName": "XCUITest",
        "appium:deviceName": deviceName,
        "appium:platformVersion": platformVersion,
        "appium:app": app,
        ...vendorCaps,
      },
    },
    entryPoint: `iOS app ${app} on ${deviceName} (iOS ${platformVersion}) via ${cloud.provider}`,
  };
}
