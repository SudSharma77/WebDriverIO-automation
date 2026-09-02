import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { ClientProject } from "./project.js";
import { categoryFile, fallbackName, recordSuccess, type KnowledgeSession } from "./session.js";
import type { Catalog } from "./types.js";

describe("categoryFile", () => {
  it("groups web scenarios by the page they exercise, not their own title", () => {
    const login = categoryFile("https://www.iwanttfc.com/", "Login with valid credentials", "web");
    const logout = categoryFile("https://www.iwanttfc.com/", "Login then logout", "web");
    assert.equal(login, logout);
    assert.equal(login, "home.web.spec.js");
  });

  it("still separates web scenarios that hit different pages", () => {
    const checkout = categoryFile("https://shop.example.com/checkout/payment", "Pay with a card", "web");
    const home = categoryFile("https://shop.example.com/", "Browse the catalogue", "web");
    assert.notEqual(checkout, home);
  });

  // Regression: an .apk path or a cloud app id both parse as a syntactically
  // valid URL with an empty path (a bare custom scheme), which would make
  // slugFromUrl return "home" for every single one of them - collapsing every
  // mobile scenario in the client's project into one file. Mobile must stay
  // one-file-per-scenario regardless of what the "target" string looks like.
  it("does not group mobile scenarios by target, even when the app path parses as a URL", () => {
    const a = categoryFile("C:\\apps\\demo.apk", "Add an item to the cart", "android");
    const b = categoryFile("C:\\apps\\demo.apk", "Remove an item from the cart", "android");
    const c = categoryFile("bs://a1b2c3d4e5", "Sign in with a saved account", "ios");

    assert.notEqual(a, b);
    assert.ok(a.endsWith(".android.spec.js"));
    assert.ok(c.endsWith(".ios.spec.js"));
    // Neither collapses to the web-style "home" slug an app-path URL would
    // otherwise produce.
    assert.ok(!a.startsWith("home."));
    assert.ok(!c.startsWith("home."));
  });
});

describe("categoryFile — language", () => {
  it("names a TypeScript project's spec .ts", () => {
    assert.equal(categoryFile("https://example.com/", "Log in", "web", "ts"), "home.web.spec.ts");
  });

  it("keeps a JavaScript project's spec .js", () => {
    assert.equal(categoryFile("https://example.com/", "Log in", "web", "js"), "home.web.spec.js");
  });

  it("carries the extension through the mobile naming path too", () => {
    assert.ok(categoryFile("bs://a1b2c3", "Sign in", "ios", "ts").endsWith(".ios.spec.ts"));
  });
});

async function scratchProject(): Promise<ClientProject> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "testlab-session-"));
  const project: ClientProject = {
    clientId: "acme",
    root,
    language: "ts",
    specsDir: path.join(root, "test", "specs"),
    metaDir: path.join(root, ".testlab"),
    pagesDir: path.join(root, "src", "pages"),
    selectorsDir: path.join(root, "src", "selectors"),
    flowsDir: path.join(root, "src", "flows"),
    dataDir: path.join(root, "test", "testdata"),
  };
  await fs.mkdir(project.specsDir, { recursive: true });
  await fs.mkdir(project.metaDir, { recursive: true });
  return project;
}

function session(project: ClientProject): KnowledgeSession {
  return { project, decision: { mode: "explored", reason: "test", known: [] }, missingSecrets: [] };
}

/** A minimal spec of the shape synth emits — one navigation, one labelled call. */
function specFor(label: string, selector: string): string {
  return `import { click } from '@testlab/framework';

describe('scenario', () => {
  it('acts', async () => {
    await browser.url('https://shop.example.com/');
    await click('${selector}', { label: '${label}' });
    await expect(browser).toHaveUrl('https://shop.example.com/', { containing: true });
  });
});
`;
}

describe("recordSuccess — concurrent saves", () => {
  // The three platform lanes of one run reach recordSuccess in parallel
  // (orchestrator.ts), and catalog.json is read-modify-write. Before the
  // per-client lock, the later writer built on a snapshot taken before the
  // earlier one landed and silently dropped its locators.
  it("keeps every lane's locators when they land at the same time", async () => {
    const project = await scratchProject();
    const target = { webUrl: "https://shop.example.com/" };

    const save = (label: string, selector: string, title: string) =>
      recordSuccess({
        session: session(project),
        runId: `run-${label}`,
        spec: specFor(label, selector),
        title,
        prompt: title,
        platform: "web",
        target,
      });

    await Promise.all([
      save("the cart button", "#cart", "Open the cart"),
      save("the search field", "#search", "Search the catalogue"),
      save("the profile menu", "#profile", "Open the profile menu"),
    ]);

    const catalog = JSON.parse(await fs.readFile(path.join(project.metaDir, "catalog.json"), "utf8")) as Catalog;
    const labels = catalog.entries.map((e) => e.label).sort();

    assert.deepEqual(labels, ["the cart button", "the profile menu", "the search field"]);
  });

  it("records every scenario in the spec index rather than the last one only", async () => {
    const project = await scratchProject();
    const target = { webUrl: "https://shop.example.com/" };

    await Promise.all(
      ["Open the cart", "Search the catalogue", "Open the profile menu"].map((title, i) =>
        recordSuccess({
          session: session(project),
          runId: `run-${i}`,
          spec: specFor(`element ${i}`, `#el${i}`),
          title,
          prompt: title,
          platform: "web",
          target,
        }),
      ),
    );

    const index = JSON.parse(await fs.readFile(path.join(project.metaDir, "specs.json"), "utf8")) as {
      specs: Array<{ prompt: string }>;
    };
    assert.deepEqual(index.specs.map((s) => s.prompt).sort(), [
      "Open the cart",
      "Open the profile menu",
      "Search the catalogue",
    ]);
  });
});

describe("fallbackName", () => {
  it("inserts the counter before the platform/spec/js suffix, not at the end", () => {
    const next = fallbackName("home.web.spec.js");
    assert.equal(next(2), "home-2.web.spec.js");
    assert.equal(next(3), "home-3.web.spec.js");
  });

  it("is extension-agnostic, so a TypeScript spec numbers the same way", () => {
    const next = fallbackName("home.web.spec.ts");
    assert.equal(next(2), "home-2.web.spec.ts");
  });
});

/** A single-scenario spec of exactly the shape synthesis emits. */
function scenarioSpec(title: string, extra = ""): string {
  return `import { click, type, getText, waitForPageLoad } from '@testlab/framework';

describe('${title}', () => {
  it('${title}', async () => {
    await browser.url('https://shop.example.com/');
    await waitForPageLoad();
    await type('#email', process.env.TESTLAB_SECRET_EMAIL, { label: 'the email field' });
    await type('#password', process.env.TESTLAB_SECRET_PASSWORD, { label: 'the password field', mask: true });
    await click('#go', { label: 'the sign in button' });
${extra}    const heading = await getText('h1', { label: 'the page heading' });
    await expect(heading).toBe('Welcome back');
  });
});
`;
}

const TARGET = { webUrl: "https://shop.example.com/" };

function save(project: ClientProject, spec: string, title: string, verifyExtraction?: (s: string, f: string) => Promise<boolean>) {
  return recordSuccess({
    session: session(project),
    runId: "run-1",
    spec,
    title,
    prompt: title,
    platform: "web",
    target: TARGET,
    ...(verifyExtraction ? { verifyExtraction } : {}),
  });
}

const readFile = (project: ClientProject, rel: string) => fs.readFile(path.join(project.root, rel), "utf8");

describe("recordSuccess — business functions", () => {
  it("lifts a saved scenario's steps into src/flows and points the spec at them", async () => {
    const project = await scratchProject();
    const report = await save(project, scenarioSpec("log in"), "log in", async () => true);

    assert.equal(report.flow?.applied, true);
    assert.deepEqual(report.flow?.names, ["logIn"]);

    const flow = await readFile(project, "src/flows/home-bfs.ts");
    assert.match(flow, /export async function logIn/);
    assert.match(flow, /await homePage\.clickSignInButton\(\);/);

    const spec = await readFile(project, `test/specs/${report.specFile}`);
    assert.match(spec, /import \{ logIn \} from '\.\.\/\.\.\/src\/flows\/home-bfs\.js';/);
    assert.doesNotMatch(spec, /#email|#password|#go/, "a selector survived in the spec");
  });

  it("registers the flow so a later scenario can find it", async () => {
    const project = await scratchProject();
    await save(project, scenarioSpec("log in"), "log in", async () => true);

    const index = JSON.parse(await readFile(project, ".testlab/flows.json")) as {
      flows: Array<{ name: string; callSequence: string[]; usedBy: string[] }>;
    };
    assert.equal(index.flows.length, 1);
    assert.equal(index.flows[0]?.name, "logIn");
    assert.ok(index.flows[0]!.callSequence.includes("homePage.clickSignInButton"));
  });

  it("publishes the manifest the reference architecture expects", async () => {
    const project = await scratchProject();
    await save(project, scenarioSpec("log in"), "log in", async () => true);

    const manifest = await readFile(project, "src/manifest.yaml");
    // Kebab from the camelCase export — `logIn`, not `login`.
    assert.match(manifest, /- id: "log-in"/);
    assert.match(manifest, /path: "src\/flows\/home-bfs\.ts"/);
    assert.match(manifest, /export: "logIn"/);
  });

  // The guarantee the whole pipeline exists to make: every saved spec passed a
  // real replay. Lifting rewrites a passing spec, so the lifted form has to
  // earn its place or be discarded.
  it("rolls back to the flat spec when the lifted form does not replay", async () => {
    const project = await scratchProject();
    const flat = scenarioSpec("log in");
    const report = await save(project, flat, "log in", async () => false);

    assert.equal(report.flow?.applied, false);
    assert.match(report.flow?.reason ?? "", /did not pass replay/);

    const spec = await readFile(project, `test/specs/${report.specFile}`);
    assert.match(spec, /homePage\./, "the page-object form was not restored");
    assert.doesNotMatch(spec, /src\/flows/, "the spec still points at a flow that was rolled back");

    await assert.rejects(readFile(project, "src/flows/logIn.ts"), "a flow no spec calls was left behind");
  });

  it("does not register a rolled-back flow", async () => {
    const project = await scratchProject();
    await save(project, scenarioSpec("log in"), "log in", async () => false);
    await assert.rejects(readFile(project, ".testlab/flows.json"));
  });

  // The centralized-repo case: a second person prompts the same scenario in
  // different words, and gets the flow that already exists.
  it("reuses an existing flow for an identical scenario rather than duplicating it", async () => {
    const project = await scratchProject();
    await save(project, scenarioSpec("log in"), "log in", async () => true);

    const second = await recordSuccess({
      session: session(project),
      runId: "run-2",
      spec: scenarioSpec("sign in to the account"),
      title: "sign in to the account",
      prompt: "sign in to the account",
      platform: "web",
      target: { webUrl: "https://other.example.com/" },
      verifyExtraction: async () => true,
    });

    assert.deepEqual(second.flow?.reused, ["logIn"]);

    const index = JSON.parse(await readFile(project, ".testlab/flows.json")) as { flows: unknown[] };
    assert.equal(index.flows.length, 1, "a duplicate flow was written for the same steps");

    await assert.rejects(readFile(project, "src/flows/signInToTheAccount.ts"));
  });

  it("still extracts when no verifier is available, and says the lift was unverified", async () => {
    const project = await scratchProject();
    const report = await save(project, scenarioSpec("log in"), "log in");

    assert.equal(report.flow?.applied, true);
    assert.equal(report.flow?.verified, false);
  });
});
