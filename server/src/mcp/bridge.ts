import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type { LlmToolDef } from "../agent/llm/types.js";
import type { McpContent, McpToolResult } from "./client.js";
import type { Platform } from "../types.js";

/**
 * Tools that only make sense on one kind of session. Handing the web lane
 * `swipe` (or the Android lane `get_cookies`) invites the agent to burn a turn
 * discovering it does not apply, and bloats the cached prompt prefix.
 */
const MOBILE_ONLY = new Set([
  "tap_element",
  "swipe",
  "drag_and_drop",
  "get_contexts",
  "switch_context",
  "rotate_device",
  "hide_keyboard",
  "get_app_state",
]);

const BROWSER_ONLY = new Set([
  "navigate",
  "get_tabs",
  "switch_tab",
  "switch_frame",
  "scroll",
  "get_accessibility_tree",
  "get_cookies",
  "set_cookie",
  "delete_cookies",
  "emulate_device",
  "launch_chrome",
  "open_web_extension",
]);

/** Session lifecycle is driven by the lane, not the model. */
const RESERVED = new Set(["start_session", "close_session", "attach_session", "upload_app", "list_apps"]);

/**
 * Tools that are useful but not load-bearing. Dropped in lean mode, where the
 * tool schemas themselves are a meaningful share of every request's tokens —
 * on a free tier that matters more than the extra capability.
 */
const OPTIONAL = new Set([
  "set_cookie",
  "get_cookies",
  "delete_cookies",
  "emulate_device",
  "open_web_extension",
  "set_geolocation",
  "rotate_device",
  "drag_and_drop",
  "get_app_state",
  "switch_frame",
  "switch_tab",
  "get_tabs",
]);

export function selectTools(tools: McpTool[], platform: Platform, lean = false): McpTool[] {
  const isMobile = platform === "android" || platform === "ios";
  return tools
    .filter((t) => !RESERVED.has(t.name))
    .filter((t) => (isMobile ? !BROWSER_ONLY.has(t.name) : !MOBILE_ONLY.has(t.name)))
    .filter((t) => !lean || !OPTIONAL.has(t.name))
    // Deterministic order keeps the cached prompt prefix byte-stable across runs.
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function toLlmTools(tools: McpTool[]): LlmToolDef[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    schema: normalizeSchema(tool.inputSchema),
  }));
}

/**
 * MCP advertises JSON Schema; both provider APIs want an object schema with a
 * `properties` map. Servers occasionally omit `properties` on no-arg tools,
 * which is rejected — fill it in rather than letting the request 400.
 *
 * Boolean properties are widened to accept a string too: some models (seen
 * on Groq's qwen3.6-27b) emit "true"/"false" as a JSON string instead of a
 * real boolean, and providers validate tool-call arguments against this exact
 * schema server-side — a strict `type: "boolean"` makes them reject the whole
 * turn with a 400 before the agent ever sees a chance to self-correct. See
 * coerceToolInput(), called right before the value reaches the real tool.
 */
function normalizeSchema(schema: McpTool["inputSchema"]): Record<string, unknown> {
  const raw = (schema ?? {}) as Record<string, unknown>;
  const properties = { ...((raw.properties as Record<string, unknown>) ?? {}) };

  for (const [key, prop] of Object.entries(properties)) {
    if (prop && typeof prop === "object" && (prop as { type?: unknown }).type === "boolean") {
      properties[key] = { ...(prop as Record<string, unknown>), type: ["boolean", "string"] };
    }
  }

  return { ...raw, type: "object", properties };
}

/**
 * Undo the schema-widening above: a "true"/"false" string arriving from the
 * model is coerced back to a real boolean before it reaches the MCP tool,
 * which still expects the type its own schema originally declared.
 */
export function coerceToolInput(tool: McpTool, input: Record<string, unknown>): Record<string, unknown> {
  const properties = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
  const out = { ...input };

  for (const [key, prop] of Object.entries(properties)) {
    if (
      prop &&
      typeof prop === "object" &&
      (prop as { type?: unknown }).type === "boolean" &&
      typeof out[key] === "string"
    ) {
      const value = (out[key] as string).trim().toLowerCase();
      if (value === "true") out[key] = true;
      else if (value === "false") out[key] = false;
    }
  }

  return out;
}

export interface ConvertedResult {
  /** Flattened text of the result, capped. */
  text: string;
  /** Base64 data URLs pulled out for the UI and, optionally, the model. */
  images: string[];
  /** One-line digest for the run log. */
  summary: string;
}

const MAX_TEXT_CHARS = 20_000;

export function convertToolResult(result: McpToolResult, maxChars = MAX_TEXT_CHARS): ConvertedResult {
  const images: string[] = [];
  const texts: string[] = [];

  for (const item of result.content) {
    if (isText(item)) {
      texts.push(item.text);
    } else if (isImage(item)) {
      images.push(`data:${normalizeMediaType(item.mimeType)};base64,${item.data}`);
    }
  }

  const joined = texts.join("\n").trim();
  const text =
    joined.length > maxChars ? `${joined.slice(0, maxChars)}\n...[truncated]` : joined;

  const summary = joined
    ? firstLine(joined)
    : images.length > 0
      ? `${images.length} screenshot${images.length > 1 ? "s" : ""}`
      : result.isError
        ? "error with no detail"
        : "OK";

  return { text, images, summary };
}

function isText(item: McpContent): item is { type: "text"; text: string } {
  return item.type === "text" && typeof (item as { text?: unknown }).text === "string";
}

function isImage(item: McpContent): item is { type: "image"; data: string; mimeType: string } {
  return item.type === "image" && typeof (item as { data?: unknown }).data === "string";
}

function normalizeMediaType(mime: string | undefined): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  switch (mime) {
    case "image/jpeg":
    case "image/jpg":
      return "image/jpeg";
    case "image/webp":
      return "image/webp";
    case "image/gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
