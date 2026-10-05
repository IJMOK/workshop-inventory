import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { FakeHomebox } from "./fake-homebox.ts";
import { Client, fakeAi, startApp } from "./helpers.ts";
import { ProjectStore } from "../src/projects.ts";

let hb: FakeHomebox;
let app: { url: string; server: Server };
let c: Client;
let drillId: string;

before(async () => {
  hb = await new FakeHomebox().start();
  const garage = hb.addLocation("Garage");
  const wood = hb.addLocation("Wood shop", garage);
  app = await startApp(hb.url, fakeAi);
  c = new Client(app.url);
  await c.call("POST", "/api/login", { username: "rob@example.com", password: "pw" });
  drillId = (await c.call("POST", "/api/items", { name: "Cordless drill", parentId: wood })).data.id;
});
after(() => {
  app.server.close();
  hb.stop();
});

test("project endpoints need a session", async () => {
  assert.equal((await new Client(app.url).call("GET", "/api/projects")).status, 401);
});

test("AI plan returns suggestions with inventory matches", async () => {
  const r = await c.call("POST", "/api/ai/plan", { description: "Build a workbench" });
  assert.equal(r.status, 200);
  assert.equal(r.data[0].name, "drill");
  assert.deepEqual(r.data[0].matches.map((m: any) => m.id), [drillId]);
  assert.deepEqual(r.data[1].matches, []);
});

test("create, update, pull list grouped by location, delete", async () => {
  const created = await c.call("POST", "/api/projects", {
    name: "Workbench",
    items: [
      { name: "Cordless drill", entityId: drillId },
      { name: "Wood glue", kind: "consumable", quantity: "1 bottle" },
    ],
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.id;
  assert.equal(created.data.items.length, 2);
  assert.ok(created.data.items.every((i: any) => i.id && i.pulled === false));

  const list = await c.call("GET", `/api/projects/${id}/pull-list`);
  assert.deepEqual(list.data.map((g: any) => g.location), ["Garage › Wood shop", "Not in the inventory"]);

  const items = created.data.items.map((i: any) => ({ ...i, pulled: i.entityId === drillId }));
  const updated = await c.call("PUT", `/api/projects/${id}`, { name: "Workbench", status: "active", items });
  assert.equal(updated.data.status, "active");

  const summary = await c.call("GET", "/api/projects");
  assert.equal(summary.data[0].pulledCount, 1);
  assert.equal(summary.data[0].itemCount, 2);

  assert.equal((await c.call("DELETE", `/api/projects/${id}`)).status, 200);
  assert.equal((await c.call("GET", `/api/projects/${id}`)).status, 404);
});

test("store persists to disk and reloads", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "wc-")), "nested", "projects.json");
  const a = new ProjectStore(file);
  const p = await a.create({ name: "Brew day", description: "", status: "planning", items: [] });
  assert.equal(JSON.parse(readFileSync(file, "utf8"))[0].id, p.id);
  const b = new ProjectStore(file);
  assert.equal((await b.get(p.id))?.name, "Brew day");
});
