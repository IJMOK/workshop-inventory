import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config } from "./config.ts";
import { Homebox, HomeboxError, type HomeboxSession } from "./homebox.ts";
import { SessionStore } from "./sessions.ts";
import { ProjectIn, ProjectStore } from "./projects.ts";
import { join as joinPath } from "node:path";
import { AiError, type AiProvider } from "./ai/types.ts";

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const MAX_BODY = 25 * 1024 * 1024;
const COOKIE = "wc_session";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const PhotoIn = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data: z.string().min(1),
});

const LoginIn = z.object({ username: z.string().min(1), password: z.string().min(1) });
const IdentifyIn = z.object({ photos: z.array(PhotoIn).min(1).max(4), hint: z.string().max(500).optional() });
const LabelIn = z.object({ photo: PhotoIn });
const ParseIn = z.object({ text: z.string().min(1).max(1000) });
const MoveIn = z.object({ parentId: z.string().min(1) });
const PlanIn = z.object({ description: z.string().min(1).max(2000) });
const LocationIn = z.object({ name: z.string().min(1).max(200), parentId: z.string().optional() });
const ItemIn = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  parentId: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  manufacturer: z.string().max(255).optional(),
  modelNumber: z.string().max(255).optional(),
  serialNumber: z.string().max(255).optional(),
  notes: z.string().max(5000).optional(),
  purchasePrice: z.number().nonnegative().optional(),
  insured: z.boolean().optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  photos: z.array(PhotoIn).max(6).default([]),
});

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
}

type Handler = (ctx: Ctx) => Promise<unknown>;

export interface Deps {
  config: Config;
  homebox?: Homebox;
  ai: AiProvider | null;
  sessions?: SessionStore;
  projects?: ProjectStore;
}

export function buildServer(deps: Deps): Server {
  const homebox = deps.homebox ?? new Homebox(deps.config.homeboxUrl);
  const sessions = deps.sessions ?? new SessionStore(deps.config.sessionHours);
  const ai = deps.ai;
  const projects = deps.projects ?? new ProjectStore(joinPath(deps.config.dataDir, "projects.json"));
  const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];

  const route = (method: string, path: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)"))}$`);
    routes.push({ method, pattern, keys, handler });
  };

  const session = (ctx: Ctx): HomeboxSession => {
    const token = sessions.get(readCookie(ctx.req, COOKIE));
    if (!token) throw new HttpError(401, "Please sign in");
    return homebox.as(token);
  };

  const requireAi = (): AiProvider => {
    if (!ai) throw new HttpError(503, "AI is switched off in the add-on settings");
    return ai;
  };

  route("GET", "/api/status", async (ctx) => ({
    signedIn: sessions.get(readCookie(ctx.req, COOKIE)) !== null,
    ai: ai?.name ?? null,
  }));

  route("POST", "/api/login", async (ctx) => {
    const { username, password } = await body(ctx.req, LoginIn);
    const { token, expiresAt } = await homebox.login(username, password);
    const { id, maxAgeSec } = sessions.create(token, expiresAt);
    ctx.res.setHeader("set-cookie", cookie(ctx.req, id, maxAgeSec));
    return { ok: true };
  });

  route("POST", "/api/logout", async (ctx) => {
    sessions.delete(readCookie(ctx.req, COOKIE));
    ctx.res.setHeader("set-cookie", cookie(ctx.req, "", 0));
    return { ok: true };
  });

  route("GET", "/api/locations", async (ctx) => session(ctx).locations());

  route("POST", "/api/locations", async (ctx) => {
    const { name, parentId } = await body(ctx.req, LocationIn);
    const loc = await session(ctx).createLocation(name, parentId);
    return { id: loc.id, name: loc.name };
  });

  route("GET", "/api/search", async (ctx) => {
    const hb = session(ctx);
    const q = ctx.url.searchParams.get("q")?.trim() ?? "";
    if (!q) return [];
    const items = await hb.search(q);
    return Promise.all(
      items.map(async (i) => ({
        id: i.id,
        name: i.name,
        description: i.description ?? "",
        quantity: i.quantity ?? 1,
        imageId: i.imageId || i.thumbnailId || null,
        location: await hb.path(i.id).catch(() => i.parent?.name ?? ""),
      })),
    );
  });

  route("GET", "/api/items/:id/photos/:photoId", async (ctx) => {
    const upstream = await session(ctx).attachment(ctx.params.id, ctx.params.photoId);
    ctx.res.writeHead(200, {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=86400",
    });
    ctx.res.end(Buffer.from(await upstream.arrayBuffer()));
    return undefined;
  });

  route("PATCH", "/api/items/:id/location", async (ctx) => {
    const { parentId } = await body(ctx.req, MoveIn);
    const item = await session(ctx).move(ctx.params.id, parentId);
    return { id: item.id };
  });

  route("POST", "/api/items", async (ctx) => {
    const { photos, ...item } = await body(ctx.req, ItemIn);
    const created = await session(ctx).createItem(item, photos);
    return { id: created.id, name: created.name };
  });

  route("POST", "/api/ai/identify", async (ctx) => {
    session(ctx);
    const { photos, hint } = await body(ctx.req, IdentifyIn);
    return requireAi().identifyItem(photos, hint);
  });

  route("POST", "/api/ai/label", async (ctx) => {
    session(ctx);
    const { photo } = await body(ctx.req, LabelIn);
    return requireAi().readLabel(photo);
  });

  route("POST", "/api/ai/parse", async (ctx) => {
    const hb = session(ctx);
    const { text } = await body(ctx.req, ParseIn);
    const locations = await hb.locations();
    return requireAi().parseRequest(text, locations.map(({ id, path }) => ({ id, path })));
  });

  // ---------- projects ----------

  const project = async (ctx: Ctx) => {
    const p = await projects.get(ctx.params.id);
    if (!p) throw new HttpError(404, "Project not found");
    return p;
  };

  route("GET", "/api/projects", async (ctx) => {
    session(ctx);
    return (await projects.list()).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      itemCount: p.items.length,
      pulledCount: p.items.filter((i) => i.pulled).length,
      updatedAt: p.updatedAt,
    }));
  });

  route("POST", "/api/projects", async (ctx) => {
    session(ctx);
    return projects.create(await body(ctx.req, ProjectIn));
  });

  route("GET", "/api/projects/:id", async (ctx) => {
    session(ctx);
    return project(ctx);
  });

  route("PUT", "/api/projects/:id", async (ctx) => {
    session(ctx);
    const updated = await projects.update(ctx.params.id, await body(ctx.req, ProjectIn));
    if (!updated) throw new HttpError(404, "Project not found");
    return updated;
  });

  route("DELETE", "/api/projects/:id", async (ctx) => {
    session(ctx);
    if (!(await projects.delete(ctx.params.id))) throw new HttpError(404, "Project not found");
    return { ok: true };
  });

  /** Items grouped by where they live, so everything can be gathered in one walk round. */
  route("GET", "/api/projects/:id/pull-list", async (ctx) => {
    const hb = session(ctx);
    const p = await project(ctx);
    const groups = new Map<string, { location: string; items: unknown[] }>();
    await Promise.all(
      p.items.map(async (item) => {
        let location = "Not in the inventory";
        if (item.entityId) location = (await hb.path(item.entityId).catch(() => "")) || "No location set";
        if (!groups.has(location)) groups.set(location, { location, items: [] });
        groups.get(location)!.items.push(item);
      }),
    );
    return [...groups.values()].sort((a, b) =>
      a.location === "Not in the inventory" ? 1 : b.location === "Not in the inventory" ? -1 : a.location.localeCompare(b.location),
    );
  });

  /** AI suggests what the project needs, and each suggestion comes back with inventory matches to pick from. */
  route("POST", "/api/ai/plan", async (ctx) => {
    const hb = session(ctx);
    const { description } = await body(ctx.req, PlanIn);
    const plan = await requireAi().planProject(description);
    return Promise.all(
      plan.items.slice(0, 25).map(async (s) => ({
        ...s,
        matches: (await hb.search(s.name, 3).catch(() => [])).map((m) => ({ id: m.id, name: m.name })),
      })),
    );
  });

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    try {
      if (url.pathname.startsWith("/api/")) {
        const match = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
        if (!match) throw new HttpError(404, "Not found");
        const values = match.pattern.exec(url.pathname)!.slice(1);
        const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(values[i])]));
        const result = await match.handler({ req, res, url, params });
        if (!res.headersSent) send(res, 200, result);
        return;
      }
      await serveStatic(url.pathname, res);
    } catch (err) {
      const status = err instanceof HttpError || err instanceof HomeboxError || err instanceof AiError ? err.status : 500;
      if (status === 500) console.error(err);
      const message = status === 500 ? "Something went wrong" : (err as Error).message;
      if (!res.headersSent) send(res, status, { error: message });
      else res.end();
    }
  });
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data ?? null));
}

async function body<T extends z.ZodType>(req: IncomingMessage, schema: T): Promise<z.infer<T>> {
  // Requiring a JSON content type stops cross-site form posts (simple requests can't send it).
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "Expected JSON");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Upload too large");
    chunks.push(chunk);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, `Invalid request: ${parsed.error.issues[0]?.path.join(".") || "body"}`);
  return parsed.data;
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

function cookie(req: IncomingMessage, value: string, maxAgeSec: number): string {
  const secure = req.headers["x-forwarded-proto"] === "https" || (req.socket as { encrypted?: boolean }).encrypted;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}

async function serveStatic(pathname: string, res: ServerResponse) {
  const rel = normalize(pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  if (rel.startsWith("..")) throw new HttpError(404, "Not found");
  let file: Buffer;
  let ext = extname(rel);
  try {
    file = await readFile(join(WEB_ROOT, rel));
  } catch {
    // Unknown paths fall back to the app shell.
    file = await readFile(join(WEB_ROOT, "index.html"));
    ext = ".html";
  }
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": ext === ".html" || rel === "sw.js" ? "no-cache" : "public, max-age=3600",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(file);
}
