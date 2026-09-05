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
export async function analyzeEvent(
  text: string,
  options: { allowLlm?: boolean; fallbackNote?: string } = {}
): Promise<ExtractionResult> {
  const { allowLlm = true, fallbackNote } = options;

  if (allowLlm && isGeminiConfigured()) {
    return analyzeEventGemini(text);
  }

  const result = analyzeEventBaseline(text);
  if (fallbackNote) {
    result.fallbackNote = fallbackNote;
  }
  return result;
}
