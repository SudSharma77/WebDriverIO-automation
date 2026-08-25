import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { getClient, linkClientRepo, listClients, recordSyncResult, upsertClient } from "./clients.js";

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "testlab-registry-"));
}

describe("client registry", () => {
  it("registers a new client and finds it again", async () => {
    const dir = await tmpDir();
    await upsertClient("acme", "Acme Corp", dir);

    const client = await getClient("acme", dir);
    assert.ok(client);
    assert.equal(client!.name, "Acme Corp");
    assert.equal(client!.repo, undefined);
  });

  it("adopts an existing id rather than duplicating it, on a second onboarding", async () => {
    const dir = await tmpDir();
    await upsertClient("acme", "Acme Corp", dir);
    await upsertClient("acme", "Acme Corporation (renamed)", dir);

    const clients = await listClients(dir);
    assert.equal(clients.length, 1);
    assert.equal(clients[0]!.name, "Acme Corporation (renamed)");
  });

  it("links a repo onto an already-registered client", async () => {
    const dir = await tmpDir();
    await upsertClient("acme", "Acme Corp", dir);
    const updated = await linkClientRepo(
      "acme",
      { url: "https://github.com/acme/qa.git", baseBranch: "main", tokenEnvVar: "TESTLAB_REPO_TOKEN_ACME" },
      dir,
    );

    assert.equal(updated.repo?.url, "https://github.com/acme/qa.git");
    assert.ok(updated.repo!.linkedAt > 0);

    const reread = await getClient("acme", dir);
    assert.equal(reread!.repo?.baseBranch, "main");
  });

  it("refuses to link a repo onto a client id that was never onboarded", async () => {
    const dir = await tmpDir();
    await assert.rejects(
      linkClientRepo("ghost", { url: "https://example.com/x.git", baseBranch: "main", tokenEnvVar: "X" }, dir),
      /No client registered/,
    );
  });

  it("records a sync outcome, and clears a prior error on the next success", async () => {
    const dir = await tmpDir();
    await upsertClient("acme", "Acme Corp", dir);
    await linkClientRepo("acme", { url: "https://example.com/x.git", baseBranch: "main", tokenEnvVar: "X" }, dir);

    await recordSyncResult("acme", { ok: false, reason: "bad token" }, dir);
    let client = await getClient("acme", dir);
    assert.equal(client!.repo?.lastSyncError, "bad token");

    await recordSyncResult("acme", { ok: true }, dir);
    client = await getClient("acme", dir);
    assert.equal(client!.repo?.lastSyncError, undefined);
    assert.ok(client!.repo!.lastSyncedAt);
  });

  it("is a no-op when recording a sync for a client with no repo linked", async () => {
    const dir = await tmpDir();
    await upsertClient("acme", "Acme Corp", dir);
    await recordSyncResult("acme", { ok: true }, dir); // must not throw
    const client = await getClient("acme", dir);
    assert.equal(client!.repo, undefined);
  });

  it("starts empty when nothing has been registered yet", async () => {
    const dir = await tmpDir();
    assert.deepEqual(await listClients(dir), []);
  });
});
