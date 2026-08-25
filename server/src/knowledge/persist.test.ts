import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { storePages } from "./persist.js";
import type { ClientProject } from "./project.js";
import type { PageFact } from "./structure.js";
import type { ProjectLanguage } from "./types.js";

async function scratchProject(language: ProjectLanguage): Promise<ClientProject> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "testlab-persist-"));
  return {
    clientId: "probe",
    root,
    language,
    specsDir: path.join(root, "test", "specs"),
    metaDir: path.join(root, ".testlab"),
    pagesDir: path.join(root, "src", "pages"),
    selectorsDir: path.join(root, "src", "selectors"),
    flowsDir: path.join(root, "src", "flows"),
    dataDir: path.join(root, "test", "testdata"),
  };
}

function page(elements: PageFact["elements"]): PageFact {
  return { className: "HomePage", slug: "home", platform: "web", url: "https://example.com/", elements };
}

const EMAIL = { label: "the email field", property: "emailField", selector: "#email", interactions: ["type" as const] };
const SUBMIT = { label: "the submit button", property: "submitButton", selector: "#go", interactions: ["click" as const] };
const PASSWORD = {
  label: "the password field",
  property: "passwordField",
  selector: "#password",
  interactions: ["type" as const],
  masked: true,
};

async function read(project: ClientProject, rel: string): Promise<string> {
  return fs.readFile(path.join(project.root, rel), "utf8");
}

describe("storePages — TypeScript project", () => {
  it("writes page objects, selectors and the base class as .ts", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([EMAIL])]);

    await read(project, "src/pages/HomePage.ts");
    await read(project, "src/pages/BasePage.ts");
    await read(project, "src/selectors/home.selectors.ts");
  });

  it("keeps import specifiers on .js, which is what NodeNext resolution requires", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([EMAIL])]);
    const source = await read(project, "src/pages/HomePage.ts");

    assert.match(source, /from '\.\/BasePage\.js'/);
    assert.match(source, /from '\.\.\/selectors\/home\.selectors\.js'/);
  });

  it("types the value a typing method accepts", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([EMAIL])]);
    const source = await read(project, "src/pages/HomePage.ts");

    assert.match(source, /async enterEmailField\(value: string \| number \| null \| undefined\)/);
  });

  it("closes the selector map with `as const`", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([EMAIL])]);
    const source = await read(project, "src/selectors/home.selectors.ts");

    assert.match(source, /\} as const;/);
  });
});

describe("storePages — JavaScript project", () => {
  it("still writes .js for a project that already had it, with no type annotations", async () => {
    const project = await scratchProject("js");
    await storePages(project, [page([EMAIL])]);

    const source = await read(project, "src/pages/HomePage.js");
    assert.match(source, /async enterEmailField\(value\)/);
    assert.doesNotMatch(source, /: string/);

    const selectors = await read(project, "src/selectors/home.selectors.js");
    assert.doesNotMatch(selectors, /as const/);
  });
});

describe("growing an existing page", () => {
  // Regression: the insertion point used to be found with lastIndexOf("};"),
  // which does not exist in a TypeScript selector map — it closes with
  // `} as const;`. The entry was appended *after* the object instead, leaving a
  // file that no longer parses, and nothing would have noticed until a client
  // ran their own suite.
  it("inserts a new selector inside the object, not after it", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([EMAIL])]);
    await storePages(project, [page([EMAIL, SUBMIT])]);

    const source = await read(project, "src/selectors/home.selectors.ts");
    const added = source.indexOf("submitButton");
    const closing = source.indexOf("} as const;");

    assert.ok(added !== -1, "the new selector was not written at all");
    assert.ok(closing !== -1, "the selector map no longer closes with `as const`");
    assert.ok(added < closing, "the new selector landed outside the object, producing a file that cannot parse");
  });

  it("appends a matching typed method to an existing page class", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([EMAIL])]);
    const report = await storePages(project, [page([EMAIL, SUBMIT])]);

    const source = await read(project, "src/pages/HomePage.ts");
    assert.match(source, /async clickSubmitButton\(\)/);
    // The class must still close before the exported instance.
    assert.ok(source.indexOf("clickSubmitButton") < source.indexOf("export const homePage"));
    assert.deepEqual(report[0]?.addedMethods, ["clickSubmitButton"]);
  });

  // The method carries `mask`, not the caller. That is what lets a credential
  // field become a page-object call at all: while the flag lived on the call
  // site, the rewrite had to refuse it and the selector stayed in the spec.
  it("masks a credential field inside the generated method", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([PASSWORD])]);

    const source = await read(project, "src/pages/HomePage.ts");
    assert.match(source, /await this\.type\(HomeSelectors\.passwordField, value, "the password field", \{ mask: true \}\);/);
  });

  it("does not mask an ordinary field", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([EMAIL])]);

    const source = await read(project, "src/pages/HomePage.ts");
    assert.doesNotMatch(source, /mask/);
  });

  // A method appended to an existing page has to be indistinguishable from one
  // written when the page was created — the two renderers used to be separate
  // copies kept in step by hand.
  it("appends a masked method identically to one written at creation", async () => {
    const fresh = await scratchProject("ts");
    await storePages(fresh, [page([PASSWORD])]);

    const grown = await scratchProject("ts");
    await storePages(grown, [page([EMAIL])]);
    await storePages(grown, [page([EMAIL, PASSWORD])]);

    const line = /async enterPasswordField\([^)]*\) \{\n\s*await this\.type\([^\n]*\n\s*\}/;
    const fromFresh = line.exec(await read(fresh, "src/pages/HomePage.ts"))?.[0];
    const fromGrown = line.exec(await read(grown, "src/pages/HomePage.ts"))?.[0];

    assert.ok(fromFresh, "no method found in the freshly created page");
    assert.equal(fromGrown, fromFresh);
  });

  // Pages written before masking moved onto the element still have an unmasked
  // typing method. Rewriting a file the client may have edited is the one thing
  // this module never does, so it is surfaced instead of silently repaired.
  it("reports an existing credential method that does not mask, without rewriting it", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([{ ...PASSWORD, masked: false }])]);
    const before = await read(project, "src/pages/HomePage.ts");

    const report = await storePages(project, [page([PASSWORD])]);

    assert.deepEqual(report[0]?.unmaskedMethods, ["enterPasswordField"]);
    assert.equal(await read(project, "src/pages/HomePage.ts"), before, "the existing method was rewritten");
  });

  it("does not report a method that already masks", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([PASSWORD])]);
    const report = await storePages(project, [page([PASSWORD])]);

    assert.deepEqual(report[0]?.unmaskedMethods, []);
  });

  it("reports a moved selector rather than applying it silently", async () => {
    const project = await scratchProject("ts");
    await storePages(project, [page([EMAIL])]);
    const moved = { ...EMAIL, selector: "#email-v2" };
    const report = await storePages(project, [page([moved])]);

    assert.deepEqual(report[0]?.changedLocators, [{ property: "emailField", from: "#email", to: "#email-v2" }]);
    assert.match(await read(project, "src/selectors/home.selectors.ts"), /#email-v2/);
  });
});
