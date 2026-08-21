import { config } from "../config.js";
import { explore } from "../agent/explore.js";
import { repairSpec, synthesizeSpec } from "../agent/synthesize.js";
import { clearStaging, openKnowledge, recordSuccess, stagingWorkspace } from "../knowledge/session.js";
import { slugify } from "../knowledge/structure.js";
import { selectTools, toLlmTools } from "../mcp/bridge.js";
import { WdioMcp, errorMessage } from "../mcp/client.js";
import { verify } from "../runner/verify.js";
import { store } from "../store.js";
import type { Platform, RunState } from "../types.js";
import { planFor } from "./capabilities.js";
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
        emit({ type: "lane.saved", platform, report: saved });
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

    const tools = toLlmTools(selectTools(await mcp.listTools(), platform, config.llm.leanTools));

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

    emit({ type: "lane.phase", platform, phase: "explore" });
    const exploration = await explore({
      mcp,
      tools,
      prompt: run.prompt,
      platform,
      plan,
      budget: config.MAX_AGENT_STEPS,
      signal,
      secrets,
      emit: {
        text: (text) => emit({ type: "agent.text", platform, text }),
        toolStarted: (step) => emit({ type: "agent.tool", platform, step }),
        toolFinished: (id, ok, summary) => emit({ type: "agent.tool_result", platform, id, ok, summary }),
        screenshot: (shot) => emit({ type: "screenshot", platform, shot }),
      },
    });

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
    };
    let spec = await synthesizeSpec(synthArgs);
    emit({ type: "artifact", platform, kind: "spec", code: spec });

    emit({ type: "lane.phase", platform, phase: "verify" });

    const title = titleOf(spec) ?? run.prompt.slice(0, 60);
    const specName = knowledge.decision.spec?.file ?? `${slugify(title)}.${platform}.spec.js`;
    // Staged inside the client's project so imports of their page objects
    // resolve exactly as they will once the spec is accepted into the suite.
    const workspace = stagingWorkspace(knowledge.project, specName);

    let result = await verify({ runId, clientId: run.clientId, platform, plan, spec, onLine, signal, secrets, workspace });

    if (!result.passed && !signal.aborted) {
      onLine("--- replay failed; attempting one repair pass ---");
      spec = await repairSpec({ ...synthArgs, spec, failure: result.output });
      emit({ type: "artifact", platform, kind: "spec", code: spec });
      result = await verify({ runId, clientId: run.clientId, platform, plan, spec, onLine, signal, secrets, workspace });
    }

    // Staging is cleared either way: a spec that never passed has no business
    // being left behind in the client's repository.
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
      });
      emit({ type: "lane.saved", platform, report: saved });
    }

    emit({ type: "lane.phase", platform, phase: "done" });
    emit({
      type: "lane.status",
      platform,
      status: result.passed ? "passed" : "failed",
      detail: result.passed
        ? exploration.exhausted
          ? "Passed, but the agent hit its tool budget - review that the scenario was fully covered."
          : undefined
        : (result.reason ?? "The generated spec did not pass replay."),
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

function firstText(content: Array<{ type: string; [k: string]: unknown }>): string {
  const block = content.find((c) => c.type === "text");
  const text = typeof block?.text === "string" ? block.text : "";
  return text.trim() || "no detail returned";
}
