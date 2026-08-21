/**
 * A plan is the contract between "what the user asked for" and "what gets
 * written to disk". It is deliberately explicit: every step names the exact
 * class and method it will call, so the diff can be reviewed — and so a
 * deterministic run can produce one without any model involved.
 */

export interface TestRequest {
  /** describe(...) title. */
  title: string;
  /** it(...) title. */
  test: string;
  platform: "web" | "mobile";
  steps: RequestStep[];
  /** Bind the spec to a dataset instead of hardcoding values. */
  data?: { file: string; index?: number; as?: string };
  /** Override where the spec is written; defaults to the detected specsDir. */
  specPath?: string;
}

/**
 * `use` performs an action; `expect` reads a value and asserts on it.
 * Both reference a capability as "ClassName.methodName".
 */
export type RequestStep =
  | { use: string; args?: unknown[]; comment?: string }
  | { expect: string; args?: unknown[]; matcher: Matcher; value?: unknown; comment?: string };

export type Matcher =
  | "toBe"
  | "toEqual"
  | "toContain"
  | "toBeGreaterThan"
  | "toBeTruthy"
  | "toBeFalsy"
  | "toBeDisplayed"
  | "toHaveText";

export interface ResolvedCall {
  className: string;
  method: string;
  importPath: string;
  /** Whether the module exports a class to construct or a ready instance. */
  exportStyle: "class" | "instance" | "unknown";
  defaultExport: boolean;
  kind: "page" | "helper";
  isStatic: boolean;
  /** Parameters the method declares, used to sanity-check the supplied args. */
  paramCount: number;
  requiredParams: number;
}

export type PlanStep =
  | { kind: "action"; call: ResolvedCall; args: string[]; comment?: string }
  | {
      kind: "assertion";
      call: ResolvedCall;
      args: string[];
      matcher: Matcher;
      value?: string;
      comment?: string;
    };

export interface PlanProblem {
  /** The unresolved reference, e.g. "CartPage.getBadgeCount". */
  reference: string;
  reason: string;
  /** Closest things that do exist — what a human would pick from. */
  suggestions: string[];
}

export interface TestPlan {
  title: string;
  test: string;
  platform: "web" | "mobile";
  /** Absolute path the spec will be written to. */
  specPath: string;
  steps: PlanStep[];
  /** Distinct "Class.method" entries this plan reuses from the framework. */
  reused: string[];
  /** References that could not be resolved. A plan with these cannot be written. */
  problems: PlanProblem[];
  data?: { file: string; index: number; as: string; importPath?: string };
  /** True when every reference resolved and the spec can be generated. */
  complete: boolean;
}

export interface FileChange {
  /** Repo-relative. */
  path: string;
  action: "create" | "modify";
  /** Existing content, when modifying. */
  before?: string;
  after: string;
}

export interface ProposedDiff {
  root: string;
  changes: FileChange[];
  reused: string[];
  created: string[];
  problems: PlanProblem[];
}
