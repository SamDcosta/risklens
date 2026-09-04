/**
 * Runs the /api/analyze-event extractor (in-process, not over HTTP) against
 * the hand-labeled dataset in eval/dataset.json and writes eval/results.json.
 *
 * `npm run eval`
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeEvent } from "../lib/llm/analyzeEvent";

interface LabeledEntity {
  name: string;
  type: "COMPANY" | "COUNTERPARTY" | "REGULATOR";
  span: string;
  resolvesToSymbol: string | null;
}

interface DatasetItem {
  id: string;
  sourceUrl: string;
  publisher: string;
  publishedDate: string;
  excerpt: string;
  labeledAt: string;
  labels: {
    holdingsSymbols: string[];
    entities: LabeledEntity[];
  };
  note?: string;
}

interface ItemResult {
  id: string;
  abstained: boolean;
  abstainReason?: string;
  predictedEntityCount: number;
  groundTruthEntityCount: number;
  matchedSpans: number;
  unresolvedPredicted: number;
  counterpartyLinkingCorrect: boolean;
  rawEntityCount: number | null;
  droppedForContainment: number | null;
  note?: string;
  missedSpans: string[];
  extraUnresolvedSpans: string[];
}

function expectedCounterparties(item: DatasetItem): Set<string> {
  return new Set(item.labels.entities.filter((e) => e.type === "COUNTERPARTY").map((e) => e.name.toUpperCase()));
}

async function main() {
  const datasetPath = path.join(process.cwd(), "eval", "dataset.json");
  let dataset: DatasetItem[];
  try {
    dataset = JSON.parse(readFileSync(datasetPath, "utf-8"));
  } catch {
    console.error(`Could not read ${datasetPath}. Build the dataset first (see eval/README.md).`);
    process.exit(1);
  }

  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  const itemResults: ItemResult[] = [];

  for (const item of dataset) {
    const result = await analyzeEvent(item.excerpt);

    const gtSpans = new Set(item.labels.entities.map((e) => e.span));
    const predictedSpans = [
      ...result.entities.map((e) => ({ span: e.span, resolved: e.resolvedPositionSymbol !== null })),
      ...result.counterparties.map((c) => ({ span: c.span, resolved: c.resolvedCounterpartyName !== null })),
    ];

    const matchedSpans = predictedSpans.filter((p) => gtSpans.has(p.span)).length;
    const missedSpans = item.labels.entities.filter((e) => !predictedSpans.some((p) => p.span === e.span)).map((e) => e.span);
    const extraUnresolvedSpans = predictedSpans.filter((p) => !p.resolved).map((p) => p.span);

    const expected = expectedCounterparties(item);
    const predictedCounterparties = new Set(
      result.counterparties.filter((c) => c.resolvedCounterpartyName).map((c) => c.resolvedCounterpartyName!.toUpperCase())
    );
    const counterpartyLinkingCorrect =
      expected.size === predictedCounterparties.size && [...expected].every((c) => predictedCounterparties.has(c));

    itemResults.push({
      id: item.id,
      abstained: result.abstain,
      abstainReason: result.abstainReason,
      predictedEntityCount: predictedSpans.length,
      groundTruthEntityCount: item.labels.entities.length,
      matchedSpans,
      unresolvedPredicted: extraUnresolvedSpans.length,
      counterpartyLinkingCorrect,
      rawEntityCount: result.diagnostics ? result.diagnostics.rawEntityCount + result.diagnostics.rawCounterpartyCount : null,
      droppedForContainment: result.diagnostics ? result.diagnostics.droppedForContainment : null,
      note: item.note,
      missedSpans,
      extraUnresolvedSpans,
    });
  }

  const n = itemResults.length;
  const totalPredicted = itemResults.reduce((s, r) => s + r.predictedEntityCount, 0);
  const totalGroundTruth = itemResults.reduce((s, r) => s + r.groundTruthEntityCount, 0);
  const totalMatched = itemResults.reduce((s, r) => s + r.matchedSpans, 0);
  const totalUnresolved = itemResults.reduce((s, r) => s + r.unresolvedPredicted, 0);
  const abstained = itemResults.filter((r) => r.abstained).length;
  const withDiagnostics = itemResults.filter((r) => r.rawEntityCount !== null);
  const totalRaw = withDiagnostics.reduce((s, r) => s + (r.rawEntityCount ?? 0), 0);
  const totalDropped = withDiagnostics.reduce((s, r) => s + (r.droppedForContainment ?? 0), 0);
  const counterpartyCorrect = itemResults.filter((r) => r.counterpartyLinkingCorrect).length;

  const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

  const metrics = {
    entityPrecision: ratio(totalMatched, totalPredicted),
    entityRecall: ratio(totalMatched, totalGroundTruth),
    counterpartyLinkingAccuracy: ratio(counterpartyCorrect, n),
    hallucinationRate: withDiagnostics.length > 0 ? ratio(totalDropped, totalRaw) : null,
    abstentionRate: ratio(abstained, n),
    unresolvedEntityRate: ratio(totalUnresolved, totalPredicted),
  };

  const namedFailures = itemResults
    .filter((r) => r.missedSpans.length > 0 || r.extraUnresolvedSpans.length > 0 || r.note)
    .map((r) => ({
      id: r.id,
      missedSpans: r.missedSpans,
      extraUnresolvedSpans: r.extraUnresolvedSpans,
      note: r.note,
    }));

  const results = {
    runAt: new Date().toISOString(),
    llmConfigured: configured,
    datasetSize: n,
    metrics,
    itemResults,
    namedFailures,
  };

  writeFileSync(path.join(process.cwd(), "eval", "results.json"), JSON.stringify(results, null, 2));

  console.log(`\nRan ${n} items. LLM configured: ${configured}`);
  console.log("Metrics:");
  for (const [key, value] of Object.entries(metrics)) {
    console.log(`  ${key}: ${value === null ? "n/a" : `${(value * 100).toFixed(1)}%`}`);
  }
  if (!configured) {
    console.log(
      "\nANTHROPIC_API_KEY is not set, so every item abstained without a model call — these numbers reflect " +
        "the stubbed state, not extractor quality. Set the key and re-run `npm run eval` for real metrics."
    );
  }
}

main();
