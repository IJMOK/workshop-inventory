import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

interface Entity {
  id: string;
  name: string;
  isLocation: boolean;
  parentId?: string;
  fields: Record<string, unknown>;
  tagIds: string[];
  attachments: { id: string; type: string; primary: boolean; bytes: number }[];
}

/** Just enough of the Homebox v0.26 API to exercise Workshop Capture end to end. */
export class FakeHomebox {
  readonly entities = new Map<string, Entity>();
  readonly tags: { id: string; name: string }[] = [];
  readonly token = "tok-" + randomUUID();
  private server!: Server;
  url = "";

  addLocation(name: string, parentId?: string): string {
    const id = randomUUID();
    this.entities.set(id, { id, name, isLocation: true, parentId, fields: {}, tagIds: [], attachments: [] });
    return id;
  }

  async start(): Promise<this> {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url!, "http://x");
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const p = url.pathname;

      if (p === "/api/v1/users/login" && req.method === "POST") {
        const b = JSON.parse(raw.toString());
        if (b.username === "rob@example.com" && b.password === "pw") return json(200, { token: `Bearer ${this.token}`, expiresAt: new Date(Date.now() + 864e5).toISOString() });
        return json(401, { error: "unauthorized" });
      }
      if (req.headers.authorization !== `Bearer ${this.token}`) return json(401, { error: "unauthorized" });

      const summary = (e: Entity) => ({
        id: e.id,
        name: e.name,
        description: e.fields.description ?? "",
        quantity: e.fields.quantity ?? 1,
        imageId: e.attachments.find((a) => a.primary)?.id ?? "",
        parent: e.parentId ? { id: e.parentId, name: this.entities.get(e.parentId)!.name } : null,
      });
      const out = (e: Entity) => ({ ...summary(e), ...e.fields, entityType: { id: e.isLocation ? "loc-type" : "item-type" }, tags: e.tagIds.map((id) => this.tags.find((t) => t.id === id)) });

      if (p === "/api/v1/entities/tree") {
        const build = (parentId?: string): unknown[] =>
          [...this.entities.values()].filter((e) => e.isLocation && e.parentId === parentId).map((e) => ({ id: e.id, name: e.name, type: "location", children: build(e.id) }));
        return json(200, build(undefined));
      }
      if (p === "/api/v1/entity-types") return json(200, [{ id: "item-type", name: "Item", isLocation: false }, { id: "loc-type", name: "Location", isLocation: true }]);
      if (p === "/api/v1/tags" && req.method === "GET") return json(200, this.tags);
      if (p === "/api/v1/tags" && req.method === "POST") {
        const t = { id: randomUUID(), name: JSON.parse(raw.toString()).name };
        this.tags.push(t);
        return json(201, t);
      }
      if (p === "/api/v1/entities" && req.method === "GET") {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const items = [...this.entities.values()].filter((e) => !e.isLocation && e.name.toLowerCase().includes(q));
        return json(200, { items: items.map(summary), page: 1, pageSize: 25, total: items.length });
      }
      if (p === "/api/v1/entities" && req.method === "POST") {
        const b = JSON.parse(raw.toString());
        const id = randomUUID();
        const e: Entity = { id, name: b.name, isLocation: b.entityTypeId === "loc-type", parentId: b.parentId, fields: { description: b.description, quantity: b.quantity }, tagIds: b.tagIds ?? [], attachments: [] };
        this.entities.set(id, e);
        return json(201, out(e));
      }
      const m = p.match(/^\/api\/v1\/entities\/([^/]+)(\/path|\/attachments(?:\/([^/]+))?)?$/);
      const e = m && this.entities.get(m[1]);
      if (!e) return json(404, { error: "not found" });
      if (m![2] === "/path") {
        const chain: Entity[] = [];
        for (let cur: Entity | undefined = e; cur; cur = cur.parentId ? this.entities.get(cur.parentId) : undefined) chain.unshift(cur);
        return json(200, chain.map((c) => ({ id: c.id, name: c.name, type: c.isLocation ? "location" : "item" })));
      }
      if (m![2]?.startsWith("/attachments") && req.method === "POST") {
        const isPrimary = raw.toString("latin1").includes('name="primary"\r\n\r\ntrue');
        e.attachments.push({ id: randomUUID(), type: "photo", primary: isPrimary, bytes: raw.length });
        return json(201, out(e));
      }
      if (m![3] && req.method === "GET") {
        res.writeHead(200, { "content-type": "image/jpeg" });
        return res.end(Buffer.from([0xff, 0xd8, 0xff]));
      }
      if (req.method === "GET") return json(200, out(e));
      if (req.method === "PUT") {
        const b = JSON.parse(raw.toString());
        const { id: _id, name, parentId, tagIds, entityTypeId: _t, ...rest } = b;
        Object.assign(e, { name, parentId, tagIds });
        Object.assign(e.fields, rest);
        return json(200, out(e));
      }
      if (req.method === "PATCH") {
        const b = JSON.parse(raw.toString());
        if (b.parentId) e.parentId = b.parentId;
        return json(200, out(e));
      }
      json(405, { error: "method" });
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop() {
    this.server.close();
  }
}
