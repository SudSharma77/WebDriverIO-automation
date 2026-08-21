/**
 * Types for the spec runtime.
 *
 * Hand-written rather than emitted: the runtime is authored as plain ESM so
 * that nothing has to compile between generating a spec and replaying it, and
 * this file is small enough that keeping it in step is cheaper than putting a
 * build step in the verification path.
 */

export interface FindOptions {
  /** Milliseconds to wait for the element. Defaults to 15000. */
  timeout?: number;
  /** Human name used in the failure message, e.g. "the checkout button". */
  label?: string;
}

export interface TypeOptions extends FindOptions {
  /** Clear the field before typing. Defaults to true. */
  clear?: boolean;
}

/** Thrown when a selector does not match; lists what was on screen instead. */
export declare class ElementNotFoundError extends Error {
  readonly selector: string;
}

export declare function find(selector: string, options?: FindOptions): Promise<WebdriverIO.Element>;
export declare function click(selector: string, options?: FindOptions): Promise<void>;
export declare function type(selector: string, text: string, options?: TypeOptions): Promise<void>;
export declare function selectOption(selector: string, optionText: string, options?: FindOptions): Promise<void>;
export declare function getText(selector: string, options?: FindOptions): Promise<string>;
export declare function isVisible(selector: string, options?: FindOptions): Promise<boolean>;
export declare function waitForGone(selector: string, options?: FindOptions): Promise<void>;

/**
 * Dismiss a banner or dialog if present; no-op if absent. Returns whether
 * anything was dismissed. Use for consent banners, which appear late on a
 * first visit and not at all on a return visit.
 */
export declare function dismissIfPresent(selector: string, options?: FindOptions): Promise<boolean>;
export declare function waitForPageLoad(options?: { timeout?: number }): Promise<void>;

/** Selectors for the interactive elements currently on screen. Best-effort. */
export declare function describeScreen(limit?: number): Promise<string[]>;
