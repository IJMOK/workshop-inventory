// Thin client for the Homebox v0.26 API (unified "entities": items and locations).

export class HomeboxError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** fetch, but a network failure becomes a clear "can't reach Homebox" error. */
async function call(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new HomeboxError(`Can't reach Homebox at ${new URL(url).origin}. Check homebox_url in the add-on settings.`, 502);
  }
}

export interface TreeNode {
  id: string;
  name: string;
  type: "location" | "item";
  children?: TreeNode[];
}

export interface EntitySummary {
  id: string;
  name: string;
  description?: string;
  quantity?: number;
  thumbnailId?: string;
  imageId?: string;
  parent?: { id: string; name: string } | null;
}

export interface EntityOut extends EntitySummary {
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  notes?: string;
  purchasePrice?: number;
  insured?: boolean;
  entityType?: { id: string };
  tags?: { id: string; name: string }[];
}

export interface Tag {
  id: string;
  name: string;
}

export interface NewItem {
  name: string;
  description?: string;
  parentId?: string;
  quantity?: number;
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  notes?: string;
  purchasePrice?: number;
  insured?: boolean;
  tags?: string[];
}

export interface Photo {
  mediaType: string;
  data: string;
}

export class Homebox {
  readonly baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async login(username: string, password: string): Promise<{ token: string; expiresAt?: Date }> {
    const res = await call(`${this.baseUrl}/api/v1/users/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, stayLoggedIn: true }),
    });
    if (!res.ok) throw new HomeboxError(res.status === 401 ? "Wrong email or password" : `Homebox login failed (${res.status})`, res.status === 401 ? 401 : 502);
    const body = (await res.json()) as { token: string; expiresAt?: string };
    return { token: body.token.replace(/^Bearer /, ""), expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined };
  }

  as(token: string): HomeboxSession {
    return new HomeboxSession(this.baseUrl, token);
  }
}

export class HomeboxSession {
  private readonly baseUrl: string;
  private readonly token: string;
  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: { authorization: `Bearer ${this.token}` } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["content-type"] = "application/json";
    }
    const res = await call(`${this.baseUrl}/api${path}`, init);
    if (res.status === 401) throw new HomeboxError("Homebox session expired", 401);
    if (!res.ok) throw new HomeboxError(`Homebox ${method} ${path.split("?")[0]} failed (${res.status})`, 502);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Every location as a flat list with its full path, e.g. "Garage › Wood shop › Drawer 3". */
  async locations(): Promise<{ id: string; name: string; path: string }[]> {
    const tree = await this.request<TreeNode[]>("GET", "/v1/entities/tree");
    const out: { id: string; name: string; path: string }[] = [];
    const walk = (nodes: TreeNode[], prefix: string) => {
      for (const n of nodes) {
        if (n.type !== "location") continue;
        const path = prefix ? `${prefix} › ${n.name}` : n.name;
        out.push({ id: n.id, name: n.name, path });
        walk(n.children ?? [], path);
      }
    };
    walk(tree, "");
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async createLocation(name: string, parentId?: string): Promise<EntityOut> {
    const types = await this.request<{ id: string; isLocation: boolean; name: string }[]>("GET", "/v1/entity-types");
    const locType = types.find((t) => t.isLocation);
    return this.request<EntityOut>("POST", "/v1/entities", {
      name,
      ...(parentId ? { parentId } : {}),
      ...(locType ? { entityTypeId: locType.id } : {}),
    });
  }

  async search(q: string, pageSize = 25): Promise<EntitySummary[]> {
    const params = new URLSearchParams({ q, pageSize: String(pageSize), page: "1" });
    const res = await this.request<{ items: EntitySummary[] }>("GET", `/v1/entities?${params}`);
    return res.items ?? [];
  }

  get(id: string): Promise<EntityOut> {
    return this.request<EntityOut>("GET", `/v1/entities/${encodeURIComponent(id)}`);
  }

  async path(id: string): Promise<string> {
    const parts = await this.request<{ name: string; type: string }[]>("GET", `/v1/entities/${encodeURIComponent(id)}/path`);
    return parts.filter((p) => p.type === "location").map((p) => p.name).join(" › ");
  }

  move(id: string, parentId: string): Promise<EntityOut> {
    return this.request<EntityOut>("PATCH", `/v1/entities/${encodeURIComponent(id)}`, { id, parentId });
  }

  /** Find tags by name (case-insensitive), creating any that don't exist yet. */
  async ensureTags(names: string[]): Promise<string[]> {
    const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    if (!wanted.length) return [];
    const existing = await this.request<Tag[]>("GET", "/v1/tags");
    const ids: string[] = [];
    for (const name of wanted) {
      const found = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
      ids.push(found ? found.id : (await this.request<Tag>("POST", "/v1/tags", { name })).id);
    }
    return ids;
  }

  /**
   * Create an item with all its details and photos. Homebox's create endpoint
   * only takes the basics, so the rest is applied with a follow-up update.
   */
  async createItem(item: NewItem, photos: Photo[]): Promise<EntityOut> {
    const tagIds = await this.ensureTags(item.tags ?? []);
    const created = await this.request<EntityOut>("POST", "/v1/entities", {
      name: item.name,
      description: item.description ?? "",
      quantity: item.quantity ?? 1,
      ...(item.parentId ? { parentId: item.parentId } : {}),
      tagIds,
    });

    const details = {
      manufacturer: item.manufacturer,
      modelNumber: item.modelNumber,
      serialNumber: item.serialNumber,
      notes: item.notes,
      purchasePrice: item.purchasePrice,
      insured: item.insured,
    };
    if (Object.values(details).some((v) => v !== undefined && v !== "")) {
      await this.request("PUT", `/v1/entities/${created.id}`, {
        id: created.id,
        name: created.name,
        description: created.description ?? "",
        quantity: created.quantity ?? 1,
        parentId: item.parentId || undefined,
        entityTypeId: created.entityType?.id,
        tagIds,
        ...details,
      });
    }

    for (const [i, photo] of photos.entries()) {
      const form = new FormData();
      const ext = photo.mediaType.split("/")[1] ?? "jpg";
      form.append("file", new Blob([Buffer.from(photo.data, "base64")], { type: photo.mediaType }), `photo-${i + 1}.${ext}`);
      form.append("type", "photo");
      form.append("primary", String(i === 0));
      form.append("name", `photo-${i + 1}.${ext}`);
      await this.request("POST", `/v1/entities/${created.id}/attachments`, form);
    }
    return this.get(created.id);
  }

  /** Fetch an image attachment so the browser can show it without holding a Homebox token. */
  async attachment(entityId: string, attachmentId: string): Promise<Response> {
    const res = await call(
      `${this.baseUrl}/api/v1/entities/${encodeURIComponent(entityId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: { authorization: `Bearer ${this.token}` } },
    );
    if (!res.ok) throw new HomeboxError("Photo not found", res.status === 404 ? 404 : 502);
    return res;
  }
}
