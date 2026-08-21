import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { Platform } from "../types.js";
import { SELECTOR_DIR } from "./structure.js";
import type { Catalog, SpecIndex } from "./types.js";

/**
 * Each client gets a real WebdriverIO project on disk, not a scratch folder.
 *
 * The accumulated specs have to be something the client owns and can run
 * themselves — `npx wdio run wdio.web.config.mjs` with no part of this tool in
 * the loop. That constraint is what stops the product becoming a black box the
 * client can never leave, and it is why the knowledge lives in a project layout
 * rather than in a database.
 */

export interface ClientProject {
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

export function projectFor(clientId: string): ClientProject {
  const root = path.join(config.clientsRoot, clientId);
  return {
    clientId,
    root,
    specsDir: path.join(root, "test", "specs"),
    metaDir: path.join(root, ".testlab"),
    pagesDir: path.join(root, "src", "pages"),
    selectorsDir: path.join(root, "src", SELECTOR_DIR),
    flowsDir: path.join(root, "src", "flows"),
    dataDir: path.join(root, "test", "data"),
  };
}

/** Create the project if this is the client's first run. Idempotent. */
export async function ensureProject(clientId: string): Promise<ClientProject> {
  const project = projectFor(clientId);

  for (const dir of [
    project.specsDir,
    project.metaDir,
    project.pagesDir,
    project.selectorsDir,
    project.flowsDir,
    project.dataDir,
  ]) {
    await fs.mkdir(dir, { recursive: true });
  }

  await writeIfAbsent(path.join(project.root, "package.json"), packageJson(clientId));
  await writeIfAbsent(path.join(project.root, "README.md"), readme(clientId));
  await writeIfAbsent(path.join(project.root, ".gitignore"), "node_modules/\nscreenshots/\n");

  for (const platform of ["web", "android", "ios"] as const) {
    await writeIfAbsent(path.join(project.root, `wdio.${platform}.config.mjs`), configFile(platform));
  }

  return project;
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

function packageJson(clientId: string): string {
  return `${JSON.stringify(
    {
      name: `testlab-${clientId}`,
      private: true,
      type: "module",
      description: `Accumulated WebdriverIO suite for ${clientId}, grown from verified test runs.`,
      scripts: {
        "test:web": "wdio run wdio.web.config.mjs",
        "test:android": "wdio run wdio.android.config.mjs",
        "test:ios": "wdio run wdio.ios.config.mjs",
      },
    },
    null,
    2,
  )}\n`;
}

function configFile(platform: Platform): string {
  const factory = platform === "web" ? "webConfig" : platform === "android" ? "androidConfig" : "iosConfig";
  const args =
    platform === "web"
      ? "{\n  headless: process.env.HEADLESS !== 'false',"
      : "{\n  app: process.env.APP_PATH,";

  return `import { ${factory} } from '@testlab/framework/config';

// Created once, then yours to edit. The tool never rewrites this file.
export const config = ${factory}(${args}
  specs: ['./test/specs/**/*.${platform}.spec.js'],
});
`;
}

function readme(clientId: string): string {
  return `# ${clientId} — automated suite

Specs here were generated from plain-English test cases, then **verified by
replay** before being saved: each one passed a cold \`wdio run\` at least once.

## Running them yourself

    npm install @testlab/framework @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter webdriverio
    npx wdio run wdio.web.config.mjs

Nothing in this directory depends on the tool that wrote it.

## Credentials

Specs read them from the environment, so no secret is ever committed here:

    TESTLAB_SECRET_USERNAME=... TESTLAB_SECRET_PASSWORD=... npx wdio run wdio.web.config.mjs

## Layout

    src/pages/       one class per screen — what you can do
    src/selectors/   where each element is — a moved element is a one-line change
    src/flows/       business functions spanning pages ("log in", "check out")
    test/specs/      the scenarios themselves
    test/data/       fixtures

Everything here is additive. The tool adds what is missing and never rewrites a
file you have edited, so renaming a method or fixing a selector by hand is safe.

## .testlab/

Tool-maintained. \`catalog.json\` maps human element names to the selectors last
known to work, \`specs.json\` records what each spec covers, and \`runs.jsonl\` is
the audit trail. Deleting them loses accumulated knowledge — future runs get
more expensive, but nothing breaks.
`;
}
