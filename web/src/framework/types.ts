export interface LayoutInfo {
  language: "ts" | "js";
  testFramework: string;
  specsDir: string | null;
  pageObjectDirs: string[];
  dataDirs: string[];
  baseClass: string | null;
  aliases: Record<string, string>;
  confidence: Record<string, "declared" | "detected" | "guessed">;
}

export interface MethodSummary {
  name: string;
  doc: string | null;
  params: string[];
}

export interface PageObjectSummary {
  className: string;
  file: string;
  platform: "web" | "mobile" | "shared";
  methods: MethodSummary[];
}

export interface HelperSummary {
  className: string;
  methods: string[];
}

export interface DataSummary {
  name: string;
  format: "json" | "csv";
  records: number;
  fields: string[];
}

export interface SpecSummary {
  file: string;
  suites: string[];
}

export type FrameworkState =
  | {
      open: false;
      suggestion: string;
      llm: { provider: string; model: string };
    }
  | {
      open: true;
      root: string;
      path: string;
      summary: string;
      layout: LayoutInfo;
      pageObjects: PageObjectSummary[];
      helpers: HelperSummary[];
      data: DataSummary[];
      specs: SpecSummary[];
      warnings: string[];
      llm: { provider: string; model: string };
    };

export interface PlanProblem {
  reference: string;
  reason: string;
  suggestions: string[];
}

export interface MissingCapability {
  capability: string;
  suggestedClass?: string;
  suggestedMethod?: string;
}

export interface FileChange {
  path: string;
  action: "create" | "modify";
  before?: string;
  after: string;
}

export interface PlanResult {
  planId: string;
  mode: "prompt" | "deterministic";
  llmCalls: number;
  complete: boolean;
  title: string;
  test: string;
  reused: string[];
  missing: MissingCapability[];
  duplicateOf: string | null;
  problems: PlanProblem[];
  data: { file: string; index: number; as: string } | null;
  changes: FileChange[];
}
