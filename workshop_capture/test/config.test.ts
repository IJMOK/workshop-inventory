import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.ts";

const NO_FILE = "/nonexistent/options.json";

test("reads Home Assistant add-on options", () => {
  const dir = mkdtempSync(join(tmpdir(), "wc-"));
  const file = join(dir, "options.json");
  writeFileSync(file, JSON.stringify({ ai_provider: "anthropic", ai_api_key: "sk-test", homebox_url: "http://hb:7745/", currency: "EUR" }));
  const cfg = loadConfig({}, file);
  assert.equal(cfg.ai.provider, "anthropic");
  assert.equal(cfg.homeboxUrl, "http://hb:7745");
  assert.equal(cfg.ai.currency, "EUR");
});

test("falls back to environment variables and defaults", () => {
  const cfg = loadConfig({ AI_PROVIDER: "none" }, NO_FILE);
  assert.equal(cfg.port, 8099);
  assert.equal(cfg.homeboxUrl, "http://172.30.32.1:7745");
  assert.equal(cfg.ai.currency, "GBP");
});

test("requires a key for hosted providers and a model where there is no default", () => {
  assert.throws(() => loadConfig({ AI_PROVIDER: "anthropic" }, NO_FILE), /ai_api_key/);
  assert.throws(() => loadConfig({ AI_PROVIDER: "gemini", AI_API_KEY: "k" }, NO_FILE), /ai_model/);
  assert.throws(() => loadConfig({ AI_PROVIDER: "openai" }, NO_FILE), /ai_model/);
  assert.equal(loadConfig({ AI_PROVIDER: "openai", AI_MODEL: "llava", AI_BASE_URL: "http://x:11434/v1" }, NO_FILE).ai.model, "llava");
  assert.throws(() => loadConfig({ AI_PROVIDER: "bogus" }, NO_FILE), /one of/);
});
