/**
 * Types for the config factories.
 *
 * Hand-written, because index.mjs must stay plain ESM — see the rationale at
 * the top of that file: the WebdriverIO launcher loads this module without a
 * transpiler registered whenever the config file it was handed is not itself
 * TypeScript, which is still the case for every project generated before
 * TypeScript output existed.
 *
 * Kept honest by `contract.test.ts`, which asserts every declared export
 * actually exists at runtime — the cheap half of the drift problem, and the
 * half that actually bit this package before (`TypeOptions` silently lacked
 * `mask` for as long as masking existed).
 *
 * Named .d.mts, not .d.ts: under NodeNext, declarations for a .mjs module are
 * only found under the matching .d.mts extension.
 */

/** Default spec globs. Covers both extensions; a project only ever has one. */
export declare const DEFAULT_SPECS: string[];

/** A config plus the extras this framework layers on top of WebdriverIO's own. */
export interface TestLabConfig extends WebdriverIO.Config {
  /**
   * Directory for failure screenshots. Nothing sets this by default, so the
   * `afterTest` hook in `baseConfig` is a no-op until a config supplies one.
   */
  screenshotDir?: string;
}

export interface WebConfigOptions extends Partial<TestLabConfig> {
  /** Run Chrome headless. Defaults to true. */
  headless?: boolean;
}

export interface AndroidConfigOptions extends Partial<TestLabConfig> {
  /** Path to the .apk under test. */
  app?: string;
  deviceName?: string;
  /** Appium server URL. Defaults to http://127.0.0.1:4723. */
  appiumUrl?: string;
}

export interface IosConfigOptions extends Partial<TestLabConfig> {
  /** Path or cloud id of the .app/.ipa under test. */
  app?: string;
  deviceName?: string;
  platformVersion?: string;
  /** Connection details for a cloud device farm, spread onto the config. */
  hub?: Record<string, unknown>;
  /** Vendor-specific capabilities, spread onto the single capability object. */
  vendor?: Record<string, unknown>;
}

/** Everything platform-independent. */
export declare function baseConfig(overrides?: Partial<TestLabConfig>): TestLabConfig;

export declare function webConfig(options?: WebConfigOptions): TestLabConfig;
export declare function androidConfig(options?: AndroidConfigOptions): TestLabConfig;
export declare function iosConfig(options?: IosConfigOptions): TestLabConfig;
