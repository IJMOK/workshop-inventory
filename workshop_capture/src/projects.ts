import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

// Homebox has no notion of projects, so they live in the add-on's own /data
// folder, which Home Assistant includes in its backups.

export const ProjectItemIn = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(255),
  kind: z.enum(["tool", "material", "consumable"]).default("tool"),
  quantity: z.string().max(50).default(""),
  entityId: z.string().nullable().optional(),
  pulled: z.boolean().default(false),
});

export const ProjectIn = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  status: z.enum(["planning", "active", "done"]).default("planning"),
  items: z.array(ProjectItemIn).max(200).default([]),
});

export type ProjectItem = Required<Omit<z.infer<typeof ProjectItemIn>, "entityId">> & { entityId: string | null };
export interface Project {
  id: string;
  name: string;
  description: string;
  status: "planning" | "active" | "done";
  items: ProjectItem[];
  createdAt: string;
  updatedAt: string;
}

export class ProjectStore {
  private readonly file: string;
  private cache: Project[] | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  private async load(): Promise<Project[]> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await readFile(this.file, "utf8")) as Project[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.cache = [];
    }
    return this.cache;
  }

  /** Writes are serialised and atomic (temp file + rename) so a power cut can't leave half a file. */
  private save(): Promise<void> {
    const data = JSON.stringify(this.cache, null, 2);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, this.file);
    });
    return this.writing;
  }

  async list(): Promise<Project[]> {
    return [...(await this.load())].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Project | undefined> {
    return (await this.load()).find((p) => p.id === id);
  }

  async create(input: z.infer<typeof ProjectIn>): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = { id: randomUUID(), ...input, items: input.items.map(normaliseItem), createdAt: now, updatedAt: now };
    (await this.load()).push(project);
    await this.save();
    return project;
  }

  async update(id: string, input: z.infer<typeof ProjectIn>): Promise<Project | undefined> {
    const project = await this.get(id);
    if (!project) return undefined;
    Object.assign(project, { ...input, items: input.items.map(normaliseItem), updatedAt: new Date().toISOString() });
    await this.save();
    return project;
  }

  async delete(id: string): Promise<boolean> {
    const all = await this.load();
    const i = all.findIndex((p) => p.id === id);
    if (i < 0) return false;
    all.splice(i, 1);
    await this.save();
    return true;
  }
}

function normaliseItem(item: z.infer<typeof ProjectItemIn>): ProjectItem {
  return { ...item, id: item.id || randomUUID(), entityId: item.entityId || null };
}
