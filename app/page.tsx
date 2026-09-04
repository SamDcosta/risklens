import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { computeCounterpartyExposure, computePortfolioValue } from "@/lib/engine/exposure";
import { formatINR } from "@/lib/format";
import { CounterpartyConcentrationPanel } from "@/components/CounterpartyConcentrationPanel";
import { HoldingsTable, type BetaStats } from "@/components/HoldingsTable";
import { EventAnalysisSection } from "@/components/EventAnalysisSection";
import { ShockAndImpactSection } from "@/components/ShockAndImpactSection";
import { EvaluationSummary } from "@/components/EvaluationSummary";

export const dynamic = "force-dynamic";

interface BetasFile {
  betas: (Omit<BetaStats, never> & { symbol: string })[];
}

function loadBetaStats(): Map<string, BetaStats> {
  try {
    const raw = readFileSync(path.join(process.cwd(), "data", "betas.json"), "utf-8");
    const file = JSON.parse(raw) as BetasFile;
    return new Map(file.betas.map((b) => [b.symbol, b]));
  } catch {
    return new Map();
  }
}

export default async function Home() {
  const [positions, counterparties, dependencies, shocks] = await Promise.all([
    prisma.position.findMany({ orderBy: { marketValue: "desc" } }),
    prisma.counterparty.findMany(),
    prisma.dependency.findMany(),
    prisma.shock.findMany({ where: { provenance: "HISTORICAL" } }),
  ]);

  const portfolioValue = computePortfolioValue(positions);
  const exposures = computeCounterpartyExposure(counterparties, dependencies, positions, portfolioValue);
  const betaStats = loadBetaStats();

  // The event-analysis and shock panels are scoped to whichever counterparty carries the most
  // exposure. With more than one counterparty seeded, the others still show up in the
  // Counterparty Concentration panel above (which lists all of them) but don't get their own
  // shock/impact panel here — a deliberate scope limit, not an oversight.
  const primaryExposure = [...exposures].sort((a, b) => b.exposure - a.exposure)[0] ?? null;
  const primaryCounterparty = primaryExposure?.counterparty ?? null;
  const dependentHoldings = primaryExposure ? primaryExposure.positions.map((p) => p.position) : [];
  const primaryHistoricalShocks = shocks.filter((s) => s.counterpartyId === primaryCounterparty?.id);

  return (
    <>
      <CounterpartyConcentrationPanel exposures={exposures} portfolioValue={portfolioValue} />
      <HoldingsTable positions={positions} betaStats={betaStats} portfolioValue={portfolioValue} />

      {primaryCounterparty && (
        <>
          <EventAnalysisSection
            allDependentHoldings={dependentHoldings.map((p) => ({ symbol: p.symbol, name: p.name }))}
            counterpartyName={primaryCounterparty.name}
            portfolioValueLabel={formatINR(portfolioValue)}
          />
          <ShockAndImpactSection
            positions={positions}
            dependencies={dependencies}
            counterparty={primaryCounterparty}
            historicalShocks={primaryHistoricalShocks}
          />
        </>
      )}

      <EvaluationSummary />

      <section id="limitations" className="px-6 py-10">
        <div className="mx-auto max-w-6xl text-xs text-text-faint">
          See the README for methodology, limitations, and related work.
        </div>
      </section>
    </>
  );
}
