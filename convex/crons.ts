import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("hourly reminder evaluation", { hours: 1 }, internal.reminders.evaluateAndSend, {});

export default crons;
