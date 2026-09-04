import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/db";
import { createDependency } from "../lib/dependencies";

const PORTFOLIO_TARGET = 1_000_000; // Rs 10,00,000, per spec

interface HoldingSeed {
  symbol: string;
  name: string;
  sector: string;
  targetValue: number; // desired allocation; actual marketValue = quantity * price, rounds close to this
}

const HOLDINGS: HoldingSeed[] = [
  { symbol: "KNRCON", name: "KNR Constructions", sector: "Infrastructure (Roads & Highways)", targetValue: 150_000 },
  { symbol: "HGINFRA", name: "HG Infra Engineering", sector: "Infrastructure (Roads & Highways)", targetValue: 150_000 },
  { symbol: "IRB", name: "IRB Infrastructure", sector: "Infrastructure (Roads & Highways)", targetValue: 150_000 },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Financials (Banking)", targetValue: 200_000 },
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy / Conglomerate", targetValue: 200_000 },
  { symbol: "NIFTYBEES", name: "Nifty 50 ETF", sector: "Diversified (Index ETF)", targetValue: 150_000 },
];

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf-8"));
}

interface BetaRow {
  symbol: string;
  betaMarket: number;
  seBetaMarket: number;
  betaInfra: number;
  seBetaInfra: number;
  r2: number;
  sampleSize: number;
  windowStart: string;
  windowEnd: string;
}

interface BetasFile {
  computedAt: string;
  marketIndex: string;
  infraIndex: string;
  betas: BetaRow[];
}

interface RawSeries {
  dates: string[];
  closes: number[];
}

interface NhaiDependency {
  company: string;
  ticker: string;
  counterparty: string;
  sourceSpan: string;
  sourceDocument: string;
  sourceUrl: string;
  notes: string;
}

interface NhaiResearch {
  dependencies: NhaiDependency[];
  historicalShock: {
    company: string;
    ticker: string;
    eventDescription: string;
    sourceUrl: string;
    eventDate: string;
    observedDrawdownPct: number;
    windowDays: number;
  };
}

async function main() {
  const betasFile = loadJson<BetasFile>("data/betas.json");
  const research = loadJson<NhaiResearch>("research/nhai_dependencies.json");
  const betasBySymbol = new Map(betasFile.betas.map((b) => [b.symbol, b]));

  console.log("Clearing existing data...");
  await prisma.dependency.deleteMany();
  await prisma.shock.deleteMany();
  await prisma.position.deleteMany();
  await prisma.counterparty.deleteMany();

  console.log("Seeding positions with latest closes and regressed betas...");
  const positionsBySymbol = new Map<string, { id: string; marketValue: number }>();
  let totalValue = 0;

  for (const holding of HOLDINGS) {
    const raw = loadJson<RawSeries>(`data/raw/${holding.symbol}.json`);
    const latestPrice = raw.closes[raw.closes.length - 1];
    const quantity = Math.round(holding.targetValue / latestPrice);
    const marketValue = quantity * latestPrice;
    totalValue += marketValue;

    const beta = betasBySymbol.get(holding.symbol);
    if (!beta) {
      throw new Error(`No regressed beta found for ${holding.symbol} in data/betas.json — run npm run estimate-betas first.`);
    }

    const position = await prisma.position.create({
      data: {
        symbol: holding.symbol,
        name: holding.name,
        sector: holding.sector,
        quantity,
        price: latestPrice,
        marketValue,
        portfolioWeight: 0, // filled in below once totalValue is known
        betaMarket: beta.betaMarket,
        betaInfra: beta.betaInfra,
        betaSource: `OLS vs ${betasFile.marketIndex} & ${betasFile.infraIndex}, ${beta.windowStart} to ${beta.windowEnd} (n=${beta.sampleSize}), computed ${betasFile.computedAt}`,
      },
    });
    positionsBySymbol.set(holding.symbol, { id: position.id, marketValue });
    console.log(`  ${holding.symbol}: qty=${quantity} price=${latestPrice.toFixed(2)} value=${marketValue.toFixed(2)}`);
  }

  console.log(`Portfolio total: Rs ${totalValue.toFixed(2)} (target Rs ${PORTFOLIO_TARGET})`);

  for (const [, { id, marketValue }] of positionsBySymbol) {
    await prisma.position.update({
      where: { id },
      data: { portfolioWeight: marketValue / totalValue },
    });
  }

  console.log("Seeding counterparties...");
  const nhai = await prisma.counterparty.create({
    data: { name: "NHAI", type: "GOVERNMENT_AGENCY" },
  });

  console.log("Seeding dependencies (source span required — no span, no row)...");
  for (const dep of research.dependencies) {
    const position = positionsBySymbol.get(dep.ticker);
    if (!position) {
      console.warn(`  Skipping dependency for unknown ticker ${dep.ticker}`);
      continue;
    }
    if (!dep.sourceSpan) {
      console.log(`  ${dep.ticker}: no verbatim span found — recording absence, not a dependency row.`);
      continue;
    }
    await createDependency({
      positionId: position.id,
      positionSymbolForError: dep.ticker,
      counterpartyId: nhai.id,
      counterpartyNameForError: dep.counterparty,
      sourceDocument: dep.sourceDocument,
      sourceUrl: dep.sourceUrl,
      sourceSpan: dep.sourceSpan,
      extractedBy: "MANUAL",
    });
    console.log(`  ${dep.ticker} -> NHAI: recorded with source span from ${dep.sourceUrl}`);
  }

  console.log("Seeding historical shock...");
  const shockEvent = research.historicalShock;
  await prisma.shock.create({
    data: {
      label: `NHAI enforcement action on an NHAI toll asset (${shockEvent.company} analogue, ${shockEvent.eventDate})`,
      description: shockEvent.eventDescription,
      provenance: "HISTORICAL",
      counterpartyId: nhai.id,
      magnitudePct: shockEvent.observedDrawdownPct / 100,
      sourceUrl: shockEvent.sourceUrl,
      eventDate: new Date(shockEvent.eventDate),
      observedDrawdownPct: shockEvent.observedDrawdownPct,
      windowDays: shockEvent.windowDays,
    },
  });

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
