import type { Dependency, Position, Shock } from "@prisma/client";

export interface PositionImpact {
  position: Position;
  impact: number;
  kind: "direct" | "indirect";
}

export interface ShockImpactResult {
  shock: Shock;
  direct: PositionImpact[];
  indirect: PositionImpact[];
  totalDirectImpact: number;
  totalIndirectImpact: number;
}

/**
 * positionImpact = position.marketValue x shockPct x (dependency ? 1 : betaInfra)
 * portfolioImpact = sum(positionImpact)
 *
 * Direct and indirect are kept as separate arrays/totals on purpose — the
 * spec is explicit that they must never be summed into one headline number.
 * Direct is arithmetic (a real quoted dependency); indirect rests on a
 * regression whose R^2 is displayed alongside every beta.
 *
 * A position with no regressed betaInfra (null) is excluded from the
 * indirect side rather than treated as zero exposure — we don't have a
 * basis to claim it's unaffected, we simply can't estimate the effect.
 */
export function computeShockImpact(
  shock: Shock,
  positions: Position[],
  dependencies: Dependency[]
): ShockImpactResult {
  const shockPct = shock.magnitudePct;
  const dependentPositionIds = new Set(
    dependencies.filter((d) => d.counterpartyId === shock.counterpartyId).map((d) => d.positionId)
  );

  const direct: PositionImpact[] = [];
  const indirect: PositionImpact[] = [];

  for (const position of positions) {
    if (dependentPositionIds.has(position.id)) {
      direct.push({
        position,
        impact: position.marketValue * shockPct,
        kind: "direct",
      });
    } else if (position.betaInfra != null) {
      indirect.push({
        position,
        impact: position.marketValue * shockPct * position.betaInfra,
        kind: "indirect",
      });
    }
  }

  return {
    shock,
    direct,
    indirect,
    totalDirectImpact: direct.reduce((sum, r) => sum + r.impact, 0),
    totalIndirectImpact: indirect.reduce((sum, r) => sum + r.impact, 0),
  };
}
