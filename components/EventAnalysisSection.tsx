"use client";

import { useState } from "react";
import { ExposureGraph } from "./ExposureGraph";

// Mirrors the server's cap so the limit is unreachable by accident rather
// than surfaced as a validation error after a round trip.
const MAX_INPUT_CHARS = 4_000;

interface HoldingRef {
  symbol: string;
  name: string;
}

interface AnalyzeResponse {
  extractor?: "GEMINI" | "BASELINE";
  abstain: boolean;
  abstainReason?: string;
  fallbackNote?: string;
  eventTitle?: string;
  entities: {
    name: string;
    type: string;
    span: string;
    resolvedPositionSymbol: string | null;
    resolvedCounterpartyName: string | null;
  }[];
  counterparties: { name: string; span: string; resolvedCounterpartyName: string | null }[];
}

// Which extractor produced a result is always shown. A rule-based matcher
// must never be mistakable for a model.
function ExtractorBadge({ extractor }: { extractor: "GEMINI" | "BASELINE" }) {
  const isLlm = extractor === "GEMINI";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
        isLlm ? "border-ok/50 bg-ok/10 text-ok" : "border-accent/50 bg-accent/10 text-accent"
      }`}
    >
      {isLlm ? "Gemini · LLM" : "Alias matcher · no LLM"}
    </span>
  );
}

// Names a holding directly, so the sample demonstrates resolution working.
// The indirect-reference cases ("the concessionaire", "the infrastructure
// major") live in eval/dataset.json, where a miss is measured rather than
// mistaken for the feature being broken.
const SAMPLE_TEXT =
  "KNR Constructions has received a Letter of Award from the National Highways Authority of India " +
  "for a highway expansion project in Telangana worth Rs 1,734 crore.";

export function EventAnalysisSection({
  allDependentHoldings,
  counterpartyName,
  portfolioValueLabel,
}: {
  allDependentHoldings: HoldingRef[];
  counterpartyName: string;
  portfolioValueLabel: string;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolvedSymbol = result?.entities.find((e) => e.resolvedPositionSymbol)?.resolvedPositionSymbol ?? null;
  const company = resolvedSymbol ? allDependentHoldings.find((h) => h.symbol === resolvedSymbol) ?? null : null;
  const otherHoldings = allDependentHoldings.filter((h) => h.symbol !== resolvedSymbol);

  async function analyze() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/analyze-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as AnalyzeResponse;
      setResult(data);
    } catch {
      setError("Request failed. The endpoint may be unreachable.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section id="exposure-graph" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-faint">Exposure graph</h2>
          <p className="mt-1 text-sm text-text-dim">
            How a shock to one holding reaches every other holding that shares the same counterparty. Analyse an
            event below to highlight the specific company it names.
          </p>
          <div className="mt-6 rounded border border-border bg-bg-panel p-4">
            <ExposureGraph
              eventLabel={result?.eventTitle ?? "no event analysed yet"}
              company={company}
              counterpartyName={counterpartyName}
              otherHoldings={company ? otherHoldings : allDependentHoldings.slice(1)}
              portfolioValueLabel={portfolioValueLabel}
            />
          </div>
        </div>
      </section>

      <section id="event-analysis" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-faint">Event analysis</h2>
          <p className="mt-1 text-sm text-text-dim">
            Paste a news article or snippet. The model only extracts and links entity names — it never sees
            portfolio values and never emits a number. Every entity it returns must be a verbatim quote from the
            text you paste; anything else is dropped before it reaches this screen.
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste article text here..."
            rows={5}
            maxLength={MAX_INPUT_CHARS}
            className="mt-4 w-full rounded border border-border bg-bg-inset p-3 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
          <div className="mt-1 flex justify-end">
            <span
              className={`mono-num text-xs ${
                text.length >= MAX_INPUT_CHARS ? "text-accent" : "text-text-faint"
              }`}
            >
              {text.length.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()}
              {text.length >= MAX_INPUT_CHARS && " — paste the relevant paragraphs, not a whole article"}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={analyze}
              disabled={loading || !text.trim()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-40"
            >
              {loading ? "Analysing…" : "Analyse"}
            </button>
            <button
              onClick={() => setText(SAMPLE_TEXT)}
              className="text-xs text-text-dim underline hover:text-text"
              type="button"
            >
              use a sample snippet
            </button>
          </div>

          {error && <p className="mt-4 text-sm text-danger">{error}</p>}

          {result && (
            <div className="mt-6 rounded border border-border bg-bg-panel p-4">
              {result.extractor && (
                <div className="mb-3">
                  <ExtractorBadge extractor={result.extractor} />
                </div>
              )}
              {result.fallbackNote && (
                <p className="mb-3 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
                  {result.fallbackNote}
                </p>
              )}
              {result.abstain ? (
                <p className="text-sm text-text-dim">
                  <span className="font-medium text-text">Could not analyse.</span>{" "}
                  {result.abstainReason ?? "The system declined rather than guess."}
                </p>
              ) : (
                <>
                  <h3 className="text-sm font-medium text-text">{result.eventTitle}</h3>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-text-faint">Entities mentioned</div>
                      <ul className="mt-2 space-y-1 text-sm">
                        {result.entities.map((e, i) => (
                          <li key={i} className="text-text-dim">
                            <span className="text-text">{e.name}</span> ({e.type.toLowerCase()})
                            {e.resolvedPositionSymbol ? (
                              <span className="ml-1 text-ok">→ {e.resolvedPositionSymbol}</span>
                            ) : e.resolvedCounterpartyName ? (
                              <span className="ml-1 text-ok">→ {e.resolvedCounterpartyName} (counterparty)</span>
                            ) : (
                              <span className="ml-1 text-text-faint">→ not in portfolio</span>
                            )}
                          </li>
                        ))}
                        {result.entities.length === 0 && <li className="text-text-faint">none</li>}
                      </ul>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-text-faint">Counterparties implicated</div>
                      <ul className="mt-2 space-y-1 text-sm">
                        {result.counterparties.map((c, i) => (
                          <li key={i} className="text-text-dim">
                            <span className="text-text">{c.name}</span>
                            {c.resolvedCounterpartyName ? (
                              <span className="ml-1 text-ok">→ {c.resolvedCounterpartyName}</span>
                            ) : (
                              <span className="ml-1 text-text-faint">→ unresolved</span>
                            )}
                          </li>
                        ))}
                        {result.counterparties.length === 0 && <li className="text-text-faint">none</li>}
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
