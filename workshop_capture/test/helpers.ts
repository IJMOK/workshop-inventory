import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { Config } from "../src/config.ts";
import type { AiProvider } from "../src/ai/types.ts";
import { buildServer } from "../src/server.ts";

export function testConfig(homeboxUrl: string): Config {
  return { port: 0, homeboxUrl, sessionHours: 1, dataDir: mkdtempSync(join(tmpdir(), "wc-data-")), ai: { provider: "none", apiKey: "", model: "", baseUrl: "", currency: "GBP" } };
}

export async function startApp(homeboxUrl: string, ai: AiProvider | null): Promise<{ url: string; server: Server }> {
  const server = buildServer({ config: testConfig(homeboxUrl), ai });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

/** Tiny client that keeps the session cookie between calls. */
export class Client {
  cookie = "";
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  async call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
    const res = await fetch(this.base + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data };
  }
}

export const fakeAi: AiProvider = {
  name: "fake",
  async identifyItem(photos, hint) {
    return { name: hint ? `Drill (${hint})` : "Cordless drill", manufacturer: "Makita", modelNumber: "DHP482", category: "power tool", description: "18V combi drill", tags: ["18v", "drill"], estimatedValue: 120, confidence: "high", alternatives: [] };
  },
  async readLabel() {
    return { manufacturer: "Makita", modelNumber: "DHP482", serialNumber: "SN123456", partNumber: "", manufactureDate: "2021", otherText: "18V", confidence: "high" };
  },
  async planProject() {
    return {
      items: [
        { name: "drill", kind: "tool", quantity: "" },
        { name: "wood glue", kind: "consumable", quantity: "1 bottle" },
      ],
    };
  },
  async parseRequest(text, locations) {
    const loc = locations.find((l) => text.toLowerCase().includes(l.path.split(" › ").pop()!.toLowerCase()));
    return { action: text.startsWith("where") ? "find" : "add", itemName: "angle grinder", locationName: loc ? loc.path : "", locationId: loc?.id ?? "", quantity: 1, notes: "" };
  },
};
