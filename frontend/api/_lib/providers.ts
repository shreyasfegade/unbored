/**
 * LLM providers: Google Gemini (REST generateContent) and DeepSeek (OpenAI-
 * compatible chat completions). Ports of backend/app/llm/gemini.py and
 * openai_compatible.py. Every call has a hard timeout, retries once on a 5xx,
 * and reports *how* it failed so the client can tell the user honestly.
 * Keys are never logged.
 */

export type ProviderName = "gemini" | "deepseek";
export type Outcome = "ok" | "timeout" | "limited" | "rejected" | "error";

export interface Generation {
  text: string | null;
  outcome: Outcome;
}

export interface GenerateArgs {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
export const deepseekModel = () => process.env.DEEPSEEK_MODEL || "deepseek-chat";

function geminiText(json: unknown): string | null {
  const cand = (json as { candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[] })
    ?.candidates?.[0];
  if (!cand || cand.finishReason === "SAFETY") return null;
  const text = cand.content?.parts?.[0]?.text?.trim();
  return text || null;
}

function openaiText(json: unknown): string | null {
  const text = (json as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content?.trim();
  return text || null;
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, retry = true): Promise<{ status: number; json: unknown } | "timeout" | "network"> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return (err as Error)?.name === "TimeoutError" ? "timeout" : "network";
  }
  if (res.status >= 500 && retry) return post(url, headers, body, timeoutMs, false);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

export async function generate(provider: ProviderName, apiKey: string, a: GenerateArgs): Promise<Generation> {
  let result: Awaited<ReturnType<typeof post>>;
  let extract: (json: unknown) => string | null;

  if (provider === "gemini") {
    const url = `${GEMINI_BASE}/models/${geminiModel()}:generateContent`;
    result = await post(
      url,
      { "x-goog-api-key": apiKey },
      {
        contents: [{ role: "user", parts: [{ text: a.user }] }],
        systemInstruction: { parts: [{ text: a.system }] },
        generationConfig: { temperature: a.temperature, maxOutputTokens: a.maxTokens, topP: 0.9, topK: 40 },
        // Titles like "Saw" or "War" shouldn't trip a filter on a one-line reason.
        safetySettings: [
          "HARM_CATEGORY_HARASSMENT",
          "HARM_CATEGORY_HATE_SPEECH",
          "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          "HARM_CATEGORY_DANGEROUS_CONTENT",
        ].map((category) => ({ category, threshold: "BLOCK_NONE" })),
      },
      a.timeoutMs,
    );
    extract = geminiText;
  } else {
    result = await post(
      `${DEEPSEEK_BASE}/chat/completions`,
      { Authorization: `Bearer ${apiKey}` },
      {
        model: deepseekModel(),
        messages: [
          { role: "system", content: a.system },
          { role: "user", content: a.user },
        ],
        temperature: a.temperature,
        max_tokens: a.maxTokens,
        stream: false,
      },
      a.timeoutMs,
    );
    extract = openaiText;
  }

  if (result === "timeout") return { text: null, outcome: "timeout" };
  if (result === "network") return { text: null, outcome: "error" };
  if (result.status === 429) return { text: null, outcome: "limited" };
  if ([400, 401, 403].includes(result.status)) return { text: null, outcome: "rejected" };
  if (result.status !== 200) return { text: null, outcome: "error" };
  const text = extract(result.json);
  return { text, outcome: text ? "ok" : "error" };
}
