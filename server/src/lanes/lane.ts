import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { explore, type ExploreResult } from "../agent/explore.js";
import { skimSite } from "../agent/siteSkim.js";
import { extendSpec, repairSpec, summarizeFailure, synthesizeSpec } from "../agent/synthesize.js";
import { getClient, recordSyncResult, requiresReview } from "../knowledge/clients.js";
import { commitLocally, pushApproved, showCommit, UPDATE_BRANCH } from "../knowledge/git.js";
import { openReview } from "../knowledge/reviews.js";
import { sourceExt, type ClientProject } from "../knowledge/project.js";
import { clearStaging, openKnowledge, recordSuccess, type SaveReport, stagingWorkspace } from "../knowledge/session.js";
import { slugify } from "../knowledge/structure.js";
import type { SecretBag } from "./secrets.js";
import type { VerifyWorkspace } from "../runner/verify.js";
import { selectTools, toLlmTools } from "../mcp/bridge.js";
import { WdioMcp, errorMessage } from "../mcp/client.js";
import { verify } from "../runner/verify.js";
import { store } from "../store.js";
import type { LaneState, Platform, RunState } from "../types.js";
import { planFor, type LanePlan } from "./capabilities.js";
import { preflight } from "./preflight.js";

export interface LaneArgs {
  run: RunState;
  platform: Platform;
  signal: AbortSignal;
}

/**
 * Drives one platform end to end. Lanes are fully independent: their own MCP
 * process, their own device, their own artifacts. A failure in one never
 * touches another, which is why they are started with allSettled upstream.
 */
export async function runLane({ run, platform, signal }: LaneArgs): Promise<void> {
  const runId = run.id;
  const emit = store.emit.bind(store, runId);
  const secrets = store.secrets(runId);

  emit({ type: "lane.status", platform, status: "running" });
  emit({ type: "lane.phase", platform, phase: "preflight" });

  const check = await preflight(platform, run.target);
  if (!check.ok) {
    emit({ type: "lane.status", platform, status: "skipped", detail: check.reason });
    return;
  }

  const plan = planFor(platform, run.target, run.headless);

  // Cache fast path: an identical prompt + target was already solved before.
  // Replay that spec cold, for free, before paying for a fresh
  // explore+synthesize - only fall through to the full pipeline below if it
  // no longer verifies (the target genuinely changed since then).
  const cachedSpec = store.findCachedSpec(run.prompt, platform, run.target);
  if (cachedSpec && !signal.aborted) {
    emit({ type: "lane.phase", platform, phase: "verify" });
    const onCachedLine = (line: string) => emit({ type: "verify.log", platform, line });
    onCachedLine("--- identical prompt + target seen before; replaying the cached spec first (no AI calls) ---");

    const cached = await verify({
      runId,
      clientId: run.clientId,
      platform,
      plan,
      spec: cachedSpec,
      onLine: onCachedLine,
      signal,
      secrets,
    });
    if (cached.passed) {
      emit({ type: "artifact", platform, kind: "spec", code: cachedSpec, path: cached.specPath });
      emit({ type: "lane.phase", platform, phase: "done" });
      emit({
        type: "lane.status",
        platform,
        status: "passed",
        detail: "Reused a cached spec from an identical earlier prompt - passed cold again, no AI calls made.",
      });
      return;
    }
    onCachedLine("--- cached spec no longer passes; the target may have changed - falling back to a fresh run ---");
  }

  let mcp: WdioMcp | null = null;

  try {
    const knowledge = await openKnowledge({
      clientId: run.clientId,
      prompt: run.prompt,
      platform,
      target: run.target,
      availableSecrets: secrets.names,
    });
    emit({ type: "lane.reuse", platform, mode: knowledge.decision.mode, reason: knowledge.decision.reason });

    const onLine = (line: string) => emit({ type: "verify.log", platform, line });

    // The cheap path: a spec already covers this. Replay it and, if it is
    // still green, the run is done without a model call or an MCP session at
    // all. This is the whole return on keeping a knowledge base.
    if (knowledge.decision.mode === "replayed" && knowledge.replaySpec) {
      emit({ type: "lane.phase", platform, phase: "verify" });
      const replay = await verify({
        runId,
        clientId: run.clientId,
        platform,
        plan,
        spec: knowledge.replaySpec,
        onLine,
        signal,
        secrets,
        workspace: stagingWorkspace(knowledge.project, knowledge.decision.spec!.file),
      });
      await clearStaging(knowledge.project);

      if (replay.passed) {
        emit({ type: "artifact", platform, kind: "spec", code: knowledge.replaySpec, path: replay.specPath });
        const saved = await recordSuccess({
          session: knowledge,
          runId,
          spec: knowledge.replaySpec,
          title: knowledge.decision.spec!.title,
          prompt: run.prompt,
          platform,
          target: run.target,
        });
        const repoSync = await syncClientRepo(knowledge.project, run.clientId, platform, knowledge.decision.spec!.title, onLine, runId, run.prompt);
        emit({ type: "lane.saved", platform, report: { ...saved, repoSync } });
        emit({ type: "lane.phase", platform, phase: "done" });
        emit({
          type: "lane.status",
          platform,
          status: "passed",
          detail: `Reused "${knowledge.decision.spec!.title}" — no model calls needed.`,
        });
        return;
      }

      // A green spec that has stopped passing is the interesting case: the
      // build changed. Fall through and rediscover, which repairs the stored
      // spec and the locators behind it rather than reporting a bare failure.
      onLine("--- the stored spec no longer passes; re-exploring to find what changed ---");
    }

    mcp = await WdioMcp.launch(platform);

    const mcpTools = selectTools(await mcp.listTools(), platform, config.llm.leanTools);
    const tools = toLlmTools(mcpTools);

    // The lane owns session lifecycle, not the model - it must be opened before
    // the agent runs and closed before verify, so the device is free to replay.
    const started = await mcp.callTool("start_session", plan.sessionArgs);
    if (started.isError) {
      throw new Error(`Could not start a ${platform} session: ${firstText(started.content)}`);
    }

    if (platform === "web" && run.target.webUrl) {
      const nav = await mcp.callTool("navigate", { url: run.target.webUrl });
      if (nav.isError) {
        throw new Error(`Could not load ${run.target.webUrl}: ${firstText(nav.content)}`);
      }
    }

    // Cheap head start for the web lane: a static skim never blocks or fails
    // the run, it just gives the explorer a rough map before it starts
    // spending its live tool-call budget. No HTTP equivalent for a native app.
    const siteSkim = platform === "web" && run.target.webUrl ? await skimSite(run.target.webUrl) : null;

    emit({ type: "lane.phase", platform, phase: "explore" });
    const exploration = await explore({
      mcp,
      tools,
      mcpTools,
      prompt: run.prompt,
      platform,
      plan,
      budget: config.MAX_AGENT_STEPS,
      signal,
      secrets,
      siteSkim,
      emit: {
        text: (text) => emit({ type: "agent.text", platform, text }),
        toolStarted: (step) => emit({ type: "agent.tool", platform, step }),
        toolFinished: (id, ok, summary) => emit({ type: "agent.tool_result", platform, id, ok, summary }),
        screenshot: (shot) => emit({ type: "screenshot", platform, shot }),
      },
    });
    emit({ type: "lane.usage", platform, usage: exploration.usage });

    emit({ type: "lane.phase", platform, phase: "export" });
    // The MCP recorder replays what actually reached the device, so a filled
    // credential is sitting in this code verbatim. Put the placeholders back
    // before it is shown to the user or handed to synthesis.
    const rawRecorded = await mcp.readResourceText("wdio://session/current/code");
    const recorded = rawRecorded ? secrets.redact(rawRecorded) : rawRecorded;
    if (recorded) {
      emit({ type: "artifact", platform, kind: "recorded", code: recorded });
    }

    // Free the device before replay. On a cloud farm this also stops the
    // exploratory session billing while synthesis runs.
    await mcp.close();
    mcp = null;

    emit({ type: "lane.phase", platform, phase: "synthesize" });
    const synthArgs = {
      prompt: run.prompt,
      platform,
      plan,
      transcript: secrets.redact(exploration.transcript),
      recorded,
      language: knowledge.project.language,
    };
    const synthesized = await synthesizeSpec(synthArgs);
    let spec = synthesized.code;
    emit({ type: "lane.usage", platform, usage: synthesized.usage });
    emit({ type: "artifact", platform, kind: "spec", code: spec });

    emit({ type: "lane.phase", platform, phase: "verify" });

    const title = titleOf(spec) ?? run.prompt.slice(0, 60);
    const specName =
      knowledge.decision.spec?.file ?? `${slugify(title)}.${platform}.spec${sourceExt(knowledge.project.language)}`;
    // Staged inside the client's project so imports of their page objects
    // resolve exactly as they will once the spec is accepted into the suite.
    const workspace = stagingWorkspace(knowledge.project, specName);

    let result = await verify({ runId, clientId: run.clientId, platform, plan, spec, onLine, signal, secrets, workspace });

    if (!result.passed && !signal.aborted) {
      onLine("--- replay failed; attempting one repair pass ---");
      const repaired = await repairSpec({ ...synthArgs, spec, failure: result.output, domSnapshot: result.domSnapshot });
      spec = repaired.code;
      emit({ type: "lane.usage", platform, usage: repaired.usage });
      emit({ type: "artifact", platform, kind: "spec", code: spec });
      result = await verify({ runId, clientId: run.clientId, platform, plan, spec, onLine, signal, secrets, workspace });
    }

    let stabilityDetail: string | undefined;
    if (result.passed && run.stabilityRuns > 0 && !signal.aborted) {
      stabilityDetail = await checkStability({
        runId,
        clientId: run.clientId,
        platform,
        plan,
        spec,
        stabilityRuns: run.stabilityRuns,
        onLine,
        signal,
        secrets,
        workspace,
      });
    }

    // Only for a genuinely failed lane (post-repair) - a plain-English cause,
    // cheap to generate, that saves opening the full verify log to find out
    // why, especially useful scanning a batch of several results at once.
    let failureSummary: string | null = null;
    if (!result.passed && !signal.aborted) {
      const summarized = await summarizeFailure({ prompt: run.prompt, failure: result.output, domSnapshot: result.domSnapshot });
      failureSummary = summarized.summary;
      emit({ type: "lane.usage", platform, usage: summarized.usage });
    }

    // Cleared after every replay, including the stability repeats: a spec that
    // never passed has no business being left behind in the client's project.
    await clearStaging(knowledge.project);

    emit({ type: "artifact", platform, kind: "spec", code: spec, path: result.specPath });

    if (result.passed) {
      const saved = await recordSuccess({
        session: knowledge,
        runId,
        spec,
        title,
        prompt: run.prompt,
        platform,
        target: run.target,
        verifyExtraction: extractionVerifier({
          runId,
          clientId: run.clientId,
          platform,
          plan,
          project: knowledge.project,
          onLine,
          signal,
          secrets,
        }),
      });
      const repoSync = await syncClientRepo(knowledge.project, run.clientId, platform, title, onLine, runId, run.prompt);
      emit({ type: "lane.saved", platform, report: { ...saved, repoSync } });
    }

    emit({ type: "lane.phase", platform, phase: "done" });
    emit({
      type: "lane.status",
      platform,
      status: result.passed ? "passed" : "failed",
      detail: result.passed
        ? (stabilityDetail ?? exhaustionDetail(exploration))
        : (failureSummary ?? result.reason ?? "The generated spec did not pass replay."),
    });
  } catch (err) {
    if (signal.aborted) {
      emit({ type: "lane.status", platform, status: "error", detail: "Run cancelled." });
      return;
    }
    const message = errorMessage(err);
    emit({ type: "error", platform, message });
    emit({ type: "lane.status", platform, status: "error", detail: message });
  } finally {
    await mcp?.close();
  }
}

/** The scenario's own name, so the saved file is called what the test is called. */
function titleOf(spec: string): string | null {
  return /\bdescribe\s*\(\s*(['"`])((?:[^\\]|\\.)*?)\1/.exec(spec)?.[2]?.trim() || null;
}

export interface ExtendLaneArgs {
  /** The NEW run being created for this extension - its own history entry, own artifacts. */
  run: RunState;
  platform: Platform;
  /** The ORIGINAL, already-passing lane being built on. */
  baseLane: LaneState;
  additionalPrompt: string;
  signal: AbortSignal;
}

/**
 * Builds on an already-passing lane instead of a fresh explore+synthesize.
 *
 * The original scenario's recorded steps are replayed mechanically - the
 * exact MCP tool calls, no LLM involved - to fast-forward the live session
 * to where the original scenario left off. Only the additional part needs
 * live AI exploration, and only the additional part needs to enter the
 * structure/code prompts as new input; the original plan and code are given
 * as fixed context the model must not repeat.
 *
 * If the mechanical replay itself fails, the target's state has likely
 * changed since the base run - this stops and says so plainly rather than
 * silently falling back to a full run under a different code path than the
 * one the user actually asked for.
 */
export async function extendLane({ run, platform, baseLane, additionalPrompt, signal }: ExtendLaneArgs): Promise<void> {
  const runId = run.id;
  const emit = store.emit.bind(store, runId);

  emit({ type: "lane.status", platform, status: "running" });
  emit({ type: "lane.phase", platform, phase: "preflight" });

  const check = await preflight(platform, run.target);
  if (!check.ok) {
    emit({ type: "lane.status", platform, status: "skipped", detail: check.reason });
    return;
  }

  if (!baseLane.specCode) {
    emit({ type: "lane.status", platform, status: "error", detail: "The base run has no spec to extend." });
    return;
  }
  const baseSpec = baseLane.specCode;
  // The extension run carries its own credentials: the base run's were dropped
  // when it finished, and an extended login flow still has to be able to log in.
  const secrets = store.secrets(runId);

  // Only used for its project handle and staging - the reuse/replay decision
  // itself does not apply here, this lane already knows exactly what to do.
  const knowledge = await openKnowledge({
    clientId: run.clientId,
    prompt: run.prompt,
    platform,
    target: run.target,
    availableSecrets: secrets.names,
  });
  // openKnowledge can still classify the combined prompt as a "replayed" match
  // against the base spec (it hasn't seen the additional part). recordSuccess
  // reads that mode to mean "identical content, skip the write" - which is
  // never true here, the merged spec always has new steps. Keep decision.spec
  // (it is what makes the saved filename match the base spec) but force the
  // mode so the write actually happens.
  if (knowledge.decision.mode === "replayed") {
    knowledge.decision = { ...knowledge.decision, mode: "explored" };
  }

  const plan = planFor(platform, run.target, run.headless);
  let mcp: WdioMcp | null = null;

  try {
    mcp = await WdioMcp.launch(platform);

    const mcpTools = selectTools(await mcp.listTools(), platform, config.llm.leanTools);
    const tools = toLlmTools(mcpTools);

    const started = await mcp.callTool("start_session", plan.sessionArgs);
    if (started.isError) {
      throw new Error(`Could not start a ${platform} session: ${firstText(started.content)}`);
    }

    if (platform === "web" && run.target.webUrl) {
      const nav = await mcp.callTool("navigate", { url: run.target.webUrl });
      if (nav.isError) {
        throw new Error(`Could not load ${run.target.webUrl}: ${firstText(nav.content)}`);
      }
    }

    emit({ type: "lane.phase", platform, phase: "explore" });
    emit({
      type: "agent.text",
      platform,
      text: `Replaying ${baseLane.steps.length} step(s) from the base run to reach its end state — no AI cost for this part.`,
    });

    for (const step of baseLane.steps) {
      signal.throwIfAborted();
      const raw = await mcp.callTool(step.name, (step.input ?? {}) as Record<string, unknown>);
      const replayStep = { ...step, id: randomUUID(), at: Date.now() };
      emit({ type: "agent.tool", platform, step: replayStep });
      emit({
        type: "agent.tool_result",
        platform,
        id: replayStep.id,
        ok: !raw.isError,
        summary: raw.isError ? "replay failed" : "replayed",
      });
      if (raw.isError) {
        throw new Error(
          `Could not replay step "${step.name}" from the base run — the page state has likely changed since then. Submit this as a fresh prompt instead of an extension.`,
        );
      }
    }

    // Already mid-scenario at this point; a fresh page skim would describe
    // the wrong state and only mislead the explorer.
    const exploration = await explore({
      mcp,
      tools,
      mcpTools,
      prompt: additionalPrompt,
      platform,
      plan,
      budget: config.MAX_AGENT_STEPS,
      signal,
      secrets,
      siteSkim: null,
      emit: {
        text: (text) => emit({ type: "agent.text", platform, text }),
        toolStarted: (step) => emit({ type: "agent.tool", platform, step }),
        toolFinished: (id, ok, summary) => emit({ type: "agent.tool_result", platform, id, ok, summary }),
        screenshot: (shot) => emit({ type: "screenshot", platform, shot }),
      },
    });
    emit({ type: "lane.usage", platform, usage: exploration.usage });

    emit({ type: "lane.phase", platform, phase: "export" });
    const recorded = await mcp.readResourceText("wdio://session/current/code");
    if (recorded) {
      emit({ type: "artifact", platform, kind: "recorded", code: recorded });
    }

    await mcp.close();
    mcp = null;

    emit({ type: "lane.phase", platform, phase: "synthesize" });
    const synthesized = await extendSpec({
      additionalPrompt,
      platform,
      plan,
      transcript: exploration.transcript,
      recorded,
      existingCode: baseSpec,
      language: knowledge.project.language,
    });
    let spec = synthesized.code;
    emit({ type: "lane.usage", platform, usage: synthesized.usage });
    emit({ type: "artifact", platform, kind: "spec", code: spec });

    emit({ type: "lane.phase", platform, phase: "verify" });
    const onLine = (line: string) => emit({ type: "verify.log", platform, line });

    const title = titleOf(spec) ?? run.prompt.slice(0, 60);
    const specName =
      knowledge.decision.spec?.file ?? `${slugify(title)}.${platform}.spec${sourceExt(knowledge.project.language)}`;
    // Staged inside the client's project so imports of their page objects
    // resolve exactly as they will once the spec is accepted into the suite.
    const workspace = stagingWorkspace(knowledge.project, specName);

    let result = await verify({ runId, clientId: run.clientId, platform, plan, spec, onLine, signal, secrets, workspace });

    if (!result.passed && !signal.aborted) {
      onLine("--- replay failed; attempting one repair pass ---");
      // The repair prompt's transcript only covers the additional part - the
      // base portion was already proven to pass on its own before this
      // extension began, so a fresh failure is far more likely to be in the
      // new code than the old.
      const repaired = await repairSpec({
        prompt: run.prompt,
        platform,
        plan,
        transcript: exploration.transcript,
        recorded,
        language: knowledge.project.language,
        spec,
        failure: result.output,
        domSnapshot: result.domSnapshot,
      });
      spec = repaired.code;
      emit({ type: "lane.usage", platform, usage: repaired.usage });
      emit({ type: "artifact", platform, kind: "spec", code: spec });
      result = await verify({ runId, clientId: run.clientId, platform, plan, spec, onLine, signal, secrets, workspace });
    }

    let stabilityDetail: string | undefined;
    if (result.passed && run.stabilityRuns > 0 && !signal.aborted) {
      stabilityDetail = await checkStability({
        runId,
        clientId: run.clientId,
        platform,
        plan,
        spec,
        stabilityRuns: run.stabilityRuns,
        onLine,
        signal,
        secrets,
        workspace,
      });
    }

    let failureSummary: string | null = null;
    if (!result.passed && !signal.aborted) {
      const summarized = await summarizeFailure({ prompt: run.prompt, failure: result.output, domSnapshot: result.domSnapshot });
      failureSummary = summarized.summary;
      emit({ type: "lane.usage", platform, usage: summarized.usage });
    }

    // Cleared after every replay, including the stability repeats: a spec that
    // never passed has no business being left behind in the client's project.
    await clearStaging(knowledge.project);

    emit({ type: "artifact", platform, kind: "spec", code: spec, path: result.specPath });

    if (result.passed) {
      const saved = await recordSuccess({
        session: knowledge,
        runId,
        spec,
        title,
        prompt: run.prompt,
        platform,
        target: run.target,
        verifyExtraction: extractionVerifier({
          runId,
          clientId: run.clientId,
          platform,
          plan,
          project: knowledge.project,
          onLine,
          signal,
          secrets,
        }),
      });
      const repoSync = await syncClientRepo(knowledge.project, run.clientId, platform, title, onLine, runId, run.prompt);
      emit({ type: "lane.saved", platform, report: { ...saved, repoSync } });
    }

    emit({ type: "lane.phase", platform, phase: "done" });
    emit({
      type: "lane.status",
      platform,
      status: result.passed ? "passed" : "failed",
      detail: result.passed
        ? (stabilityDetail ??
          `Extended from an earlier run — replayed ${baseLane.steps.length} base step(s) for free, only the new part spent tokens.`)
        : (failureSummary ?? result.reason ?? "The extended spec did not pass replay."),
    });
  } catch (err) {
    if (signal.aborted) {
      emit({ type: "lane.status", platform, status: "error", detail: "Run cancelled." });
      return;
    }
    const message = errorMessage(err);
    emit({ type: "error", platform, message });
    emit({ type: "lane.status", platform, status: "error", detail: message });
  } finally {
    await mcp?.close();
  }
}

/**
 * Re-run an already-passing spec cold, N more times, with no repair pass.
 *
 * A spec that only ran once proves it can pass, not that it reliably does -
 * timing-dependent selectors (a native <select>'s options, an animation, a
 * race with an API call) can pass by luck on a given try. This is the
 * cheapest way to catch that before handing the file to a user who will
 * commit it to CI.
 */
async function checkStability(args: {
  runId: string;
  clientId: string;
  platform: Platform;
  plan: LanePlan;
  spec: string;
  stabilityRuns: number;
  onLine: (line: string) => void;
  signal: AbortSignal;
  secrets: SecretBag;
  workspace?: VerifyWorkspace;
}): Promise<string> {
  const { runId, clientId, platform, plan, spec, stabilityRuns, onLine, signal, secrets, workspace } = args;
  let passes = 1; // the run that got us here already passed once

  for (let i = 1; i <= stabilityRuns; i++) {
    if (signal.aborted) break;
    onLine(`--- stability check: repeat ${i}/${stabilityRuns} ---`);
    const repeat = await verify({ runId, clientId, platform, plan, spec, onLine, signal, secrets, workspace });
    if (repeat.passed) passes++;
  }

  const total = 1 + stabilityRuns;
  return passes === total
    ? `Passed, and stable across ${total}/${total} cold runs.`
    : `Passed, but only ${passes}/${total} cold runs succeeded - this spec is flaky. Look for a timing-dependent step (an unguarded click, a native dropdown, an animation) rather than trusting the first green run.`;
}

function firstText(content: Array<{ type: string; [k: string]: unknown }>): string {
  const block = content.find((c) => c.type === "text");
  const text = typeof block?.text === "string" ? block.text : "";
  return text.trim() || "no detail returned";
}

/**
 * Replay a spec that `recordSuccess` is considering writing.
 *
 * Lifting a scenario's steps into a business function splits one file into two
 * and rewrites its assertions. The spec that arrived has already passed a real
 * replay; the lifted one has not, and "every saved spec passed a replay" is
 * the one guarantee this pipeline exists to make — so the lift has to earn its
 * place. Costs one more browser run per new scenario and no model calls.
 */
function extractionVerifier(args: {
  runId: string;
  clientId: string;
  platform: Platform;
  plan: LanePlan;
  project: ClientProject;
  onLine: (line: string) => void;
  signal: AbortSignal;
  secrets: SecretBag;
}): (spec: string, specFile: string) => Promise<boolean> {
  return async (spec, specFile) => {
    args.onLine("--- re-checking the spec with its steps lifted into a business function ---");
    const result = await verify({
      runId: args.runId,
      clientId: args.clientId,
      platform: args.platform,
      plan: args.plan,
      spec,
      onLine: args.onLine,
      signal: args.signal,
      secrets: args.secrets,
      workspace: stagingWorkspace(args.project, specFile),
    });
    await clearStaging(args.project);
    if (!result.passed) args.onLine("--- it did not pass; keeping the original spec and discarding the extraction ---");
    return result.passed;
  };
}

/**
 * Push whatever `recordSuccess` just wrote to the client's linked repo, if
 * they have one — best-effort, never thrown. The run this was called after
 * already passed and is already safely saved locally; a bad token or a
 * network blip here must show up as a note on the save, not as a failed run.
 */
async function syncClientRepo(
  project: ClientProject,
  clientId: string,
  platform: Platform,
  title: string,
  onLine: (line: string) => void,
  runId: string,
  prompt: string,
): Promise<SaveReport["repoSync"]> {
  const client = await getClient(clientId);
  // No repo linked - the overwhelmingly common case, and not worth a note on
  // every single save; `repoSync` simply stays absent from the report.
  if (!client?.repo) return undefined;

  const token = process.env[client.repo.tokenEnvVar];
  if (!token) {
    const error = `${client.repo.tokenEnvVar} is not set on this server — could not sync to ${client.repo.url}.`;
    onLine(`--- ${error} ---`);
    return { pushed: false, branch: UPDATE_BRANCH, error };
  }

  // Always commit locally first. That is what gives the reviewer a real diff
  // to read, and it keeps the working tree clean for the next run whether or
  // not this change is ever approved.
  const committed = await commitLocally(project, `${platform}: ${title}`);
  if (!committed.ok) {
    onLine(`--- could not commit locally: ${committed.reason} ---`);
    await recordSyncResult(client.id, { ok: false, reason: committed.reason });
    return { pushed: false, branch: UPDATE_BRANCH, error: committed.reason };
  }
  if (!committed.commit) return { pushed: false, branch: UPDATE_BRANCH }; // Nothing changed.

  if (requiresReview(client.repo)) {
    const details = await showCommit(project, committed.commit);
    const review = await openReview(project, {
      clientId: client.id,
      runId,
      commit: committed.commit,
      prompt,
      title,
      platform,
      files: details?.files ?? [],
    });
    onLine(`--- committed locally and opened a review; nothing is pushed until someone approves it ---`);
    return { pushed: false, branch: UPDATE_BRANCH, awaitingReview: review.id };
  }

  const result = await pushApproved(project, token, committed.commit, "auto (review disabled for this client)");
  await recordSyncResult(client.id, result);

  if (!result.ok) {
    onLine(`--- could not sync to ${client.repo.url}: ${result.reason} ---`);
    return { pushed: false, branch: UPDATE_BRANCH, error: result.reason };
  }
  return { pushed: true, branch: UPDATE_BRANCH };
}

/**
 * Surfaced on an otherwise-passing lane whose exploration was cut short —
 * distinct wording for "ran out of steps" versus "the device stopped
 * responding", since only one of those points at the same failure recurring
 * on a re-run.
 */
function exhaustionDetail(exploration: ExploreResult): string | undefined {
  if (!exploration.exhausted) return undefined;
  if (exploration.exhaustedReason === "unresponsive") {
    return "Passed on what it managed to verify, but the device stopped responding partway through and exploration ended early - re-run to see if this repeats.";
  }
  return "Passed, but the agent hit its tool budget - review that the scenario was fully covered.";
}
