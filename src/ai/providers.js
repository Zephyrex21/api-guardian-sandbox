const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Returns an async (system, user) => text function backed by Groq's
 * OpenAI-compatible chat completions API. fetchImpl defaults to the real
 * global fetch but can be swapped for a fake in tests, so the request-
 * building and response-parsing logic here is fully testable without a
 * real API key or network access.
 */
export function createGroqProvider(apiKey, { fetchImpl = fetch } = {}) {
  return async function callGroq(system, user) {
    const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${await safeText(response)}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("Groq API returned an unexpected response shape (no message content)");
    }
    return text;
  };
}

/**
 * Same idea as createGroqProvider, but for Google's Gemini API - used as
 * the fallback if Groq is down or rate-limited.
 */
export function createGeminiProvider(apiKey, { fetchImpl = fetch } = {}) {
  return async function callGemini(system, user) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${await safeText(response)}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Gemini API returned an unexpected response shape (no candidate text)");
    }
    return text;
  };
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "(no response body)";
  }
}
