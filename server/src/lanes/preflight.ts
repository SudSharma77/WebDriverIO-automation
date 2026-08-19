import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { Platform, RunTarget } from "../types.js";

export type PreflightResult = { ok: true } | { ok: false; reason: string };

/**
 * Fail fast, in the user's language.
 *
 * Every one of these would otherwise surface 30 seconds later as a WebDriver
 * stack trace that says nothing about what to actually do — an unreachable
 * Appium, a typo'd apk path, iOS with no farm configured.
 */
export async function preflight(platform: Platform, target: RunTarget): Promise<PreflightResult> {
  switch (platform) {
    case "web":
      return preflightWeb(target);
    case "android":
      return preflightAndroid(target);
    case "ios":
      return preflightIos(target);
  }
}

function preflightWeb(target: RunTarget): PreflightResult {
  if (!target.webUrl?.trim()) {
    return { ok: false, reason: "No web URL supplied. Add the URL under test to run the web lane." };
  }
  let url: URL;
  try {
    url = new URL(target.webUrl);
  } catch {
    return { ok: false, reason: `"${target.webUrl}" is not a valid URL. Include the scheme, e.g. https://example.com` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Unsupported scheme "${url.protocol}". Use http:// or https://` };
  }
  return { ok: true };
}

async function preflightAndroid(target: RunTarget): Promise<PreflightResult> {
  const app = target.androidApp?.trim();
  if (!app) {
    return { ok: false, reason: "No Android app supplied. Give an absolute path to a local .apk." };
  }

  if (!isCloudAppId(app)) {
    if (!path.isAbsolute(app)) {
      return { ok: false, reason: `Android app path must be absolute. Got "${app}".` };
    }
    if (path.extname(app).toLowerCase() !== ".apk") {
      return { ok: false, reason: `Expected a .apk file, got "${path.extname(app) || "no extension"}".` };
    }
    try {
      const stat = await fs.stat(app);
      if (!stat.isFile()) return { ok: false, reason: `"${app}" is not a file.` };
    } catch {
      return { ok: false, reason: `Cannot read "${app}" — check the path exists and is readable.` };
    }
  }

  const appium = await probeAppium();
  if (!appium.ok) return appium;

  return { ok: true };
}

function preflightIos(target: RunTarget): PreflightResult {
  if (!config.cloud) {
    return {
      ok: false,
      reason:
        "iOS needs a cloud device farm — XCUITest only runs on macOS with Xcode, and this server is not on a Mac. " +
        "Set CLOUD_PROVIDER plus its credentials in .env, or deselect iOS.",
    };
  }
  const app = target.iosApp?.trim();
  if (!app) {
    return {
      ok: false,
      reason: `No iOS app supplied. Upload your .ipa to ${config.cloud.provider} and paste the returned app id.`,
    };
  }
  if (!isCloudAppId(app)) {
    return {
      ok: false,
      reason: `"${app}" is not a cloud app id. Expected something like bs://<hash> or storage:filename=app.ipa — a local .ipa path cannot be reached from a cloud device.`,
    };
  }
  return { ok: true };
}

function isCloudAppId(app: string): boolean {
  return /^(bs:\/\/|storage:|lt:\/\/|tb:\/\/)/i.test(app);
}

/** The Appium server is the single most common thing to have forgotten to start. */
async function probeAppium(): Promise<PreflightResult> {
  const statusUrl = new URL("/status", config.APPIUM_URL).toString();
  try {
    const res = await fetch(statusUrl, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      return { ok: false, reason: `Appium at ${config.APPIUM_URL} answered ${res.status}. Restart it with \`npm run appium\`.` };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: `No Appium server at ${config.APPIUM_URL}. Start one in another terminal: \`npm run appium\` (install the driver once with \`npm run appium:drivers\`).`,
    };
  }
}
