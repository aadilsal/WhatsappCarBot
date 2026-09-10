// Shared Anthropic call helper. Every parsing call returns structured JSON
// against an explicit schema described in the prompt — never freeform text
// the caller re-parses (agents.md).

const MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export async function callClaudeForJson(system: string, userText: string): Promise<unknown | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude parse call failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? "";
  return extractJson(text);
}

function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  // Strip markdown fences if Claude adds them despite instructions.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
