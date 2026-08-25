import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import { z } from "zod";
import type { ClientRecord } from "../knowledge/clients.js";
import { getClient, linkClientRepo, listClients, upsertClient } from "../knowledge/clients.js";
import { linkRepo } from "../knowledge/git.js";
import { ensureProject, projectFor } from "../knowledge/project.js";
import { ClientId } from "./shared.js";

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

const OnboardClient = z.object({
  id: ClientId,
  name: z.string().trim().min(1, "Give the client a name.").max(120),
  /** Optional: a client with no repo is a complete, runnable project that
   *  simply lives only under `clients/<id>/`. One can be linked later. */
  repo: LinkRepo.optional(),
});

/**
 * Point a client's project at a remote, and record the link.
 *
 * Shared by onboarding and by linking after the fact, because the two differ
 * only in *when* they happen. Returns the failure rather than throwing so
 * onboarding can keep a client that was created successfully even when the
 * repo half of the same request did not work.
 */
async function attachRepo(
  clientId: string,
  repo: z.infer<typeof LinkRepo>,
): Promise<{ ok: true; client: ClientRecord } | { ok: false; error: string; message: string }> {
  const token = process.env[repo.tokenEnvVar];
  if (!token) {
    return {
      ok: false,
      error: "missing_token",
      message: `${repo.tokenEnvVar} is not set on this server. Set it, then try linking again.`,
    };
  }

  // linkRepo only needs `.root` to exist. Scaffolding deliberately happens
  // *after* this: linking checks out the client's real default branch, and
  // untracked files we had written first would make git refuse the checkout.
  // Running second, `writeIfAbsent` also leaves the repo's own README,
  // package.json and config alone rather than competing with them.
  const project = projectFor(clientId);
  await fs.mkdir(project.root, { recursive: true });

  const result = await linkRepo(project, { url: repo.url, baseBranch: repo.baseBranch }, token);
  if (!result.ok) return { ok: false, error: "link_failed", message: result.reason };

  const client = await linkClientRepo(clientId, {
    url: repo.url,
    baseBranch: repo.baseBranch,
    tokenEnvVar: repo.tokenEnvVar,
  });
  return { ok: true, client };
}

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
    let client = await upsertClient(parsed.data.id, parsed.data.name);

    // A repo is optional in all three of its states: an existing repo with
    // history, a brand-new empty one, or none at all. What the client gets is
    // the same either way - a real project under `clients/<id>/` they can cd
    // into and run. The repo only decides whether it is also pushed anywhere.
    let repoError: string | undefined;
    if (parsed.data.repo) {
      const attached = await attachRepo(client.id, parsed.data.repo);
      if (attached.ok) client = attached.client;
      // Reported, not fatal: the client exists and is usable, and the repo can
      // be linked from its own form once whatever failed here is fixed.
      else repoError = attached.message;
    }

    await ensureProject(client.id);

    return reply.status(201).send({ client, repoError });
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

    const attached = await attachRepo(client.id, parsed.data);
    if (!attached.ok) {
      return reply.status(400).send({ error: attached.error, message: attached.message });
    }

    // Idempotent, and the one thing that guarantees a linked client always has
    // a project to push: a client onboarded before this route existed has a
    // registry row and nothing on disk.
    await ensureProject(client.id);

    return { client: attached.client };
  });
}
