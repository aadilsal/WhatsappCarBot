# Garage Bot — Architecture

For product scope and rationale, see PRD.md. For a one-page operational cheat-sheet, see architecture-essentials.md. This document is the full technical design.

## 0. Stack

- **Convex** — database, server functions (queries/mutations/actions), crons, HTTP endpoints. Single backend, no separate API server.
- **WhatsApp Cloud API** — inbound webhook + outbound messages (free-form and template).
- **Claude (Anthropic API)** — parses free-form WhatsApp text into structured fields at every step: setup wizard answers, event logging, corrections, commands.
- **WhatsApp is the primary interface; a companion read/edit web dashboard exists for browsing history, filtering, and light corrections.** No deletion of events/documents anywhere 2014 that history matters for resale 2014 see §6.

## 1. Design principles

**Multi-vehicle from the first migration.** `vehicleId` sits on every row from day one. Retrofitting it later means rewriting every query and backfilling every record. Adding it now costs one column and one index. With a single vehicle the bot never asks which one — the cost is invisible until the day you need it.

**Rules, not hardcoded reminders.** Adding a new maintenance item is inserting a row, not editing application logic. Each vehicle owns its own copy of every rule, so overriding the oil interval on a 1976 Corolla is a plain UPDATE with no special-casing.

**Derive, don't store.** Due dates are computed on every evaluation from an anchor plus an interval. A stored due date goes stale the moment a service is logged out of band.

**The odometer is the backbone.** Every kilometre-based rule fails silently without it. Capture is designed around this single fact (see §4, odometer capture).

**Chat still carries everything for logging.** The dashboard (web/) is for browsing/filtering history, light corrections (never deleting), and reminders — new events are best logged by talking to the bot, which is still the fastest path and the only one with a `set` command and `undo`.

## 2. Data model

Seven tables. Everything else is derived at query/cron time.

### `users`
One row, realistically (see §9 on multi-user). Fields: `waId` (phone number, unique index), timezone offset, `lastInboundAt` (governs the 24h free-form window, §6), and toggles for the daily check-in and weekly/monthly summaries.

### `vehicles`
Identity: nickname, make, model, year, plate, VIN, engine, fuel type, purchase date, purchase price.

Live odometer state:
- `currentOdo` — last known reading.
- `currentOdoAt` — timestamp of that reading.
- `avgKmPerDay` — smoothed daily rate (30% blend weight per new reading, §4).

`avgKmPerDay` is what lets the bot estimate today's odometer between fill-ups so a reminder can say "due in ~650 km (roughly 11 days at your current rate)" without waiting for a fresh reading.

Index: by `userId`; by `waId` + nickname/plate for resolution.

### `events`
The single append-only log. Every fuel fill, service, repair, wash, expense, document, and bare odometer reading is one row here.

Fields: `vehicleId`, `kind` (`fuel` | `service` | `expense` | `odo` | `document` | `note`), `category` (`oil`, `tyre_rotation`, `insurance`, …), `odo`, `amount` (PKR), `liters`, `fullTank` (bool), `expiresAt`, `notes`, `raw` (the original WhatsApp text, kept so a bad parse can always be diagnosed), `createdAt`.

Each event also carries an **undo snapshot**: a serialized copy of the vehicle's odometer state (`currentOdo`, `currentOdoAt`, `avgKmPerDay`) and every rule anchor (`anchorOdo`, `anchorAt` per affected rule) exactly as they were immediately *before* this event was written. `undo` restores from this snapshot rather than trying to reverse-compute the mutation.

Index: by `vehicleId` + `createdAt` (history/summary queries); by `vehicleId` + `kind` (category history).

### `rules`
One row per maintenance item per vehicle (denormalized on purpose — see below). Two modes:

- **interval** — `intervalKm` and/or `intervalMonths`, measured from `anchorOdo` / `anchorAt`.
- **expiry** — an absolute `dueAt` (insurance, registration, token tax).

Plus `anchorEstimated` (bool), set true when setup assumed the anchor (anchored to "now") rather than being given a real date/reading, and `overridden` state for `set` command interval changes.

Anchors are denormalized onto the rule row and patched in the *same mutation* that writes a matching event. The alternative — scanning the event log on every cron tick to find the last oil change — is one query per rule per hour, forever, to compute something that only changes when an event is written. Denormalization trades a small write-time cost (patch the rule row alongside the event insert) for zero read-time cost, and reads (hourly cron × N rules) vastly outnumber writes (one per log).

Index: by `vehicleId`; by `vehicleId` + `category`.

### `sentReminders`
One row per `(ruleId, cycleKey, tierKey)` actually delivered. This is what stops the hourly cron from re-sending the same nudge sixty times.

`cycleKey` is the identity of the current service cycle, derived deterministically from the anchor (e.g. a hash or concatenation of `anchorOdo`/`anchorAt`). Logging an oil change changes the anchor, which changes `cycleKey`, which makes every previously-sent-reminder row for that rule belong to a *stale* cycle — the ladder resets with no explicit cleanup mutation required; the evaluator simply won't find a matching row for the new cycle key.

Index: by `ruleId` + `cycleKey` (uniqueness / lookup at cron time).

### `pending`
Multi-turn conversation state: an in-progress setup draft, a "which vehicle?" disambiguation awaiting a reply, an odometer prompt awaiting a number-or-`skip`. Carries an `expiresAt` so a stale pending state doesn't hijack an unrelated future message.

Index: by `waId` (one active pending state per user, looked up on every inbound message before generic parsing).

### `inboundMessages`
Meta retries webhooks on any non-2xx or timeout. Every inbound message ID is checked against this table and inserted before any side-effecting logic runs. Skipping this dedupe means one delivery hiccup logs your fuel twice.

Index: by Meta's message ID (unique).

## 3. First-time setup

Setup asks for everything, in three passes: **identity → odometer → calibration.**

The calibration pass is the one that matters and the one most maintenance loggers skip. If rule anchors are seeded at "now," the bot silently claims your oil, coolant, brake fluid and timing belt were all done the day you signed up. A Civic that's actually due next week goes quiet for 5,000 km. Reminders become decorative.

### The steps

| # | Asks | Required |
|---|------|----------|
| 1 | Nickname | Yes |
| 2 | Make, model, year | Yes |
| 3 | Registration number | Yes |
| 4 | Fuel type (buttons) | Yes |
| 5 | Current odometer | Yes |
| 6 | Last oil change — km and roughly when | Skippable |
| 7 | Other recent services, free-text | Skippable |
| 8 | Insurance expiry | Skippable |
| 9 | Registration / token tax expiry | Skippable |
| 10 | VIN, engine, purchase date, price | Skippable |

### Mechanics

- **Every step accepts a paste.** Answer step one with `Civic, Honda 2018, ABC-123, petrol, 124350 km` and Claude fills four fields at once; the wizard skips straight to step five. There is no separate "quick setup" branch — the parser is always allowed to fill any field it recognises, and the step pointer just advances to the first thing still missing.
- **Step 7 takes a blob.** `tyres rotated at 118000, air filter last month, coolant done Jan 2025, battery installed Jan 2026` becomes four anchors in one message. Relative dates resolve to absolute timestamps at parse time so nothing downstream deals with fuzzy time.
- **Every optional step accepts `skip`**, and the skip is recorded in the draft so resuming later doesn't re-ask it.
- **The draft is persisted after every turn** (in `pending`). Setup interrupted at step six resumes at step six, an hour or a day later.
- **Each answer is echoed back**: "Got it — 124,350 km." A misparse is visible immediately, while it's still one message to fix.

### On completion

The vehicle is created and all sixteen rules are seeded in one write (a single Convex mutation — vehicle insert + 16 rule inserts, atomic). Categories answered during calibration get real anchors; the rest anchor to today and are flagged `anchorEstimated`. The closing message states the split honestly:

> ✅ **Civic** is set up.
> 2018 Honda Civic · ABC-123
> Odometer: 124,350 km
>
> 4 service intervals are calibrated from real dates. 12 are running on estimates until you log them.

Estimated rules phrase their reminders more softly (e.g. "roughly due" vs. "due") until a real event replaces the anchor. Any of them can be corrected later without repeating setup: *"oil was actually done at 121000 in March"* — parsed as a correction, patches the rule anchor directly.

`add vehicle` runs the same wizard again, scoped to a new `vehicleId`.

## 4. Logging

Natural language, single message, no menus.

```
Filled petrol 3000
Filled Corolla petrol 3000, 124500
Oil change 4500
Insurance renewed till 15 Dec
Wash 400
```

**Vehicle resolution.** One active vehicle: never ask. Multiple: match the message against nicknames, then plates, then model names, in that priority order. On a miss, send an interactive list — WhatsApp buttons cap at three options, a list message holds up to ten.

**Odometer capture.** Fuel is the highest-frequency event, so it's the capture point. If a fuel message has no reading, the bot asks once via a `pending` prompt. `skip` is accepted — the event is saved without an odometer value, and existing rules carry on from the last known reading/rate. Nagging on every fill is how people stop logging, so this only asks once per event, never retries.

**Rate smoothing.** Each new odometer reading blends into `avgKmPerDay` at 30% weight: `avgKmPerDay = 0.3 × impliedRate + 0.7 × avgKmPerDay`, where `impliedRate = (newOdo - currentOdo) / daysSince(currentOdoAt)`. Readings that go backwards (`newOdo < currentOdo`) or imply more than 800 km/day are rejected as typos rather than written — the event is still logged, but the odometer/rate state is left untouched and the bot flags the anomaly back to the user.

**Full-tank flag.** Captured on every fuel event at zero extra cost to the user (a single follow-up question or inferred from phrasing like "filled up"/"topped off"). It is the only thing that makes honest km/l possible later — partial fills silently corrupt fuel economy maths if you don't record which is which. Fuel economy itself is computed lazily between two consecutive full-tank events, never stored (see PRD.md §10).

**Undo.** `undo` reverses the last event completely — the row, the odometer, the smoothed rate, and every rule anchor it moved — by restoring from that event's undo snapshot (§2, `events`). Without a dashboard this is the only correction mechanism, so it has to be exact rather than approximate: a partial undo that fixes the event row but leaves a stale rule anchor is worse than no undo at all, because the discrepancy is invisible until a reminder fires wrong.

## 5. Reminder engine

An hourly cron evaluates every active rule across every vehicle.

**Projection.** `projectedOdo = currentOdo + avgKmPerDay × daysSinceReading`. Every km-based rule is measured against this projected value, not against the last physical reading — otherwise a rule goes silent for weeks between fill-ups even as the car keeps racking up kilometres.

**Due calculation.**
- interval: `kmRemaining = anchorOdo + intervalKm − projectedOdo`; `daysRemaining = (anchorAt + intervalMonths) − now`.
- expiry: `daysRemaining = dueAt − now`.

A rule with both a km and a month interval (oil: 5,000 km **or** 6 months) computes both and fires on whichever is proportionally closer to its own limit (i.e. compare `kmRemaining / intervalKm` against `daysRemaining / (intervalMonths × 30)`, smaller ratio wins).

**Tier ladder.**
- Kilometres: 1,000 km → 250 km → overdue.
- Days: 30 → 14 → 7 → 1 → overdue.

**Overdue escalation.** Overdue buckets by distance rather than firing daily — every 500 km or every 7 days past due. The message gets more insistent as it gets worse, without becoming noise you learn to ignore. Bucketing is implemented by computing an "overdue bucket index" (`floor(kmOverdue / 500)` or `floor(daysOverdue / 7)`) and using that index as part of `tierKey` in `sentReminders` — a new bucket is a new tier, so it fires again exactly once per bucket crossing.

**Default rules seeded per vehicle**

| Item | Interval |
|---|---|
| Engine oil | 5,000 km or 6 months |
| Tyre rotation | 10,000 km |
| Wheel alignment | 10,000 km |
| Air filter | 20,000 km |
| Cabin filter | 15,000 km |
| Brake inspection | 15,000 km |
| Coolant | 24 months |
| Brake fluid | 24 months |
| Transmission oil | 40,000 km |
| Spark plugs | 40,000 km |
| Timing belt | 100,000 km |
| Battery inspection | 6 months |
| Battery replacement | 30 months |
| Insurance | expiry date |
| Registration | expiry date |
| Token tax | expiry date |

Override per vehicle: `set corolla oil 4000km` patches `rules.intervalKm` directly; the anchor is untouched, so the next-due calculation reflects the new interval immediately without waiting for the next event.

## 6. The WhatsApp constraint

**This is the thing that breaks otherwise-finished projects, so it shapes the whole outbound design.**

The Cloud API only permits free-form messages within 24 hours of the user's last inbound message. Every proactive send — the 10 PM check-in, the Sunday summary, every reminder — is outbound-initiated. On any day you didn't happen to message the bot, all of it silently fails to deliver.

Outside the window, only pre-approved template messages go through. Templates have fixed structure with variable slots, which rules out "Claude writes a friendly natural message" for proactive sends. Body parameters also can't contain newlines, tabs, or four-plus consecutive spaces — Meta rejects the send outright.

**The resolution: templates are a doorbell, not the message.**

Three approved templates, each deliberately terse:

- `garage_reminder` — "{{1}}: {{2}} coming up. Reply for details."
- `garage_summary` — "Your {{1}} summary is ready. Reply to see it."
- `garage_checkin` — "Anything to log for {{1}} today?"

Any reply re-opens the 24-hour window, and the full natural-language message goes out free-form immediately after (triggered off the webhook handler that stamps `lastInboundAt`, checking for a pending "queued rich message" tied to that user). Inside the window the template is skipped entirely and the rich message sends directly. One send wrapper (`sendToUser(userId, richMessage, templateFallback)`) checks `lastInboundAt` against the 24h threshold and picks the channel — no calling code branches on this itself.

**Crons run in UTC.** Pakistan is UTC+5, so a 10 PM local check-in is `0 17 * * *`. Weekly summary Sunday evening is `0 15 * * 0`.

**Submit templates early.** Meta's template review can take days; this is why template submission is explicitly slotted into "Next" rather than blocking the "Tonight" build order (§8) — the reminder *engine* can be built and tested against the free-form path before templates are approved.

## 7. Commands

Everything the dashboard would have done:

| Command | Result |
|---|---|
| `due` | Everything approaching or overdue, all vehicles |
| `due civic` | Scoped to one vehicle |
| `summary` | This month so far |
| `summary aug` | A named month |
| `week` | Last 7 days |
| `history civic oil` | Recent events in one category |
| `vehicles` | List with odometers |
| `rules civic` | Every interval and its current status |
| `set civic oil 4000km` | Override an interval |
| `add vehicle` | Run setup again |
| `undo` | Reverse the last entry |

Weekly and monthly summaries follow the same format: fuel spend, distance, maintenance, repairs, wash, total, and what's coming up.

Commands are matched by a lightweight intent classifier (keyword/regex first; Claude fallback for anything ambiguous) run before generic event-logging parse, since a message like `due` or `undo` is not itself a loggable event.

## 8. Build order

**Tonight**
1. Schema — all seven tables, indexes included.
2. Webhook: verify handshake, dedupe via `inboundMessages`, stamp `lastInboundAt`.
3. Setup wizard.
4. Event logging with odometer capture and anchor patching.
5. Rule evaluator plus the hourly cron.
6. `due` and `undo`.

**Next**
7. Template approval (submit early — review takes time).
8. Summaries and the daily check-in.
9. Interval overrides and anchor corrections.
10. Fuel economy from full-tank pairs.

**Later**
11. Documents, receipts, photos — WhatsApp media handling is its own project.
12. Charts, rendered as images and sent into the chat.

Nothing after item six changes the schema, which is the point of writing it correctly the first time.

## 9. Open decisions

- **Media storage.** Convex file storage is the obvious fit, but downloading from Meta's media endpoint needs an authenticated fetch and a URL that expires quickly — needs a scheduled action to pull the media promptly after webhook receipt, before Meta's URL expires.
- **Multiple users.** Everything is keyed by `userId` already. Adding family members is an invite flow, not a migration — but shared vehicles need a decision about who receives which reminders (all members? a designated primary?).
- **Fuel economy.** Only meaningful between two consecutive full tanks. Worth computing lazily on request rather than storing, since a stored value would need invalidation logic every time a fuel event is corrected or undone.
- **Personal-number libraries.** Avoid the template dance entirely, at the cost of a ban risk. Acceptable on a project that only serves the builder; not acceptable if family joins (see PRD.md §10).

## 10. Security & secrets

- WhatsApp Cloud API access token and app secret, and the Anthropic API key, are Convex environment variables — never committed, never logged in plaintext (event `raw` text is expected to contain user data, not secrets).
- Webhook handshake verification (`hub.verify_token`) must match the Meta App Dashboard configuration exactly; treat this token as a secret.
- Inbound webhook payloads are unauthenticated beyond Meta's signature header (`X-Hub-Signature-256`) — verify this signature before processing any payload, not just before writing to the DB.
- No PII beyond phone number and vehicle data is collected; this is a single/family-scoped tool, not a multi-tenant SaaS, so there is no cross-user data isolation requirement beyond `userId` scoping already implied by the schema.
