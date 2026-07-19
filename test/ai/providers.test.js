import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createGroqProvider, createGeminiProvider } from "../../src/ai/providers.js";

function fakeFetch({ status = 200, body }) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  fn.calls = calls;
  return fn;
}

describe("Groq provider", () => {
  test("sends the system/user messages and returns the message content", async () => {
    const fetchImpl = fakeFetch({ body: { choices: [{ message: { content: '{"ok":true}' } }] } });
    const groq = createGroqProvider("fake-key", { fetchImpl });

    const result = await groq("system prompt", "user prompt");

    assert.equal(result, '{"ok":true}');
    assert.equal(fetchImpl.calls.length, 1);
    const requestBody = JSON.parse(fetchImpl.calls[0].options.body);
    assert.equal(requestBody.messages[0].content, "system prompt");
    assert.equal(requestBody.messages[1].content, "user prompt");
    assert.equal(fetchImpl.calls[0].options.headers.Authorization, "Bearer fake-key");
  });

  test("throws a clear error on a non-2xx response", async () => {
    const fetchImpl = fakeFetch({ status: 429, body: { error: "rate limited" } });
    const groq = createGroqProvider("fake-key", { fetchImpl });
    await assert.rejects(() => groq("s", "u"), /Groq API error: 429/);
  });

  test("throws on an unexpected response shape rather than returning undefined silently", async () => {
    const fetchImpl = fakeFetch({ body: { unexpected: "shape" } });
    const groq = createGroqProvider("fake-key", { fetchImpl });
    await assert.rejects(() => groq("s", "u"), /unexpected response shape/);
  });
});

describe("Gemini provider", () => {
  test("sends the prompt and returns the candidate text", async () => {
    const fetchImpl = fakeFetch({
      body: { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] },
    });
    const gemini = createGeminiProvider("fake-key", { fetchImpl });

    const result = await gemini("system prompt", "user prompt");

    assert.equal(result, '{"ok":true}');
    const requestBody = JSON.parse(fetchImpl.calls[0].options.body);
    assert.equal(requestBody.systemInstruction.parts[0].text, "system prompt");
    assert.equal(requestBody.contents[0].parts[0].text, "user prompt");
    assert.match(fetchImpl.calls[0].url, /key=fake-key/);
  });

  test("throws a clear error on a non-2xx response", async () => {
    const fetchImpl = fakeFetch({ status: 500, body: { error: "server error" } });
    const gemini = createGeminiProvider("fake-key", { fetchImpl });
    await assert.rejects(() => gemini("s", "u"), /Gemini API error: 500/);
  });
});
