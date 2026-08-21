#!/usr/bin/env node
/**
 * Drive a run from the terminal.
 *
 * The browser UI has not been rewired to this pipeline yet, so this is the way
 * to exercise it end to end. It posts a run, follows the server's event stream,
 * and prints what the client's project gained — which is the part worth
 * watching, since it is what makes the next run cheaper.
 *
 *   node scripts/run.mjs --url https://the-internet.herokuapp.com/login \
 *     --prompt "Log in with valid credentials and confirm the secure area" \
 *     --secret USERNAME=tomsmith --secret PASSWORD=SuperSecretPassword!
 */

const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.prompt && !args.list)) {
  console.log(`
Usage: node scripts/run.mjs [options]

  --prompt "<test case>"    What to test, in plain English        (required)
  --url <url>               Web app under test                    (web lane)
  --apk <path>              Absolute path to a .apk               (android lane)
  --client <id>             Which client's project to grow        (default: default)
  --platform <p>            web | android | ios, repeatable       (default: web)
  --secret NAME=VALUE       Credential, repeatable. Never stored in the spec.
  --headed                  Watch the browser instead of running headless
  --server <origin>         Server origin                         (default: http://127.0.0.1:8787)
  --list                    Show this client's accumulated specs and exit

Examples:
  node scripts/run.mjs --url https://the-internet.herokuapp.com/login \\
    --prompt "Log in with valid credentials and confirm the secure area" \\
    --secret USERNAME=tomsmith --secret PASSWORD=SuperSecretPassword! \\
    --client demo --headed

  node scripts/run.mjs --client demo --list
`);
  process.exit(args.help ? 0 : 1);
}

const server = args.server ?? "http://127.0.0.1:8787";
const clientId = args.client ?? "default";

await assertServerUp(server);

if (args.list) {
  await listClient(clientId);
  process.exit(0);
}

const platforms = args.platform.length > 0 ? args.platform : ["web"];
const target = {};
if (args.url) target.webUrl = args.url;
if (args.apk) target.androidApp = args.apk;

const body = {
  prompt: args.prompt,
  platforms,
  target,
  clientId,
  secrets: args.secret,
  headless: !args.headed,
};

console.log(`\n  client    ${clientId}`);
console.log(`  platforms ${platforms.join(", ")}`);
console.log(`  target    ${args.url ?? args.apk ?? "(none)"}`);
if (Object.keys(args.secret).length) console.log(`  secrets   ${Object.keys(args.secret).join(", ")} (values never leave this machine in the spec)`);
console.log(`  prompt    ${args.prompt}\n`);

const created = await post(`${server}/api/runs`, body);
if (!created.ok) {
  const detail = created.body?.issues?.map((i) => `${i.path}: ${i.message}`).join("\n  ") ?? created.body?.error;
  console.error(`Rejected:\n  ${detail ?? JSON.stringify(created.body)}`);
  process.exit(1);
}

const runId = created.body.id;
console.log(`  run ${runId}\n`);

await follow(`${server}/api/runs/${runId}/stream`);

const final = await get(`${server}/api/runs/${runId}`);
report(final.body?.run);

/* ---------------------------------------------------------------- helpers */

function parseArgs(argv) {
  const out = { platform: [], secret: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);

    if (key === "headed" || key === "help" || key === "list") {
      out[key] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) continue;

    if (key === "platform") out.platform.push(value);
    else if (key === "secret") {
      const at = value.indexOf("=");
      if (at > 0) out.secret[value.slice(0, at)] = value.slice(at + 1);
    } else out[key] = value;
  }
  return out;
}

async function assertServerUp(origin) {
  try {
    const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) return;
  } catch {
    /* fall through to the message below */
  }
  console.error(`Cannot reach the server at ${origin}.\nStart it first:  npm run dev:server`);
  process.exit(1);
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, body: await res.json().catch(() => null) };
}

async function get(url) {
  const res = await fetch(url);
  return { ok: res.ok, body: await res.json().catch(() => null) };
}

/** Read the SSE stream and narrate it. */
async function follow(url) {
  const res = await fetch(url, { headers: { accept: "text/event-stream" } });
  if (!res.ok || !res.body) {
    console.error(`Could not open the event stream (${res.status}).`);
    process.exit(1);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });

    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      if (!frame.startsWith("data: ")) continue;

      try {
        narrate(JSON.parse(frame.slice(6)));
      } catch {
        /* a malformed frame is not worth aborting the run over */
      }
    }
  }
}

const PHASE_LABEL = {
  preflight: "checking the target is reachable",
  explore: "driving the real app",
  export: "collecting what happened",
  synthesize: "writing the spec",
  verify: "replaying it on a cold session",
  done: "done",
};

function narrate(event) {
  const where = event.platform ? `[${event.platform}] ` : "";
  switch (event.type) {
    case "lane.reuse":
      console.log(`${where}${event.mode.toUpperCase()} — ${event.reason}`);
      break;
    case "lane.phase":
      if (event.phase !== "done") console.log(`${where}${PHASE_LABEL[event.phase] ?? event.phase}…`);
      break;
    case "agent.tool":
      process.stdout.write(`${where}  · ${event.step.name}\n`);
      break;
    case "verify.log":
      if (/passing|failing|Error|✓|✖|---/.test(event.line)) console.log(`${where}  ${event.line}`);
      break;
    case "lane.saved":
      printSaved(where, event.report);
      break;
    case "lane.status":
      if (event.status === "passed") console.log(`${where}PASSED${event.detail ? ` — ${event.detail}` : ""}`);
      else if (event.status !== "running") console.log(`${where}${event.status.toUpperCase()}${event.detail ? ` — ${event.detail}` : ""}`);
      break;
    case "error":
      console.error(`${where}error: ${event.message}`);
      break;
    default:
      break;
  }
}

function printSaved(where, report) {
  console.log(`${where}saved to the client project:`);
  console.log(`${where}  spec      ${report.specFile}${report.reusedExistingSpec ? " (already had it)" : " (new)"}`);
  for (const page of report.pages) {
    const bits = [];
    if (page.addedMethods.length) bits.push(`+${page.addedMethods.length} methods`);
    if (page.changedLocators.length) bits.push(`${page.changedLocators.length} moved`);
    console.log(`${where}  page      ${page.className} ${page.created ? "created" : "reused"}${bits.length ? ` (${bits.join(", ")})` : ""}`);
    for (const change of page.changedLocators) {
      console.log(`${where}            MOVED ${change.property}: ${change.from} -> ${change.to}`);
    }
  }
  if (report.locatorsAdded.length) console.log(`${where}  locators  learned ${report.locatorsAdded.length}`);
}

function report(run) {
  if (!run) return;
  console.log("\n" + "-".repeat(60));
  for (const platform of run.order) {
    const lane = run.lanes[platform];
    if (!lane) continue;
    const seconds = lane.finishedAt && lane.startedAt ? ((lane.finishedAt - lane.startedAt) / 1000).toFixed(1) : "?";
    console.log(`${platform.padEnd(8)} ${lane.status.toUpperCase().padEnd(8)} ${seconds}s   ${lane.reuse?.mode ?? ""}`);
    if (lane.detail) console.log(`         ${lane.detail}`);
  }
  console.log(`\nThe client's suite is under clients/${run.clientId}/`);
  console.log(`Run it yourself:  cd clients/${run.clientId} && npx wdio run wdio.web.config.mjs`);
}

async function listClient(id) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(process.cwd(), "clients", id);

  try {
    const index = JSON.parse(await fs.readFile(path.join(root, ".testlab", "specs.json"), "utf8"));
    const catalog = JSON.parse(await fs.readFile(path.join(root, ".testlab", "catalog.json"), "utf8"));

    console.log(`\n${id} — ${index.specs.length} spec(s), ${catalog.entries.length} known element(s)\n`);
    for (const spec of index.specs) {
      console.log(`  ${spec.file}`);
      console.log(`     "${spec.prompt}"`);
      console.log(`     ${spec.platform} · ${spec.target} · passed ${spec.passCount}x`);
      if (spec.requiresSecrets.length) console.log(`     needs: ${spec.requiresSecrets.join(", ")}`);
    }
    if (catalog.entries.length) {
      console.log(`\n  known elements:`);
      for (const entry of catalog.entries) {
        const moved = entry.history.length ? `  (moved ${entry.history.length}x)` : "";
        console.log(`     ${entry.label.padEnd(30)} ${entry.selector}${moved}`);
      }
    }
  } catch {
    console.log(`\nNothing stored for "${id}" yet — run a test first.`);
  }
}
