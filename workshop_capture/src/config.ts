import { readFileSync } from "node:fs";

export type ProviderName = "none" | "anthropic" | "openai" | "gemini";

export interface Config {
  port: number;
  homeboxUrl: string;
  sessionHours: number;
  dataDir: string;
  ai: {
    provider: ProviderName;
    apiKey: string;
    model: string;
    baseUrl: string;
    currency: string;
  };
}

const PROVIDERS: ProviderName[] = ["none", "anthropic", "openai", "gemini"];

/**
 * Home Assistant writes add-on options to /data/options.json. Outside Home
 * Assistant (local development) the same settings come from environment variables.
 */
export function loadConfig(env = process.env, optionsPath = "/data/options.json"): Config {
  let opts: Record<string, unknown> = {};
  try {
    opts = JSON.parse(readFileSync(optionsPath, "utf8"));
  } catch {
    // Not running as an add-on.
  }
  const pick = (key: string, envKey: string, fallback = ""): string => {
    const v = opts[key] ?? env[envKey];
    return v == null ? fallback : String(v).trim();
  };

  const provider = pick("ai_provider", "AI_PROVIDER", "anthropic") as ProviderName;
  if (!PROVIDERS.includes(provider)) throw new Error(`ai_provider must be one of ${PROVIDERS.join(", ")}`);

  const cfg: Config = {
    port: Number(pick("port", "PORT", "8099")),
    homeboxUrl: pick("homebox_url", "HOMEBOX_URL", "http://172.30.32.1:7745").replace(/\/$/, ""),
    sessionHours: Number(pick("session_hours", "SESSION_HOURS", "720")),
    dataDir: env.DATA_DIR || "/data",
    ai: {
      provider,
      apiKey: pick("ai_api_key", "AI_API_KEY"),
      model: pick("ai_model", "AI_MODEL"),
      baseUrl: pick("ai_base_url", "AI_BASE_URL"),
      currency: pick("currency", "CURRENCY", "GBP"),
    },
  };
  if (cfg.ai.provider !== "none" && cfg.ai.provider !== "openai" && !cfg.ai.apiKey) {
    throw new Error(`ai_api_key is required for the ${cfg.ai.provider} provider`);
  }
  if ((cfg.ai.provider === "openai" || cfg.ai.provider === "gemini") && !cfg.ai.model) {
    throw new Error(`ai_model is required for the ${cfg.ai.provider} provider`);
  }
  return cfg;
}
