import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { commitLocally, linkRepo, pushApproved, revertCommit, showCommit, UPDATE_BRANCH } from "./git.js";
import type { ProjectPaths } from "./project.js";

const run = promisify(execFile);
// A local filesystem path is a perfectly valid git remote URL, so these tests
// exercise the real `git` binary end to end without any network access - the
// same fetch/checkout/push code paths a real GitHub remote would take.

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function bareRemote(): Promise<string> {
  const dir = await tmpDir("testlab-remote-");
  await run("git", ["init", "--bare", "-b", "main", dir]);
  return dir;
}

/** A throwaway project rooted at a fresh directory - only `.root` matters to git.ts. */
function projectAt(root: string): ProjectPaths {
  return {
    clientId: "probe",
    root,
    specsDir: path.join(root, "test", "specs"),
    metaDir: path.join(root, ".testlab"),
    pagesDir: path.join(root, "src", "pages"),
    selectorsDir: path.join(root, "src", "selectors"),
    flowsDir: path.join(root, "src", "flows"),
    dataDir: path.join(root, "test", "testdata"),
  };
}

async function commitCount(remote: string, branch: string): Promise<number> {
  const { stdout } = await run("git", ["--git-dir", remote, "rev-list", "--count", branch]);
  return Number(stdout.trim());
}

describe("linkRepo", () => {
  it("forks the update branch from the client's real default branch, not an orphan history", async () => {
    const remote = await bareRemote();

    // Seed the remote with real content on main, as a client's existing repo would have.
    const seed = await tmpDir("testlab-seed-");
    await run("git", ["init", "-b", "main", seed]);
    await fs.writeFile(path.join(seed, "README.md"), "# Client's own repo\n", "utf8");
    await run("git", ["-C", seed, "add", "-A"]);
    await run("git", ["-C", seed, "-c", "user.email=a@b.c", "-c", "user.name=seed", "commit", "-m", "seed commit"]);
    await run("git", ["-C", seed, "push", remote, "main"]);

    const projectRoot = await tmpDir("testlab-project-");
    const project = projectAt(projectRoot);

    const result = await linkRepo(project, { url: remote, baseBranch: "main" }, "unused-token");
    assert.deepEqual(result, { ok: true });

    // The checked-out branch must contain the seeded commit - proof it forked
    // from the client's history rather than starting a disconnected one.
    const log = await run("git", ["-C", projectRoot, "log", "--oneline", UPDATE_BRANCH]);
    assert.match(log.stdout, /seed commit/);
  });

  it("succeeds against a brand-new, completely empty remote", async () => {
    const remote = await bareRemote(); // never pushed to
    const projectRoot = await tmpDir("testlab-project-");
    const project = projectAt(projectRoot);

    const result = await linkRepo(project, { url: remote, baseBranch: "main" }, "unused-token");
    assert.deepEqual(result, { ok: true });
  });

  // Why onboarding links *before* it scaffolds. Checking out the client's real
  // default branch cannot overwrite untracked files, so a project scaffolded
  // first can never be linked to a repo that already has a README, a
  // package.json or a config of its own - which is most real repos. Linking
  // first also lets `writeIfAbsent` see the repo's own files and leave them be.
  it("cannot check out a branch over files scaffolded before the link", async () => {
    const remote = await bareRemote();
    const seed = await tmpDir("testlab-seed-");
    await run("git", ["init", "-b", "main", seed]);
    await fs.writeFile(path.join(seed, "README.md"), "# The client's own README\n", "utf8");
    await run("git", ["-C", seed, "add", "-A"]);
    await run("git", ["-C", seed, "-c", "user.email=a@b.c", "-c", "user.name=seed", "commit", "-m", "seed"]);
    await run("git", ["-C", seed, "push", remote, "main"]);

    const projectRoot = await tmpDir("testlab-project-");
    await fs.writeFile(path.join(projectRoot, "README.md"), "# scaffolded too early\n", "utf8");

    const result = await linkRepo(projectAt(projectRoot), { url: remote, baseBranch: "main" }, "unused-token");
    assert.equal(result.ok, false, "scaffolding before linking no longer conflicts - check the onboarding order");
  });

  it("reports failure rather than throwing when the remote doesn't exist", async () => {
    const projectRoot = await tmpDir("testlab-project-");
    const project = projectAt(projectRoot);

    const result = await linkRepo(project, { url: path.join(os.tmpdir(), "does-not-exist-at-all"), baseBranch: "main" }, "x");
    assert.equal(result.ok, false);
  });
});

describe("commitLocally and pushApproved", () => {
  async function linked() {
    const remote = await bareRemote();
    const projectRoot = await tmpDir("testlab-project-");
    const project = projectAt(projectRoot);
    await linkRepo(project, { url: remote, baseBranch: "main" }, "unused-token");
    await fs.mkdir(project.specsDir, { recursive: true });
    return { remote, project, projectRoot };
  }

  async function writeSpec(project: ProjectPaths, name: string) {
    await fs.writeFile(path.join(project.specsDir, name), `// ${name}\n`, "utf8");
  }

  // The gate: a passing run commits, and the remote stays untouched until a
  // person says so. Pushing on green would mean nobody ever reviewed it.
  it("commits locally without pushing anything", async () => {
    const { remote, project } = await linked();
    await writeSpec(project, "login.web.spec.js");

    const committed = await commitLocally(project, "add login spec");
    assert.equal(committed.ok, true);
    assert.ok(committed.ok && committed.commit, "no commit sha returned");

    await assert.rejects(commitCount(remote, UPDATE_BRANCH), "something was pushed before approval");
  });

  it("is a silent no-op when nothing changed", async () => {
    const { project } = await linked();
    await writeSpec(project, "login.web.spec.js");
    await commitLocally(project, "add login spec");

    const second = await commitLocally(project, "add login spec");
    assert.deepEqual(second, { ok: true, commit: null });
  });

  it("pushes only once a reviewer has approved, and records who", async () => {
    const { remote, project, projectRoot } = await linked();
    await writeSpec(project, "login.web.spec.js");
    const committed = await commitLocally(project, "add login spec");
    assert.ok(committed.ok && committed.commit);

    const pushed = await pushApproved(project, "unused-token", committed.commit, "Priya");
    assert.deepEqual(pushed, { ok: true });
    assert.equal(await commitCount(remote, UPDATE_BRANCH), 1);

    const log = await run("git", ["-C", projectRoot, "log", "-1", "--format=%B", UPDATE_BRANCH]);
    assert.match(log.stdout, /Reviewed-by: Priya/);
  });

  it("shows the reviewer exactly which files the change touches", async () => {
    const { project } = await linked();
    await writeSpec(project, "login.web.spec.js");
    const committed = await commitLocally(project, "add login spec");
    assert.ok(committed.ok && committed.commit);

    const shown = await showCommit(project, committed.commit);
    assert.ok(shown, "no diff available to review");
    assert.deepEqual(shown.files.map((f) => f.path), ["test/specs/login.web.spec.js"]);
    assert.match(shown.diff, /a generated spec|login\.web\.spec\.js/);
  });
});

describe("revertCommit", () => {
  // A rejected change is removed, not merely left unpushed: leaving it on disk
  // would diverge the project from the repo permanently, and decideReuse would
  // happily replay a spec the reviewer had just turned down.
  it("removes a rejected change from the working tree", async () => {
    const remote = await bareRemote();
    const projectRoot = await tmpDir("testlab-project-");
    const project = projectAt(projectRoot);
    await linkRepo(project, { url: remote, baseBranch: "main" }, "unused-token");
    await fs.mkdir(project.specsDir, { recursive: true });

    const specPath = path.join(project.specsDir, "bad.web.spec.js");
    await fs.writeFile(specPath, "// not wanted\n", "utf8");
    const committed = await commitLocally(project, "add bad spec");
    assert.ok(committed.ok && committed.commit);

    const reverted = await revertCommit(project, committed.commit);
    assert.deepEqual(reverted, { ok: true });

    await assert.rejects(fs.readFile(specPath, "utf8"), "the rejected spec is still on disk");
  });

  it("reverts rather than rewrites when a later change already builds on it", async () => {
    const remote = await bareRemote();
    const projectRoot = await tmpDir("testlab-project-");
    const project = projectAt(projectRoot);
    await linkRepo(project, { url: remote, baseBranch: "main" }, "unused-token");
    await fs.mkdir(project.specsDir, { recursive: true });

    await fs.writeFile(path.join(project.specsDir, "first.web.spec.js"), "// first\n", "utf8");
    const first = await commitLocally(project, "first");
    assert.ok(first.ok && first.commit);

    await fs.writeFile(path.join(project.specsDir, "second.web.spec.js"), "// second\n", "utf8");
    await commitLocally(project, "second");

    const reverted = await revertCommit(project, first.commit);
    assert.deepEqual(reverted, { ok: true });

    // The rejected file is gone; the one built on top of it survives.
    await assert.rejects(fs.readFile(path.join(project.specsDir, "first.web.spec.js"), "utf8"));
    await fs.readFile(path.join(project.specsDir, "second.web.spec.js"), "utf8");
  });
});

describe("a client project inside another repository", () => {
  // The bug this guards: `--is-inside-work-tree` answers yes for a directory
  // nested in someone else's checkout, so the enclosing repository was adopted
  // as the client's. Every later `git add -A` stages that whole outer tree —
  // `add -A` is work-tree-wide, not cwd-scoped — and the first approved push
  // sends an unrelated repository to the client's remote.
  async function nestedProject() {
    const outer = await tmpDir("testlab-outer-");
    await run("git", ["init", "-b", "main", outer]);
    await fs.writeFile(path.join(outer, "secret.txt"), "not the client's\n", "utf8");
    await run("git", ["-C", outer, "add", "-A"]);
    await run("git", ["-C", outer, "-c", "user.email=a@b.c", "-c", "user.name=o", "commit", "-m", "outer"]);

    const root = path.join(outer, "clients", "acme");
    await fs.mkdir(root, { recursive: true });
    return { outer, project: projectAt(root) };
  }

  it("gives the client its own repository rather than adopting the enclosing one", async () => {
    const remote = await bareRemote();
    const { outer, project } = await nestedProject();

    await linkRepo(project, { url: remote, baseBranch: "main" }, "unused-token");

    const { stdout } = await run("git", ["-C", project.root, "rev-parse", "--show-toplevel"]);
    assert.notEqual(
      path.resolve(stdout.trim()),
      path.resolve(outer),
      "the client project adopted the repository it happens to sit inside",
    );
  });

  it("never commits the enclosing repository's files", async () => {
    const remote = await bareRemote();
    const { project } = await nestedProject();
    await linkRepo(project, { url: remote, baseBranch: "main" }, "unused-token");

    await fs.mkdir(project.specsDir, { recursive: true });
    await fs.writeFile(path.join(project.specsDir, "login.web.spec.js"), "// the client's spec\n", "utf8");

    const committed = await commitLocally(project, "add login spec");
    assert.ok(committed.ok && committed.commit);

    const shown = await showCommit(project, committed.commit);
    assert.ok(shown);
    assert.ok(
      !shown.files.some((f) => f.path.includes("secret.txt")),
      `the enclosing repository's files were committed: ${shown.files.map((f) => f.path).join(", ")}`,
    );
  });

  it("refuses to commit a project that was mis-rooted before this was checked", async () => {
    const { project } = await nestedProject(); // linkRepo deliberately not called

    const committed = await commitLocally(project, "should not happen");
    assert.equal(committed.ok, false);
    assert.match(committed.ok === false ? committed.reason : "", /not the root of its own git repository/);
  });
});
