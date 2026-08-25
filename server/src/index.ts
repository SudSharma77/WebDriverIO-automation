import cors from "@fastify/cors";
import Fastify from "fastify";
import fs from "node:fs/promises";
import { batchStore } from "./batch.js";
import { config } from "./config.js";
import { cancelAll } from "./orchestrator.js";
import { registerBatchRoutes } from "./routes/batches.js";
import { registerClientRoutes } from "./routes/clients.js";
import { registerReviewRoutes } from "./routes/reviews.js";
import { registerFrameworkRoutes } from "./routes/framework.js";
import { registerRunRoutes } from "./routes/runs.js";
import { store } from "./store.js";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  // Screenshots come back as base64 inside SSE, not request bodies; keep the
  // inbound limit small.
  bodyLimit: 1_000_000,
});

await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? true,
  methods: ["GET", "POST"],
});

app.get("/health", async () => ({ ok: true }));

// Logged before any registration work so that a process which never reaches
// listen() still says something. A server that prints nothing at all is
// indistinguishable from one that failed to start.
app.log.info(`starting on port ${config.PORT} (cwd ${process.cwd()})`);

await registerFrameworkRoutes(app);
await registerRunRoutes(app);
await registerBatchRoutes(app);
await registerClientRoutes(app);
await registerReviewRoutes(app);

await fs.mkdir(config.artifactDir, { recursive: true });
await store.hydrate();
await batchStore.hydrate();

try {
  await app.listen({ port: config.PORT, host: "127.0.0.1" });
  app.log.info(`artifacts -> ${config.artifactDir}`);
  if (!config.cloud) {
    app.log.warn("No cloud device farm configured - the iOS lane will be skipped with an explanation.");
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Abort in-flight lanes so no emulator session or cloud device is left held.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received - cancelling in-flight runs`);
    cancelAll();
    void app.close().then(() => process.exit(0));
  });
}
