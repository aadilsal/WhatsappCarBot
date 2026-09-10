// Thin wrapper around the WhatsApp Cloud API. Nothing here decides *whether*
// to send or which channel to use — that's send.ts. This only knows how to
// make the HTTP call.

const GRAPH_VERSION = "v21.0";

function apiUrl(): string {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
}

async function post(body: Record<string, unknown>): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const res = await fetch(apiUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${text}`);
  }
}

export async function sendFreeformText(waId: string, body: string): Promise<void> {
  await post({
    messaging_product: "whatsapp",
    to: waId,
    type: "text",
    text: { body },
  });
}

// Template sends are stubbed until garage_reminder / garage_summary /
// garage_checkin clear Meta's review (architecture.md §6, build order item
// 7 — explicitly deferred past tonight's scope). Calling this before
// approval will fail at the Graph API; send.ts only reaches here outside the
// 24h window, which won't happen during same-session testing.
export async function sendTemplate(
  waId: string,
  templateName: string,
  bodyParams: string[],
): Promise<void> {
  await post({
    messaging_product: "whatsapp",
    to: waId,
    type: "template",
    template: {
      name: templateName,
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: bodyParams.map((text) => ({ type: "text", text })),
        },
      ],
    },
  });
}
