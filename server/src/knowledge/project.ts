import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { Platform } from "../types.js";
import { SELECTOR_DIR, slugify } from "./structure.js";
import type { Catalog, FlowIndex, ProjectLanguage, SpecIndex } from "./types.js";

/**
 * Each client gets a real WebdriverIO project on disk, not a scratch folder.
 *
 * The accumulated specs have to be something the client owns and can run
 * themselves — `npx wdio run wdio.web.config.mjs` with no part of this tool in
 * the loop. That constraint is what stops the product becoming a black box the
 * client can never leave, and it is why the knowledge lives in a project layout
 * rather than in a database.
 */

/**
 * Where everything lives. Pure path arithmetic — no disk access, so this is
 * safe to call before a project exists.
 */
export interface ProjectPaths {
  clientId: string;
  root: string;
  specsDir: string;
  /** Tool-owned metadata, kept out of the way of the client's own files. */
  metaDir: string;
  /** Page objects: one class per screen. */
  pagesDir: string;
  /** Selectors as data, so a moved element is a one-line change. */
  selectorsDir: string;
  /** Business functions spanning pages — "log in", "check out". */
  flowsDir: string;
  dataDir: string;
}

/** A project whose language has been established, which needs the disk. */
export interface ClientProject extends ProjectPaths {
  language: ProjectLanguage;
}

export function projectFor(clientId: string): ProjectPaths {
  const root = path.join(config.clientsRoot, clientId);
  return {
    clientId,
    root,
    specsDir: path.join(root, "test", "specs"),
    metaDir: path.join(root, ".testlab"),
    pagesDir: path.join(root, "src", "pages"),
    selectorsDir: path.join(root, "src", SELECTOR_DIR),
    flowsDir: path.join(root, "src", "flows"),
    dataDir: path.join(root, "test", "testdata"),
  };
}

/** The file extension source files in this project carry. */
export function sourceExt(language: ProjectLanguage): ".ts" | ".js" {
  return language === "ts" ? ".ts" : ".js";
}

interface ProjectMeta {
  version: 1;
  language: ProjectLanguage;
}

/**
 * What language this project is written in.
 *
 * Recorded on first scaffold, but never trusted as the *only* signal: a
 * project generated before that record existed has no marker, and guessing
 * TypeScript for it would start writing `.ts` files into a working JavaScript
 * suite. So an unmarked project is read off what is actually on disk, and only
 * a genuinely empty one defaults to TypeScript.
 */
export async function detectLanguage(paths: ProjectPaths): Promise<ProjectLanguage> {
  const recorded = await readJson<ProjectMeta>(path.join(paths.metaDir, "project.json"));
  if (recorded?.language === "ts" || recorded?.language === "js") return recorded.language;

  for (const dir of [paths.specsDir, paths.pagesDir]) {
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    if (entries.some((name) => name.endsWith(".js"))) return "js";
    if (entries.some((name) => name.endsWith(".ts"))) return "ts";
  }

  return "ts";
}

/** Create the project if this is the client's first run. Idempotent. */
export async function ensureProject(clientId: string): Promise<ClientProject> {
  const paths = projectFor(clientId);

  for (const dir of [paths.specsDir, paths.metaDir, paths.pagesDir, paths.selectorsDir, paths.flowsDir, paths.dataDir]) {
    await fs.mkdir(dir, { recursive: true });
  }

  // Detected before anything is written, so the very first scaffold of an
  // existing-but-unmarked project still reads that project's own files rather
  // than the directories just created for it.
  const language = await detectLanguage(paths);
  const project: ClientProject = { ...paths, language };

  // writeIfAbsent, like everything else here: a project that predates this
  // record keeps whatever detectLanguage read off its files, and can never be
  // flipped by a later write.
  await writeIfAbsent(
    path.join(project.metaDir, "project.json"),
    `${JSON.stringify({ version: 1, language } satisfies ProjectMeta, null, 2)}\n`,
  );

  await writeIfAbsent(path.join(project.root, "package.json"), packageJson(clientId, language));
  await writeIfAbsent(path.join(project.root, "README.md"), readme(clientId, language));
  await writeIfAbsent(path.join(project.root, ".gitignore"), gitignore());

  if (language === "ts") {
    await writeIfAbsent(path.join(project.root, "tsconfig.json"), tsconfigFile());
  }

  await scaffoldFramework(project);

  for (const platform of ["web", "android", "ios"] as const) {
    await writeIfAbsent(path.join(project.root, configName(platform, language)), configFile(platform, language));
  }

  await fs.mkdir(path.join(project.root, ".github", "workflows"), { recursive: true });
  await writeIfAbsent(path.join(project.root, ".github", "workflows", "test.yml"), ciWorkflow(language));

  return project;
}

/**
 * What never belongs in the client's repository.
 *
 * `.testlab/reviews/` and `.testlab/pending/` are the two that matter beyond
 * the obvious: reviews are the record of what is *waiting* to be approved, and
 * pending is scratch space for verifying a candidate spec. Committing either
 * would put them inside the blast radius of the operations that act on them —
 * rejecting a change resets the working tree, which would take the review
 * history for every *other* change with it. The rest of `.testlab/` is
 * genuinely useful in the repo and stays tracked.
 */
function gitignore(): string {
  return `node_modules/
screenshots/
.env

# Tool state about work in flight, not part of the suite.
.testlab/reviews/
.testlab/pending/
`;
}

/**
 * The parts of the framework that are infrastructure rather than knowledge.
 *
 * Written once at onboarding, not grown per prompt: a client should be able to
 * run their suite, point it at a different environment and read a failure
 * before a single test case has been written. Everything here goes through
 * `writeIfAbsent`, so a project that predates any of these files simply gains
 * the ones it lacks and nothing that already exists is touched.
 *
 * Deliberately small. Anything that could live in `@testlab/framework` does —
 * a helper vendored into every client's repo is a helper that can never be
 * fixed centrally. What remains here is what has to be the client's own: their
 * environments, their test data, their shared types.
 */
export async function scaffoldFramework(project: ClientProject): Promise<void> {
  const ext = sourceExt(project.language);
  const utilsDir = path.join(project.root, "src", "utils");
  const typesDir = path.join(project.root, "src", "types");
  const fixturesDir = path.join(project.root, "src", "fixtures");

  // Including the two it does not own: this must be callable against any
  // project, not only one `ensureProject` has just laid out.
  for (const dir of [utilsDir, typesDir, fixturesDir, project.flowsDir, project.dataDir]) {
    await fs.mkdir(dir, { recursive: true });
  }

  await writeIfAbsent(path.join(utilsDir, `env${ext}`), envUtil(project.language));
  await writeIfAbsent(path.join(utilsDir, `testdata${ext}`), testDataUtil(project.language));
  await writeIfAbsent(path.join(typesDir, `index${ext}`), sharedTypes(project.language));
  await writeIfAbsent(path.join(fixturesDir, `hooks${ext}`), hooksUtil(project.language));
  await writeIfAbsent(path.join(project.root, ".env.example"), envExample());
  await writeIfAbsent(path.join(project.root, "eslint.config.js"), eslintConfig(project.language));
  await writeIfAbsent(path.join(project.flowsDir, "README.md"), flowsReadme());
  await writeIfAbsent(path.join(project.dataDir, "README.md"), testDataReadme());
}

/**
 * The wdio config's own filename.
 *
 * TypeScript projects need a `.ts` config specifically, and not for tidiness:
 * `@wdio/cli`'s launcher registers tsx for its own process only when the config
 * file it was handed is TypeScript. A `.mjs` config in a TypeScript project
 * would load, then fail the moment it imported anything typed.
 */
export function configName(platform: Platform, language: ProjectLanguage): string {
  return language === "ts" ? `wdio.${platform}.config.ts` : `wdio.${platform}.config.mjs`;
}

/**
 * Only ever creates. A client's config is theirs to edit — regenerating it on
 * every run would silently discard the timeout they raised last week.
 */
async function writeIfAbsent(file: string, contents: string): Promise<void> {
  try {
    await fs.writeFile(file, contents, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

export async function readCatalog(project: ClientProject): Promise<Catalog> {
  return (
    (await readJson<Catalog>(path.join(project.metaDir, "catalog.json"))) ?? {
      version: 1,
      clientId: project.clientId,
      entries: [],
    }
  );
}

export async function writeCatalog(project: ClientProject, catalog: Catalog): Promise<void> {
  await writeJson(path.join(project.metaDir, "catalog.json"), catalog);
}

export async function readSpecIndex(project: ClientProject): Promise<SpecIndex> {
  return (
    (await readJson<SpecIndex>(path.join(project.metaDir, "specs.json"))) ?? {
      version: 1,
      clientId: project.clientId,
      specs: [],
    }
  );
}

export async function writeSpecIndex(project: ClientProject, index: SpecIndex): Promise<void> {
  await writeJson(path.join(project.metaDir, "specs.json"), index);
}

export async function readFlowIndex(project: ClientProject): Promise<FlowIndex> {
  return (
    (await readJson<FlowIndex>(path.join(project.metaDir, "flows.json"))) ?? {
      version: 1,
      clientId: project.clientId,
      flows: [],
    }
  );
}

export async function writeFlowIndex(project: ClientProject, index: FlowIndex): Promise<void> {
  await writeJson(path.join(project.metaDir, "flows.json"), index);
  await fs.writeFile(path.join(project.root, "src", "manifest.yaml"), manifest(index), "utf8");
}

/**
 * The human-readable register of business functions, in the same shape the
 * reference architecture uses.
 *
 * Written *from* `flows.json` and never read back. That direction is
 * deliberate: reuse decisions stay deterministic against a machine-owned file
 * rather than depending on a YAML parser's view of something a human may have
 * reformatted, and the project gains no dependency for a file it only ever
 * emits. This is the one generated file that *is* rewritten each time — it is
 * a projection of the index, so an edit to it would be lost either way, and
 * saying so here is better than pretending otherwise.
 */
function manifest(index: FlowIndex): string {
  if (index.flows.length === 0) {
    return `# Business functions in this suite. Generated from .testlab/flows.json — edit the flows, not this file.\n[]\n`;
  }

  const entries = index.flows
    .map((flow) =>
      [
        // Kebab from the camelCase export, so `logIn` reads as `log-in`
        // rather than collapsing to `login`.
        `- id: ${JSON.stringify(slugify(flow.name.replace(/([a-z0-9])([A-Z])/g, "$1-$2")))}`,
        `  name: ${JSON.stringify(flow.name)}`,
        `  path: ${JSON.stringify(`src/flows/${flow.file}`)}`,
        `  export: ${JSON.stringify(flow.name)}`,
        `  inputs: [${flow.inputFields.map((f) => JSON.stringify(f)).join(", ")}]`,
        `  outputs: [${flow.outputFields.map((f) => JSON.stringify(f)).join(", ")}]`,
        `  usedBy:`,
        ...(flow.usedBy.length > 0 ? flow.usedBy.map((s) => `    - ${JSON.stringify(s)}`) : ["    []"]),
      ].join("\n"),
    )
    .join("\n\n");

  return `# Business functions in this suite. Generated from .testlab/flows.json — edit the flows, not this file.\n${entries}\n`;
}

/** Append-only run history. JSONL so a crash truncates one line, not the file. */
export async function appendRunLog(project: ClientProject, entry: Record<string, unknown>): Promise<void> {
  await fs.mkdir(project.metaDir, { recursive: true });
  await fs.appendFile(path.join(project.metaDir, "runs.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    // A corrupt metadata file must not take the run down: losing accumulated
    // knowledge degrades cost, whereas failing the run loses the run.
    return null;
  }
}

/**
 * Write through a temp file and rename.
 *
 * Lanes for different platforms finish independently and both update the
 * catalog; a torn write during that overlap would corrupt the knowledge base
 * for every future run.
 */
async function writeJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, file);
}

function packageJson(clientId: string, language: ProjectLanguage): string {
  const scripts: Record<string, string> = {
    "test:web": `wdio run ${configName("web", language)}`,
    "test:android": `wdio run ${configName("android", language)}`,
    "test:ios": `wdio run ${configName("ios", language)}`,
    lint: "eslint .",
  };
  // Never part of running the suite — see tsconfigFile(). Offered so a client
  // can ask for type errors deliberately, not so anything gates on them.
  if (language === "ts") scripts["typecheck"] = "tsc --noEmit";

  // Only what `npm run lint` and `npm run typecheck` need. The WebdriverIO
  // packages are deliberately left to the install line in the README: a client
  // pinning them here would fight whatever their own CI already installs.
  const devDependencies: Record<string, string> =
    language === "ts"
      ? { eslint: "^9.0.0", typescript: "^5.4.0", "@typescript-eslint/parser": "^8.0.0" }
      : { eslint: "^9.0.0" };

  return `${JSON.stringify(
    {
      name: `testlab-${clientId}`,
      private: true,
      type: "module",
      description: `Accumulated WebdriverIO suite for ${clientId}, grown from verified test runs.`,
      scripts,
      devDependencies,
    },
    null,
    2,
  )}\n`;
}

/**
 * Deliberately lenient, and `strict` is off on purpose.
 *
 * Nothing here ever compiles: specs run through tsx, which strips types
 * without checking them. So a type error cannot fail a test — it can only
 * appear as noise against a spec that provably passes, since a spec only
 * reaches this project after passing a real replay. `allowJs` matters too: a
 * client hand-adding a `.js` helper should not break their own typecheck.
 *
 * Created once, then yours to edit — the same contract as the wdio configs.
 */
function tsconfigFile(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022", "DOM"],
        types: ["node", "@wdio/globals/types", "@wdio/mocha-framework", "expect-webdriverio"],
        strict: false,
        allowJs: true,
        skipLibCheck: true,
        noEmit: true,
        forceConsistentCasingInFileNames: true,
      },
      include: ["test/**/*.ts", "src/**/*.ts", "wdio.*.config.ts"],
    },
    null,
    2,
  )}\n`;
}

/**
 * Web only, on purpose: Android needs Appium and a device/emulator, iOS needs
 * a cloud farm's credentials — neither exists on a stock GitHub-hosted
 * runner. Headless Chrome does, so that's the lane a generic CI box can
 * actually run without the client wiring up secrets or self-hosted runners
 * first. Same "created once, yours to edit" contract as the wdio configs.
 */
function ciWorkflow(language: ProjectLanguage): string {
  // Non-blocking on purpose: nothing compiles to run the suite, so a type
  // error is information, never a reason to fail a build whose tests pass.
  const typecheck =
    language === "ts"
      ? `      - name: Type check (informational — specs run without compiling)
        run: npx tsc --noEmit
        continue-on-error: true
`
      : "";

  return `name: Test suite

on:
  push:
  pull_request:

jobs:
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install @testlab/framework @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter webdriverio
${typecheck}      - run: npx wdio run ${configName("web", language)}
        env:
          HEADLESS: 'true'
          # Add TESTLAB_SECRET_* values this suite's specs read as repository secrets.
`;
}

/**
 * Where the app under test lives, per environment.
 *
 * Page objects call `baseUrl()` instead of holding a literal, so moving the
 * suite from prod to a staging box is one environment variable rather than an
 * edit to every page. The observed URL stays as the default, so a project with
 * no `.env` at all runs exactly as it did before — the indirection costs
 * nothing until someone actually uses it.
 */
function envUtil(language: ProjectLanguage): string {
  const ts = language === "ts";
  const p = (name: string, type: string) => (ts ? `${name}: ${type}` : name);
  const returns = (type: string) => (ts ? `: ${type}` : "");

  return `/**
 * Environment configuration. Created once — yours to edit.
 *
 * TEST_ENV picks which base URL is used: 'dev', 'qa' or 'prod'. Set the
 * matching <ENV>_BASE_URL variable (see .env.example). If none is set, the URL
 * a page was originally observed at is used, so this file is optional until
 * you need a second environment.
 */

/** Which environment this run targets. Defaults to prod. */
export function testEnv()${returns("string")} {
  return process.env.TEST_ENV || 'prod';
}

/**
 * The base URL for the current environment, or \`fallback\` when nothing is
 * configured. Page objects pass the URL they were generated with as the
 * fallback, which is what keeps this backwards compatible.
 */
export function baseUrl(${p("fallback", "string")})${returns("string")} {
  const configured = process.env[\`\${testEnv().toUpperCase()}_BASE_URL\`] || process.env.BASE_URL;
  if (!configured) return fallback;

  // Preserve whatever path the caller asked for, against the configured host.
  try {
    const path = new URL(fallback).pathname;
    return new URL(path, configured).toString();
  } catch {
    return configured;
  }
}

/**
 * A required environment variable, with a message that says what to do rather
 * than just what is missing.
 */
export function required(${p("name", "string")})${returns("string")} {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      \`\${name} is not set. Add it to your environment (see .env.example) before running this suite.\`,
    );
  }
  return value;
}
`;
}

/**
 * Scenario data, keyed the way the reference architecture keys it.
 *
 * The point is that a spec names *which* data it uses and never the values
 * themselves, so changing a search term or an expected message is a JSON edit
 * rather than a code change.
 */
function testDataUtil(language: ProjectLanguage): string {
  const ts = language === "ts";

  return `import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Scenario data, loaded from test/testdata/<file>.json. Created once — yours
 * to edit.
 *
 * Specs reference data by key rather than inlining values:
 *
 *     const data = testData('checkout', 'tc-checkout-001');
 *     const result = await placeOrder({ card: data.card });
 */

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'testdata');

${ts ? "const cache = new Map<string, Record<string, Record<string, unknown>>>();" : "const cache = new Map();"}

export function testData${ts ? "<T = Record<string, unknown>>" : ""}(${
    ts ? "file: string, key: string" : "file, key"
  })${ts ? ": T" : ""} {
  let contents = cache.get(file);
  if (!contents) {
    contents = JSON.parse(readFileSync(path.join(DATA_DIR, \`\${file}.json\`), 'utf8'));
    cache.set(file, contents${ts ? "!" : ""});
  }

  const entry = contents${ts ? "!" : ""}[key];
  if (!entry) {
    throw new Error(\`No test data under "\${key}" in test/testdata/\${file}.json.\`);
  }
  return entry${ts ? " as T" : ""};
}
`;
}

function sharedTypes(language: ProjectLanguage): string {
  if (language !== "ts") {
    return `/**
 * Shared JSDoc typedefs for this suite. Created once — yours to edit.
 *
 * @typedef {Object} Credentials
 * @property {string} username
 * @property {string} password
 */

export {};
`;
  }

  return `/**
 * Types shared across this suite. Created once — yours to edit.
 *
 * Business functions declare their own Input/Output interfaces next to the
 * function itself; this file is for shapes more than one of them needs.
 */

export interface Credentials {
  username: string;
  password: string;
}
`;
}

/**
 * WebdriverIO hooks, not a Playwright-style fixture: the runner owns the
 * session here, so there is nothing to inject. What the reference gets from
 * its fixture — a legible boundary between tests in the log — is what these
 * provide.
 */
function hooksUtil(language: ProjectLanguage): string {
  const ts = language === "ts";
  const test = ts ? "test: WdioTest" : "test";
  // `{ passed }` is the binding; any type has to annotate the whole pattern,
  // never sit inside it — `{ passed: boolean }` renames the binding to
  // `boolean` and leaves `passed` undeclared.
  const result = ts ? "{ passed }: { passed: boolean }" : "{ passed }";
  const context = ts ? "_context: unknown" : "_context";
  const testType = ts ? "interface WdioTest {\n  title?: string;\n}\n\n" : "";

  return `/**
 * Shared run hooks. Created once — yours to edit.
 *
 * Wire them into a wdio config to get a clear boundary between tests in the
 * output:
 *
 *     import { beforeTest, afterTest } from './src/fixtures/hooks.js';
 *     export const config = webConfig({ beforeTest, afterTest });
 */

${testType}export function beforeTest(${test})${ts ? ": void" : ""} {
  console.log(\`\\n=== \${test.title ?? 'test'} ===\`);
}

export function afterTest(${test}, ${context}, ${result})${ts ? ": void" : ""} {
  console.log(\`=== \${test.title ?? 'test'} — \${passed ? 'PASSED' : 'FAILED'} ===\\n\`);
}
`;
}

function envExample(): string {
  return `# Copy to .env and fill in. .env is gitignored; .env.example is not.

# Which environment to run against: dev | qa | prod (default: prod)
TEST_ENV=prod

# Base URL per environment. Optional — without one, each page object uses the
# URL it was originally generated against.
DEV_BASE_URL=
QA_BASE_URL=
PROD_BASE_URL=

# Credentials the specs read. Every secret a spec needs is named
# TESTLAB_SECRET_*, and is read from the environment at run time so no value is
# ever committed here.
# TESTLAB_SECRET_USERNAME=
# TESTLAB_SECRET_PASSWORD=

# Run headless (CI sets this to true).
HEADLESS=true
`;
}

/**
 * The layer boundaries, as a rule a machine can check.
 *
 * The three layers are only real if something enforces them: prose in a README
 * describes the intent, but the first hand-edit that puts a selector back in a
 * spec is exactly the edit nobody notices in review. Warnings rather than
 * errors, and non-blocking in CI, for the same reason the typecheck is —
 * nothing here compiles, and a lint opinion must never fail a suite whose tests
 * pass.
 */
function eslintConfig(language: ProjectLanguage): string {
  const ts = language === "ts";
  const specGlob = ts ? "test/specs/**/*.ts" : "test/specs/**/*.js";
  const flowGlob = ts ? "src/flows/**/*.ts" : "src/flows/**/*.js";

  // Without this, every file carrying a type annotation comes back as a
  // parse error dressed up as a lint finding — and a business function always
  // carries one, because its return type is the whole point of the layer.
  const parser = ts
    ? `import tsParser from '@typescript-eslint/parser';

`
    : "";
  const languageOptions = ts
    ? `    languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' },\n`
    : `    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },\n`;

  return `${parser}// Layer boundaries for this suite. Created once — yours to edit.
//
//   test/specs  call business functions, assert on what they return
//   src/flows   compose page objects into one named operation
//   src/pages   own the selectors, the waits and the retries
//
// Advisory: \`npx eslint .\` reports violations, and CI does not fail on them.

export default [
  {
${languageOptions}    files: ['${specGlob}', '${flowGlob}'],
    rules: {},
  },
  {
    files: ['${specGlob}'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['**/src/pages/*', '**/src/selectors/*'],
              message:
                'A spec calls a business function from src/flows and asserts on what it returns. Page objects belong to the flow, not the spec.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['${flowGlob}'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CallExpression[callee.name='\\$']",
          message: 'A business function composes page objects; selectors belong in src/pages.',
        },
        {
          selector: "CallExpression[callee.name='expect']",
          message:
            'A business function returns observations; the spec asserts on them. Use check() from @testlab/framework to record one.',
        },
      ],
    },
  },
];
`;
}

function flowsReadme(): string {
  return `# Business functions

One named operation per file — "log in", "add to watchlist", "place an order".
A flow composes page objects and **returns what it observed**; it does not
assert. The spec that calls it does that:

    // src/flows/logIn.ts
    export async function logIn(input: LogInInput): Promise<LogInOutput> {
      step('log in');
      await loginPage.open();
      await loginPage.enterEmailField(input.email);
      await loginPage.clickSignInButton();
      return { url: await browser.getUrl() };
    }

    // test/specs/home.web.spec.ts
    const result = await logIn({ email: process.env.TESTLAB_SECRET_EMAIL });
    await expect(result.url).toContain('/dashboard');

Flows here are written from verified runs and reused: a later scenario that
starts the same way calls the existing flow instead of repeating its steps.
Renaming one, or editing its body, is safe — nothing is ever regenerated over
the top of a file you have changed.
`;
}

function testDataReadme(): string {
  return `# Test data

Scenario values, keyed by scenario, so a spec names *which* data it uses and
never the values themselves:

    {
      "tc-checkout-001": { "card": "4242424242424242", "expected": "Order placed" }
    }

Read it with the helper in \`src/utils/testdata\`:

    const data = testData('checkout', 'tc-checkout-001');

Credentials do **not** belong here. Specs read those from the environment as
\`TESTLAB_SECRET_*\`, so nothing secret is ever committed.
`;
}

function configFile(platform: Platform, language: ProjectLanguage): string {
  const factory = platform === "web" ? "webConfig" : platform === "android" ? "androidConfig" : "iosConfig";
  const args =
    platform === "web"
      ? "{\n  headless: process.env.HEADLESS !== 'false',"
      : "{\n  app: process.env.APP_PATH,";

  const ext = sourceExt(language);
  const typed = language === "ts" ? ": TestLabConfig" : "";
  const typeImport = language === "ts" ? `import type { TestLabConfig } from '@testlab/framework/config';\n` : "";

  return `import { ${factory} } from '@testlab/framework/config';
${typeImport}
// Created once, then yours to edit. The tool never rewrites this file.
export const config${typed} = ${factory}(${args}
  specs: ['./test/specs/**/*.${platform}.spec${ext}'],
});
`;
}

function readme(clientId: string, language: ProjectLanguage): string {
  const ext = sourceExt(language);
  const webConfigName = configName("web", language);

  const languageNotes =
    language === "ts"
      ? `
## TypeScript, without a build step

Specs are TypeScript and run directly — there is no compile step to forget.
WebdriverIO loads them through \`tsx\`, which strips types as it runs, so a type
error can never stop a test from running. \`npm run typecheck\` is there when
you want the compiler's opinion; nothing depends on it passing.

One thing that looks wrong but is not: imports keep a \`.js\` suffix even though
the files are \`.ts\` — \`import { homePage } from '../../src/pages/HomePage.js'\`.
That is what Node's ESM resolution requires, and TypeScript is designed to be
written this way. Do not "fix" it to \`.ts\`.
`
      : "";

  return `# ${clientId} — automated suite

Specs here were generated from plain-English test cases, then **verified by
replay** before being saved: each one passed a cold \`wdio run\` at least once.

## Running them yourself

    npm install @testlab/framework @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter webdriverio
    npx wdio run ${webConfigName}

Nothing in this directory depends on the tool that wrote it.
${languageNotes}

## Credentials

Specs read them from the environment, so no secret is ever committed here:

    TESTLAB_SECRET_USERNAME=... TESTLAB_SECRET_PASSWORD=... npx wdio run ${webConfigName}

## Layout

    .github/workflows/  runs the web suite headless on every push (edit freely)
    src/pages/          one class per screen — what you can do there
    src/selectors/      where each element is — a moved element is a one-line change
    src/flows/          business functions ("log in", "check out")
    src/utils/          environment config and test-data loading
    src/types/          shapes shared across the suite
    src/fixtures/       run hooks
    test/specs/         the scenarios themselves
    test/testdata/      scenario values, keyed by scenario

## The three layers

Each layer is defined by what it is allowed to reach for:

| Layer | Owns | Never contains |
|---|---|---|
| \`test/specs/\` | which scenario, which data, and the assertions | selectors, waits, page objects |
| \`src/flows/\` | one named operation, composing page objects; returns what it observed | selectors, assertions |
| \`src/pages/\` | selectors, waits, retries, semantic methods | — |

So a spec reads as the scenario and nothing else:

    const result = await logIn({ email: process.env.TESTLAB_SECRET_EMAIL });
    await expect(result.url).toContain('/dashboard');

\`npx eslint .\` reports violations of these boundaries. It is advisory — nothing
here compiles, and a lint opinion should never fail a suite whose tests pass.

## Where new work lands

Each new test case is bucketed into what is already here, and reuses whatever
already exists rather than adding a second copy of it:

| What | Goes to | Reused when |
|---|---|---|
| A selector | \`src/selectors/\` | the element already has a name here |
| A page method | \`src/pages/\` | a method of that name exists |
| A business function | \`src/flows/\` | an existing flow makes the same calls in the same order |
| A scenario | \`test/specs/\` | it exercises a page a spec already covers — it joins that file |

Everything is additive. The tool adds what is missing and never rewrites a file
you have edited, so renaming a method, fixing a selector, or rewriting a flow's
body by hand is safe.

## Environments

Page objects open themselves through \`baseUrl()\` in \`src/utils/env\`, so pointing
the suite at staging is one environment variable rather than an edit per page.
Set \`TEST_ENV\` and the matching \`<ENV>_BASE_URL\` (see \`.env.example\`). With
nothing set, each page uses the URL it was originally generated against.

## .testlab/

Tool-maintained. \`catalog.json\` maps human element names to the selectors last
known to work, \`specs.json\` records what each spec covers, and \`runs.jsonl\` is
the audit trail. Deleting them loses accumulated knowledge — future runs get
more expensive, but nothing breaks.
`;
}
