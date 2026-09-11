export function formatDate(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatOdo(km: number | undefined): string {
  if (km === undefined) return "—";
  return `${km.toLocaleString()} km`;
}

export function formatPKR(amount: number | undefined): string {
  if (amount === undefined) return "—";
  return `Rs ${amount.toLocaleString()}`;
}

// For <input type="date"> — local date, not UTC, so the value round-trips
// without drifting a day near midnight.
export function toDateInputValue(ms: number | undefined): string {
  if (ms === undefined) return "";
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function fromDateInputValue(value: string): number | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}
