import { z } from "zod";

/**
 * Validators shared by every route that starts a run — a single case (POST
 * /api/runs) or many (POST /api/batches). Kept in one place so a batch case
 * can't silently accept a shape a single run would reject.
 */

/** Secret names are constrained to env-var shape because that is literally what
 *  they become in the runner's environment, and the value cap keeps a pasted
 *  certificate or token dump from ending up held in memory for the run. */
export const SecretName = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/, "Secret names must be A–Z, 0–9 and _, starting with a letter.");

export const Secrets = z.record(SecretName, z.string().max(4096)).default({});

/** Path segment on disk, so anything that could climb out of the artifact tree
 *  is rejected outright rather than sanitised. */
export const ClientId = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "Client id must be lowercase letters, digits and hyphens.")
  .default("default");
