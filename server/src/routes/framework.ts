import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { displayPath, frameworks } from "../framework/store.js";
import { summarizeIndex } from "../framework/render.js";
import type { FrameworkIndex } from "../framework/types.js";
import { planFromPrompt } from "../planner/fromPrompt.js";
import { resolvePlan } from "../planner/resolve.js";
import { applyDiff, proposeDiff } from "../planner/write.js";
import { typecheckChange } from "../planner/typecheck.js";
import type { TestRequest } from "../planner/types.js";

const OpenBody = z.object({
  path: z.string().trim().min(1, "Give a path to the framework."),
});

const PlanBody = z.object({
  prompt: z.string().trim().min(8, "Describe the test case in a sentence."),
  platform: z.enum(["web", "mobile"]).default("web"),
});

const ApplyBody = z.object({ planId: z.string().uuid() });

/**
 * The framework-facing API: point at a project, see what it contains, plan a
 * test case against it, review the diff, apply it.
 *
 * Planning and applying are deliberately two calls. The diff the user approves
 * is the exact one that gets written — re-planning at apply time could produce
 * something different, which is the one behaviour that would make writing into
 * someone's repository untrustworthy.
 */
export async function registerFrameworkRoutes(app: FastifyInstance): Promise<void> {
  // Indexing FRAMEWORK_ROOT is started here but deliberately not awaited: the
  // port must open regardless. Awaiting it meant that anything slow or stuck in
  // detection took the whole server down with it, and because the first log line
  // comes after listen(), the symptom was a silent process with no port and no
  // error — the hardest possible thing to diagnose.
  const booting = frameworks.openDefault().catch(() => null);

  /** The open framework, once the startup index has had its chance to finish. */
  const ready = async () => {
    await booting;
    return frameworks.current;
  };

  app.get("/api/framework", async () => describe(await ready()));

  app.post("/api/framework/open", async (request, reply) => {
    const parsed = OpenBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid path." });
    }
    try {
      return describe(await frameworks.open(parsed.data.path));
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : "Could not open that path." });
    }
  });

  app.post("/api/framework/refresh", async (_request, reply) => {
    if (!(await ready())) return reply.status(409).send({ error: "No framework is open." });
    return describe(await frameworks.refresh());
  });

  /** Prose (or a structured request) -> a reviewed, unwritten diff. */
  app.post("/api/framework/plan", async (request, reply) => {
    const index = await ready();
    if (!index) return reply.status(409).send({ error: "Open a framework first." });

    const parsed = PlanBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    }

    try {
      const result = await planFromPrompt(index, parsed.data.prompt, parsed.data.platform);
      const diff = await proposeDiff(index, result.plan);
      return {
        planId: frameworks.rememberDiff(diff),
        mode: "prompt" as const,
        llmCalls: result.llmCalls,
        complete: result.plan.complete,
        title: result.plan.title,
        test: result.plan.test,
        reused: result.plan.reused,
        missing: result.missing,
        duplicateOf: result.duplicateOf ?? null,
        problems: result.plan.problems,
        data: result.plan.data ?? null,
        changes: diff.changes,
      };
    } catch (err) {
      return reply.status(502).send({ error: err instanceof Error ? err.message : "Planning failed." });
    }
  });

  /** Deterministic path: a structured request, resolved with no model at all. */
  app.post("/api/framework/plan/structured", async (request, reply) => {
    const index = await ready();
    if (!index) return reply.status(409).send({ error: "Open a framework first." });

    const plan = resolvePlan(index, request.body as TestRequest);
    const diff = await proposeDiff(index, plan);
    return {
      planId: frameworks.rememberDiff(diff),
      mode: "deterministic" as const,
      llmCalls: 0,
      complete: plan.complete,
      title: plan.title,
      test: plan.test,
      reused: plan.reused,
      missing: [],
      duplicateOf: null,
      problems: plan.problems,
      data: plan.data ?? null,
      changes: diff.changes,
    };
  });

  /**
   * Compile the proposed spec against the framework without keeping it.
   * The middle rung between reading the preview and running the test: no
   * browser needed, but it catches unresolved imports, missing methods and
   * wrong argument types.
   */
  app.post("/api/framework/verify", async (request, reply) => {
    const index = await ready();
    if (!index) return reply.status(409).send({ error: "Open a framework first." });

    const parsed = ApplyBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid planId." });

    const diff = frameworks.takeDiff(parsed.data.planId);
    if (!diff) return reply.status(404).send({ error: "That plan is no longer available. Re-run it." });

    const change = diff.changes[0];
    if (!change) return reply.status(409).send({ error: "This plan has no file to check." });

    try {
      return await typecheckChange(index, change);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Typecheck failed." });
    }
  });

  app.post("/api/framework/apply", async (request, reply) => {
    const parsed = ApplyBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid planId." });

    const diff = frameworks.takeDiff(parsed.data.planId);
    if (!diff) {
      return reply.status(404).send({ error: "That plan is no longer available. Re-run it and review again." });
    }
    if (diff.problems.length > 0) {
      return reply.status(409).send({ error: "This plan has unresolved references and cannot be applied." });
    }

    try {
      return { written: await applyDiff(diff) };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Write failed." });
    }
  });
}

/** The shape the UI renders: inventory, layout confidence, and warnings. */
function describe(index: FrameworkIndex | null) {
  if (!index) {
    return {
      open: false as const,
      suggestion: config.FRAMEWORK_ROOT ?? "./igs-wdio-framework-main",
      llm: { provider: config.llm.provider, model: config.llm.model },
    };
  }

  return {
    open: true as const,
    root: index.root,
    path: displayPath(index),
    summary: summarizeIndex(index),
    layout: {
      language: index.layout.language,
      testFramework: index.layout.testFramework,
      specsDir: index.layout.specsDir ?? null,
      pageObjectDirs: index.layout.pageObjectDirs,
      dataDirs: index.layout.dataDirs,
      baseClass: index.layout.baseClass ?? null,
      aliases: index.layout.aliases,
      confidence: index.layout.confidence,
    },
    pageObjects: index.pageObjects.map((p) => ({
      className: p.className,
      file: p.file,
      platform: p.platform,
      methods: p.methods.map((m) => ({ name: m.name, doc: m.doc ?? null, params: m.params.map((x) => x.name) })),
    })),
    helpers: index.helpers.map((h) => ({
      className: h.className,
      methods: h.methods.map((m) => m.name),
    })),
    data: index.data.map((d) => ({ name: d.name, format: d.format, records: d.recordCount, fields: d.fields })),
    specs: index.specs.map((s) => ({ file: s.file, suites: s.suites.map((x) => x.title) })),
    warnings: index.warnings,
    llm: { provider: config.llm.provider, model: config.llm.model },
  };
}
