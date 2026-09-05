/**
 * Best-effort rate limiting for the public extraction endpoint.
 *
 * The API key sits behind a public URL, so without this anyone can spend the
 * project's Gemini quota — and the realistic cost isn't a bill (the free tier
 * has none), it's the demo returning errors because the quota is gone.
 *
 * IMPORTANT, measured rather than assumed: this is in-memory, and Vercel
 * routes consecutive requests to different serverless instances — four
 * consecutive requests to this deployment hit four distinct instances. Each
 * starts with an empty counter, so a burst passes straight through. This
 * limiter works locally and against a single warm instance under sustained
 * load; in production it stops far less than its numbers suggest.
 *
 * The protection actually carrying weight is the caller's fallback to the
 * baseline extractor, which makes an exhausted quota a cosmetic downgrade
 * rather than a broken endpoint. Real limiting needs shared state (Vercel KV,
 * Upstash); not added here because on a free tier the downside is a demo
 * showing the baseline, not a bill.
 */

const PER_IP_LIMIT = 5;
const PER_IP_WINDOW_MS = 60_000;

const GLOBAL_DAILY_LIMIT = 150;
const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_TRACKED_IPS = 5_000;

const ipHits = new Map<string, number[]>();
let globalHits: number[] = [];

function withinWindow(timestamps: number[], now: number, windowMs: number): number[] {
  return timestamps.filter((t) => now - t < windowMs);
}

/** Drops IPs whose hits have all aged out, so the map can't grow without bound. */
function pruneIpMap(now: number): void {
  if (ipHits.size <= MAX_TRACKED_IPS) return;
  for (const [ip, hits] of ipHits) {
    if (withinWindow(hits, now, PER_IP_WINDOW_MS).length === 0) {
      ipHits.delete(ip);
    }
  }
}

export interface RateLimitDecision {
  /** False means: serve the request, but from the free local extractor. */
  llmAllowed: boolean;
  reason?: string;
}

export function checkLlmBudget(ip: string): RateLimitDecision {
  const now = Date.now();

  globalHits = withinWindow(globalHits, now, DAY_MS);
  if (globalHits.length >= GLOBAL_DAILY_LIMIT) {
    return {
      llmAllowed: false,
      reason:
        "This demo's daily budget for model calls is used up, so the request was served by the " +
        "deterministic alias matcher instead. Run it locally with your own GEMINI_API_KEY for the model path.",
    };
  }

  const hits = withinWindow(ipHits.get(ip) ?? [], now, PER_IP_WINDOW_MS);
  if (hits.length >= PER_IP_LIMIT) {
    ipHits.set(ip, hits);
    return {
      llmAllowed: false,
      reason:
        `Rate limit: at most ${PER_IP_LIMIT} model calls per minute from one address. This request was ` +
        "served by the deterministic alias matcher instead — try again in a minute for the model path.",
    };
  }

  hits.push(now);
  ipHits.set(ip, hits);
  globalHits.push(now);
  pruneIpMap(now);

  return { llmAllowed: true };
}

/** Vercel populates x-forwarded-for; the fallback keeps local dev working. */
export function clientIpFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
