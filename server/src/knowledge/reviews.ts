import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Platform } from "../types.js";
import type { ClientProject, ProjectPaths } from "./project.js";

/**
 * The human gate between a passing run and a client's repository.
 *
 * A run that passes is evidence the spec works. It is not evidence that the
 * spec is one this team wants, named the way they name things, asserting what
 * they meant to assert. Pushing automatically on green treats those as the
 * same question. So every save commits locally and opens a review; a person
 * reads the diff and decides; only approval pushes.
 *
 * Reviews live inside the client's own project, alongside the catalog and the
 * spec index, because they are part of that project's history — who approved
 * what, and when — rather than cross-client tool state.
 */

export type ReviewStatus = "pending" | "approved" | "rejected" | "pushed";

export interface ReviewRequest {
  id: string;
  clientId: string;
  runId: string;
  /** The local commit this review covers. */
  commit: string;
  prompt: string;
  title: string;
  platform: Platform;
  files: Array<{ path: string; status: string }>;
  status: ReviewStatus;
  createdAt: number;
  /** Who decided, in their own words — this is not an authenticated identity. */
  reviewer?: string;
  note?: string;
  decidedAt?: number;
  /** Why a push or a revert did not work, if it did not. */
  error?: string;
}

function reviewsDir(project: ProjectPaths): string {
  return path.join(project.metaDir, "reviews");
}

export async function openReview(
  project: ClientProject,
  fields: Omit<ReviewRequest, "id" | "status" | "createdAt">,
): Promise<ReviewRequest> {
  const review: ReviewRequest = { ...fields, id: randomUUID(), status: "pending", createdAt: Date.now() };
  await write(project, review);
  return review;
}

export async function listReviews(project: ProjectPaths): Promise<ReviewRequest[]> {
  const dir = reviewsDir(project);
  const names = await fs.readdir(dir).catch(() => [] as string[]);

  const reviews: ReviewRequest[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const review = await read(project, name.replace(/\.json$/, ""));
    if (review) reviews.push(review);
  }

  // Newest first: the queue is worked from the top.
  return reviews.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getReview(project: ProjectPaths, id: string): Promise<ReviewRequest | null> {
  return read(project, id);
}

export async function updateReview(
  project: ProjectPaths,
  id: string,
  changes: Partial<ReviewRequest>,
): Promise<ReviewRequest | null> {
  const review = await read(project, id);
  if (!review) return null;

  const updated = { ...review, ...changes };
  await write(project, updated);
  return updated;
}

async function write(project: ProjectPaths, review: ReviewRequest): Promise<void> {
  const dir = reviewsDir(project);
  await fs.mkdir(dir, { recursive: true });

  // Temp-and-rename, like every other metadata write here: a torn review file
  // would leave a change with no record of whether anyone approved it.
  const target = path.join(dir, `${review.id}.json`);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  await fs.rename(temp, target);
}

async function read(project: ProjectPaths, id: string): Promise<ReviewRequest | null> {
  // The id reaches this from an HTTP route, so it must never be able to walk
  // out of the reviews directory.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  try {
    return JSON.parse(await fs.readFile(path.join(reviewsDir(project), `${id}.json`), "utf8")) as ReviewRequest;
  } catch {
    return null;
  }
}
