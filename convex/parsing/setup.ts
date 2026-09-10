import { callClaudeForJson } from "./client";
import { DEFAULT_RULES } from "../rules";

const SERVICE_CATEGORIES = DEFAULT_RULES.filter(
  (r) => r.mode === "interval" && r.category !== "oil",
).map((r) => r.category);

export type SetupExtraction = {
  nickname?: string;
  make?: string;
  model?: string;
  year?: number;
  plate?: string;
  fuelType?: "petrol" | "diesel" | "hybrid" | "electric" | "cng";
  currentOdo?: number;
  oilAnchorOdo?: number;
  oilAnchorAt?: number;
  otherServiceAnchors?: Array<{ category: string; odo?: number; at?: number }>;
  insuranceExpiry?: number;
  registrationExpiry?: number;
  tokenTaxExpiry?: number;
  vin?: string;
  engine?: string;
  purchaseDate?: number;
  purchasePrice?: number;
};

// Any step accepts a paste that fills multiple fields at once — architecture.md
// §3. We always offer the full schema, not just the current step's field, and
// let Claude fill whatever it recognizes; the wizard driver advances the step
// pointer to the first still-missing field afterward.
export async function extractSetupFields(now: number, userText: string): Promise<SetupExtraction> {
  const system = `You extract vehicle setup fields from a WhatsApp message for a car-maintenance bot.
Current date/time (UTC ms epoch): ${now} (${new Date(now).toISOString()}).

Respond with ONLY a single JSON object, no prose, no markdown fences. Omit any key you are not confident about — do not guess or invent values.

Recognized keys:
- nickname (string): a short name the user calls the vehicle
- make (string), model (string), year (number)
- plate (string): registration/number plate
- fuelType (one of "petrol","diesel","hybrid","electric","cng")
- currentOdo (number): current odometer reading in km
- oilAnchorOdo (number): odometer reading at last oil change, if mentioned
- oilAnchorAt (number): ms epoch timestamp of the last oil change, resolving any relative date ("6 months ago", "last March") against the current date above. Only for past events, never future.
- otherServiceAnchors (array of {category, odo?, at?}): any other maintenance items mentioned as already done, mapped to one of these categories: ${SERVICE_CATEGORIES.join(", ")}. Only include a category if it was actually mentioned.
- insuranceExpiry, registrationExpiry, tokenTaxExpiry (number): ms epoch timestamp of each expiry date if mentioned. These are future dates.
- vin (string), engine (string)
- purchaseDate (number): ms epoch timestamp
- purchasePrice (number)

If the message is just "skip" or clearly means skip this step, respond with {}.`;

  const result = await callClaudeForJson(system, userText);
  if (!result || typeof result !== "object") return {};
  return result as SetupExtraction;
}
