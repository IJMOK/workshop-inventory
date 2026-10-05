import { z } from "zod";
import { AiError } from "./types.ts";

/** Pull a JSON object out of model text (tolerates code fences) and validate it. */
export function parseJsonReply<T extends z.ZodType>(schema: T, text: string): z.infer<T> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("The AI reply did not contain JSON");
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiError("The AI reply was not valid JSON");
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new AiError("The AI reply was missing fields");
  return result.data;
}

export function jsonSchemaOf(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema);
}
