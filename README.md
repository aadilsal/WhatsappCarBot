# Garage Bot

A personal automotive assistant that lives entirely in WhatsApp. Multiple vehicles, every expense, every litre of fuel, every service, every document, every reminder — logged and tracked through natural-language chat, no app required.

```
Filled petrol 3000, 124500
Oil change 4500
Insurance renewed till 15 Dec
```

## Why WhatsApp, not an app

A dashboard adds friction: open app, find vehicle, find field, enter value. That friction is why maintenance logs get abandoned within a month. WhatsApp is already open. There is no other UI in this project, by design — see [docs/architecture.md](./docs/architecture.md) §6 for how proactive reminders work within WhatsApp's messaging rules.

## Stack

- **[Convex](https://www.convex.dev/)** — database, server functions, hourly/scheduled crons, HTTP webhook endpoint. The entire backend.
- **[WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)** — inbound message webhook, outbound free-form and template messages.
- **Claude (Anthropic API)** — parses every free-form message (setup answers, logged events, commands, corrections) into structured data.

No separate frontend, no REST API for humans, no admin panel.

## Documentation map

| Doc | For |
|---|---|
| [docs/PRD.md](./docs/PRD.md) | Product scope: what this does, for whom, and why — feature requirements, success metrics, phasing |
| [docs/architecture.md](./docs/architecture.md) | Full technical design: data model, reminder-engine math, the WhatsApp 24h-window constraint, build order |
| [docs/architecture-essentials.md](./docs/architecture-essentials.md) | One-page cheat-sheet version of the above — read this first if you just need a refresher |
| [docs/agents.md](./docs/agents.md) | Coding conventions for AI agents (or humans) writing Convex functions in this repo |
| [docs/CLAUDE.md](./docs/CLAUDE.md) | Claude Code project instructions: current build state, commands, env vars (the root `CLAUDE.md` is a stub that imports this) |
| [docs/PHASES.md](./docs/PHASES.md) | Build tracker — phases checked off as they're completed and verified |

## Status

Building, phase by phase — see [docs/PHASES.md](./docs/PHASES.md) for the checklist. Currently in **Phase 0 (scaffolding)**.

## Getting started

```bash
npm install         # already done if you're continuing this checkout
npx convex dev       # first run opens a browser to log in / create a deployment, then pushes functions
```

Copy `.env.example` to `.env.local` and fill it in for local dev; in production these are set via the Convex dashboard's environment variables, never committed:

- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` — from the Meta App Dashboard's WhatsApp Cloud API product.
- `ANTHROPIC_API_KEY` — for Claude parsing.

Point the Meta webhook at your Convex HTTP endpoint (`https://<your-deployment>.convex.site/webhook` or equivalent, once `convex/http.ts` is wired up in Phase 2) and complete the verify handshake.

## Core commands (once running)

| Command | Result |
|---|---|
| `due` / `due civic` | What's approaching or overdue, all vehicles or one |
| `summary` / `summary aug` | Spend + activity, this month or a named month |
| `week` | Last 7 days |
| `history civic oil` | Recent events in one category |
| `vehicles` | List with odometers |
| `rules civic` | Every interval and its current status |
| `set civic oil 4000km` | Override a maintenance interval |
| `add vehicle` | Onboard another vehicle |
| `undo` | Reverse the last logged entry |

See docs/architecture.md §7 for the full command reference.
