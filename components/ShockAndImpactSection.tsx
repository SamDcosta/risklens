"use client";

import { useMemo, useState } from "react";
import type { Position, Dependency, Shock, Counterparty } from "@prisma/client";
import { computeShockImpact } from "@/lib/engine/impact";
import { formatINR, formatSignedPct } from "@/lib/format";

function ProvenanceBadge({ provenance }: { provenance: string }) {
  if (provenance === "HISTORICAL") {
    return (
      <span className="rounded-full border border-ok/50 bg-ok/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ok">
        Historical · cited
      </span>
    );
  }
  return (
    <span className="rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-accent">
      User-defined · assumption
    </span>
  );
}

export function ShockAndImpactSection({
  positions,
  dependencies,
  counterparty,
  historicalShocks,
}: {
  positions: Position[];
  dependencies: Dependency[];
  counterparty: Counterparty;
  historicalShocks: Shock[];
}) {
  const [mode, setMode] = useState<"historical" | "user">(historicalShocks.length > 0 ? "historical" : "user");
  const [historicalId, setHistoricalId] = useState(historicalShocks[0]?.id ?? "");
  const [userMagnitudePct, setUserMagnitudePct] = useState(-10);

  const activeShock: Shock = useMemo(() => {
    if (mode === "historical") {
      const found = historicalShocks.find((s) => s.id === historicalId);
      if (found) return found;
    }
    return {
      id: "user-defined",
      label: `User-defined shock: ${userMagnitudePct}% on ${counterparty.name} exposure`,
      description: null,
      provenance: "USER_DEFINED",
      counterpartyId: counterparty.id,
      magnitudePct: userMagnitudePct / 100,
      sourceUrl: null,
      eventDate: null,
      observedDrawdownPct: null,
      windowDays: null,
      createdAt: new Date(),
    };
  }, [mode, historicalId, historicalShocks, userMagnitudePct, counterparty]);

  const impact = useMemo(
    () => computeShockImpact(activeShock, positions, dependencies),
    [activeShock, positions, dependencies]
  );

  return (
    <section id="shock" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-text-faint">Shock panel</h2>
        <p className="mt-1 text-sm text-text-dim">
          Every shock is tagged with its provenance. There is no third category — no model-generated magnitudes or
          probabilities.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          {historicalShocks.length > 0 && (
            <button
              type="button"
              onClick={() => setMode("historical")}
              className={`rounded border px-3 py-2 text-left text-sm ${
                mode === "historical" ? "border-accent bg-bg-panel-alt" : "border-border bg-bg-panel"
              }`}
            >
              <ProvenanceBadge provenance="HISTORICAL" />
              <div className="mt-1 text-text">Use a cited historical analogue</div>
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode("user")}
            className={`rounded border px-3 py-2 text-left text-sm ${
              mode === "user" ? "border-accent bg-bg-panel-alt" : "border-border bg-bg-panel"
            }`}
          >
            <ProvenanceBadge provenance="USER_DEFINED" />
            <div className="mt-1 text-text">Set my own assumption</div>
          </button>
        </div>

        {mode === "historical" && historicalShocks.length > 0 && (
          <div className="mt-4 rounded border border-border bg-bg-panel p-4">
            <select
              value={historicalId}
              onChange={(e) => setHistoricalId(e.target.value)}
              className="rounded border border-border bg-bg-inset px-2 py-1 text-sm text-text"
            >
              {historicalShocks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {activeShock.description && <p className="mt-3 text-sm text-text-dim">{activeShock.description}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-text-faint">Event date</dt>
                <dd className="mono-num text-text">
                  {activeShock.eventDate ? new Date(activeShock.eventDate).toISOString().slice(0, 10) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-text-faint">Observed drawdown</dt>
                <dd className="mono-num text-text">{activeShock.observedDrawdownPct}%</dd>
              </div>
              <div>
                <dt className="text-text-faint">Window</dt>
                <dd className="mono-num text-text">{activeShock.windowDays} days</dd>
              </div>
              <div>
                <dt className="text-text-faint">Source</dt>
                <dd className="text-text">
                  {activeShock.sourceUrl ? (
                    <a href={activeShock.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-accent">
                      link
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}

        {mode === "user" && (
          <div className="mt-4 rounded border border-border bg-bg-panel p-4">
            <label className="flex items-center gap-4 text-sm text-text-dim">
              <span className="w-40">Assumed shock to {counterparty.name} exposure</span>
              <input
                type="range"
                min={-50}
                max={-1}
                step={1}
                value={userMagnitudePct}
                onChange={(e) => setUserMagnitudePct(Number(e.target.value))}
                className="flex-1 accent-accent"
              />
              <span className="mono-num w-16 text-right text-text">{userMagnitudePct}%</span>
            </label>
            <p className="mt-2 text-xs text-text-faint">
              This is a slider labelled &ldquo;assumption,&rdquo; not a model output labelled &ldquo;probability.&rdquo;
            </p>
          </div>
        )}

        <h3 className="mt-10 text-sm font-semibold uppercase tracking-widest text-text-faint">
          Direct vs indirect impact
        </h3>
        <p className="mt-1 text-sm text-text-dim">
          Never summed into one headline number. Direct is arithmetic; indirect rests on a regression whose R² is
          shown in the holdings table above.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded border border-border bg-bg-panel p-4">
            <div className="flex items-baseline justify-between">
              <h4 className="text-sm font-medium text-text">Direct (dependency-linked)</h4>
              <span className="mono-num text-lg font-semibold text-danger">{formatINR(impact.totalDirectImpact)}</span>
            </div>
            <ul className="mt-3 divide-y divide-border/60 text-sm">
              {impact.direct.map((row) => (
                <li key={row.position.id} className="flex items-center justify-between py-2">
                  <span className="text-text-dim">{row.position.symbol}</span>
                  <span className="mono-num text-text">{formatINR(row.impact)}</span>
                </li>
              ))}
              {impact.direct.length === 0 && <li className="py-2 text-text-faint">No directly dependent positions.</li>}
            </ul>
          </div>

          <div className="rounded border border-border bg-bg-panel p-4">
            <div className="flex items-baseline justify-between">
              <h4 className="text-sm font-medium text-text">Indirect (β-linked)</h4>
              <span className="mono-num text-lg font-semibold text-accent">{formatINR(impact.totalIndirectImpact)}</span>
            </div>
            <ul className="mt-3 divide-y divide-border/60 text-sm">
              {impact.indirect.map((row) => (
                <li key={row.position.id} className="flex items-center justify-between py-2">
                  <span className="text-text-dim">
                    {row.position.symbol}{" "}
                    <span className="text-xs text-text-faint">(β={row.position.betaInfra?.toFixed(2)})</span>
                  </span>
                  <span className="mono-num text-text">{formatINR(row.impact)}</span>
                </li>
              ))}
              {impact.indirect.length === 0 && <li className="py-2 text-text-faint">No indirectly exposed positions.</li>}
            </ul>
          </div>
        </div>

        <p className="mt-3 text-xs text-text-faint">
          Shock applied: {formatSignedPct(activeShock.magnitudePct)} to positions dependent on {counterparty.name}.
        </p>
      </div>
    </section>
  );
}
