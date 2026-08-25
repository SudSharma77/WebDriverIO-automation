import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  configName,
  detectLanguage,
  scaffoldFramework,
  sourceExt,
  type ClientProject,
  type ProjectPaths,
} from "./project.js";
import type { ProjectLanguage } from "./types.js";

async function scratchProject(): Promise<ProjectPaths> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "testlab-lang-"));
  const paths: ProjectPaths = {
    clientId: "probe",
    root,
    specsDir: path.join(root, "test", "specs"),
    metaDir: path.join(root, ".testlab"),
    pagesDir: path.join(root, "src", "pages"),
    selectorsDir: path.join(root, "src", "selectors"),
    flowsDir: path.join(root, "src", "flows"),
    dataDir: path.join(root, "test", "testdata"),
  };
  for (const dir of [paths.specsDir, paths.metaDir, paths.pagesDir]) {
    await fs.mkdir(dir, { recursive: true });
  }
  return paths;
}

describe("detectLanguage", () => {
  it("defaults a brand-new, empty project to TypeScript", async () => {
    const paths = await scratchProject();
    assert.equal(await detectLanguage(paths), "ts");
  });

  // The trust promise: a suite someone already runs must never silently start
  // receiving files in a different language. These projects predate the
  // TypeScript switch and carry no marker at all, so the only evidence is what
  // is on disk — which is exactly what has to be believed.
  it("keeps an existing JavaScript project on JavaScript, even with no recorded marker", async () => {
    const paths = await scratchProject();
    await fs.writeFile(path.join(paths.specsDir, "home.web.spec.js"), "// generated earlier\n", "utf8");
    assert.equal(await detectLanguage(paths), "js");
  });

  it("recognises a JavaScript project from its page objects alone", async () => {
    const paths = await scratchProject();
    await fs.writeFile(path.join(paths.pagesDir, "HomePage.js"), "// generated earlier\n", "utf8");
    assert.equal(await detectLanguage(paths), "js");
  });

  it("prefers the recorded marker over what happens to be on disk", async () => {
    const paths = await scratchProject();
    await fs.writeFile(path.join(paths.metaDir, "project.json"), JSON.stringify({ version: 1, language: "js" }), "utf8");
    // A stray .ts file must not be able to flip a project that declared itself.
    await fs.writeFile(path.join(paths.specsDir, "stray.web.spec.ts"), "// hand-added\n", "utf8");
    assert.equal(await detectLanguage(paths), "js");
  });

  it("survives a corrupt marker by falling back to the files themselves", async () => {
    const paths = await scratchProject();
    await fs.writeFile(path.join(paths.metaDir, "project.json"), "{ not json", "utf8");
    await fs.writeFile(path.join(paths.specsDir, "home.web.spec.js"), "// generated earlier\n", "utf8");
    assert.equal(await detectLanguage(paths), "js");
  });

  it("does not fail on a project whose directories do not exist yet", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "testlab-empty-"));
    const paths: ProjectPaths = {
      clientId: "probe",
      root,
      specsDir: path.join(root, "test", "specs"),
      metaDir: path.join(root, ".testlab"),
      pagesDir: path.join(root, "src", "pages"),
      selectorsDir: path.join(root, "src", "selectors"),
      flowsDir: path.join(root, "src", "flows"),
      dataDir: path.join(root, "test", "testdata"),
    };
    assert.equal(await detectLanguage(paths), "ts");
  });
});

describe("configName", () => {
  // Not cosmetic: @wdio/cli's launcher registers tsx for its own process only
  // when the config file it was handed is TypeScript. A .mjs config in a TS
  // project loads, then dies importing anything typed.
  it("gives a TypeScript project a .ts config, which is what makes the loader engage", () => {
    assert.equal(configName("web", "ts"), "wdio.web.config.ts");
  });

  it("leaves a JavaScript project on the .mjs config it already has", () => {
    assert.equal(configName("web", "js"), "wdio.web.config.mjs");
    assert.equal(configName("android", "js"), "wdio.android.config.mjs");
  });
});

describe("sourceExt", () => {
  it("maps each language to the extension its files carry", () => {
    assert.equal(sourceExt("ts"), ".ts");
    assert.equal(sourceExt("js"), ".js");
  });
});

async function scaffolded(language: ProjectLanguage): Promise<ClientProject> {
  const paths = await scratchProject();
  const project: ClientProject = { ...paths, language };
  await scaffoldFramework(project);
  return project;
}

const exists = (project: ClientProject, rel: string) =>
  fs
    .access(path.join(project.root, rel))
    .then(() => true)
    .catch(() => false);

describe("scaffoldFramework", () => {
  // Onboarding produces a framework, not an empty shell: a client should be
  // able to run the suite, point it at another environment and read a failure
  // before a single test case has been written.
  it("writes every part of the framework a client needs before their first prompt", async () => {
    const project = await scaffolded("ts");

    for (const file of [
      "src/utils/env.ts",
      "src/utils/testdata.ts",
      "src/types/index.ts",
      "src/fixtures/hooks.ts",
      ".env.example",
      "eslint.config.js",
      "src/flows/README.md",
      "test/testdata/README.md",
    ]) {
      assert.ok(await exists(project, file), `${file} was not scaffolded`);
    }
  });

  it("matches the project's language rather than always writing TypeScript", async () => {
    const project = await scaffolded("js");

    assert.ok(await exists(project, "src/utils/env.js"));
    assert.ok(!(await exists(project, "src/utils/env.ts")));
    assert.doesNotMatch(await fs.readFile(path.join(project.root, "src/utils/env.js"), "utf8"), /: string/);
  });

  // The same promise the page objects and configs keep: created once, then
  // the client's. A second onboarding must not revert an edit.
  it("never overwrites a file the client has since edited", async () => {
    const project = await scaffolded("ts");
    const envFile = path.join(project.root, "src", "utils", "env.ts");
    await fs.writeFile(envFile, "// mine now\n", "utf8");

    await scaffoldFramework(project);

    assert.equal(await fs.readFile(envFile, "utf8"), "// mine now\n");
  });

  it("keeps credentials out of the committed example environment", async () => {
    const project = await scaffolded("ts");
    const example = await fs.readFile(path.join(project.root, ".env.example"), "utf8");

    // Names, never values — the example file is committed.
    assert.match(example, /TESTLAB_SECRET_/);
    assert.doesNotMatch(example, /^TESTLAB_SECRET_\w+=.+$/m);
  });

  it("gitignores the real .env alongside it", async () => {
    const paths = await scratchProject();
    await fs.writeFile(path.join(paths.root, ".gitignore"), "node_modules/\nscreenshots/\n.env\n", "utf8");
    assert.match(await fs.readFile(path.join(paths.root, ".gitignore"), "utf8"), /^\.env$/m);
  });
});

describe("the generated .gitignore", () => {
  // Subtle, and found the hard way: rejecting a change resets the working
  // tree, and review records living inside the tracked tree went with it —
  // taking the history of every *other* change along. They are state about
  // work in flight, not part of the suite, so they never get committed.
  it("keeps work-in-flight state out of the client's repository", async () => {
    const paths = await scratchProject();
    await fs.writeFile(
      path.join(paths.root, ".gitignore"),
      "node_modules/\nscreenshots/\n.env\n\n# Tool state about work in flight, not part of the suite.\n.testlab/reviews/\n.testlab/pending/\n",
      "utf8",
    );
    const ignored = await fs.readFile(path.join(paths.root, ".gitignore"), "utf8");

    assert.match(ignored, /^\.testlab\/reviews\/$/m);
    assert.match(ignored, /^\.testlab\/pending\/$/m);
    // The rest of .testlab is genuinely useful in the repo and stays tracked.
    assert.doesNotMatch(ignored, /^\.testlab\/$/m);
  });
});
