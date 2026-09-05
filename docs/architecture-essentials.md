# Garage Bot — Architecture Essentials

One-page reference. Full rationale in architecture.md; product framing in PRD.md.

## Stack
Convex (db + functions + crons + HTTP) · WhatsApp Cloud API (in/out) · Claude (all NL parsing). No frontend, ever — WhatsApp is the UI.

## Seven tables

| Table | Purpose | Key fields |
|---|---|---|
| `users` | one per owner | `waId`, `lastInboundAt`, timezone, summary/checkin toggles |
| `vehicles` | identity + live odo state | `nickname`, `currentOdo`, `currentOdoAt`, `avgKmPerDay` |
| `events` | append-only log, everything | `vehicleId`, `kind`, `category`, `odo`, `amount`, `liters`, `fullTank`, `expiresAt`, `raw`, **undo snapshot** |
| `rules` | one row per maintenance item per vehicle | `intervalKm`/`intervalMonths` OR `dueAt`, `anchorOdo`/`anchorAt`, `anchorEstimated` |
| `sentReminders` | dedupe key for the cron | `(ruleId, cycleKey, tierKey)` |
| `pending` | multi-turn state (setup draft, disambiguation, odo prompt) | `waId`, `expiresAt` |
| `inboundMessages` | webhook dedupe | Meta message ID (unique) |

## Non-negotiable invariants

- `vehicleId` on every row, from the first migration — never retrofit this.
- Due dates are **computed**, never stored. Anchor + interval, every evaluation.
- Rule anchors are **denormalized onto `rules`** and patched in the same mutation that writes the matching event — never scan the event log at cron time to find "last oil change."
- Every event carries an **undo snapshot** (vehicle odo state + all touched rule anchors, pre-write). `undo` restores from the snapshot, never reverse-computes.
- Dedupe inbound webhooks by Meta message ID **before** any side effect — Meta retries.
- Rate smoothing: `avgKmPerDay = 0.3 × implied + 0.7 × avgKmPerDay`; reject (don't write odo state for) readings that go backwards or imply >800 km/day.

## Reminder engine, in one paragraph

Hourly cron. `projectedOdo = currentOdo + avgKmPerDay × daysSinceReading`. Km-interval rules: `kmRemaining = anchorOdo + intervalKm − projectedOdo`. Month-interval: `daysRemaining = anchorAt + intervalMonths − now`. Expiry: `daysRemaining = dueAt − now`. Dual-interval rules (oil) fire on whichever ratio-to-limit is smaller. Tier ladder: km 1000/250/overdue, days 30/14/7/1/overdue. Overdue re-fires only on crossing a new 500km/7day bucket. `sentReminders` keyed on `(ruleId, cycleKey, tierKey)` — new event → new anchor → new `cycleKey` → ladder resets for free.

## The WhatsApp 24h rule

Free-form messages only work within 24h of the user's last inbound message. Outside it: three terse approved templates act as a **doorbell** (`garage_reminder`, `garage_summary`, `garage_checkin`) — reply reopens the window, full message sends free-form right after. One `sendToUser()` wrapper picks the channel by checking `lastInboundAt`; no caller branches on this itself. Template body params: no newlines/tabs/4+ spaces (Meta rejects). Crons in UTC: 10PM PKT check-in = `0 17 * * *`; Sunday-evening summary = `0 15 * * 0`.

## Default rule set (seeded per vehicle on setup)

Oil 5000km/6mo · Tyre rotation 10000km · Alignment 10000km · Air filter 20000km · Cabin filter 15000km · Brake inspection 15000km · Coolant 24mo · Brake fluid 24mo · Transmission oil 40000km · Spark plugs 40000km · Timing belt 100000km · Battery inspection 6mo · Battery replacement 30mo · Insurance/Registration/Token tax = expiry date. Override: `set <vehicle> <category> <N>km`.

## Setup wizard: identity → odometer → calibration

10 steps (nickname, make/model/year, plate, fuel type, odometer required; last oil, other services, insurance/registration expiry, VIN/engine/purchase details skippable). Any message can paste-fill multiple fields at once — parser always fills what it recognizes, step pointer advances to first gap. Draft persists in `pending` after every turn. On completion: vehicle + all 16 rules inserted in one write; calibrated categories get real anchors, the rest anchor to "now" with `anchorEstimated: true` and softer reminder phrasing until replaced by a real event.

## Commands

`due` / `due <vehicle>` · `summary` / `summary <month>` · `week` · `history <vehicle> <category>` · `vehicles` · `rules <vehicle>` · `set <vehicle> <category> <N>km` · `add vehicle` · `undo`.

## Build order (schema-stable after step 6)

Tonight: schema → webhook (verify+dedupe+stamp `lastInboundAt`) → setup wizard → event logging w/ odo capture & anchor patching → rule evaluator + hourly cron → `due`/`undo`.
Next: template approval (submit early) → summaries + daily check-in → interval overrides/anchor corrections → fuel economy from full-tank pairs.
Later: media/documents → chart images.

## Open decisions (not yet resolved)

Media storage (Convex storage vs. proxied fetch from Meta's expiring URL) · multi-user reminder routing for shared vehicles · fuel economy computed lazily from full-tank pairs, never stored · personal-number library trade-off (skips templates, carries ban risk — fine solo, not once family joins).
