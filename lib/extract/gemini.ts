import { GoogleGenAI } from "@google/genai";
import { ENTITY_TYPES, RawExtractionSchema, finalize, type ExtractionResult } from "./shared";

const DEFAULT_MODEL = "gemini-3.6-flash";
const TIMEOUT_MS = 20_000;

// Pinned, not an alias like "gemini-flash-latest": an eval whose model can
// change under it isn't reproducible.
const MODEL = process.env.GEMINI_MODEL || DEFAULT_MODEL;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    eventTitle: { type: "string", description: "A short, neutral title for the news event." },
    entitiesMentioned: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: [...ENTITY_TYPES] },
          span: {
            type: "string",
            description: "A verbatim substring copied exactly from the input text that names this entity.",
          },
        },
        required: ["name", "type", "span"],
      },
    },
    counterpartiesImplicated: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          span: {
            type: "string",
            description: "A verbatim substring copied exactly from the input text naming this counterparty.",
          },
        },
        required: ["name", "span"],
      },
    },
    abstain: {
      type: "boolean",
      description: "True instead of guessing if the text doesn't clearly concern a company or counterparty.",
    },
  },
  required: ["eventTitle", "entitiesMentioned", "counterpartiesImplicated", "abstain"],
};

const SYSTEM_PROMPT = `You extract and link entities from a news article about Indian infrastructure/equity markets.
You do ONLY extraction and linking. You never estimate a probability, severity, financial impact, or any number.
You never see or reason about any portfolio, position size, or holding value — none exists in this conversation.
Every entity and counterparty you report MUST include a "span" that is an exact, verbatim, character-for-character
substring copied from the input text — not paraphrased, not corrected, not translated. If you cannot find a
substring in the input that names something, do not report it.
If the text does not clearly concern a company, counterparty, or regulator relevant to Indian infrastructure/equity
markets, set abstain to true and leave the arrays empty.`;

/** The model was reached and deliberately declined, or returned unusable output. */
function abstained(reason: string): ExtractionResult {
  return { extractor: "GEMINI", abstain: true, abstainReason: reason, entities: [], counterparties: [] };
}

/** No model response could be obtained — infrastructure, not model behaviour. */
function failed(reason: string): ExtractionResult {
  return { extractor: "GEMINI", abstain: true, failed: true, abstainReason: reason, entities: [], counterparties: [] };
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function analyzeEventGemini(text: string): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return failed(
      "GEMINI_API_KEY is not configured on this deployment. The endpoint's validation, span-containment, " +
        "and resolution logic run either way — only the model call is unavailable."
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: text,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
    });

    const output = response.text;
    if (!output) return failed("Model returned an empty response.");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(output);
    } catch {
      return abstained("Model output was not valid JSON.");
    }

    const parsed = RawExtractionSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return abstained(`Malformed model output failed schema validation: ${parsed.error.message}`);
    }
    if (parsed.data.abstain) {
      return abstained("Model abstained.");
    }

    return finalize(parsed.data, text, "GEMINI");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failed(`Extraction failed: ${message}`);
  }
}
