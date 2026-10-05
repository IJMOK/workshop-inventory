import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { parseJsonReply } from "../src/ai/json.ts";
import { LabelReading } from "../src/ai/schemas.ts";
import { OpenAiCompatibleProvider } from "../src/ai/openai.ts";
import { createProvider } from "../src/ai/index.ts";
import { AiError } from "../src/ai/types.ts";

const label = { manufacturer: "Bosch", modelNumber: "GSR 18V", serialNumber: "123", partNumber: "", manufactureDate: "", otherText: "", confidence: "high" };

test("parses JSON wrapped in code fences", () => {
  const r = parseJsonReply(LabelReading, "```json\n" + JSON.stringify(label) + "\n```");
  assert.equal(r.serialNumber, "123");
});

test("rejects replies missing fields", () => {
  assert.throws(() => parseJsonReply(LabelReading, '{"manufacturer":"Bosch"}'), AiError);
  assert.throws(() => parseJsonReply(LabelReading, "no json here"), AiError);
});

test("factory picks the configured provider", () => {
  const base = { apiKey: "k", model: "", baseUrl: "", currency: "GBP" };
  assert.equal(createProvider({ ...base, provider: "none" }), null);
  assert.equal(createProvider({ ...base, provider: "anthropic" })?.name, "anthropic");
  assert.equal(createProvider({ ...base, provider: "openai", model: "m" })?.name, "openai");
  assert.equal(createProvider({ ...base, provider: "gemini", model: "m" })?.name, "gemini");
});

test("OpenAI-compatible adapter sends images and a schema, and validates the reply", async () => {
  let seen: any;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    seen = { path: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(label) } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const p = new OpenAiCompatibleProvider({
      apiKey: "",
      model: "llava",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`,
      currency: "GBP",
    });
    const r = await p.readLabel({ mediaType: "image/jpeg", data: "AAAA" });
    assert.equal(r.modelNumber, "GSR 18V");
    assert.equal(seen.path, "/v1/chat/completions");
    assert.equal(seen.auth, undefined); // local servers like Ollama need no key
    assert.equal(seen.body.model, "llava");
    assert.equal(seen.body.messages[1].content[0].image_url.url, "data:image/jpeg;base64,AAAA");
    assert.match(seen.body.messages[0].content, /serialNumber/);
  } finally {
    server.close();
  }
});

test("Anthropic adapter sends photos, a JSON schema and the refusal fallback", async () => {
  const { AnthropicProvider } = await import("../src/ai/anthropic.ts");
  let seen: any;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    seen = { path: req.url, beta: req.headers["anthropic-beta"], body: JSON.parse(Buffer.concat(chunks).toString()) };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: seen.body.model, stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: JSON.stringify(label) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const p = new AnthropicProvider({ apiKey: "k", model: "claude-opus-5-5", currency: "GBP", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    const r = await p.readLabel({ mediaType: "image/jpeg", data: "AAAA" });
    assert.equal(r.serialNumber, "123");
    assert.match(seen.path, /^\/v1\/messages/);
    assert.match(seen.beta, /server-side-fallback-2026-07-01/);
    assert.equal(seen.body.fallbacks, "default");
    assert.equal(seen.body.output_config.format.type, "json_schema");
    assert.equal(seen.body.messages[0].content[0].source.data, "AAAA");
  } finally {
    server.close();
  }
});
