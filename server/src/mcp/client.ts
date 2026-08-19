import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config.js";

/** Content blocks @wdio/mcp returns from a tool call. */
export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: string; [k: string]: unknown };

export interface McpToolResult {
  content: McpContent[];
  isError: boolean;
}

/**
 * One @wdio/mcp process.
 *
 * The MCP server holds at most one live WebDriver session, so a lane that wants
 * its own device gets its own process. Three platforms in parallel = three
 * processes; they do not share state and cannot stomp on each other's session.
 */
export class WdioMcp {
  #client: Client;
  #transport: StdioClientTransport;
  #closed = false;

  private constructor(client: Client, transport: StdioClientTransport) {
    this.#client = client;
    this.#transport = transport;
  }

  static async launch(label: string): Promise<WdioMcp> {
    // `npx` is a shell shim on Windows; spawning the bare name fails with ENOENT.
    const command = process.platform === "win32" ? "npx.cmd" : "npx";

    const transport = new StdioClientTransport({
      command,
      args: ["-y", "@wdio/mcp@latest"],
      // Least privilege: forward only what the toolchain needs. Notably this
      // keeps ANTHROPIC_API_KEY out of the child's environment.
      env: pickEnv([
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
        "BROWSERSTACK_USERNAME",
        "BROWSERSTACK_ACCESS_KEY",
        "SAUCE_USERNAME",
        "SAUCE_ACCESS_KEY",
      ]),
      stderr: "pipe",
    });

    const client = new Client({ name: `wdio-ai-test-lab/${label}`, version: "0.1.0" });
    await client.connect(transport);
    return new WdioMcp(client, transport);
  }

  async listTools(): Promise<McpTool[]> {
    const { tools } = await this.#client.listTools();
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    try {
      const result = await this.#client.callTool({ name, arguments: args });
      return {
        content: (result.content ?? []) as McpContent[],
        isError: result.isError === true,
      };
    } catch (err) {
      // A transport/protocol failure is still a tool outcome from the agent's
      // point of view — surface it as an error result so the loop can react
      // instead of tearing the whole lane down.
      return {
        content: [{ type: "text", text: `Tool call failed: ${errorMessage(err)}` }],
        isError: true,
      };
    }
  }

  /** Read an MCP resource, e.g. `wdio://session/current/code`. */
  async readResourceText(uri: string): Promise<string | null> {
    try {
      const result = await this.#client.readResource({ uri });
      // `contents` is a union of text and blob entries; only text is useful here.
      const text = result.contents
        .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
        .filter(Boolean)
        .join("\n");
      return text.trim() || null;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    // Best-effort: release the device even if the agent left a session open.
    try {
      await this.#client.callTool({ name: "close_session", arguments: {} });
    } catch {
      /* no session, or already gone */
    }
    try {
      await this.#client.close();
    } catch {
      /* already disconnected */
    }
    try {
      await this.#transport.close();
    } catch {
      /* already disconnected */
    }
  }
}

function pickEnv(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  // The MCP server reads farm credentials from its own env; mirror whichever
  // provider is configured so `start_session({provider})` can authenticate.
  if (config.cloud?.provider === "browserstack") {
    out.BROWSERSTACK_USERNAME = config.cloud.user;
    out.BROWSERSTACK_ACCESS_KEY = config.cloud.key;
  }
  if (config.cloud?.provider === "saucelabs") {
    out.SAUCE_USERNAME = config.cloud.user;
    out.SAUCE_ACCESS_KEY = config.cloud.key;
  }
  return out;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
