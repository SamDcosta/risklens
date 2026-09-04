import type { Dependency, Position, Counterparty } from "@prisma/client";

export interface CounterpartyExposure {
  counterparty: Counterparty;
  exposure: number; // sum of marketValue across positions depending on this counterparty
  exposurePct: number; // exposure / portfolioValue
  positions: {
    position: Position;
    dependency: Dependency;
  }[];
}

/**
 * counterpartyExposure(c) = sum of marketValue over positions depending on c
 * counterpartyExposurePct(c) = counterpartyExposure(c) / portfolioValue
 *
 * Pure arithmetic over the ledger — a position counts once per counterparty
 * even if it has multiple dependency rows on that counterparty (dedup by
 * position id), since exposure is "capital sitting behind the dependency",
 * not a sum of dependency rows.
 */
export function computeCounterpartyExposure(
  counterparties: Counterparty[],
  dependencies: Dependency[],
  positions: Position[],
  portfolioValue: number
): CounterpartyExposure[] {
  const positionsById = new Map(positions.map((p) => [p.id, p]));

  return counterparties.map((counterparty) => {
    const depsForCounterparty = dependencies.filter((d) => d.counterpartyId === counterparty.id);

    const seenPositionIds = new Set<string>();
    const rows: CounterpartyExposure["positions"] = [];
    let exposure = 0;

    for (const dependency of depsForCounterparty) {
      if (seenPositionIds.has(dependency.positionId)) continue;
      const position = positionsById.get(dependency.positionId);
      if (!position) continue;
      seenPositionIds.add(dependency.positionId);
      exposure += position.marketValue;
      rows.push({ position, dependency });
    }

    return {
      counterparty,
      exposure,
      exposurePct: portfolioValue > 0 ? exposure / portfolioValue : 0,
      positions: rows,
    };
  });
}

export function computePortfolioValue(positions: Position[]): number {
  return positions.reduce((sum, p) => sum + p.marketValue, 0);
}
