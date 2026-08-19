import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { availableModels } from "../agent/llm/index.js";
import { config } from "../config.js";
import { cancelRun, startRun } from "../orchestrator.js";
import { store } from "../store.js";
import { PLATFORMS, isPlatform, type RunEvent } from "../types.js";

const CreateRun = z
  .object({
    prompt: z.string().trim().min(10, "Describe the test case in a sentence or two.").max(4000),
    platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform."),
    headless: z.boolean().default(false),
    target: z
      .object({
        webUrl: z.string().trim().max(2048).optional(),
        androidApp: z.string().trim().max(1024).optional(),
        iosApp: z.string().trim().max(1024).optional(),
        iosDeviceName: z.string().trim().max(120).optional(),
        iosPlatformVersion: z.string().trim().max(20).optional(),
      })
      .default({}),
  })
  // Cheap guard so an obviously incomplete run never spins up an MCP process.
  .refine((v) => !v.platforms.includes("web") || !!v.target.webUrl, {
    message: "The web lane needs a URL under test.",
    path: ["target", "webUrl"],
  })
  .refine((v) => !v.platforms.includes("android") || !!v.target.androidApp, {
    message: "The Android lane needs a path to an .apk.",
    path: ["target", "androidApp"],
  })
  .refine((v) => !v.platforms.includes("ios") || !!v.target.iosApp, {
    message: "The iOS lane needs a cloud app id.",
    path: ["target", "iosApp"],
  });

export async function registerRunRoutes(app: FastifyInstance): Promise<void> {
  /** What the UI needs to render sensible defaults and disable what cannot work. */
  app.get("/api/capabilities", async () => ({
    platforms: PLATFORMS,
    cloudProvider: config.cloud?.provider ?? null,
    iosAvailable: config.cloud !== null,
    appiumUrl: config.APPIUM_URL,
    maxAgentSteps: config.MAX_AGENT_STEPS,
    host: process.platform,
    llm: {
      provider: config.llm.provider,
      model: config.llm.model,
      // Surfaced so a run that behaves oddly is traceable to its settings.
      sendsScreenshots: config.llm.sendScreenshots,
      leanTools: config.llm.leanTools,
    },
  }));

  /** Which models the configured key can actually reach. Empty for Anthropic. */
  app.get("/api/models", async () => ({ models: await availableModels() }));

  app.post("/api/runs", async (request, reply) => {
    const parsed = CreateRun.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const run = startRun(parsed.data);
    return reply.status(201).send({ id: run.id, run });
  });

  app.get("/api/runs", async () => ({
    runs: store.list().map((run) => ({
      id: run.id,
      prompt: run.prompt,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      platforms: run.order,
      statuses: Object.fromEntries(run.order.map((p) => [p, run.lanes[p]?.status ?? "queued"])),
    })),
  }));

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = store.get(request.params.id);
    if (!run) return reply.status(404).send({ error: "not_found" });
    return { run };
  });

  app.post<{ Params: { id: string } }>("/api/runs/:id/cancel", async (request, reply) => {
    const run = store.get(request.params.id);
    if (!run) return reply.status(404).send({ error: "not_found" });
    return { cancelled: cancelRun(request.params.id) };
  });

  /** Plain-text download of the generated spec, ready to drop into a repo. */
  app.get<{ Params: { id: string; platform: string } }>(
    "/api/runs/:id/:platform/spec",
    async (request, reply) => {
      const { id, platform } = request.params;
      if (!isPlatform(platform)) return reply.status(400).send({ error: "unknown_platform" });

      const lane = store.lane(id, platform);
      if (!lane?.specCode) return reply.status(404).send({ error: "no_spec_yet" });

      return reply
        .header("content-type", "text/plain; charset=utf-8")
        .header("content-disposition", `attachment; filename="${platform}.e2e.js"`)
        .send(lane.specCode);
    },
  );

  /**
   * SSE stream. Sends the current snapshot first, then the missed event log,
   * then live events - so a client that connects late, or reconnects, lands in
   * exactly the same state as one that was there from the start.
   */
  app.get<{ Params: { id: string } }>("/api/runs/:id/stream", async (request, reply) => {
    const run = store.get(request.params.id);
    if (!run) return reply.status(404).send({ error: "not_found" });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    const send = (event: RunEvent) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    send({ type: "run.snapshot", run });
    for (const event of store.history(run.id)) send(event);

    if (run.finishedAt) {
      reply.raw.end();
      return reply;
    }

    const unsubscribe = store.subscribe(run.id, (event) => {
      send(event);
      if (event.type === "run.done") {
        unsubscribe();
        reply.raw.end();
      }
    });

    // Proxies drop idle connections; a comment frame keeps it warm without
    // showing up as an event on the client.
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(": keepalive\n\n");
    }, 20_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on("close", cleanup);
    reply.raw.on("close", cleanup);

    return reply;
  });
}
