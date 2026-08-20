import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { LanePlan } from "../lanes/capabilities.js";
import type { Platform } from "../types.js";

export interface VerifyResult {
  passed: boolean;
  /** Full captured output - fed back to the repair pass on failure. */
  output: string;
  specPath: string;
  reason?: string;
  /** Page source captured by the afterTest hook at the moment of failure. */
  domSnapshot?: string;
}

export interface VerifyArgs {
  runId: string;
  platform: Platform;
  plan: LanePlan;
  spec: string;
  onLine: (line: string) => void;
  signal: AbortSignal;
}

/**
 * Replay the generated spec in a fresh `wdio run`.
 *
 * This is the actual verification: a separate process, a cold session, no
 * memory of the exploratory run. If it goes green, the file handed to the user
 * is one they can commit and run in CI - which is the whole point of the
 * product. Exploration passing proves nothing about the artifact.
 */
export async function verify(args: VerifyArgs): Promise<VerifyResult> {
  const dir = laneDir(args.runId, args.platform);
  await fs.mkdir(path.join(dir, "test"), { recursive: true });

  const specPath = path.join(dir, "test", "generated.e2e.js");
  const confPath = path.join(dir, "wdio.conf.mjs");

  await fs.writeFile(specPath, args.spec, "utf8");
  await fs.writeFile(confPath, renderConfig(args.plan), "utf8");

  const cli = await resolveWdioCli();
  if (!cli) {
    return {
      passed: false,
      output: "",
      specPath,
      reason: "The WebdriverIO CLI is not installed. Run `npm install` at the repo root.",
    };
  }

  const output: string[] = [];
  const emit = (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const clean = stripAnsi(line).trimEnd();
      if (!clean) continue;
      output.push(clean);
      args.onLine(clean);
    }
  };

  return await new Promise<VerifyResult>((resolve) => {
    // Invoke the CLI's JS entry with this Node binary rather than the .bin
    // shim: since CVE-2024-27980, Node refuses to spawn a .cmd without a
    // shell, and turning the shell on to work around that would put
    // user-supplied paths through cmd.exe quoting. This sidesteps both.
    const child = spawn(process.execPath, [cli, "run", "./wdio.conf.mjs"], {
      cwd: dir,
      // Least privilege: the runner gets a PATH, a temp dir and the SDK vars it
      // needs - never ANTHROPIC_API_KEY.
      env: runnerEnv(),
      shell: false,
      windowsHide: true,
    });

    let settled = false;
    const finish = (result: VerifyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      args.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        passed: false,
        output: output.join("\n"),
        specPath,
        reason: `Replay exceeded the ${Math.round(config.VERIFY_TIMEOUT_MS / 1000)}s timeout and was killed.`,
      });
    }, config.VERIFY_TIMEOUT_MS);

    const onAbort = () => {
      child.kill("SIGKILL");
      finish({ passed: false, output: output.join("\n"), specPath, reason: "Run cancelled." });
    };
    args.signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", emit);
    child.stderr.on("data", emit);

    child.on("error", (err) => {
      finish({
        passed: false,
        output: output.join("\n"),
        specPath,
        reason: `Could not start the WebdriverIO runner (${err.message}). Run \`npm install\` in server/.`,
      });
    });

    child.on("close", (code) => {
      const passed = code === 0;
      void (passed ? Promise.resolve(undefined) : readDomSnapshot(dir)).then((domSnapshot) => {
        finish({
          passed,
          output: output.join("\n"),
          specPath,
          reason: passed ? undefined : `WebdriverIO exited with code ${code}.`,
          domSnapshot,
        });
      });
    });
  });
}

/** Relative to the lane dir - matches the afterTest hook in renderConfig. */
const FAILURE_DIR = "failure-artifacts";

/**
 * Best-effort read of the page source the afterTest hook wrote on failure.
 *
 * Absent whenever the hook itself couldn't run (crash before any test
 * started) - the repair pass just proceeds without a snapshot in that case.
 */
async function readDomSnapshot(dir: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(dir, FAILURE_DIR, "failure.html"), "utf8");
  } catch {
    return undefined;
  }
}

export function laneDir(runId: string, platform: Platform): string {
  return path.join(config.artifactDir, runId, platform);
}

/**
 * Find @wdio/cli's entry script by walking up node_modules from the server.
 *
 * `require.resolve` cannot be used: the package's `exports` map does not expose
 * ./package.json or ./bin, so resolution throws. npm workspaces also hoist the
 * package to the repo root rather than server/, so a fixed path is wrong too.
 */
let cachedCli: string | null | undefined;

async function resolveWdioCli(): Promise<string | null> {
  if (cachedCli !== undefined) return cachedCli;

  let dir = config.serverRoot;
  for (;;) {
    const candidate = path.join(dir, "node_modules", "@wdio", "cli", "bin", "wdio.js");
    try {
      await fs.access(candidate);
      cachedCli = candidate;
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  cachedCli = null;
  return null;
}

function renderConfig(plan: LanePlan): string {
  const { runner } = plan;
  // The web lane lets WebdriverIO manage chromedriver itself; mobile lanes must
  // be pointed at Appium or the farm hub explicitly.
  const endpoint =
    runner.port === 0
      ? ""
      : [
          `  hostname: ${JSON.stringify(runner.hostname)},`,
          `  port: ${runner.port},`,
          `  protocol: ${JSON.stringify(runner.protocol)},`,
          `  path: ${JSON.stringify(runner.path)},`,
          runner.user ? `  user: ${JSON.stringify(runner.user)},` : "",
          runner.key ? `  key: ${JSON.stringify(runner.key)},` : "",
        ]
          .filter(Boolean)
          .join("\n");

  const caps = JSON.stringify([runner.capabilities], null, 2)
    .split("\n")
    .join("\n  ");

  return `// Generated by wdio-ai-test-lab. Rewritten on every run - edit the spec, not this file.
import fs from 'node:fs/promises';
import path from 'node:path';

export const config = {
  runner: 'local',
  specs: ['./test/**/*.js'],
  maxInstances: 1,
  capabilities: ${caps},
${endpoint}
  logLevel: 'error',
  bail: 1,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  // Gives the repair pass real evidence instead of guessing from stdout alone.
  afterTest: async function (test, context, { passed }) {
    if (passed) return;
    const dir = path.join(process.cwd(), '${FAILURE_DIR}');
    await fs.mkdir(dir, { recursive: true });
    try {
      await browser.saveScreenshot(path.join(dir, 'failure.png'));
    } catch {}
    try {
      const html = await browser.getPageSource();
      await fs.writeFile(path.join(dir, 'failure.html'), html, 'utf8');
    } catch {}
  },
};
`;
}

function runnerEnv(): Record<string, string> {
  const keep = [
    "PATH",
    "Path",
    "SystemRoot",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramFiles",
    "ProgramData",
    "JAVA_HOME",
    "ANDROID_HOME",
    "ANDROID_SDK_ROOT",
  ];
  const env: Record<string, string> = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.NODE_ENV = "test";
  return env;
}

function stripAnsi(input: string): string {
  // Built from a string literal so a raw ESC byte never has to survive a file
  // write. Matches CSI sequences: ESC [ ... final letter.
  return input.replace(new RegExp("\\u001b\\[[0-9;]*[A-Za-z]", "g"), "");
}
