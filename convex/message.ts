// The inbound-message router. Scheduled from webhook.ts *after* dedupe +
// lastInboundAt stamping, so the webhook itself stays fast and this can take
// its time calling Claude. Order of precedence per turn: active pending
// state > no-vehicle-yet (setup) > command match > event logging parse.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { matchCommand } from "./commands";
import { parseEventText, type ParsedEvent } from "./parsing/event";
import { extractSetupFields } from "./parsing/setup";
import {
  initialDraft,
  firstUnsatisfiedStep,
  mergeExtraction,
  markSkipped,
  buildEchoLine,
  STEPS,
  type SetupDraft,
} from "./setupWizard";
import { categoryLabel } from "./rules";

export const process = internalAction({
  args: { waId: v.string(), text: v.string() },
  handler: async (ctx, { waId, text }) => {
    const user = await ctx.runQuery(internal.users.getByWaId, { waId });
    if (!user) return; // recordInbound always creates the user first; defensive only

    const pending = await ctx.runQuery(internal.pending.getActivePending, { waId });

    if (pending?.type === "setup") {
      await handleSetupTurn(ctx, user, pending.draft as SetupDraft, text);
      return;
    }
    if (pending?.type === "vehicle_disambiguation") {
      await handleDisambiguation(ctx, user, pending.draft as { queuedText: string }, text);
      return;
    }
    if (pending?.type === "odo_prompt") {
      await handleOdoPrompt(ctx, user, pending.draft as PendingFuelEvent, text);
      return;
    }

    const resolution = await ctx.runQuery(internal.vehicles.resolveForUser, { userId: user._id, text });
    if (resolution.status === "none") {
      await startSetup(ctx, user, text);
      return;
    }

    const cmd = matchCommand(text);
    if (cmd) {
      await handleCommand(ctx, user, cmd);
      return;
    }

    if (resolution.status === "ambiguous") {
      await ctx.runMutation(internal.pending.setPending, {
        waId: user.waId,
        type: "vehicle_disambiguation",
        draft: { queuedText: text },
        ttlMs: 30 * 60 * 1000,
      });
      const names = resolution.candidates.map((v, i) => `${i + 1}. ${v.nickname}`).join("\n");
      await send(ctx, user._id, `Which vehicle?\n${names}`);
      return;
    }

    await processEventForVehicle(ctx, user, resolution.vehicle, text);
  },
});

async function send(ctx: any, userId: Id<"users">, message: string) {
  await ctx.runAction(internal.send.sendToUser, { userId, message });
}

// Every log-event confirmation carries a fresh one-tap dashboard link, so
// the user is never more than one message away from seeing the full
// history/reminders view (magic link — no code to type, expires in 15min).
async function sendEventConfirmation(ctx: any, user: Doc<"users">, message: string) {
  const magicToken = await ctx.runMutation(internal.auth.createMagicLink, { waId: user.waId });
  const link = `${globalThis.process.env.DASHBOARD_URL}/auth/${magicToken}`;
  await send(ctx, user._id, `${message}\n\n📊 View on the dashboard: ${link}`);
}

// ---------- setup wizard ----------

async function startSetup(ctx: any, user: Doc<"users">, text: string) {
  const intro =
    "Let's get your vehicle set up. Answer in one message or several — paste in as much as you know.\n\n";
  const extraction = await extractSetupFields(Date.now(), text);
  const draft = mergeExtraction(initialDraft(), extraction);
  const echo = buildEchoLine(extraction);
  await advanceOrFinishSetup(ctx, user, draft, intro + (echo ? echo + "\n\n" : ""));
}

async function handleSetupTurn(ctx: any, user: Doc<"users">, draftIn: SetupDraft, text: string) {
  const currentStep = firstUnsatisfiedStep(draftIn);
  const trimmed = text.trim().toLowerCase();

  let draft = draftIn;
  let echo: string | null = null;

  if (trimmed === "skip" && currentStep && !currentStep.required) {
    draft = markSkipped(draft, currentStep.key);
  } else {
    const extraction = await extractSetupFields(Date.now(), text, currentStep?.prompt ?? null);
    draft = mergeExtraction(draft, extraction);
    echo = buildEchoLine(extraction);
  }

  await advanceOrFinishSetup(ctx, user, draft, echo ? echo + "\n\n" : "");
}

async function advanceOrFinishSetup(ctx: any, user: Doc<"users">, draft: SetupDraft, prefix: string) {
  const nextStep = firstUnsatisfiedStep(draft);

  if (!nextStep) {
    const result = await ctx.runMutation(internal.setupWizard.finalizeSetup, { userId: user._id, draft });
    await ctx.runMutation(internal.pending.clearPending, { waId: user.waId });
    await send(ctx, user._id, prefix + buildCompletionMessage(result));
    return;
  }

  await ctx.runMutation(internal.pending.setPending, {
    waId: user.waId,
    type: "setup",
    draft,
    step: nextStep.key,
  });
  await send(ctx, user._id, prefix + nextStep.prompt);
}

function buildCompletionMessage(result: {
  nickname: string;
  make?: string;
  model?: string;
  plate?: string;
  currentOdo?: number;
  calibratedCount: number;
  estimatedCount: number;
}): string {
  const identity = [result.make, result.model].filter(Boolean).join(" ");
  const odo = result.currentOdo !== undefined ? `${result.currentOdo.toLocaleString()} km` : "not set";
  return [
    `✅ ${result.nickname} is set up.`,
    [identity, result.plate].filter(Boolean).join(" · "),
    `Odometer: ${odo}`,
    "",
    `${result.calibratedCount} service interval${result.calibratedCount === 1 ? "" : "s"} calibrated from real dates. ${result.estimatedCount} running on estimates until you log them.`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ---------- vehicle disambiguation ----------

async function handleDisambiguation(ctx: any, user: Doc<"users">, draft: { queuedText: string }, text: string) {
  const vehicles = await ctx.runQuery(internal.vehicles.listActiveForUser, { userId: user._id });
  const num = parseInt(text.trim(), 10);
  let vehicle: Doc<"vehicles"> | undefined;
  if (!isNaN(num) && num >= 1 && num <= vehicles.length) {
    vehicle = vehicles[num - 1];
  } else {
    const needle = text.toLowerCase();
    vehicle = vehicles.find((v: Doc<"vehicles">) => needle.includes(v.nickname.toLowerCase()));
  }

  if (!vehicle) {
    await send(ctx, user._id, "Didn't catch which vehicle — reply with the number or name.");
    return;
  }

  await ctx.runMutation(internal.pending.clearPending, { waId: user.waId });
  await processEventForVehicle(ctx, user, vehicle, draft.queuedText);
}

// ---------- odometer prompt (fuel events with no reading) ----------

type PendingFuelEvent = {
  vehicleId: Id<"vehicles">;
  userId: Id<"users">;
  kind: ParsedEvent["kind"];
  category?: string;
  amount?: number;
  liters?: number;
  fullTank?: boolean;
  expiresAt?: number;
  notes?: string;
  raw: string;
  vehicleName: string;
};

async function handleOdoPrompt(ctx: any, user: Doc<"users">, draft: PendingFuelEvent, text: string) {
  const trimmed = text.trim().toLowerCase();
  let odo: number | undefined;
  if (trimmed !== "skip") {
    const num = parseFloat(text.replace(/[^\d.]/g, ""));
    if (!isNaN(num)) odo = num;
  }

  await ctx.runMutation(internal.pending.clearPending, { waId: user.waId });
  const result = await ctx.runMutation(internal.events.logEvent, {
    vehicleId: draft.vehicleId,
    userId: draft.userId,
    kind: draft.kind!,
    category: draft.category,
    odo,
    amount: draft.amount,
    liters: draft.liters,
    fullTank: draft.fullTank,
    expiresAt: draft.expiresAt,
    notes: draft.notes,
    raw: draft.raw,
  });

  await sendEventConfirmation(
    ctx,
    user,
    buildEventConfirmation(draft.vehicleName, { kind: draft.kind, category: draft.category, odo, amount: draft.amount, liters: draft.liters }, result),
  );
}

// ---------- event logging ----------

async function processEventForVehicle(ctx: any, user: Doc<"users">, vehicle: Doc<"vehicles">, text: string) {
  const parsed = await parseEventText(Date.now(), text);

  if (!parsed || !parsed.isEvent || !parsed.kind) {
    await send(
      ctx,
      user._id,
      "Didn't catch that as something to log. Try `due`, `vehicles`, `undo`, or describe a fill-up/service (e.g. \"filled petrol 3000, 124500\").",
    );
    return;
  }

  if (parsed.kind === "fuel" && parsed.odo === undefined) {
    await ctx.runMutation(internal.pending.setPending, {
      waId: user.waId,
      type: "odo_prompt",
      draft: {
        vehicleId: vehicle._id,
        userId: user._id,
        kind: parsed.kind,
        category: parsed.category,
        amount: parsed.amount,
        liters: parsed.liters,
        fullTank: parsed.fullTank,
        expiresAt: parsed.expiresAt,
        notes: parsed.notes,
        raw: text,
        vehicleName: vehicle.nickname,
      } satisfies PendingFuelEvent,
      ttlMs: 60 * 60 * 1000,
    });
    await send(ctx, user._id, "What's the odometer reading? (or reply 'skip')");
    return;
  }

  const result = await ctx.runMutation(internal.events.logEvent, {
    vehicleId: vehicle._id,
    userId: user._id,
    kind: parsed.kind,
    category: parsed.category,
    odo: parsed.odo,
    amount: parsed.amount,
    liters: parsed.liters,
    fullTank: parsed.fullTank,
    expiresAt: parsed.expiresAt,
    notes: parsed.notes,
    raw: text,
  });

  await sendEventConfirmation(ctx, user, buildEventConfirmation(vehicle.nickname, parsed, result));
}

function buildEventConfirmation(
  vehicleName: string,
  parsed: Pick<ParsedEvent, "kind" | "category" | "odo" | "amount" | "liters">,
  result?: { odoRejectedReason?: string },
): string {
  const bits: string[] = [];
  if (parsed.kind === "fuel") {
    bits.push(`fuel${parsed.liters ? ` ${parsed.liters}L` : ""}${parsed.amount ? ` (Rs ${parsed.amount})` : ""}`);
  } else if (parsed.kind === "service") {
    bits.push(categoryLabel(parsed.category ?? "service"));
  } else if (parsed.kind === "expense") {
    bits.push(`expense${parsed.amount ? ` (Rs ${parsed.amount})` : ""}`);
  } else if (parsed.kind === "odo") {
    bits.push("odometer reading");
  } else if (parsed.kind === "document") {
    bits.push(`${categoryLabel(parsed.category ?? "document")} updated`);
  } else {
    bits.push("note");
  }
  if (parsed.odo !== undefined) bits.push(`at ${parsed.odo.toLocaleString()} km`);

  let msg = `✅ Logged for ${vehicleName}: ${bits.join(" ")}.`;
  if (result?.odoRejectedReason) {
    const why =
      result.odoRejectedReason === "backwards"
        ? "lower than last known reading"
        : "implies over 800km/day";
    msg += `\n⚠️ Odometer ignored — ${why}. Event saved, odometer unchanged.`;
  }
  return msg;
}

// ---------- commands ----------

async function handleCommand(ctx: any, user: Doc<"users">, cmd: ReturnType<typeof matchCommand>) {
  if (!cmd) return;

  switch (cmd.type) {
    case "due": {
      const report = await ctx.runQuery(internal.commands.buildDueReport, {
        userId: user._id,
        vehicleText: cmd.vehicleText,
      });
      await send(ctx, user._id, report);
      return;
    }
    case "undo": {
      const result = await ctx.runMutation(internal.events.undoLast, { userId: user._id });
      if (result.status === "none") await send(ctx, user._id, "Nothing to undo.");
      else if (result.status === "cannot_undo") await send(ctx, user._id, "That entry can't be undone.");
      else await send(ctx, user._id, "↩️ Undone — last entry reversed.");
      return;
    }
    case "vehicles": {
      const list = await ctx.runQuery(internal.commands.buildVehiclesList, { userId: user._id });
      await send(ctx, user._id, list);
      return;
    }
    case "rules": {
      const report = await ctx.runQuery(internal.commands.buildRulesReport, {
        userId: user._id,
        vehicleText: cmd.vehicleText,
      });
      await send(ctx, user._id, report);
      return;
    }
    case "set": {
      const result = await ctx.runMutation(internal.commands.applyIntervalOverride, {
        userId: user._id,
        vehicleText: cmd.vehicleText,
        category: cmd.category,
        km: cmd.km,
      });
      if (result.status === "not_found") {
        await send(ctx, user._id, "Couldn't find that vehicle/category to override.");
      } else {
        await send(ctx, user._id, `Updated: ${categoryLabel(result.category)} now every ${cmd.km}km.`);
      }
      return;
    }
    case "add_vehicle": {
      await ctx.runMutation(internal.pending.setPending, {
        waId: user.waId,
        type: "setup",
        draft: initialDraft(),
        step: STEPS[0].key,
      });
      await send(ctx, user._id, "Let's add another vehicle.\n\n" + STEPS[0].prompt);
      return;
    }
    case "unimplemented": {
      await send(ctx, user._id, `\`${cmd.name}\` isn't available yet — coming soon.`);
      return;
    }
  }
}
