import { callClaudeForJson } from "./client";
import { DEFAULT_RULES } from "../rules";

const CATEGORIES = DEFAULT_RULES.map((r) => r.category);

export type ParsedEvent = {
  isEvent: boolean;
  kind?: "fuel" | "service" | "expense" | "odo" | "document" | "note";
  category?: string;
  odo?: number;
  amount?: number;
  liters?: number;
  fullTank?: boolean;
  expiresAt?: number;
  notes?: string;
  vehicleHint?: string; // a nickname/plate/model mentioned in the message, for resolution
};

export async function parseEventText(now: number, userText: string): Promise<ParsedEvent | null> {
  const system = `You classify and extract fields from a WhatsApp message logging something about a car, for a car-maintenance bot.
Current date/time (UTC ms epoch): ${now} (${new Date(now).toISOString()}).

Respond with ONLY a single JSON object, no prose, no markdown fences.

First decide isEvent (boolean): true if this message is logging a fuel fill, service, repair, wash, expense, odometer reading, or document/expiry update. False if it's a question, a command, small talk, or anything else that isn't logging something. If false, respond with just {"isEvent": false}.

If isEvent is true, also include:
- kind (one of "fuel","service","expense","odo","document","note")
- category (string, only for kind "service" or "document"): one of ${CATEGORIES.join(", ")}, or a short freeform category if none fit
- odo (number): odometer reading in km, if mentioned
- amount (number): amount spent in PKR, if mentioned
- liters (number): fuel volume, only for kind "fuel"
- fullTank (boolean): only for kind "fuel" — true if phrasing implies a full tank ("filled up", "topped off", "full tank"), false if explicitly partial, omit if unclear
- expiresAt (number): ms epoch timestamp, only for kind "document" — a new expiry date being set (e.g. "insurance renewed till 15 Dec")
- notes (string): brief freeform detail worth keeping, if any
- vehicleHint (string): a vehicle nickname, plate, or model mentioned in the message, if any (omit if the message doesn't name a specific vehicle)

Resolve any relative date to the ms epoch timestamp above.`;

  const result = await callClaudeForJson(system, userText);
  if (!result || typeof result !== "object") return null;
  return result as ParsedEvent;
}
