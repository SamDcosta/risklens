import { readFileSync } from "node:fs";
import path from "node:path";

interface EvalResults {
  runAt: string;
  llmConfigured: boolean;
  datasetSize: number;
  metrics: Record<string, number | null>;
  namedFailures: { id: string; missedSpans: string[]; extraUnresolvedSpans: string[]; note?: string }[];
}

const METRIC_LABELS: Record<string, string> = {
  entityPrecision: "Entity precision",
  entityRecall: "Entity recall",
  counterpartyLinkingAccuracy: "Counterparty linking accuracy",
  hallucinationRate: "Hallucination rate",
  abstentionRate: "Abstention rate",
  unresolvedEntityRate: "Unresolved-entity rate",
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

  return (
    <section id="evaluation" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-text-faint">Evaluation</h2>

        {!results ? (
          <p className="mt-4 text-sm text-text-dim">
            No evaluation run yet. Build <code className="text-text">eval/dataset.json</code> and run{" "}
            <code className="text-text">npm run eval</code>.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-text-dim">
              {results.datasetSize} hand-labeled items · run {new Date(results.runAt).toISOString().slice(0, 10)} ·
              LLM configured: {results.llmConfigured ? "yes" : "no"}
            </p>

            {!results.llmConfigured && (
              <p className="mt-3 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
                ANTHROPIC_API_KEY was not set for this run — every item abstained without a model call. These
                numbers reflect the stubbed state, not extractor quality. Set the key and re-run{" "}
                <code>npm run eval</code> for real metrics.
              </p>
            )}

            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border-strong text-left text-xs uppercase tracking-wide text-text-faint">
                    <th className="py-2 pr-4">Metric</th>
                    <th className="py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(results.metrics).map(([key, value]) => (
                    <tr key={key} className="border-b border-border/60">
                      <td className="py-2 pr-4 text-text-dim">{METRIC_LABELS[key] ?? key}</td>
                      <td className="mono-num py-2 text-right text-text">{fmt(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {results.namedFailures.length > 0 && (
              <div className="mt-6">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">Named failures</h3>
                <ul className="mt-2 space-y-2 text-sm text-text-dim">
                  {results.namedFailures.slice(0, 15).map((f) => (
                    <li key={f.id} className="rounded border border-border bg-bg-panel px-3 py-2">
                      <span className="text-text">{f.id}</span>
                      {f.missedSpans.length > 0 && <> — missed: {f.missedSpans.map((s) => `"${s}"`).join(", ")}</>}
                      {f.note && <div className="mt-1 text-xs text-text-faint">{f.note}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
