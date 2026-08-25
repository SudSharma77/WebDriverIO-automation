import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getClient, recordSyncResult, requiresReview } from "../knowledge/clients.js";
import { pushApproved, revertCommit, showCommit, UPDATE_BRANCH } from "../knowledge/git.js";
import { ensureProject, projectFor } from "../knowledge/project.js";
import { getReview, listReviews, updateReview } from "../knowledge/reviews.js";
import { ClientId } from "./shared.js";

/**
 * The review queue: what is waiting to reach a client's repo, and the two
 * decisions a person can make about it.
 *
 * Approving pushes; rejecting removes the change from the project entirely.
 * Neither is undoable from here, which is why both take an explicit reviewer
 * name — this is the record of who decided, and it is the only such record.
 */

const Decision = z.object({
  reviewer: z.string().trim().min(1, "Say who is approving this.").max(120),
  note: z.string().trim().max(2000).optional(),
});

export async function registerReviewRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/clients/:id/reviews", async (request, reply) => {
    const parsed = ClientId.safeParse(request.params.id);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_client" });

    return { reviews: await listReviews(projectFor(parsed.data)) };
  });

  // The diff is fetched separately from the list: a queue of twenty changes
  // should not carry twenty full diffs to the browser.
  app.get<{ Params: { id: string; reviewId: string } }>(
    "/api/clients/:id/reviews/:reviewId",
    async (request, reply) => {
      const parsed = ClientId.safeParse(request.params.id);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_client" });

      const project = projectFor(parsed.data);
      const review = await getReview(project, request.params.reviewId);
      if (!review) return reply.status(404).send({ error: "not_found" });

      const details = await showCommit(project, review.commit);
      return { review, diff: details?.diff ?? null };
    },
  );

  app.post<{ Params: { id: string; reviewId: string } }>(
    "/api/clients/:id/reviews/:reviewId/approve",
    async (request, reply) => {
      const decision = Decision.safeParse(request.body);
      if (!decision.success) {
        return reply.status(400).send({
          error: "invalid_request",
          issues: decision.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }

      const client = await getClient(request.params.id);
      if (!client?.repo) return reply.status(404).send({ error: "no_linked_repo" });

      const project = await ensureProject(client.id);
      const review = await getReview(project, request.params.reviewId);
      if (!review) return reply.status(404).send({ error: "not_found" });
      if (review.status !== "pending") {
        return reply.status(409).send({ error: "already_decided", status: review.status });
      }

      const token = process.env[client.repo.tokenEnvVar];
      if (!token) {
        return reply.status(400).send({
          error: "missing_token",
          message: `${client.repo.tokenEnvVar} is not set on this server, so nothing can be pushed.`,
        });
      }

      const pushed = await pushApproved(project, token, review.commit, decision.data.reviewer);
      await recordSyncResult(client.id, pushed);

      // Recorded as approved either way: the person did approve it. A push
      // that failed is a separate, retryable problem, and losing the approval
      // would mean asking them to make the same decision twice.
      const updated = await updateReview(project, review.id, {
        status: pushed.ok ? "pushed" : "approved",
        reviewer: decision.data.reviewer,
        ...(decision.data.note ? { note: decision.data.note } : {}),
        decidedAt: Date.now(),
        ...(pushed.ok ? { error: undefined } : { error: pushed.reason }),
      });

      if (!pushed.ok) {
        return reply.status(502).send({ error: "push_failed", message: pushed.reason, review: updated });
      }
      return { review: updated, branch: UPDATE_BRANCH };
    },
  );

  app.post<{ Params: { id: string; reviewId: string } }>(
    "/api/clients/:id/reviews/:reviewId/reject",
    async (request, reply) => {
      const decision = Decision.safeParse(request.body);
      if (!decision.success) {
        return reply.status(400).send({
          error: "invalid_request",
          issues: decision.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }

      const parsed = ClientId.safeParse(request.params.id);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_client" });

      const project = await ensureProject(parsed.data);
      const review = await getReview(project, request.params.reviewId);
      if (!review) return reply.status(404).send({ error: "not_found" });
      if (review.status !== "pending") {
        return reply.status(409).send({ error: "already_decided", status: review.status });
      }

      // The change leaves the project, not just the push queue — see
      // revertCommit for why keeping it locally would be worse than losing it.
      const reverted = await revertCommit(project, review.commit);

      const updated = await updateReview(project, review.id, {
        status: "rejected",
        reviewer: decision.data.reviewer,
        ...(decision.data.note ? { note: decision.data.note } : {}),
        decidedAt: Date.now(),
        ...(reverted.ok ? {} : { error: reverted.reason }),
      });

      if (!reverted.ok) {
        return reply.status(500).send({ error: "revert_failed", message: reverted.reason, review: updated });
      }
      return { review: updated };
    },
  );

  // Whether this client's changes are gated at all — the dashboard needs it to
  // know if a "reviews" tab is meaningful.
  app.get<{ Params: { id: string } }>("/api/clients/:id/review-policy", async (request, reply) => {
    const client = await getClient(request.params.id);
    if (!client) return reply.status(404).send({ error: "not_found" });
    return { linked: Boolean(client.repo), requiresReview: client.repo ? requiresReview(client.repo) : false };
  });
}
