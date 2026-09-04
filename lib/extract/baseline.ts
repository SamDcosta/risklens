import { COUNTERPARTY_ALIASES, POSITION_ALIASES } from "../aliases";
import { finalize, type ExtractionResult, type RawExtraction } from "./shared";

/**
 * A rule-based extractor: scans the input for names in our own alias table and
 * emits the matched text verbatim. No model, no API key, no cost.
 *
 * This exists as an honest baseline to measure the LLM against, not as a
 * substitute for it. It can only find names it was told about, so it fails by
 * construction on indirect references ("the Mumbai-Pune concessionaire",
 * "the infrastructure major") — which is precisely the gap the eval quantifies.
 */

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds the alias in the text as a whole word and returns the text's own
 * casing, so the span stays verbatim rather than echoing the alias table.
 */
function findVerbatimSpan(text: string, alias: string): string | null {
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(alias)}(?![A-Za-z0-9])`, "i");
  const match = pattern.exec(text);
  return match ? match[0] : null;
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const end = trimmed.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? trimmed : trimmed.slice(0, end + 1);
  return sentence.length > 120 ? `${sentence.slice(0, 117)}...` : sentence;
}

export function analyzeEventBaseline(text: string): ExtractionResult {
  const entitiesMentioned: RawExtraction["entitiesMentioned"] = [];
  const counterpartiesImplicated: RawExtraction["counterpartiesImplicated"] = [];

  for (const entry of POSITION_ALIASES) {
    // Longest alias first, so "IRB Infrastructure Developers" wins over "IRB".
    const candidates = [entry.symbol, ...entry.aliases].sort((a, b) => b.length - a.length);
    for (const candidate of candidates) {
      const span = findVerbatimSpan(text, candidate);
      if (span) {
        entitiesMentioned.push({ name: span, type: "COMPANY", span });
        break;
      }
    }
  }

  for (const entry of COUNTERPARTY_ALIASES) {
    const candidates = [entry.name, ...entry.aliases].sort((a, b) => b.length - a.length);
    for (const candidate of candidates) {
      const span = findVerbatimSpan(text, candidate);
      if (span) {
        entitiesMentioned.push({ name: span, type: "COUNTERPARTY", span });
        counterpartiesImplicated.push({ name: span, span });
        break;
      }
    }
  }

  const foundNothing = entitiesMentioned.length === 0 && counterpartiesImplicated.length === 0;

  const raw: RawExtraction = {
    eventTitle: firstSentence(text),
    entitiesMentioned,
    counterpartiesImplicated,
    abstain: foundNothing,
  };

  const result = finalize(raw, text, "BASELINE");
  if (foundNothing) {
    result.abstainReason = "No known company or counterparty name appears in the text.";
  }
  return result;
}
