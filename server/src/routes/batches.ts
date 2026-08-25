import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { batchStore } from "../batch.js";
import { store } from "../store.js";
import { PLATFORMS } from "../types.js";
import { ClientId, Secrets } from "./shared.js";

const CreateBatch = z
  .object({
    cases: z
      .array(
        z.object({
          prompt: z.string().trim().min(10, "Each test case needs a sentence or two.").max(4000),
          target: z
            .object({
              webUrl: z.string().trim().max(2048).optional(),
              androidApp: z.string().trim().max(1024).optional(),
              iosApp: z.string().trim().max(1024).optional(),
              iosDeviceName: z.string().trim().max(120).optional(),
              iosPlatformVersion: z.string().trim().max(20).optional(),
            })
            .default({}),
        }),
      )
      .min(1, "Upload at least one test case.")
      .max(50, "50 test cases per batch, to keep a bad upload from running unattended for hours."),
    platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform."),
    headless: z.boolean().default(false),
    stabilityRuns: z.coerce.number().int().min(0).max(5).default(0),
    clientId: ClientId,
    // One set of credentials for the whole batch, applied to every case — a
    // bulk upload tests one app across many scenarios, not many apps, so a
    // per-case login would just be the same values pasted 50 times.
    secrets: Secrets,
  })
  .refine((v) => !v.platforms.includes("web") || v.cases.every((c) => !!c.target.webUrl), {
    message: "Every case needs a URL when the web lane is selected.",
    path: ["cases"],
  })
  .refine((v) => !v.platforms.includes("android") || v.cases.every((c) => !!c.target.androidApp), {
    message: "The Android lane needs a path to an .apk on every case.",
    path: ["cases"],
  })
  .refine((v) => !v.platforms.includes("ios") || v.cases.every((c) => !!c.target.iosApp), {
    message: "The iOS lane needs a cloud app id on every case.",
    path: ["cases"],
  });

export async function registerBatchRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/batches", async (request, reply) => {
    const parsed = CreateBatch.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const batch = batchStore.create(parsed.data);
    return reply.status(201).send({ id: batch.id, batch });
  });

  app.get("/api/batches", async () => ({
    batches: batchStore.list().map((batch) => ({
      id: batch.id,
      createdAt: batch.createdAt,
      finishedAt: batch.finishedAt,
      platforms: batch.platforms,
      caseCount: batch.caseCount,
      completed: batch.runIds.filter((id) => store.get(id)?.finishedAt).length,
    })),
  }));

  app.get<{ Params: { id: string } }>("/api/batches/:id", async (request, reply) => {
    const batch = batchStore.get(request.params.id);
    if (!batch) return reply.status(404).send({ error: "not_found" });

    const runs = batch.runIds
      .map((id) => store.get(id))
      .filter((run): run is NonNullable<typeof run> => !!run)
      .map((run) => ({
        id: run.id,
        prompt: run.prompt,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        platforms: run.order,
        statuses: Object.fromEntries(run.order.map((p) => [p, run.lanes[p]?.status ?? "queued"])),
        // The plain-English cause for a failed lane (see summarizeFailure) -
        // what makes scanning a batch of results faster than opening each one.
        details: Object.fromEntries(run.order.map((p) => [p, run.lanes[p]?.detail])),
      }));

    return { batch, runs };
  });
}
