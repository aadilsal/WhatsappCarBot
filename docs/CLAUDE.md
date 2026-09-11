# CLAUDE.md — Garage Bot

Project-specific instructions for Claude Code. These apply on top of (and, where they conflict, override for this repo) global instructions.

## What this is

A WhatsApp-native personal automotive assistant: Convex (db/functions/crons) + WhatsApp Cloud API + Claude for parsing. WhatsApp is the primary interface. A companion web dashboard (`web/`, Next.js + Convex, OTP login via WhatsApp) exists for browsing history, filtering, and light corrections — never deletion. See PRD.md for scope, architecture.md for the full technical design, architecture-essentials.md for a one-page reference, agents.md for coding conventions.

**Read agents.md before writing any Convex function.** It has the non-negotiable patterns (transactional anchor-patching, undo snapshots, webhook dedupe ordering, the `sendToUser()` wrapper) that this project depends on. Violating one of them produces a bug that's invisible until a real reminder misfires weeks later, not a test failure today.

## Current state

Greenfield — no code exists yet beyond the docs (README.md at repo root, PRD.md, architecture.md, architecture-essentials.md, agents.md, this file, all under docs/). Follow the build order in architecture.md §8 / architecture-essentials.md: schema → webhook → setup wizard → event logging → rule evaluator + cron → `due`/`undo`, in that order, since nothing after step 6 should change the schema.

## Commands

No `package.json` exists yet. Once the project is scaffolded (`npm create convex@latest` or equivalent):

- `npx convex dev` — local dev, live schema/function push.
- `npx convex deploy` — deploy to production Convex deployment.
- Typecheck: whatever the scaffold sets up (`tsc --noEmit` via `npm run typecheck` is the expected convention — add this script when scaffolding rather than inventing an ad hoc invocation each time).
- Tests: prefer `convex-test` for function-level tests per agents.md's testing expectations. Add the test script to `package.json` when the test setup is created, and use that script name consistently afterward.

Update this section with the real commands as soon as the project is scaffolded — don't leave it stale once `package.json` exists.

## Environment variables (Convex dashboard, not committed)

- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` — Cloud API.
- `ANTHROPIC_API_KEY` — Claude parsing calls.

Never log these, never write them into `events.raw` or any user-facing message.

## Scope discipline

- The `web/` dashboard (see `convex/dashboard.ts` and `convex/auth.ts`) is the one exception to WhatsApp-only: it can read/create/update vehicles, events, and rules, but never deletes events/documents (only archives vehicles). Every write there reuses the same core mutation logic as the WhatsApp path (logEventCore, finalizeSetupCore) — never a second implementation of the anchor-patching rules.
- Multi-vehicle support (`vehicleId` on every row) is already in the schema from day one — don't "simplify" it back out for a single-vehicle first pass.
- Due dates, fuel economy, and anything else derivable from `events`/`rules` at read time must stay derived, not stored — see architecture.md §1 ("derive, don't store").
