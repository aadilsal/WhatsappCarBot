# Agents Guide — Garage Bot

Conventions for any AI coding agent (Claude Code or otherwise) working in this repository. Read architecture-essentials.md first for the data model and invariants; this file is about *how to write the code*, not what the system does.

## Before touching code

1. Read architecture-essentials.md. Every invariant listed there ("due dates are computed, never stored", "anchors are denormalized and patched in the same mutation", "dedupe before any side effect") is load-bearing — violating one doesn't just introduce a bug, it silently breaks the reminder engine in a way that's invisible until a real deadline is missed.
2. Check PRD.md §7 before adding a feature to confirm it's actually in scope for the area you're touching.
3. This project has **no dashboard, ever** — do not propose a web UI, admin panel, or REST API surface as a "quick win." Every user-facing capability is a WhatsApp command or a wizard step. If you're tempted to add a UI, the answer is a new command instead.

## Repo shape (expected, once scaffolded)

```
convex/
  schema.ts              # all seven tables + indexes
  webhook.ts             # HTTP action: Meta webhook verify + inbound handler
  http.ts                # Convex HTTP router
  events.ts              # mutations/queries for logging, undo
  vehicles.ts            # vehicle CRUD, resolution logic
  rules.ts               # rule CRUD, default rule seeding, overrides
  reminders.ts           # hourly cron + evaluator + sentReminders dedupe
  pending.ts             # multi-turn conversation state helpers
  send.ts                # sendToUser() wrapper: template vs free-form
  commands/              # one file per command or a dispatcher + handlers
  parsing/               # Claude prompt templates + response schemas
  crons.ts               # cron.interval / cron.cron registrations
lib/                     # pure helper functions shared across convex/ (date math, rate smoothing, tier calc)
```

Convex convention: queries/mutations/actions are plain exported functions per file, grouped by domain table, not by REST-style verb. Don't invent a controller/service/repository layering on top of this — Convex functions *are* the service layer.

## Non-negotiable patterns

- **Every mutation that logs an event and every mutation that patches a rule anchor happens in the same Convex mutation**, not two round trips. Convex mutations are transactional — use that. If you're writing an event and then separately calling another mutation to patch the rule, that's two commits and a window where they can diverge.
- **Every event-logging mutation writes an undo snapshot** as part of the same write. Don't add a new `kind`/`category` that skips this — `undo` has to work uniformly across every event type, or it becomes a footgun ("undo works for fuel but not service").
- **Webhook dedupe is the first thing that runs**, before any parsing or side effect. Insert into `inboundMessages` (or check-then-insert) before doing anything else in the webhook handler.
- **Rule evaluation reads only `rules` + `vehicles`, never scans `events`.** If you find yourself querying `events` inside the hourly cron to figure out "when was this last done," that logic belongs in the mutation that writes the event (patch the anchor there), not in the evaluator.
- **`sendToUser()` is the only path to an outbound WhatsApp message.** Don't call the Cloud API directly from a command handler or the cron — route everything through the wrapper so the 24h-window logic stays in one place.
- **Claude parsing calls return structured JSON against an explicit schema**, not freeform text the caller then re-parses. Define the expected shape per parsing call (setup-step fields, event fields, command intent) and validate it before writing to Convex.
- **Relative dates/times are resolved to absolute timestamps at parse time**, not downstream. "last month," "in March," "6 months" should never reach a mutation as a string.

## Adding a new maintenance rule category

This should be a data change, per the design principle in architecture.md §1. To add one:

1. Add the category to the default-rules seed list (used at vehicle creation) — not to a switch statement in the evaluator.
2. If it needs bespoke reminder copy, add it to the message-template lookup, keyed by category — don't branch on category name inside the evaluator's core due-date math.
3. Confirm the evaluator's generic interval/expiry logic covers it unmodified. If it doesn't, the evaluator is under-generalized — fix the evaluator, don't special-case the category.

## Adding a new command

1. Add intent matching (keyword/regex first, Claude fallback for ambiguity) to the command dispatcher.
2. Write the handler as a Convex query (read-only commands like `due`, `summary`, `vehicles`, `rules`, `history`) or mutation (`undo`, `set`, `add vehicle`).
3. Route the response through `sendToUser()`, never a raw API call.
4. Update the command table in architecture.md §7 and architecture-essentials.md.

## Testing expectations

- Convex functions: prefer `convex-test` (or equivalent) unit tests over manual webhook curl round-trips for anything touching odometer math, rate smoothing, or rule evaluation — these have exact numeric invariants (30% blend weight, 800km/day rejection threshold, tier bucket math) that are easy to get subtly wrong and hard to eyeball-verify from a WhatsApp reply.
- Any change to the reminder tier ladder or `cycleKey` derivation needs a test that simulates a full cycle: seed a rule, advance time, confirm each tier fires exactly once, log an event, confirm the ladder resets.
- Any change to `undo` needs a test that logs an event, mutates state further (e.g. a second event), then confirms undo restores the pre-event snapshot exactly — not just "doesn't crash."
- WhatsApp-side integration (actual Cloud API calls, template delivery) is not something to fake confidently — when you can't hit the real API in a test, say so explicitly rather than asserting the send worked.

## Things not to do

- Don't add a due-date column to `rules` or `events` that gets written once and read later — see "derive, don't store" in architecture.md §1.
- Don't hardcode the 16 default rules into application logic anywhere except the seed step — they must remain plain rows a user can `set` or add to.
- Don't build "quick setup" as a separate code path from the full wizard — the paste-fill behavior (any step can fill any field) is the only setup path; there's no forked shortcut branch to maintain in parallel.
- Don't send a proactial message via any path other than `sendToUser()` — a direct Cloud API call from a new feature will silently violate the 24h window rule the first time it's tested outside an active conversation.
- Don't treat `pending` as a cache — it's conversation state with a real `expiresAt`; a stale pending row silently hijacking an unrelated later message is a worse bug than the state just being gone.
