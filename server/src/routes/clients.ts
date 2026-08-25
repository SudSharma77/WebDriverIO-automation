import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import { z } from "zod";
import { getClient, linkClientRepo, listClients, upsertClient } from "../knowledge/clients.js";
import { linkRepo } from "../knowledge/git.js";
import { projectFor } from "../knowledge/project.js";
import { ClientId } from "./shared.js";

const OnboardClient = z.object({
  id: ClientId,
  name: z.string().trim().min(1, "Give the client a name.").max(120),
});

const LinkRepo = z.object({
  url: z.string().trim().min(1, "A repo URL is required.").max(2048),
  baseBranch: z.string().trim().min(1).max(200).default("main"),
  // Not the token - the name of the env var on this server that holds it. See
  // knowledge/clients.ts for why the token itself is never accepted here.
  tokenEnvVar: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/, "Must be an env var name: A–Z, 0–9 and _, starting with a letter.")
    .default("TESTLAB_REPO_TOKEN"),
});

export async function registerClientRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/clients", async () => ({ clients: await listClients() }));

  app.post("/api/clients", async (request, reply) => {
    const parsed = OnboardClient.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const client = await upsertClient(parsed.data.id, parsed.data.name);
    return reply.status(201).send({ client });
  });

  app.get<{ Params: { id: string } }>("/api/clients/:id", async (request, reply) => {
    const client = await getClient(request.params.id);
    if (!client) return reply.status(404).send({ error: "not_found" });
    return { client };
  });

  // Validates the URL and token actually work (a real `git ls-remote`, via
  // linkRepo) before saving the link - a typo is much cheaper to catch here
  // than on the first real save's silent, best-effort sync failure.
  app.post<{ Params: { id: string } }>("/api/clients/:id/repo", async (request, reply) => {
    const parsed = LinkRepo.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }

    const client = await getClient(request.params.id);
    if (!client) return reply.status(404).send({ error: "not_found" });

    const token = process.env[parsed.data.tokenEnvVar];
    if (!token) {
      return reply.status(400).send({
        error: "missing_token",
        message: `${parsed.data.tokenEnvVar} is not set on this server. Set it, then try linking again.`,
      });
    }

    // linkRepo only needs `.root` to exist - the rest of the project layout
    // (specs/pages/selectors dirs) is scaffolded by ensureProject on first
    // actual run, not here; onboarding a client and running a test for them
    // are separate steps.
    const project = projectFor(client.id);
    await fs.mkdir(project.root, { recursive: true });

    const result = await linkRepo(project, { url: parsed.data.url, baseBranch: parsed.data.baseBranch }, token);
    if (!result.ok) {
      return reply.status(400).send({ error: "link_failed", message: result.reason });
    }

    const updated = await linkClientRepo(client.id, {
      url: parsed.data.url,
      baseBranch: parsed.data.baseBranch,
      tokenEnvVar: parsed.data.tokenEnvVar,
    });
    return { client: updated };
  });
}
