import { z } from "zod";
import { resolveCounterpartyAlias, resolvePositionAlias } from "../aliases";

export const ENTITY_TYPES = ["COMPANY", "COUNTERPARTY", "REGULATOR"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Which extractor produced a result. Surfaced in the UI and in eval output —
 *  a rule-based matcher must never be presentable as a model. */
export const EXTRACTORS = ["GEMINI", "BASELINE"] as const;
export type Extractor = (typeof EXTRACTORS)[number];

export const EXTRACTOR_LABELS: Record<Extractor, string> = {
  GEMINI: "Gemini (LLM)",
  BASELINE: "Deterministic alias matcher (no LLM)",
};

const EntitySchema = z.object({
  name: z.string(),
  type: z.enum(ENTITY_TYPES),
  span: z.string(),
});

const CounterpartySchema = z.object({
  name: z.string(),
  span: z.string(),
});

/**
 * The shape both extractors must produce. Deliberately has no numeric or
 * probabilistic fields — extraction and linking only, never a magnitude,
 * severity, or probability.
 */
export const RawExtractionSchema = z.object({
  eventTitle: z.string(),
  entitiesMentioned: z.array(EntitySchema),
  counterpartiesImplicated: z.array(CounterpartySchema),
  abstain: z.boolean(),
});

export type RawExtraction = z.infer<typeof RawExtractionSchema>;

export interface ResolvedEntity {
  name: string;
  type: EntityType;
  span: string;
  resolvedPositionSymbol: string | null;
  /** A known counterparty (e.g. NHAI) is not a holding but is still resolvable. */
  resolvedCounterpartyName: string | null;
}

export interface ResolvedCounterparty {
  name: string;
  span: string;
  resolvedCounterpartyName: string | null;
}

export interface ExtractionResult {
  extractor: Extractor;
  abstain: boolean;
  abstainReason?: string;
  /**
   * True when no model response could be obtained at all (quota, network,
   * timeout, missing key) — as opposed to the model deliberately declining.
   * Eval excludes these from quality metrics: a 429 says nothing about
   * extraction accuracy, and counting it as an abstention would misreport it.
   */
  failed?: boolean;
  eventTitle?: string;
  /** Set when the model path was skipped (rate limit / budget) and this is the fallback. */
  fallbackNote?: string;
  entities: ResolvedEntity[];
  counterparties: ResolvedCounterparty[];
  /** Counts before the containment filter, so hallucination rate is measurable in eval. */
  diagnostics?: {
    rawEntityCount: number;
    rawCounterpartyCount: number;
    droppedForContainment: number;
  };
}

/**
 * Drops anything whose span is not a literal substring of the input.
 * This is a string containment check in code, not a prompt instruction —
 * it runs over every extractor's output, model or not, before the UI sees it.
 */
export function filterByContainment(raw: RawExtraction, inputText: string): RawExtraction {
  return {
    ...raw,
    entitiesMentioned: raw.entitiesMentioned.filter((e) => inputText.includes(e.span)),
    counterpartiesImplicated: raw.counterpartiesImplicated.filter((c) => inputText.includes(c.span)),
  };
}

/** Deterministic lookup against our own alias table — never another model call. */
export function resolveEntities(raw: RawExtraction, extractor: Extractor): ExtractionResult {
  // Every entity is tried against both tables. An entity typed COUNTERPARTY or
  // REGULATOR can't resolve to a holding, but it may well be a counterparty we
  // know — reporting "unresolved" when the alias table has the mapping is just
  // failing to look it up.
  const entities: ResolvedEntity[] = raw.entitiesMentioned.map((e) => {
    const resolvedPositionSymbol = resolvePositionAlias(e.name);
    const resolvedCounterpartyName = resolveCounterpartyAlias(e.name);
    if (!resolvedPositionSymbol && !resolvedCounterpartyName && e.type === "COMPANY") {
      console.warn(`[analyze-event/${extractor}] unresolved company: "${e.name}"`);
    }
    return { ...e, resolvedPositionSymbol, resolvedCounterpartyName };
  });

  const counterparties: ResolvedCounterparty[] = raw.counterpartiesImplicated.map((c) => {
    const resolvedCounterpartyName = resolveCounterpartyAlias(c.name);
    if (!resolvedCounterpartyName) {
      console.warn(`[analyze-event/${extractor}] unresolved counterparty: "${c.name}"`);
    }
    return { ...c, resolvedCounterpartyName };
  });

  // The model is inconsistent about populating counterpartiesImplicated — it
  // sometimes reports NHAI only under entities. Whether a counterparty is
  // "implicated" is our determination to make from our own table, not
  // something to leave to the model's mood, so a known counterparty found
  // among the entities is promoted here. The span still came from the model
  // and still passed containment; only the classification is ours.
  const alreadyLinked = new Set(counterparties.map((c) => c.resolvedCounterpartyName).filter(Boolean));
  for (const entity of entities) {
    if (entity.resolvedCounterpartyName && !alreadyLinked.has(entity.resolvedCounterpartyName)) {
      counterparties.push({
        name: entity.name,
        span: entity.span,
        resolvedCounterpartyName: entity.resolvedCounterpartyName,
      });
      alreadyLinked.add(entity.resolvedCounterpartyName);
    }
  }

  return { extractor, abstain: raw.abstain, eventTitle: raw.eventTitle, entities, counterparties };
}

/** Applies the containment filter, resolves aliases, and records what was dropped. */
export function finalize(raw: RawExtraction, inputText: string, extractor: Extractor): ExtractionResult {
  const filtered = filterByContainment(raw, inputText);
  const rawEntityCount = raw.entitiesMentioned.length;
  const rawCounterpartyCount = raw.counterpartiesImplicated.length;
  const droppedForContainment =
    rawEntityCount -
    filtered.entitiesMentioned.length +
    (rawCounterpartyCount - filtered.counterpartiesImplicated.length);

  return {
    ...resolveEntities(filtered, extractor),
    diagnostics: { rawEntityCount, rawCounterpartyCount, droppedForContainment },
  };
}
