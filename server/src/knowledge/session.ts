import fs from "node:fs/promises";
import path from "node:path";
import { SECRET_ENV_PREFIX } from "../lanes/secrets.js";
import type { Platform, RunTarget } from "../types.js";
import { extractLocators, extractRequiredSecrets } from "./extract.js";
import { storePages, type StoredPage } from "./persist.js";
import {
  appendRunLog,
  ensureProject,
  readCatalog,
  readSpecIndex,
  writeCatalog,
  writeSpecIndex,
  type ClientProject,
} from "./project.js";
import { decideReuse, mergeLocators } from "./reuse.js";
import { partitionByPage, slugify } from "./structure.js";
import type { ReuseDecision } from "./types.js";

/**
 * The client's accumulated project, viewed from inside one lane.
 *
 * Two entry points: `openKnowledge` before any work, to find out how much work
 * is actually needed, and `recordSuccess` after a spec passes, to fold what was
 * learned back in. Everything between them is unchanged exploration.
 */

export interface KnowledgeSession {
  project: ClientProject;
  decision: ReuseDecision;
  /** Source of the spec to replay, when one matched. */
  replaySpec?: string;
  /** Credentials that spec expects, so a missing one is caught before launch. */
  missingSecrets: string[];
}

export function targetOf(target: RunTarget, platform: Platform): string {
  if (platform === "web") return target.webUrl ?? "";
  return (platform === "android" ? target.androidApp : target.iosApp) ?? "";
}

export async function openKnowledge(args: {
  clientId: string;
  prompt: string;
  platform: Platform;
  target: RunTarget;
  availableSecrets: string[];
}): Promise<KnowledgeSession> {
  const project = await ensureProject(args.clientId);
  const [specs, catalog] = await Promise.all([readSpecIndex(project), readCatalog(project)]);

  const decision = decideReuse({
    prompt: args.prompt,
    platform: args.platform,
    target: targetOf(args.target, args.platform),
    specs,
    catalog,
  });

  if (decision.mode !== "replayed" || !decision.spec) {
    return { project, decision, missingSecrets: [] };
  }

  const missingSecrets = decision.spec.requiresSecrets.filter((name) => !args.availableSecrets.includes(name));

  // A spec that reads a credential nobody supplied would fail on replay for a
  // reason that has nothing to do with the app. Fall back to generating rather
  // than reporting a false failure against the client's build.
  if (missingSecrets.length > 0) {
    return {
      project,
      decision: {
        ...decision,
        mode: "explored",
        reason: `"${decision.spec.title}" covers this, but it needs ${missingSecrets.join(", ")}, which this run did not supply — generating instead.`,
      },
      missingSecrets,
    };
  }

  const replaySpec = await readSpec(project, decision.spec.file);
  if (!replaySpec) {
    return {
      project,
      decision: { ...decision, mode: "explored", reason: `"${decision.spec.file}" is indexed but missing from disk — regenerating it.` },
      missingSecrets: [],
    };
  }

  return { project, decision, replaySpec, missingSecrets: [] };
}

export interface SaveReport {
  specFile: string;
  pages: StoredPage[];
  locatorsAdded: string[];
  locatorsChanged: string[];
  reusedExistingSpec: boolean;
}

/**
 * Fold a passing run into the client's project.
 *
 * Only ever called after a green replay. Saving a spec that has not passed
 * would fill the client's suite with tests that fail for reasons nobody has
 * looked at, which is worse than having no suite.
 */
export async function recordSuccess(args: {
  session: KnowledgeSession;
  runId: string;
  spec: string;
  title: string;
  prompt: string;
  platform: Platform;
  target: RunTarget;
}): Promise<SaveReport> {
  const { project } = args.session;
  const now = Date.now();
  const target = targetOf(args.target, args.platform);
  const reused = args.session.decision.mode === "replayed";

  const specFile = args.session.decision.spec?.file ?? `${slugify(args.title)}.${args.platform}.spec.js`;

  if (!reused) {
    await fs.writeFile(path.join(project.specsDir, specFile), args.spec, "utf8");
  }

  const pages = partitionByPage(args.spec, args.platform, args.title);
  const stored = await storePages(project, pages);

  const catalog = await readCatalog(project);
  const merged = mergeLocators(catalog, extractLocators(args.spec), {
    platform: args.platform,
    specFile,
    now,
  });
  await writeCatalog(project, merged.catalog);

  const index = await readSpecIndex(project);
  const existing = index.specs.find((s) => s.file === specFile);
  if (existing) {
    existing.lastVerified = now;
    existing.passCount += 1;
  } else {
    index.specs.push({
      file: specFile,
      prompt: args.prompt,
      title: args.title,
      platform: args.platform,
      target,
      createdAt: now,
      lastVerified: now,
      passCount: 1,
      requiresSecrets: extractRequiredSecrets(args.spec, SECRET_ENV_PREFIX),
    });
  }
  await writeSpecIndex(project, index);

  await appendRunLog(project, {
    at: new Date(now).toISOString(),
    runId: args.runId,
    platform: args.platform,
    mode: args.session.decision.mode,
    prompt: args.prompt,
    spec: specFile,
    target,
    pagesTouched: stored.map((p) => p.className),
    locatorsChanged: merged.changed,
  });

  return {
    specFile,
    pages: stored,
    locatorsAdded: merged.added,
    locatorsChanged: merged.changed,
    reusedExistingSpec: reused,
  };
}

/**
 * Where a spec is verified.
 *
 * Inside the client's project, in a staging directory at the same depth as
 * `test/specs`, so relative imports of page objects resolve identically before
 * and after the spec is accepted. Only a passing spec is moved into the suite,
 * which keeps failed attempts out of the client's repository entirely.
 */
export function stagingWorkspace(project: ClientProject, specName: string) {
  return { dir: project.metaDir, specDir: "pending", specName };
}

export async function clearStaging(project: ClientProject): Promise<void> {
  await fs.rm(path.join(project.metaDir, "pending"), { recursive: true, force: true });
}

async function readSpec(project: ClientProject, file: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(project.specsDir, file), "utf8");
  } catch {
    return null;
  }
}
