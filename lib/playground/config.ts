// Shopper playground: the suggested prompts (also the demo-mode replays) and the limits that
// keep a public, model-calling page cheap and safe.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const SUGGESTED_PROMPTS = [
  "Find me waterproof hiking boots in men's size 10 under $200.",
  "I need a 3-season tent that sleeps 2 people. What do you recommend?",
  "What's the warmest down sleeping bag you have, and how much does it weigh?",
  "I want a daypack around 25 liters for day hikes, under $100.",
] as const;

export const LIMITS = {
  perIp: { requests: 10, window: "10 m" as const },
  globalPerDay: 200, // ~$0.50/day worst case on Gemini 3.5 Flash-Lite
  maxMessages: 12, // conversation history sent to the model
  maxInputChars: 500,
  maxSteps: 8,
};

export const normalizePrompt = (s: string) => s.toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim();

export const isSuggestedPrompt = (s: string) => SUGGESTED_PROMPTS.some((p) => normalizePrompt(p) === normalizePrompt(s));

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;
const perIp = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(LIMITS.perIp.requests, LIMITS.perIp.window), prefix: "shelfready:chat:ip" })
  : null;
const dailyBudget = redis ? new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(LIMITS.globalPerDay, "1 d"), prefix: "shelfready:chat:day" }) : null;

export type LiveDecision = { live: true } | { live: false; reason: "demo_mode" | "rate_limited" | "daily_budget" | "no_limiter" };

/**
 * Whether this request may call the model. Demo mode, a visitor over their rate, or the whole
 * site over its daily budget all fall back to recorded replays — never an error page.
 */
export async function liveOrReplay(ip: string): Promise<LiveDecision> {
  if (process.env.DEMO_MODE === "true") return { live: false, reason: "demo_mode" };
  // A public page that spends money must be limited; without Upstash, serve replays only.
  if (!perIp || !dailyBudget) return { live: false, reason: "no_limiter" };
  if (!(await perIp.limit(ip)).success) return { live: false, reason: "rate_limited" };
  if (!(await dailyBudget.limit("all")).success) return { live: false, reason: "daily_budget" };
  return { live: true };
}
