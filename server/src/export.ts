import { ZipFile } from "yazl";
import { planFor } from "./lanes/capabilities.js";
import type { LaneState, Platform, RunTarget } from "./types.js";

/**
 * Package a generated spec as a droppable-into-a-repo project: its own
 * wdio.conf.js, package.json, and a README - not just the bare spec file the
 * plain download gives you. The capabilities/runner block is rebuilt from the
 * same planFor() the verify phase used, so what you get is the config that
 * actually proved the spec passes, not a generic template.
 */
export async function buildProjectZip(args: {
  lane: LaneState;
  platform: Platform;
  target: RunTarget;
  headless: boolean;
}): Promise<Buffer> {
  const { lane, platform, target, headless } = args;
  if (!lane.specCode) throw new Error("No spec generated yet for this lane.");

  const plan = planFor(platform, target, headless);
  const zip = new ZipFile();

  zip.addBuffer(Buffer.from(lane.specCode, "utf8"), `test/${platform}.e2e.js`);
  zip.addBuffer(Buffer.from(renderWdioConfig(plan.runner), "utf8"), "wdio.conf.js");
  zip.addBuffer(Buffer.from(renderPackageJson(platform), "utf8"), "package.json");
  zip.addBuffer(Buffer.from(renderReadme(platform), "utf8"), "README.md");
  zip.end();

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("end", () => resolve());
    zip.outputStream.on("error", reject);
  });
  return Buffer.concat(chunks);
}

function renderWdioConfig(runner: {
  hostname: string;
  port: number;
  protocol: "http" | "https";
  path: string;
  user?: string;
  key?: string;
  capabilities: Record<string, unknown>;
}): string {
  const endpoint =
    runner.port === 0
      ? ""
      : [
          `  hostname: ${JSON.stringify(runner.hostname)},`,
          `  port: ${runner.port},`,
          `  protocol: ${JSON.stringify(runner.protocol)},`,
          `  path: ${JSON.stringify(runner.path)},`,
          runner.user ? `  user: process.env.CLOUD_USERNAME,` : "",
          runner.key ? `  key: process.env.CLOUD_ACCESS_KEY,` : "",
        ]
          .filter(Boolean)
          .join("\n");

  const caps = JSON.stringify([runner.capabilities], null, 2)
    .split("\n")
    .join("\n  ");

  return `// Exported from wdio-ai-test-lab. Fill in a cloud provider's credentials via
// env vars if this lane used one - see the commented user/key lines below.
export const config = {
  runner: 'local',
  specs: ['./test/**/*.js'],
  maxInstances: 1,
  capabilities: ${caps},
${endpoint}
  logLevel: 'warn',
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
};
`;
}

function renderPackageJson(platform: Platform): string {
  return (
    JSON.stringify(
      {
        name: `${platform}-spec-export`,
        private: true,
        type: "module",
        scripts: { test: "wdio run ./wdio.conf.js" },
        devDependencies: {
          "@wdio/cli": "^9.30.1",
          "@wdio/local-runner": "^9.30.1",
          "@wdio/mocha-framework": "^9.30.1",
          "@wdio/spec-reporter": "^9.30.1",
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function renderReadme(platform: Platform): string {
  return `# ${platform} spec, exported from wdio-ai-test-lab

Generated from a live exploration, verified against a cold \`wdio run\` before export.

## Run it

\`\`\`bash
npm install
npm test
\`\`\`

If this lane used a cloud device farm, set \`CLOUD_USERNAME\` and \`CLOUD_ACCESS_KEY\`
before running - see the commented lines in \`wdio.conf.js\`.
`;
}
