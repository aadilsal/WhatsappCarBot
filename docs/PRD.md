# Garage Bot — Product Requirements Document

## 1. Problem

Maintaining a vehicle (or several) means tracking fuel spend, service intervals, expiring documents, and odometer-based maintenance across a dozen different intervals — oil, filters, belts, fluids, insurance, registration. Today this lives in a mix of memory, scattered receipts, and mechanic's-shop stickers. Nothing reminds you before it's overdue, and nothing aggregates spend.

A dashboard app solves this but adds friction: open app, navigate to vehicle, find field, enter value. The friction is why people stop logging within a month.

## 2. Solution

A WhatsApp-native assistant. Every fill-up, service, repair, and document lives in one chat thread. No app to open, no login, no navigation — you're already in WhatsApp. Claude parses free-form messages into structured events; Convex stores them, evaluates maintenance rules hourly, and reminds you before things go overdue.

## 3. Target user

A single owner (initially the builder) managing 1–3 personal vehicles. Designed to extend to a small family sharing vehicles, but not built for fleet or commercial use.

## 4. Goals

- Log any vehicle event (fuel, service, expense, document, odometer reading, note) in one WhatsApp message, in natural language, in under 10 seconds.
- Never miss a maintenance interval or document expiry — surfaced proactively, not just on request.
- Support multiple vehicles from day one without the bot ever asking "which vehicle?" when there's only one.
- Make every number correctable by talking to the bot, or by editing it directly on the web dashboard (no delete, ever, for events/documents — that history is what matters when selling the car).
- Keep the reminder system rule-driven so adding a new maintenance category is a data change, not a code change.

## 5. Non-goals

- A companion web dashboard (Next.js + Convex, OTP login via WhatsApp) for browsing/filtering history and light corrections. WhatsApp stays the primary way to log — the dashboard never deletes events or documents, and vehicles are archived, not deleted (see architecture.md §6).
- No fleet/commercial features (driver assignment, dispatch, geofencing).
- No accounting-grade financial reporting — spend totals are for personal awareness, not tax filing.
- No support for vehicles without an odometer-relevant use case (the odometer is structurally load-bearing; see architecture.md §1).
- No real-time chat with a human; all replies are bot-authored.

## 6. Core user stories

### Setup
- As a new user, I can say `add vehicle` and answer a short wizard (identity → odometer → calibration) to onboard a vehicle.
- As a user in a hurry, I can paste multiple answers in one message (`Civic, Honda 2018, ABC-123, petrol, 124350 km`) and have the wizard skip every step that message answered.
- As a user, I can skip any optional calibration question and the bot will honestly tell me which rules are estimated vs. real.
- As a user, I can resume setup later if I stop mid-wizard.

### Logging
- As a user, I can log fuel, service, expense, wash, insurance renewal, or a bare odometer reading in one message, in my own words.
- As a user with one vehicle, I'm never asked which vehicle. With multiple, the bot resolves from nickname/plate/model, and asks via an interactive list only on a genuine miss.
- As a user, if I log fuel without an odometer reading, the bot asks once and accepts `skip`.
- As a user, I can mark a fill-up as a full tank so fuel economy can be computed later.
- As a user, I can undo my last entry and have every derived value (odometer, smoothed rate, rule anchors) roll back exactly.

### Reminders
- As a user, I get reminded before a service or document is due, with escalating urgency, and again (less naggy) if I let it go overdue.
- As a user, if I haven't messaged the bot in 24+ hours, I still get notified — via a short template that, once I reply, unlocks the full natural-language message.

### Retrieval & correction
- As a user, I can ask `due`, `due civic`, `summary`, `summary aug`, `week`, `history civic oil`, `vehicles`, or `rules civic` and get an answer without a UI.
- As a user, I can override any interval (`set corolla oil 4000km`) or correct a past anchor (`oil was actually done at 121000 in March`) without repeating setup.

## 7. Functional requirements by area

### 7.1 Setup wizard
- Three passes: identity, odometer, calibration — see architecture.md §3 for the full 10-step table.
- Every step accepts a partial or full paste; Claude fills whatever fields it recognizes and the step pointer advances to the first unanswered field.
- Every optional step accepts `skip`, recorded in the draft so it isn't re-asked.
- Draft persists after every turn (`pending` table) so an interrupted setup resumes where it left off.
- Every parsed answer is echoed back immediately for visible error-correction.
- On completion: vehicle row created, all 16 default rules seeded in one write, anchors from calibration are real, everything else anchors to "now" and is flagged `anchorEstimated`. Closing message states the real/estimated split honestly.
- `add vehicle` re-runs the same wizard for a second vehicle.

### 7.2 Event logging
- Single free-form message → parsed into one `events` row (see architecture.md §2 for `kind`/`category` taxonomy).
- Vehicle resolution: skip if only one active vehicle; otherwise match nickname → plate → model name; on a miss, send an interactive list (buttons for ≤3 candidates, list for up to 10).
- Odometer capture is tied to fuel events (highest frequency signal). Missing reading → ask once → accept `skip`.
- Rate smoothing: new odometer readings blend into `avgKmPerDay` at 30% weight; readings that go backwards or imply >800 km/day are rejected as typos, not written.
- Full-tank flag captured on every fuel event; required for correct km/l math later.
- `undo` reverses the most recent event completely: the row, the odometer state, the smoothed rate, and every rule anchor that event moved.

### 7.3 Reminder engine
- Hourly cron evaluates every active rule across every vehicle.
- Projected odometer = `currentOdo + avgKmPerDay × daysSinceReading`, used for all km-based comparisons instead of the last physical reading.
- Interval rules (km and/or months) compute both remaining-km and remaining-days and fire on whichever is proportionally closer.
- Expiry rules compute days until `dueAt` directly.
- Tier ladder: km at 1,000 / 250 / overdue; days at 30 / 14 / 7 / 1 / overdue.
- Overdue escalates by distance bucket (every 500 km or every 7 days past due), not by daily re-fire.
- `sentReminders` dedupes per `(ruleId, cycleKey, tierKey)` so the hourly cron never re-sends a tier already delivered in the current cycle; logging a new event changes the anchor, which changes `cycleKey`, which resets the ladder with no manual cleanup.
- Default 16 rules seeded per vehicle per the table in architecture.md §5; every interval is overridable per vehicle (`set civic oil 4000km`).

### 7.4 Outbound delivery
- All proactive sends (reminders, check-ins, summaries) must obey the WhatsApp Cloud API's 24-hour free-form messaging window (see architecture.md §6 for the full constraint and resolution).
- Three approved templates act only as a "doorbell" — terse, fixed-structure nudges. The real message sends free-form the moment the user replies.
- One send wrapper checks `lastInboundAt` and picks template vs. free-form; no calling code branches on this itself.

### 7.5 Commands
See architecture.md §7 for the full command table (`due`, `summary`, `week`, `history`, `vehicles`, `rules`, `set`, `add vehicle`, `undo`).

## 8. Success metrics

Since this serves a single owner (and later, family) rather than a market, "success" is operational, not growth-based:

- Zero missed maintenance intervals over a full ownership year (the metric the project exists to hit).
- Logging friction: median time from opening WhatsApp to a logged event under 15 seconds, measured informally.
- Reminder delivery rate ≥ 99% across the 24-hour-window edge case (i.e., the template fallback actually works, not just the happy path).
- Setup completion rate: a wizard interrupted mid-flow is resumed and finished, not abandoned.

## 9. Rollout / phasing

Mirrors architecture.md §8's build order:

1. **Tonight** — schema, webhook, setup wizard, event logging, rule evaluator + hourly cron, `due`/`undo`.
2. **Next** — template approval (submit early, review takes time), summaries + daily check-in, interval overrides, fuel-economy math.
3. **Later** — media/document/receipt handling, chart images sent into chat.

## 10. Open product decisions

Carried from architecture.md §9 — these are decisions, not yet requirements:

- **Media storage**: Convex file storage vs. an authenticated proxy for Meta's expiring media URLs.
- **Multiple users**: shared-vehicle reminder routing (who gets notified) needs a decision before the invite flow is built.
- **Fuel economy**: compute lazily on request from full-tank pairs rather than storing a derived value.
- **Personal-number WhatsApp libraries**: avoids the template dance entirely at the cost of ban risk — acceptable only as long as this serves the builder alone, not once family joins.
