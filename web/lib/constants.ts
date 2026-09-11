// Mirrors the `kind` union in convex/schema.ts's events table — stable
// enough (it's a schema-level type) to hardcode rather than round-trip
// through a query.
export const EVENT_KINDS = [
  { value: "fuel", label: "Fuel" },
  { value: "service", label: "Service" },
  { value: "expense", label: "Expense" },
  { value: "odo", label: "Odometer reading" },
  { value: "document", label: "Document" },
  { value: "note", label: "Note" },
] as const;

export type EventKind = (typeof EVENT_KINDS)[number]["value"];

export const FUEL_TYPES = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
  { value: "hybrid", label: "Hybrid" },
  { value: "electric", label: "Electric" },
  { value: "cng", label: "CNG" },
] as const;
