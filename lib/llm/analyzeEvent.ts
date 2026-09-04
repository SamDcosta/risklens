import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { resolveCounterpartyAlias, resolvePositionAlias } from "../aliases";

const ENTITY_TYPES = ["COMPANY", "COUNTERPARTY", "REGULATOR"] as const;

const EntitySchema = z.object({
  name: z.string(),
  type: z.enum(ENTITY_TYPES),
  span: z.string(),
});

const CounterpartySchema = z.object({
  name: z.string(),
  span: z.string(),
});

// The schema the LLM must produce. Deliberately has no numeric or
// probabilistic fields at all — the LLM extracts and links text, nothing
// else. Enforced below via string-containment checks in code, not by
// trusting the model to have followed the prompt.
const LlmResponseSchema = z.object({
  eventTitle: z.string(),
  entitiesMentioned: z.array(EntitySchema),
  counterpartiesImplicated: z.array(CounterpartySchema),
  abstain: z.boolean(),
});

export type LlmResponse = z.infer<typeof LlmResponseSchema>;

export interface ResolvedEntity {
  name: string;
  type: (typeof ENTITY_TYPES)[number];
  span: string;
  resolvedPositionSymbol: string | null;
}

export interface ResolvedCounterparty {
  name: string;
  span: string;
  resolvedCounterpartyName: string | null;
}

export interface AnalyzeEventResult {
  abstain: boolean;
  abstainReason?: string;
  eventTitle?: string;
  entities: ResolvedEntity[];
  counterparties: ResolvedCounterparty[];
  /** Diagnostics for eval/run.ts — counts before the span-containment filter, so hallucination rate is measurable. */
  diagnostics?: {
    rawEntityCount: number;
    rawCounterpartyCount: number;
    droppedForContainment: number;
  };
}

const TOOL_NAME = "emit_event_analysis";

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    eventTitle: { type: "string", description: "A short, neutral title for the news event." },
    entitiesMentioned: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ENTITY_TYPES },
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
            description: "A verbatim substring copied exactly from the input text that names this counterparty.",
          },
        },
        required: ["name", "span"],
      },
    },
    abstain: {
      type: "boolean",
      description: "Set true instead of guessing if the text doesn't clearly concern any company or counterparty.",
    },
  },
  required: ["eventTitle", "entitiesMentioned", "counterpartiesImplicated", "abstain"],
} as const;

const SYSTEM_PROMPT = `You extract and link entities from a news article about Indian infrastructure/equity markets.
You do ONLY extraction and linking. You never estimate a probability, severity, financial impact, or any number.
You never see or reason about any portfolio, position size, or holding value — none exists in this conversation.
Every entity and counterparty you report MUST include a "span" that is an exact, verbatim, character-for-character
substring copied from the input text — not paraphrased, not corrected, not translated. If you cannot find a
substring in the input that names something, do not report it.
If the text does not clearly concern a company, counterparty, or regulator relevant to Indian infrastructure/equity
markets, set abstain to true and leave the arrays empty.
Call the ${TOOL_NAME} tool exactly once with your answer.`;

/**
 * Drops any entity whose span is not a literal substring of the input text.
 * This is the enforcement the spec requires: "a string containment check,
 * not a prompt instruction." Even a well-behaved model's output goes
 * through this before anything reaches the UI.
 */
function filterByContainment(response: LlmResponse, inputText: string): LlmResponse {
  return {
    ...response,
    entitiesMentioned: response.entitiesMentioned.filter((e) => inputText.includes(e.span)),
    counterpartiesImplicated: response.counterpartiesImplicated.filter((c) => inputText.includes(c.span)),
  };
}

function resolve(response: LlmResponse): AnalyzeEventResult {
  const entities: ResolvedEntity[] = response.entitiesMentioned.map((e) => {
    const resolvedPositionSymbol = resolvePositionAlias(e.name);
    if (!resolvedPositionSymbol) {
      console.warn(`[analyze-event] unresolved entity: "${e.name}" (type=${e.type})`);
    }
    return { ...e, resolvedPositionSymbol };
  });

  const counterparties: ResolvedCounterparty[] = response.counterpartiesImplicated.map((c) => {
    const resolvedCounterpartyName = resolveCounterpartyAlias(c.name);
    if (!resolvedCounterpartyName) {
      console.warn(`[analyze-event] unresolved counterparty: "${c.name}"`);
    }
    return { ...c, resolvedCounterpartyName };
  });

  return {
    abstain: response.abstain,
    eventTitle: response.eventTitle,
    entities,
    counterparties,
  };
}

const TIMEOUT_MS = 20_000;

export async function analyzeEvent(text: string): Promise<AnalyzeEventResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      abstain: true,
      abstainReason:
        "ANTHROPIC_API_KEY is not configured on this deployment. The extraction endpoint's validation, " +
        "span-containment, and resolution logic run either way — only the model call is stubbed out.",
      entities: [],
      counterparties: [],
    };
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create(
      {
        model: process.env.ANALYZE_EVENT_MODEL || "claude-sonnet-5",
        max_tokens: 2048,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
        tools: [
          {
            name: TOOL_NAME,
            description: "Emit the structured entity extraction and linking result.",
            input_schema: TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: TOOL_NAME },
      },
      { timeout: TIMEOUT_MS }
    );

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return { abstain: true, abstainReason: "Model did not call the extraction tool.", entities: [], counterparties: [] };
    }

    const parsed = LlmResponseSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      return {
        abstain: true,
        abstainReason: `Malformed model output failed schema validation: ${parsed.error.message}`,
        entities: [],
        counterparties: [],
      };
    }

    if (parsed.data.abstain) {
      return { abstain: true, abstainReason: "Model abstained.", entities: [], counterparties: [] };
    }

    const filtered = filterByContainment(parsed.data, text);
    const rawEntityCount = parsed.data.entitiesMentioned.length;
    const rawCounterpartyCount = parsed.data.counterpartiesImplicated.length;
    const droppedForContainment =
      rawEntityCount - filtered.entitiesMentioned.length + (rawCounterpartyCount - filtered.counterpartiesImplicated.length);

    return {
      ...resolve(filtered),
      diagnostics: { rawEntityCount, rawCounterpartyCount, droppedForContainment },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { abstain: true, abstainReason: `Extraction failed: ${message}`, entities: [], counterparties: [] };
  }
}
