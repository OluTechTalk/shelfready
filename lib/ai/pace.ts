// Pacing for batch scripts on the free tier: model calls start at least MIN_CALL_GAP_MS
// apart across all concurrent workers, and a quota error pushes every worker back.

// Free-tier Gemini allows ~15 requests/minute.
const MIN_CALL_GAP_MS = 4_000;
const QUOTA_BACKOFF_MS = 30_000;

let nextCallAt = 0;

/** Reserves the next call slot; concurrent workers queue up behind each other. */
export async function paceModelCall() {
  const now = Date.now();
  const at = Math.max(now, nextCallAt);
  nextCallAt = at + MIN_CALL_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export const isQuotaError = (err: unknown) =>
  err instanceof Error && /quota|rate.?limit|429|high demand/i.test(err.message);

/** Call after a quota error so the per-minute window can reset before anyone retries. */
export function backOffForQuota() {
  nextCallAt = Math.max(nextCallAt, Date.now() + QUOTA_BACKOFF_MS);
}

export async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}
