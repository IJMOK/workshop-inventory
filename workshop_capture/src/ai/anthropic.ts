import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { ItemIdentification, LabelReading, ParsedRequest, ProjectPlan } from "./schemas.ts";
import { SYSTEM, LABEL_PROMPT, identifyPrompt, planPrompt, parsePrompt } from "./prompts.ts";
import { AiError, type AiProvider, type KnownLocation, type Photo } from "./types.ts";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  currency: string;
  /** Only for tests */
  baseUrl?: string;
}

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly currency: string;

  constructor(opts: AnthropicOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey, ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}) });
    this.model = opts.model;
    this.currency = opts.currency;
  }

  identifyItem(photos: Photo[], hint?: string) {
    return this.ask(ItemIdentification, [...photos.map(image), { type: "text", text: identifyPrompt(this.currency, hint) }]);
  }

  readLabel(photo: Photo) {
    return this.ask(LabelReading, [image(photo), { type: "text", text: LABEL_PROMPT }]);
  }

  parseRequest(text: string, locations: KnownLocation[]) {
    return this.ask(ParsedRequest, [{ type: "text", text: parsePrompt(text, locations) }]);
  }

  planProject(description: string) {
    return this.ask(ProjectPlan, [{ type: "text", text: planPrompt(description) }]);
  }

  private async ask<T extends z.ZodType>(schema: T, content: Block[]): Promise<z.infer<T>> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: SYSTEM,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") throw new AiError("The AI declined this request");
    if (response.parsed_output == null) throw new AiError("The AI reply could not be read");
    return response.parsed_output as z.infer<T>;
  }
}

function image(photo: Photo): Block {
  return { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.data } };
}
