import { readFileSync } from "node:fs";
import path from "node:path";

interface ExtractorResults {
  metrics: Record<string, number | null>;
  namedFailures: { id: string; missedSpans: string[]; extraUnresolvedSpans: string[]; note?: string }[];
}

interface EvalResults {
  runAt: string;
  datasetSize: number;
  geminiConfigured: boolean;
  geminiModel: string | null;
  byExtractor: Record<string, ExtractorResults>;
}

const METRIC_LABELS: Record<string, string> = {
  coverage: "Coverage (items scored)",
  errorRate: "Error rate (no response obtained)",
  entityPrecision: "Entity precision",
  entityRecall: "Entity recall",
  counterpartyLinkingAccuracy: "Counterparty linking accuracy",
  hallucinationRate: "Hallucination rate",
  abstentionRate: "Abstention rate",
  unresolvedEntityRate: "Unresolved-entity rate",
};

const EXTRACTOR_LABELS: Record<string, string> = {
  BASELINE: "Alias matcher (no LLM)",
  GEMINI: "Gemini (LLM)",
};

function loadResults(): EvalResults | null {
  try {
    const raw = readFileSync(path.join(process.cwd(), "eval", "results.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fmt(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

export function EvaluationSummary() {
  const results = loadResults();

  if (!results) {
    return (
      <section id="evaluation" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-faint">Evaluation</h2>
          <p className="mt-4 text-sm text-text-dim">
            No evaluation run yet. Build <code className="text-text">eval/dataset.json</code> and run{" "}
            <code className="text-text">npm run eval</code>.
          </p>
        </div>
      </section>
    );
  }

  const extractors = Object.keys(results.byExtractor);
  const metricKeys = Object.keys(results.byExtractor[extractors[0]]?.metrics ?? {});

  return (
    <section id="evaluation" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-text-faint">Evaluation</h2>
        <p className="mt-1 text-sm text-text-dim">
          {results.datasetSize} hand-labeled items · run {new Date(results.runAt).toISOString().slice(0, 10)}
          {results.geminiModel && <> · model {results.geminiModel}</>}
        </p>
        <p className="mt-2 text-sm text-text-dim">
          The alias matcher is a rule-based baseline that can only find names it was given — it exists so the
          LLM&apos;s numbers have something honest to be measured against, not as a model.
        </p>

        {!results.geminiConfigured && (
          <p className="mt-3 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
            GEMINI_API_KEY was not set for this run, so only the baseline was evaluated.
          </p>
        )}

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-strong text-left text-xs uppercase tracking-wide text-text-faint">
                <th className="py-2 pr-4">Metric</th>
                {extractors.map((e) => (
                  <th key={e} className="py-2 pr-4 text-right">
                    {EXTRACTOR_LABELS[e] ?? e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metricKeys.map((key) => (
                <tr key={key} className="border-b border-border/60">
                  <td className="py-2 pr-4 text-text-dim">{METRIC_LABELS[key] ?? key}</td>
                  {extractors.map((e) => (
                    <td key={e} className="mono-num py-2 pr-4 text-right text-text">
                      {fmt(results.byExtractor[e].metrics[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {extractors.map((e) => {
          const failures = results.byExtractor[e].namedFailures;
          if (failures.length === 0) return null;
          return (
            <div key={e} className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">
                Named failures — {EXTRACTOR_LABELS[e] ?? e}
              </h3>
              <ul className="mt-2 space-y-2 text-sm text-text-dim">
                {failures.slice(0, 10).map((f) => (
                  <li key={f.id} className="rounded border border-border bg-bg-panel px-3 py-2">
                    <span className="text-text">{f.id}</span>
                    {f.missedSpans.length > 0 && <> — missed: {f.missedSpans.map((s) => `"${s}"`).join(", ")}</>}
                    {f.note && <div className="mt-1 text-xs text-text-faint">{f.note}</div>}
                  </li>
                ))}
              </ul>
              {failures.length > 10 && (
                <p className="mt-2 text-xs text-text-faint">
                  {failures.length - 10} more in <code>eval/results.json</code>.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
