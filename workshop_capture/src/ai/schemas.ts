import { z } from "zod";

// Shapes every provider must return. Adapters validate against these, so the
// rest of the app never sees provider-specific output.

const text = z.string().describe("Empty string when unknown");

export const ItemIdentification = z.object({
  name: z.string().describe("Short everyday name, e.g. 'Cordless drill'"),
  manufacturer: text,
  modelNumber: text,
  category: z.string().describe("One of: power tool, hand tool, measuring, fastener, consumable, material, electrical, electronics, brewing, safety, storage, other"),
  description: z.string().describe("One or two sentences a person would recognise the item by"),
  tags: z.array(z.string()).describe("Up to 5 lowercase tags, e.g. 'woodwork', '18v'"),
  estimatedValue: z.number().nullable().describe("Rough replacement value in the currency named in the prompt, or null if unsure"),
  confidence: z.enum(["high", "medium", "low"]),
  alternatives: z.array(z.string()).describe("Up to 3 other things it might be"),
});
export type ItemIdentification = z.infer<typeof ItemIdentification>;

export const LabelReading = z.object({
  manufacturer: text,
  modelNumber: text,
  serialNumber: text,
  partNumber: text,
  manufactureDate: text,
  otherText: z.string().describe("Any other useful label text, e.g. voltage or rating"),
  confidence: z.enum(["high", "medium", "low"]),
});
export type LabelReading = z.infer<typeof LabelReading>;

export const ParsedRequest = z.object({
  action: z.enum(["add", "find", "move", "unknown"]),
  itemName: text,
  locationName: z.string().describe("Location as the person said it, or empty string"),
  locationId: z.string().describe("Best matching id from the known locations list, or empty string"),
  quantity: z.number().nullable(),
  notes: text,
});
export type ParsedRequest = z.infer<typeof ParsedRequest>;

export const ProjectPlan = z.object({
  items: z
    .array(
      z.object({
        name: z.string().describe("Generic name someone would search an inventory for, e.g. 'mitre saw', '4mm drill bit', 'Star San'"),
        kind: z.enum(["tool", "material", "consumable"]),
        quantity: z.string().describe("Amount needed in words, e.g. '2', '5 kg', 'a few'; empty string if not relevant"),
      }),
    )
    .describe("Tools, materials and consumables needed, most important first, at most 25"),
});
export type ProjectPlan = z.infer<typeof ProjectPlan>;
