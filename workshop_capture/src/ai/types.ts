import type { ItemIdentification, LabelReading, ParsedRequest, ProjectPlan } from "./schemas.ts";

export interface Photo {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  /** Base64 without a data: prefix */
  data: string;
}

export interface KnownLocation {
  id: string;
  path: string;
}

/** Every AI feature goes through this interface, so providers can be swapped in config. */
export interface AiProvider {
  readonly name: string;
  identifyItem(photos: Photo[], hint?: string): Promise<ItemIdentification>;
  readLabel(photo: Photo): Promise<LabelReading>;
  parseRequest(text: string, locations: KnownLocation[]): Promise<ParsedRequest>;
  planProject(description: string): Promise<ProjectPlan>;
}

export class AiError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}
