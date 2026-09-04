/**
 * Runs the extractors (in-process, not over HTTP) against the hand-labeled
 * dataset in eval/dataset.json and writes eval/results.json.
 *
 * Both extractors are evaluated on the same items so the LLM has something
 * honest to be compared against: a rule-based alias matcher that can only find
 * names it was told about. The interesting number is where they diverge.
 *
 * `npm run eval`
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeEventBaseline, analyzeEventGemini, isGeminiConfigured } from "../lib/extract";
import type { ExtractionResult, Extractor } from "../lib/extract/shared";

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
  labels: { holdingsSymbols: string[]; entities: LabeledEntity[] };
  note?: string;
}

interface ItemResult {
  id: string;
  abstained: boolean;
  failed: boolean;
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

function scoreItem(item: DatasetItem, result: ExtractionResult): ItemResult {
  const gtSpans = new Set(item.labels.entities.map((e) => e.span));
  const predicted = [
    ...result.entities.map((e) => ({ span: e.span, resolved: e.resolvedPositionSymbol !== null })),
    ...result.counterparties.map((c) => ({ span: c.span, resolved: c.resolvedCounterpartyName !== null })),
  ];

  const matchedSpans = predicted.filter((p) => gtSpans.has(p.span)).length;
  const missedSpans = item.labels.entities
    .filter((e) => !predicted.some((p) => p.span === e.span))
    .map((e) => e.span);
  const extraUnresolvedSpans = predicted.filter((p) => !p.resolved).map((p) => p.span);

  const expected = new Set(
    item.labels.entities.filter((e) => e.type === "COUNTERPARTY").map((e) => e.name.toUpperCase())
  );
  const predictedCounterparties = new Set(
    result.counterparties
      .filter((c) => c.resolvedCounterpartyName)
      .map((c) => c.resolvedCounterpartyName!.toUpperCase())
  );
  const counterpartyLinkingCorrect =
    expected.size === predictedCounterparties.size && [...expected].every((c) => predictedCounterparties.has(c));

  return {
    id: item.id,
    abstained: result.abstain,
    failed: Boolean(result.failed),
    abstainReason: result.abstainReason,
    predictedEntityCount: predicted.length,
    groundTruthEntityCount: item.labels.entities.length,
    matchedSpans,
    unresolvedPredicted: extraUnresolvedSpans.length,
    counterpartyLinkingCorrect,
    rawEntityCount: result.diagnostics
      ? result.diagnostics.rawEntityCount + result.diagnostics.rawCounterpartyCount
      : null,
    droppedForContainment: result.diagnostics ? result.diagnostics.droppedForContainment : null,
    note: item.note,
    missedSpans,
    extraUnresolvedSpans,
  };
}

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

/**
 * Quality metrics are computed only over items where a response was actually
 * obtained. An item that 429'd tells us nothing about extraction accuracy, so
 * folding it into recall (or calling it an "abstention") would misreport the
 * model. Failures get their own rate and a coverage figure instead.
 */
function aggregate(allResults: ItemResult[]) {
  const itemResults = allResults.filter((r) => !r.failed);
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

  return {
    coverage: ratio(n, allResults.length),
    errorRate: ratio(allResults.length - n, allResults.length),
    entityPrecision: ratio(totalMatched, totalPredicted),
    entityRecall: ratio(totalMatched, totalGroundTruth),
    counterpartyLinkingAccuracy: ratio(counterpartyCorrect, n),
    hallucinationRate: withDiagnostics.length > 0 ? ratio(totalDropped, totalRaw) : null,
    abstentionRate: ratio(abstained, n),
    unresolvedEntityRate: ratio(totalUnresolved, totalPredicted),
  };
}

function namedFailures(itemResults: ItemResult[]) {
  return itemResults
    .filter((r) => !r.failed && (r.missedSpans.length > 0 || r.extraUnresolvedSpans.length > 0))
    .map((r) => ({
      id: r.id,
      missedSpans: r.missedSpans,
      extraUnresolvedSpans: r.extraUnresolvedSpans,
      note: r.note,
    }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RATE_LIMIT_DELAY_MS = 6_000;

function looksRateLimited(result: ExtractionResult): boolean {
  const reason = result.abstainReason?.toLowerCase() ?? "";
  return reason.includes("429") || reason.includes("quota") || reason.includes("rate limit");
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

  const geminiConfigured = isGeminiConfigured();
  const perExtractor: Partial<Record<Extractor, ItemResult[]>> = { BASELINE: [] };

  console.log(`Running BASELINE over ${dataset.length} items...`);
  for (const item of dataset) {
    perExtractor.BASELINE!.push(scoreItem(item, analyzeEventBaseline(item.excerpt)));
  }

  if (geminiConfigured) {
    perExtractor.GEMINI = [];
    console.log(`Running GEMINI over ${dataset.length} items (rate-limited, this takes a couple of minutes)...`);
    for (const [i, item] of dataset.entries()) {
      let result = await analyzeEventGemini(item.excerpt);
      if (looksRateLimited(result)) {
        console.log(`  ${item.id}: rate limited, backing off 30s...`);
        await sleep(30_000);
        result = await analyzeEventGemini(item.excerpt);
      }
      perExtractor.GEMINI.push(scoreItem(item, result));
      process.stdout.write(`  ${i + 1}/${dataset.length}\r`);
      await sleep(RATE_LIMIT_DELAY_MS);
    }
    console.log("");
  } else {
    console.log("GEMINI_API_KEY not set — skipping the LLM run, baseline only.");
  }

  const byExtractor = Object.fromEntries(
    Object.entries(perExtractor).map(([extractor, itemResults]) => [
      extractor,
      {
        metrics: aggregate(itemResults!),
        itemResults: itemResults!,
        namedFailures: namedFailures(itemResults!),
      },
    ])
  );

  const results = {
    runAt: new Date().toISOString(),
    datasetSize: dataset.length,
    geminiConfigured,
    geminiModel: geminiConfigured ? process.env.GEMINI_MODEL || "gemini-2.5-flash" : null,
    byExtractor,
  };

  writeFileSync(path.join(process.cwd(), "eval", "results.json"), JSON.stringify(results, null, 2));

  console.log(`\nDataset: ${dataset.length} items`);
  for (const [extractor, data] of Object.entries(byExtractor)) {
    console.log(`\n${extractor}:`);
    for (const [key, value] of Object.entries(data.metrics)) {
      console.log(`  ${key}: ${value === null ? "n/a" : `${(value * 100).toFixed(1)}%`}`);
    }
  }
}

main();
