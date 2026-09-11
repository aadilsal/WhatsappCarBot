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
      thinking: { type: "disabled" }, // deterministic JSON extraction — no reasoning needed
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude parse call failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const content: Array<{ type: string; text?: string }> = data.content ?? [];
  // Sonnet 5 emits a leading `thinking` block before the `text` block, so the
  // text content isn't reliably at index 0 — find it by type instead.
  const text: string = content.find((block) => block.type === "text")?.text ?? "";
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
    console.error("callClaudeForJson: failed to parse model output as JSON", candidate);
    return null;
  }
}
