import type { KnownLocation } from "./types.ts";

export const SYSTEM =
  "You help catalogue a home garage workshop used for brewing, metalwork, woodwork, electronics and general DIY. " +
  "Answers are used for an inventory and for insurance, so never invent model or serial numbers: " +
  "leave a field empty unless you can actually read or clearly recognise it.";

export function identifyPrompt(currency: string, hint?: string): string {
  return (
    "Identify the main item in these photos. If several photos are given they show the same item from different angles. " +
    "Read brand and model from any visible text or labels. " +
    `Give any value estimate in ${currency}.` +
    (hint ? `\nThe owner says: ${hint}` : "")
  );
}

export const LABEL_PROMPT =
  "This is a photo of a rating plate, label or sticker on a tool or appliance. " +
  "Transcribe the manufacturer, model, serial number, part number and date exactly as printed. " +
  "Serial numbers are often marked S/N, SN, Serial or No.";

export function parsePrompt(text: string, locations: KnownLocation[]): string {
  const list = locations.map((l) => `${l.id}\t${l.path}`).join("\n");
  return (
    "Turn this spoken or typed request about the workshop inventory into a structured action.\n" +
    "'add' means record a new item, 'find' means ask where something is, 'move' means it now lives somewhere else.\n" +
    `Known locations (id, path):\n${list || "(none yet)"}\n\nRequest: ${text}`
  );
}

export function planPrompt(description: string): string {
  return (
    "List what someone would need to gather from a home workshop to do this project. " +
    "Include tools, materials and consumables; skip things everyone has like pens.\n" +
    `Project: ${description}`
  );
}

/** Used by providers without native schema enforcement. */
export function jsonInstruction(schema: unknown): string {
  return `Reply with only a JSON object matching this JSON Schema, with no other text:\n${JSON.stringify(schema)}`;
}
