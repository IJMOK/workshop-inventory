import type { z } from "zod";
import { ItemIdentification, LabelReading, ParsedRequest, ProjectPlan } from "./schemas.ts";
import { SYSTEM, LABEL_PROMPT, identifyPrompt, planPrompt, jsonInstruction, parsePrompt } from "./prompts.ts";
import { jsonSchemaOf, parseJsonReply } from "./json.ts";
import { AiError, type AiProvider, type KnownLocation, type Photo } from "./types.ts";

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  /** e.g. https://api.openai.com/v1, or http://<host>:11434/v1 for Ollama */
  baseUrl: string;
  currency: string;
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** OpenAI Chat Completions, which also covers Ollama, LM Studio and other compatible servers. */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai";
  private readonly opts: OpenAiOptions;

  constructor(opts: OpenAiOptions) {
    this.opts = opts;
  }

  identifyItem(photos: Photo[], hint?: string) {
    return this.ask(ItemIdentification, [...photos.map(image), { type: "text", text: identifyPrompt(this.opts.currency, hint) }]);
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

  private async ask<T extends z.ZodType>(schema: T, content: Part[]): Promise<z.infer<T>> {
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.opts.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${SYSTEM}\n${jsonInstruction(jsonSchemaOf(schema))}` },
          { role: "user", content },
        ],
      }),
    });
    if (!res.ok) throw new AiError(`AI provider returned ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseJsonReply(schema, body.choices?.[0]?.message?.content ?? "");
  }
}

function image(photo: Photo): Part {
  return { type: "image_url", image_url: { url: `data:${photo.mediaType};base64,${photo.data}` } };
}
