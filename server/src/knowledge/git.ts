import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
// Paths, not ClientProject: pushing a project to a repo needs to know where it
// is on disk and nothing else — in particular not what language it is written
// in, which would otherwise force a disk read on a purely mechanical operation.
import type { ProjectPaths } from "./project.js";

/**
 * Pushing a client's accumulated project to a repo they own.
 *
 * Shells out to the system `git` rather than a library: every client project
 * is meant to be an ordinary working tree a client can also clone and touch
 * by hand (see project.ts), and the system binary is the only thing
 * guaranteed to produce exactly what `git` itself would.
 *
 * Scope, stated plainly: this treats the linked repo as storage for exactly
 * the layout `project.ts` already generates (`test/specs`, `src/pages`,
 * `src/selectors`, ...). It does not attempt to reconcile with a client's
 * existing, differently-shaped framework already in that repo — a repo like
 * that just gains a second, separate set of directories alongside whatever
 * it already has. Unifying with an existing layout is a harder, separate
 * problem; this only proves changes can safely reach a client's own repo.
 */

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;

/** Commits from this tool land here, never on the client's own default branch. */
export const UPDATE_BRANCH = "testlab-updates";

export interface RepoTarget {
  url: string;
  baseBranch: string;
}

export type GitResult = { ok: true } | { ok: false; reason: string };

async function git(args: string[], cwd: string, extraHeader?: string): Promise<{ stdout: string; stderr: string }> {
  const fullArgs = extraHeader ? ["-c", `http.extraheader=${extraHeader}`, ...args] : args;
  return run("git", fullArgs, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true });
}

/**
 * GitHub, GitLab and Bitbucket Cloud all accept HTTP Basic with the token as
 * the password and any non-empty username for a personal/project access
 * token — one header form that works across all three without the caller
 * needing to know which host it's talking to.
 *
 * Passed per-invocation via `-c http.extraheader`, never written into
 * `.git/config` — a remote URL with an embedded token would persist it in
 * plaintext on the server's disk, readable by anyone with filesystem access.
 * This way the token exists only in this process's memory and the request
 * it sends.
 */
function authHeader(token: string): string {
  return `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

async function refExists(ref: string, cwd: string): Promise<boolean> {
  return git(["rev-parse", "--verify", "--quiet", ref], cwd)
    .then(() => true)
    .catch(() => false);
}

/**
 * Point a client's project at a remote and fork the update branch from the
 * client's real history, so the branch this tool commits to has a sane
 * common ancestor with their default branch — the difference between a PR
 * that shows the actual diff and one that shows every file as newly added.
 *
 * Verifies the URL and token work before returning `ok` — a typo here is far
 * more useful to catch now than on the first real save's best-effort,
 * easy-to-miss sync failure.
 */
export async function linkRepo(project: ProjectPaths, target: RepoTarget, token: string): Promise<GitResult> {
  try {
    // Whether this directory is a repository *root*, not merely whether it
    // sits inside one. A client project frequently lives inside another
    // checkout (this tool's own `clients/` directory does), and
    // `--is-inside-work-tree` answers yes for those — so the enclosing
    // repository would be adopted as the client's. Every later `git add -A`
    // then stages that whole outer tree, and the first approved push sends
    // someone else's repository to the client's remote.
    if (!(await isRepoRoot(project.root))) await git(["init"], project.root);

    const remotes = await git(["remote"], project.root);
    const hasOrigin = remotes.stdout
      .split("\n")
      .map((l) => l.trim())
      .includes("origin");
    if (hasOrigin) await git(["remote", "set-url", "origin", target.url], project.root);
    else await git(["remote", "add", "origin", target.url], project.root);

    await git(["fetch", "origin"], project.root, authHeader(token)).catch((err) => {
      // A brand-new, empty remote has nothing to fetch yet - that's the
      // normal case for a client onboarding a fresh repo, not a failure.
      const message = gitErrorMessage(err);
      if (!/couldn't find remote ref|repository .* is empty|remote end hung up|fatal: couldn't find/i.test(message)) {
        throw err;
      }
    });

    if (await refExists(`origin/${UPDATE_BRANCH}`, project.root)) {
      // Resume: an earlier link already established this branch on the remote.
      await git(["checkout", "-B", UPDATE_BRANCH, `origin/${UPDATE_BRANCH}`], project.root);
    } else if (await refExists(`origin/${target.baseBranch}`, project.root)) {
      await git(["checkout", "-B", UPDATE_BRANCH, `origin/${target.baseBranch}`], project.root);
    } // else: the remote has no history at all yet - stay on the local init, first sync starts it.

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: gitErrorMessage(err) };
  }
}

/**
 * Commit whatever the last save changed, locally.
 *
 * Deliberately does not push. Committing per run is what makes each run
 * independently reviewable: the working tree stays clean, and every save is
 * one isolated commit with a real diff a person can read before deciding
 * whether it belongs in the client's repo.
 *
 * Best-effort by design: the spec this was called after already passed replay
 * and is already safely on the client's local disk, which is the part that
 * matters to the run that triggered this.
 */
export async function commitLocally(
  project: ProjectPaths,
  message: string,
): Promise<{ ok: true; commit: string | null } | { ok: false; reason: string }> {
  try {
    // Refuse to stage anything unless this directory is its own repository.
    // `git add -A` stages the whole work tree, not just the current directory,
    // so against an enclosing repository this would commit — and later push —
    // every file in it. Checked here as well as in `linkRepo` because a
    // project linked before that check existed would still be mis-rooted.
    if (!(await isRepoRoot(project.root))) {
      return {
        ok: false,
        reason:
          `${project.root} is not the root of its own git repository. ` +
          "Re-link the repo for this client; committing from here would stage the enclosing repository.",
      };
    }

    await git(["checkout", "-B", UPDATE_BRANCH], project.root);

    const status = await git(["status", "--porcelain"], project.root);
    if (!status.stdout.trim()) return { ok: true, commit: null }; // Nothing changed.

    await git(["add", "-A"], project.root);
    await git(["-c", "user.email=testlab@local", "-c", "user.name=TestLab", "commit", "-m", message], project.root);

    const head = await git(["rev-parse", "HEAD"], project.root);
    return { ok: true, commit: head.stdout.trim() };
  } catch (err) {
    return { ok: false, reason: gitErrorMessage(err) };
  }
}

/**
 * Push the update branch, after a human has approved what is on it.
 *
 * The reviewer is recorded in the commit itself when the approved commit is
 * still the branch tip — which it normally is, since saves are serialized and
 * reviews are usually answered in order. When a later save has already
 * committed on top, the message cannot be edited without rewriting that
 * commit too, so the attribution stays in the review record rather than being
 * forced into history.
 */
export async function pushApproved(
  project: ProjectPaths,
  token: string,
  commit: string,
  reviewer: string,
): Promise<GitResult> {
  try {
    const head = (await git(["rev-parse", "HEAD"], project.root)).stdout.trim();
    if (head === commit) {
      const subject = (await git(["log", "-1", "--format=%B", commit], project.root)).stdout.trim();
      await git(
        [
          "-c",
          "user.email=testlab@local",
          "-c",
          "user.name=TestLab",
          "commit",
          "--amend",
          "-m",
          `${subject}\n\nReviewed-by: ${reviewer}`,
        ],
        project.root,
      );
    }

    await git(["push", "origin", `HEAD:${UPDATE_BRANCH}`], project.root, authHeader(token));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: gitErrorMessage(err) };
  }
}

/** The files a commit touched, and its full diff — what a reviewer reads. */
export async function showCommit(
  project: ProjectPaths,
  commit: string,
): Promise<{ files: Array<{ path: string; status: string }>; diff: string } | null> {
  try {
    const names = await git(["show", "--name-status", "--format=", commit], project.root);
    const files = names.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split(/\s+/);
        return { status: status ?? "M", path: rest.join(" ") };
      });

    const diff = await git(["show", "--format=", commit], project.root);
    return { files, diff: diff.stdout };
  } catch {
    return null;
  }
}

/**
 * Undo a rejected change locally.
 *
 * A rejected change is removed rather than merely left unpushed. Leaving it on
 * disk would diverge the project from the repo permanently, and — worse —
 * `decideReuse` would happily replay a spec the reviewer had just turned down.
 * The prompt survives in the run history, so a rejected scenario can be run
 * again after whatever prompted the rejection is fixed.
 */
export async function revertCommit(project: ProjectPaths, commit: string): Promise<GitResult> {
  try {
    const head = (await git(["rev-parse", "HEAD"], project.root)).stdout.trim();

    if (head === commit) {
      const hasParent = await git(["rev-parse", "--verify", "--quiet", `${commit}^`], project.root)
        .then(() => true)
        .catch(() => false);

      if (hasParent) {
        // The common case, since saves are serialized: drop it outright, so
        // the branch looks as though the run never happened.
        await git(["reset", "--hard", `${commit}^`], project.root);
        return { ok: true };
      }

      // No parent: this is the branch's root commit, which happens when the
      // client linked a repo that had no history at all. There is no earlier
      // state to reset to, so the commit's own files are removed by name and
      // the branch pointer goes with them.
      const details = await showCommit(project, commit);
      await git(["update-ref", "-d", `refs/heads/${UPDATE_BRANCH}`], project.root).catch(() => undefined);
      for (const file of details?.files ?? []) {
        if (file.status.startsWith("A")) await fs.rm(path.join(project.root, file.path), { force: true });
      }
      return { ok: true };
    }

    // A later save already built on top. Reverting keeps history honest rather
    // than rewriting a commit someone may have already fetched.
    await git(
      ["-c", "user.email=testlab@local", "-c", "user.name=TestLab", "revert", "--no-edit", commit],
      project.root,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: gitErrorMessage(err) };
  }
}

/**
 * Whether `root` is the top of its own git work tree.
 *
 * Both sides go through `realpath` before comparison. On Windows the two
 * disagree in three separate ways for the same directory: git answers with
 * forward slashes, the caller's path may be an 8.3 short name
 * (`C:\Users\SUDARS~1\…`), and casing is not guaranteed to match. Comparing
 * the raw strings reports "different" for a directory that is in fact the
 * repository root, which would re-init an existing repository.
 */
async function isRepoRoot(root: string): Promise<boolean> {
  const toplevel = await git(["rev-parse", "--show-toplevel"], root)
    .then((r) => r.stdout.trim())
    .catch(() => null);
  if (!toplevel) return false;

  const real = async (p: string) => {
    const resolved = await fs.realpath(path.resolve(p)).catch(() => path.resolve(p));
    return resolved.replace(/\\/g, "/").replace(/\/+$/, "");
  };

  const [left, right] = await Promise.all([real(toplevel), real(root)]);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function gitErrorMessage(err: unknown): string {
  // node's execFile rejection buries the useful part (git's own stderr)
  // behind a generic "Command failed" prefix - surface stderr instead.
  const stderr = (err as { stderr?: string } | undefined)?.stderr;
  const message = stderr?.trim() || (err instanceof Error ? err.message : String(err));
  return message.split("\n")[0]!.slice(0, 300);
}
