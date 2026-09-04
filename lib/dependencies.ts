import { prisma } from "./db";
import { EXTRACTION_SOURCES, type ExtractionSource } from "./types";

export class MissingSourceSpanError extends Error {
  constructor(positionSymbol: string, counterpartyName: string) {
    super(
      `Refusing to create dependency ${positionSymbol} -> ${counterpartyName}: no sourceSpan. ` +
        `A dependency with no verbatim quoted span is not recorded — record the absence instead.`
    );
    this.name = "MissingSourceSpanError";
  }
}

export interface CreateDependencyInput {
  positionId: string;
  positionSymbolForError: string; // only used to make the thrown error legible
  counterpartyId: string;
  counterpartyNameForError: string;
  revenueSharePct?: number | null;
  sourceDocument: string;
  sourceUrl?: string | null;
  sourceSpan: string;
  extractedBy: ExtractionSource;
  confidence?: number | null;
}

/**
 * The single write path for Dependency rows. A missing, empty, or
 * whitespace-only sourceSpan throws rather than silently dropping the row,
 * so a caller can't accidentally seed data around this check.
 */
export async function createDependency(input: CreateDependencyInput) {
  const span = input.sourceSpan?.trim();
  if (!span) {
    throw new MissingSourceSpanError(input.positionSymbolForError, input.counterpartyNameForError);
  }
  if (!EXTRACTION_SOURCES.includes(input.extractedBy)) {
    throw new Error(`Invalid extractedBy value: ${input.extractedBy}`);
  }

  return prisma.dependency.create({
    data: {
      positionId: input.positionId,
      counterpartyId: input.counterpartyId,
      revenueSharePct: input.revenueSharePct ?? null,
      sourceDocument: input.sourceDocument,
      sourceUrl: input.sourceUrl ?? null,
      sourceSpan: span,
      extractedBy: input.extractedBy,
      confidence: input.confidence ?? null,
    },
  });
}
