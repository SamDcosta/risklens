import { analyzeEventBaseline } from "./baseline";
import { analyzeEventGemini, isGeminiConfigured } from "./gemini";
import type { ExtractionResult } from "./shared";

export type { ExtractionResult } from "./shared";
export { EXTRACTOR_LABELS } from "./shared";
export { analyzeEventBaseline } from "./baseline";
export { analyzeEventGemini, isGeminiConfigured } from "./gemini";

/**
 * Uses Gemini when a key is configured, and falls back to the deterministic
 * alias matcher otherwise so the endpoint always does something real. The
 * result always carries which extractor ran — the UI shows it, because a
 * rule-based matcher must never be mistaken for a model.
 */
export async function analyzeEvent(text: string): Promise<ExtractionResult> {
  if (isGeminiConfigured()) {
    return analyzeEventGemini(text);
  }
  return analyzeEventBaseline(text);
}
