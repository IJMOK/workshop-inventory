import type { z } from "zod";
import { ItemIdentification, LabelReading, ParsedRequest, ProjectPlan } from "./schemas.ts";
import { SYSTEM, LABEL_PROMPT, identifyPrompt, planPrompt, jsonInstruction, parsePrompt } from "./prompts.ts";
import { jsonSchemaOf, parseJsonReply } from "./json.ts";
import { AiError, type AiProvider, type KnownLocation, type Photo } from "./types.ts";

export interface GeminiOptions {
  apiKey: string;
  model: string;
  currency: string;
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  private readonly opts: GeminiOptions;

  constructor(opts: GeminiOptions) {
    this.opts = opts;
  }

  identifyItem(photos: Photo[], hint?: string) {
    return this.ask(ItemIdentification, [...photos.map(image), { text: identifyPrompt(this.opts.currency, hint) }]);
  }

  readLabel(photo: Photo) {
    return this.ask(LabelReading, [image(photo), { text: LABEL_PROMPT }]);
  }

  parseRequest(text: string, locations: KnownLocation[]) {
    return this.ask(ParsedRequest, [{ text: parsePrompt(text, locations) }]);
  }

  planProject(description: string) {
    return this.ask(ProjectPlan, [{ text: planPrompt(description) }]);
  }

  private async ask<T extends z.ZodType>(schema: T, parts: Part[]): Promise<z.infer<T>> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.opts.model)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: `${SYSTEM}\n${jsonInstruction(jsonSchemaOf(schema))}` }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) throw new AiError(`AI provider returned ${res.status}`);
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return parseJsonReply(schema, text);
  }
}

function image(photo: Photo): Part {
  return { inline_data: { mime_type: photo.mediaType, data: photo.data } };
}
