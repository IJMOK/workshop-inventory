import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FakeHomebox } from "./fake-homebox.ts";
import { Client, fakeAi, startApp } from "./helpers.ts";
import type { Server } from "node:http";

const PHOTO = { mediaType: "image/jpeg", data: Buffer.from("fake-jpeg").toString("base64") };
let hb: FakeHomebox;
let app: { url: string; server: Server };
let garage: string;
let shelf: string;

before(async () => {
  hb = await new FakeHomebox().start();
  garage = hb.addLocation("Garage");
  shelf = hb.addLocation("Metal shelf", garage);
  app = await startApp(hb.url, fakeAi);
});
after(() => {
  app.server.close();
  hb.stop();
});

async function signedIn() {
  const c = new Client(app.url);
  const r = await c.call("POST", "/api/login", { username: "rob@example.com", password: "pw" });
  assert.equal(r.status, 200);
  return c;
}

test("rejects API calls without a session", async () => {
  const c = new Client(app.url);
  assert.equal((await c.call("GET", "/api/locations")).status, 401);
  assert.equal((await c.call("POST", "/api/ai/identify", { photos: [PHOTO] })).status, 401);
});

test("wrong password is a 401 with a friendly message", async () => {
  const r = await new Client(app.url).call("POST", "/api/login", { username: "rob@example.com", password: "nope" });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, "Wrong email or password");
});

test("session cookie is HttpOnly and never exposes the Homebox token", async () => {
  const res = await fetch(app.url + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "rob@example.com", password: "pw" }),
  });
  const cookie = res.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.ok(!cookie.includes(hb.token));
  assert.ok(!(await res.text()).includes(hb.token));
});

test("non-JSON posts are refused (blocks cross-site form posts)", async () => {
  const c = await signedIn();
  const res = await fetch(app.url + "/api/items", { method: "POST", headers: { "content-type": "text/plain", cookie: c.cookie }, body: "{}" });
  assert.equal(res.status, 415);
});

test("lists locations with full paths", async () => {
  const c = await signedIn();
  const r = await c.call("GET", "/api/locations");
  assert.deepEqual(r.data.map((l: any) => l.path), ["Garage", "Garage › Metal shelf"]);
});

test("creates a location", async () => {
  const c = await signedIn();
  const r = await c.call("POST", "/api/locations", { name: "Drawer 3", parentId: garage });
  assert.equal(r.status, 200);
  assert.equal(hb.entities.get(r.data.id)?.isLocation, true);
  assert.equal(hb.entities.get(r.data.id)?.parentId, garage);
});

test("creates an item with details, tags and photos, then finds and moves it", async () => {
  const c = await signedIn();
  const created = await c.call("POST", "/api/items", {
    name: "Cordless drill",
    parentId: shelf,
    manufacturer: "Makita",
    modelNumber: "DHP482",
    serialNumber: "SN123456",
    purchasePrice: 120,
    insured: true,
    tags: ["18v", "Drill"],
    photos: [PHOTO, PHOTO],
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const e = hb.entities.get(created.data.id)!;
  assert.equal(e.fields.serialNumber, "SN123456");
  assert.equal(e.fields.insured, true);
  assert.equal(e.parentId, shelf);
  assert.equal(e.attachments.length, 2);
  assert.equal(e.attachments.filter((a) => a.primary).length, 1);
  assert.deepEqual(hb.tags.map((t) => t.name).sort(), ["18v", "Drill"]);

  // Same tag names again (different case) reuse the existing tags.
  await c.call("POST", "/api/items", { name: "Drill bits", tags: ["drill"] });
  assert.equal(hb.tags.length, 2);

  const found = await c.call("GET", "/api/search?q=cordless");
  assert.equal(found.data.length, 1);
  assert.equal(found.data[0].location, "Garage › Metal shelf");
  assert.ok(found.data[0].imageId);

  const photo = await fetch(`${app.url}/api/items/${e.id}/photos/${found.data[0].imageId}`, { headers: { cookie: c.cookie } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/jpeg");

  const moved = await c.call("PATCH", `/api/items/${e.id}/location`, { parentId: garage });
  assert.equal(moved.status, 200);
  assert.equal(hb.entities.get(e.id)!.parentId, garage);
});

test("validates item input", async () => {
  const c = await signedIn();
  const r = await c.call("POST", "/api/items", { name: "", photos: [] });
  assert.equal(r.status, 400);
});

test("AI identify, label and parse go through the configured provider", async () => {
  const c = await signedIn();
  const id = await c.call("POST", "/api/ai/identify", { photos: [PHOTO], hint: "blue one" });
  assert.equal(id.data.name, "Drill (blue one)");
  const label = await c.call("POST", "/api/ai/label", { photo: PHOTO });
  assert.equal(label.data.serialNumber, "SN123456");
  const parsed = await c.call("POST", "/api/ai/parse", { text: "angle grinder on the metal shelf" });
  assert.equal(parsed.data.locationId, shelf);
});

test("AI endpoints say so clearly when AI is switched off", async () => {
  const off = await startApp(hb.url, null);
  try {
    const c = new Client(off.url);
    await c.call("POST", "/api/login", { username: "rob@example.com", password: "pw" });
    const r = await c.call("POST", "/api/ai/identify", { photos: [PHOTO] });
    assert.equal(r.status, 503);
    assert.equal((await c.call("GET", "/api/status")).data.ai, null);
  } finally {
    off.server.close();
  }
});

test("serves the app shell and refuses path traversal", async () => {
  const home = await fetch(app.url + "/");
  assert.match(await home.text(), /Workshop Capture/);
  const sneaky = await fetch(app.url + "/..%2f..%2fpackage.json");
  assert.doesNotMatch(await sneaky.text(), /"dependencies"/);
});

test("logout ends the session", async () => {
  const c = await signedIn();
  const old = c.cookie;
  await c.call("POST", "/api/logout", {});
  const r = await fetch(app.url + "/api/locations", { headers: { cookie: old } });
  assert.equal(r.status, 401);
});

test("explains clearly when Homebox can't be reached", async () => {
  const down = await startApp("http://127.0.0.1:9", null);
  try {
    const r = await new Client(down.url).call("POST", "/api/login", { username: "a@b.c", password: "x" });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /Can't reach Homebox/);
  } finally {
    down.server.close();
  }
});
