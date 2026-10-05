import type { Config } from "../config.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GeminiProvider } from "./gemini.ts";
import { OpenAiCompatibleProvider } from "./openai.ts";
import type { AiProvider } from "./types.ts";

export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-opus-5-5",
};

/** Returns null when AI is switched off, so the app still works for manual entry. */
export function createProvider(cfg: Config["ai"]): AiProvider | null {
  const model = cfg.model || DEFAULT_MODELS[cfg.provider] || "";
  switch (cfg.provider) {
    case "none":
      return null;
    case "anthropic":
      return new AnthropicProvider({ apiKey: cfg.apiKey, model, currency: cfg.currency });
    case "openai":
      return new OpenAiCompatibleProvider({
        apiKey: cfg.apiKey,
        model,
        baseUrl: cfg.baseUrl || "https://api.openai.com/v1",
        currency: cfg.currency,
      });
    case "gemini":
      return new GeminiProvider({ apiKey: cfg.apiKey, model, currency: cfg.currency });
  }
}
