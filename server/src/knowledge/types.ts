import type { Platform } from "../types.js";

/**
 * What a client's project is written in.
 *
 * Decided once, when the project is first scaffolded, and never mixed: a
 * project that already contains JavaScript keeps receiving JavaScript, because
 * silently changing the language of a suite someone already runs is the same
 * class of harm as rewriting a file they edited.
 */
export type ProjectLanguage = "ts" | "js";

/**
 * What a client's project accumulates as tests are driven against it.
 *
 * The unit of knowledge is the *labelled locator*: "the login button" ->
 * "#login". Labels come for free — the runtime requires one on every call so
 * that failures can name the element, which means every generated spec already
 * carries a human name for each selector it touches.
 */
export interface CatalogEntry {
  /** Human name, taken from the spec's `label`. The stable key. */
  label: string;
  /** Selector last known to work. */
  selector: string;
  platform: Platform;
  firstSeen: number;
  /** Last time a spec using this selector actually passed replay. */
  lastVerified: number;
  /** Spec files that reference it, so a change's blast radius is knowable. */
  usedBy: string[];
  /**
   * Selectors this label used to have.
   *
   * Kept because a new build that moves an element is the common case, and the
   * previous value is the best hint for finding it again — plus it makes
   * "this app changed here" reportable rather than invisible.
   */
  history: Array<{ selector: string; retiredAt: number }>;
}

export interface Catalog {
  version: 1;
  clientId: string;
  entries: CatalogEntry[];
}

/** A verified spec, kept so the same request never regenerates. */
export interface SpecRecord {
  /** File name within the client project's spec directory. */
  file: string;
  /** The prompt that produced it, for matching future requests. */
  prompt: string;
  title: string;
  platform: Platform;
  /** Target it was verified against — a spec is only valid for its own app. */
  target: string;
  createdAt: number;
  lastVerified: number;
  /** Runs that replayed it successfully, for confidence and for the audit. */
  passCount: number;
  /** Credential names the spec reads from the environment. */
  requiresSecrets: string[];
  /**
   * Ordered page-object calls this spec makes, once it has been through the
   * page-object rewrite — see `flow.ts`. Absent on specs saved before this
   * field existed, or ones the rewrite declined to touch; both simply never
   * match as a shared prefix.
   */
  callSequence?: string[];
}

export interface SpecIndex {
  version: 1;
  clientId: string;
  specs: SpecRecord[];
}

/**
 * A business function in the client's project.
 *
 * Keyed for reuse on `callSequence`, not on the name. Two people describing
 * the same scenario in different words produce different titles and therefore
 * different names, but the same page-object calls in the same order — which
 * is what actually makes two flows the same flow. Matching on names would
 * duplicate the login flow for every synonym of "sign in"; matching on the
 * sequence finds it however it was described.
 */
export interface FlowRecord {
  /** Exported function name, and the module's basename. */
  name: string;
  /** File within the project's `src/flows`, extension included. */
  file: string;
  /** Ordered page-object calls, e.g. `["homePage.open", "homePage.clickGo"]`. */
  callSequence: string[];
  /** Parameters a caller supplies, in declaration order. */
  inputFields: string[];
  /** Values it returns, in the order its calls produce them. */
  outputFields: string[];
  /** Spec files that call it, so a change's blast radius is knowable. */
  usedBy: string[];
  createdAt: number;
}

export interface FlowIndex {
  version: 1;
  clientId: string;
  flows: FlowRecord[];
}

/**
 * How a request was satisfied. Ordered cheapest first — this is the whole
 * economic argument for keeping a knowledge base at all.
 */
export type ReuseMode =
  /** An existing spec matched and passed on replay. No model calls at all. */
  | "replayed"
  /** An existing spec matched but failed; only the broken part was re-explored. */
  | "repaired"
  /** No spec, but the catalog knew the elements: synthesis without exploration. */
  | "from-catalog"
  /** Nothing known. Full exploration, and everything learned is saved. */
  | "explored";

export interface ReuseDecision {
  mode: ReuseMode;
  /** The spec to replay, when one matched. */
  spec?: SpecRecord;
  /** Why this path was chosen — surfaced in the UI, not just logged. */
  reason: string;
  /** Catalog entries relevant to the request, for the from-catalog path. */
  known: CatalogEntry[];
}
