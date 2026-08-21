import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

// Repo root first (the shared .env), then server-local overrides.
loadDotenv({ path: path.join(repoRoot, ".env"), quiet: true });
loadDotenv({ path: path.join(repoRoot, "server", ".env"), quiet: true, override: true });

const Env = z.object({
  LLM_PROVIDER: z.enum(["anthropic", "groq", "openai", "ollama", "custom"]).default("anthropic"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  /** Tried once, automatically, if LLM_MODEL gets rate-limited during synthesis/repair. */
  LLM_FALLBACK_MODEL: z.string().optional(),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_SUPPORTS_VISION: z.enum(["auto", "true", "false"]).default("auto"),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(4),

  /**
   * Reserved output tokens per request. Providers bill TPM against
   * `prompt + max_output`, not actual output, so an oversized reservation
   * fails a request that would otherwise fit comfortably. An explore turn only
   * has to emit one tool call; synthesis has to emit a whole spec file.
   */
  EXPLORE_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(1_024),
  SYNTH_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(512).max(32_000).default(4_096),
  PLANNER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(512).max(32_000).default(2_048),
  /** Token ceiling for the framework inventory sent with every planning call. */
  PLANNER_INDEX_BUDGET: z.coerce.number().int().min(400).max(20_000).default(1_800),

  /** Where the framework being worked on lives. */
  FRAMEWORK_ROOT: z.string().optional(),

  // Convenience aliases so the usual variable name works for each provider.
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  /** auto = follow the model's capability. Forcing false is the biggest single token saving. */
  SEND_SCREENSHOTS_TO_MODEL: z.enum(["auto", "true", "false"]).default("auto"),
  /** Drops non-essential MCP tools, shrinking the schema block on every request. */
  LEAN_TOOLS: z.enum(["auto", "true", "false"]).default("auto"),

  PORT: z.coerce.number().int().positive().default(8787),
  ARTIFACT_DIR: z.string().default("./artifacts"),
  /**
   * Where each client's accumulated suite lives. Defaults to the repo root
   * rather than under server/ because these are the client's own projects —
   * committable, runnable without this tool, and not an implementation detail.
   */
  CLIENTS_ROOT: z.string().default("./clients"),

  APPIUM_URL: z.string().url().default("http://127.0.0.1:4723"),
  ANDROID_DEVICE_NAME: z.string().optional(),

  CLOUD_PROVIDER: z.enum(["browserstack", "saucelabs", "none"]).default("none"),
  BROWSERSTACK_USERNAME: z.string().optional(),
  BROWSERSTACK_ACCESS_KEY: z.string().optional(),
  SAUCE_USERNAME: z.string().optional(),
  SAUCE_ACCESS_KEY: z.string().optional(),
  SAUCE_REGION: z.string().default("us-west-1"),

  MAX_AGENT_STEPS: z.coerce.number().int().positive().max(200).default(40),
  VERIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
});

/**
 * A blank line in a .env (`LLM_MODEL=`) sets the variable to "", not undefined.
 * Left as-is that defeats every `??` default and fails url/enum validation, so
 * an intentionally-blank placeholder would crash the server instead of falling
 * back. Everywhere in this config, empty means "not set".
 */
const presentEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value.trim() !== ""),
);

const parsed = Env.safeParse(presentEnv);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

/**
 * Per-provider defaults. Only the model and key are ever required from the
 * user; everything else has a working default so switching provider is a
 * one-line change in .env.
 */
const PRESETS = {
  anthropic: { baseURL: null, model: "claude-opus-5", vision: true, keyVar: "ANTHROPIC_API_KEY" },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    // Free tier, strong tool use, text-only. Override with LLM_MODEL — a wrong
    // id returns the list of models your key can actually reach.
    model: "openai/gpt-oss-120b",
    vision: false,
    keyVar: "GROQ_API_KEY",
  },
  openai: { baseURL: "https://api.openai.com/v1", model: null, vision: true, keyVar: "OPENAI_API_KEY" },
  ollama: { baseURL: "http://127.0.0.1:11434/v1", model: null, vision: false, keyVar: null },
  custom: { baseURL: null, model: null, vision: false, keyVar: null },
} as const;

function resolveLlm() {
  const provider = env.LLM_PROVIDER;
  const preset = PRESETS[provider];

  const apiKey =
    env.LLM_API_KEY ??
    (provider === "anthropic" ? env.ANTHROPIC_API_KEY : undefined) ??
    (provider === "groq" ? env.GROQ_API_KEY : undefined) ??
    (provider === "openai" ? env.OPENAI_API_KEY : undefined) ??
    // Ollama ignores the key but the SDK requires a non-empty string.
    (provider === "ollama" ? "ollama" : undefined);

  if (!apiKey) {
    const hint = preset.keyVar ? `${preset.keyVar} or LLM_API_KEY` : "LLM_API_KEY";
    throw new Error(`LLM_PROVIDER=${provider} needs an API key. Set ${hint} in .env.`);
  }

  const model = env.LLM_MODEL ?? preset.model;
  if (!model) {
    throw new Error(`LLM_PROVIDER=${provider} has no default model. Set LLM_MODEL in .env.`);
  }

  const baseURL = env.LLM_BASE_URL ?? preset.baseURL;
  if (provider !== "anthropic" && !baseURL) {
    throw new Error(`LLM_PROVIDER=${provider} needs LLM_BASE_URL in .env.`);
  }

  const supportsVision =
    env.LLM_SUPPORTS_VISION === "auto" ? preset.vision : env.LLM_SUPPORTS_VISION === "true";

  const sendScreenshots =
    env.SEND_SCREENSHOTS_TO_MODEL === "auto"
      ? supportsVision
      : env.SEND_SCREENSHOTS_TO_MODEL === "true";

  // Lean tool set by default on anything but Anthropic: without explicit prompt
  // caching, the tool schemas are re-billed in full on every single turn.
  const leanTools = env.LEAN_TOOLS === "auto" ? provider !== "anthropic" : env.LEAN_TOOLS === "true";

  return {
    provider,
    apiKey,
    model,
    baseURL,
    supportsVision,
    sendScreenshots,
    leanTools,
    maxRetries: env.LLM_MAX_RETRIES,
    // Same provider and key, just a different (usually lighter/higher-quota) model id.
    fallbackModel: env.LLM_FALLBACK_MODEL ?? null,
  };
}

function resolveCloud() {
  if (env.CLOUD_PROVIDER === "browserstack") {
    if (!env.BROWSERSTACK_USERNAME || !env.BROWSERSTACK_ACCESS_KEY) return null;
    return {
      provider: "browserstack" as const,
      user: env.BROWSERSTACK_USERNAME,
      key: env.BROWSERSTACK_ACCESS_KEY,
      hostname: "hub.browserstack.com",
      port: 443,
      protocol: "https" as const,
      path: "/wd/hub",
    };
  }
  if (env.CLOUD_PROVIDER === "saucelabs") {
    if (!env.SAUCE_USERNAME || !env.SAUCE_ACCESS_KEY) return null;
    return {
      provider: "saucelabs" as const,
      user: env.SAUCE_USERNAME,
      key: env.SAUCE_ACCESS_KEY,
      hostname: `ondemand.${env.SAUCE_REGION}.saucelabs.com`,
      port: 443,
      protocol: "https" as const,
      path: "/wd/hub",
    };
  }
  return null;
}

export const config = {
  ...env,
  repoRoot,
  serverRoot: path.join(repoRoot, "server"),
  artifactDir: path.resolve(path.join(repoRoot, "server"), env.ARTIFACT_DIR),
  clientsRoot: path.resolve(repoRoot, env.CLIENTS_ROOT),
  cloud: resolveCloud(),
  llm: resolveLlm(),
};

export type CloudTarget = NonNullable<ReturnType<typeof resolveCloud>>;
export type LlmConfig = ReturnType<typeof resolveLlm>;
