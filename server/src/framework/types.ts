/**
 * A structural map of an existing WebdriverIO framework.
 *
 * This is what turns the tool from "generate an orphan spec" into "work inside
 * this suite": the planner consults the index to decide whether a request is
 * already covered by existing page-object methods, needs one added, or needs a
 * whole page modelled.
 */

export type LanePlatform = "web" | "mobile" | "shared";

export interface MethodParam {
  name: string;
  type: string;
  optional: boolean;
}

export interface MethodInfo {
  name: string;
  params: MethodParam[];
  returnType: string;
  /** First line of the JSDoc, if any — the cheapest signal of intent. */
  doc?: string;
  visibility: "public" | "protected" | "private";
  isStatic: boolean;
}

export interface ElementInfo {
  /** Getter name, e.g. `loginButton`. */
  name: string;
  /** The literal selector, when it is a plain string in the source. */
  selector?: string;
  /** True for `$$(...)` collections. */
  multiple: boolean;
}

/**
 * How the module hands the page object out. Frameworks split roughly evenly
 * between exporting the class (spec does `new HomePage()`) and exporting a
 * ready-made singleton (`module.exports = new CheckoutPage()`), and generating
 * the wrong one produces code that does not run.
 */
export type ExportStyle = "class" | "instance" | "unknown";

export interface PageObjectInfo {
  className: string;
  /** Repo-relative path. */
  file: string;
  /** How a spec should import it, honouring tsconfig path aliases. */
  importPath: string;
  extends?: string;
  platform: LanePlatform;
  exportStyle: ExportStyle;
  /** True when exported via `export default` rather than a named export. */
  defaultExport: boolean;
  elements: ElementInfo[];
  methods: MethodInfo[];
}

export interface HelperInfo {
  className: string;
  file: string;
  importPath: string;
  methods: MethodInfo[];
}

export interface DataFileInfo {
  /** Repo-relative path. */
  file: string;
  /** The name TestDataHelper would load it by, e.g. `users`. */
  name: string;
  format: "json" | "csv";
  recordCount: number;
  /** Top-level field names of the first record. */
  fields: string[];
}

export interface SpecInfo {
  file: string;
  suites: Array<{ title: string; tests: string[] }>;
}

export interface ConfigInfo {
  /** `web`, `android`, `ios`, `api`, `multiremote`, `shared`. */
  platform: string;
  file: string;
  /** The `specs` globs, so we can tell whether a new spec would even run. */
  specs: string[];
  baseUrl?: string;
}

export type TestFramework = "mocha" | "jasmine" | "cucumber" | "unknown";
export type Language = "ts" | "js";

/** How confident detection is about a field — surfaced so a human can correct it. */
export type Confidence = "declared" | "detected" | "guessed";

/**
 * Where everything lives in a target framework.
 *
 * Derived by detection, overridable by a `testlab.config.json` in the target
 * repo. Nothing downstream hardcodes a path: the whole point is that the next
 * framework has a different layout and must work without a code change.
 */
export interface FrameworkLayout {
  root: string;
  language: Language;
  testFramework: TestFramework;
  /** Directories (repo-relative) holding page objects, found by shape. */
  pageObjectDirs: string[];
  /** Directories holding reusable helpers/utilities. */
  utilityDirs: string[];
  /** Where new specs should be written. */
  specsDir?: string;
  /** Directories holding .json/.csv test data. */
  dataDirs: string[];
  /** Cucumber only: directories holding step definitions. */
  stepDefinitionDirs: string[];
  /** The class every page object extends, if there is one. */
  baseClass?: string;
  /** tsconfig `paths`, prefix -> directory. */
  aliases: Record<string, string>;
  /**
   * Representative existing files. The generator matches their style rather
   * than imposing one, which is what lets this work on a framework whose
   * conventions nobody encoded in advance.
   */
  exemplars: { pageObject?: string; spec?: string; stepDefinition?: string };
  confidence: Record<string, Confidence>;
  notes: string[];
}

/** Shape of an optional `testlab.config.json` in the target repo. */
export interface FrameworkConfigFile {
  language?: Language;
  testFramework?: TestFramework;
  pageObjectDirs?: string[];
  utilityDirs?: string[];
  specsDir?: string;
  dataDirs?: string[];
  stepDefinitionDirs?: string[];
  baseClass?: string;
  exemplars?: { pageObject?: string; spec?: string; stepDefinition?: string };
}

export interface StepDefinitionInfo {
  file: string;
  keyword: "Given" | "When" | "Then";
  /** The Gherkin expression or regex source. */
  pattern: string;
}

export interface FrameworkIndex {
  root: string;
  layout: FrameworkLayout;
  /** tsconfig `paths`, normalised to prefix -> directory. */
  aliases: Record<string, string>;
  /** The abstract base every page object extends, and what it already provides. */
  baseClass?: { className: string; file: string; helpers: string[] };
  pageObjects: PageObjectInfo[];
  helpers: HelperInfo[];
  data: DataFileInfo[];
  specs: SpecInfo[];
  configs: ConfigInfo[];
  stepDefinitions: StepDefinitionInfo[];
  /** Things a human should know before trusting a generated diff. */
  warnings: string[];
  indexedAt: number;
}
