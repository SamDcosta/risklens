import type { CounterpartyExposure } from "@/lib/engine/exposure";
import { formatINR, formatPct } from "@/lib/format";
import { SourceSpanTooltip } from "./SourceSpanTooltip";

export function CounterpartyConcentrationPanel({
  exposures,
  portfolioValue,
}: {
  exposures: CounterpartyExposure[];
  portfolioValue: number;
}) {
  const sorted = [...exposures].sort((a, b) => b.exposure - a.exposure);

  return (
    <section id="concentration" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-sm font-semibold uppercase tracking-widest text-text-faint">Counterparty concentration</h1>
        <div className="mt-6 space-y-8">
          {sorted.map((row) => (
            <div key={row.counterparty.id} className="rounded border border-border bg-bg-panel p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <div>
                  <span className="text-xs uppercase tracking-wide text-text-faint">
                    {row.counterparty.type.replace(/_/g, " ")}
                  </span>
                  <h2 className="text-2xl font-semibold text-text">{row.counterparty.name}</h2>
                </div>
                <div className="text-right">
                  <div className="mono-num text-3xl font-semibold text-accent">{formatINR(row.exposure)}</div>
                  <div className="mono-num text-sm text-text-dim">
                    of {formatINR(portfolioValue)} · {formatPct(row.exposurePct)}
                  </div>
                </div>
              </div>

              <p className="mt-3 text-sm text-text-dim">
                Across {row.positions.length} position{row.positions.length === 1 ? "" : "s"}, each with a quoted
                source span (hover to read).
              </p>

              <ul className="mt-4 grid gap-2 sm:grid-cols-3">
                {row.positions.map(({ position, dependency }) => (
                  <li
                    key={position.id}
                    className="flex items-center justify-between rounded border border-border bg-bg-panel-alt px-3 py-2 text-sm"
                  >
                    <SourceSpanTooltip span={dependency.sourceSpan} document={dependency.sourceDocument} url={dependency.sourceUrl}>
                      <span className="cursor-default border-b border-dotted border-text-faint text-text">
                        {position.symbol}
                      </span>
                    </SourceSpanTooltip>
                    <span className="mono-num text-text-dim">{formatINR(position.marketValue)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {sorted.length === 0 && (
            <p className="text-sm text-text-dim">No counterparty dependencies recorded — every dependency requires a verbatim quoted source span, and none has been added yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
