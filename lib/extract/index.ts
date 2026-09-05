import { analyzeEventBaseline } from "./baseline";
import { analyzeEventGemini, isGeminiConfigured } from "./gemini";
import type { ExtractionResult } from "./shared";

export type { ExtractionResult } from "./shared";
export { EXTRACTOR_LABELS } from "./shared";
export { analyzeEventBaseline } from "./baseline";
export { analyzeEventGemini, isGeminiConfigured } from "./gemini";

/**
 * Uses Gemini when a key is configured and the caller is within budget, and
 * falls back to the deterministic alias matcher otherwise, so the endpoint
 * always does something real rather than erroring. The result always carries
 * which extractor ran — the UI shows it, because a rule-based matcher must
 * never be mistaken for a model.
 *
 * Note the eval calls analyzeEventGemini directly and never goes through here,
 * so this fallback can't quietly contaminate benchmark numbers with baseline
 * results.
 */
/** Turns a raw failure reason into something worth showing a user. */
function shortFailureCause(reason: string | undefined): string {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("429") || r.includes("quota") || r.includes("rate limit")) return "the model's quota is exhausted";
  if (r.includes("timeout") || r.includes("abort")) return "the model timed out";
  if (r.includes("not configured")) return "no model key is configured";
  return "the model could not be reached";
}

export async function analyzeEvent(
  text: string,
  options: { allowLlm?: boolean; fallbackNote?: string } = {}
): Promise<ExtractionResult> {
  const { allowLlm = true, fallbackNote } = options;

  if (allowLlm && isGeminiConfigured()) {
    const llmResult = await analyzeEventGemini(text);

    // A model that was reached and declined is a real answer — keep it.
    // A model that couldn't be reached at all is not, so fall through rather
    // than showing a raw 429. Without this the budget guard only covered the
    // failure it predicted, not the one that actually happens.
    if (!llmResult.failed) return llmResult;

    const degraded = analyzeEventBaseline(text);
    degraded.fallbackNote =
      `This result came from the deterministic alias matcher because ${shortFailureCause(llmResult.abstainReason)}.`;
    return degraded;
  }

  const result = analyzeEventBaseline(text);
  if (fallbackNote) {
    result.fallbackNote = fallbackNote;
  }
  return result;
}
