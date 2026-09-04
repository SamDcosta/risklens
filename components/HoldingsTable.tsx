import type { Position } from "@prisma/client";
import { formatINR, formatNumber, formatPct } from "@/lib/format";

export interface BetaStats {
  betaMarket: number;
  seBetaMarket: number;
  betaInfra: number;
  seBetaInfra: number;
  r2: number;
  sampleSize: number;
  windowStart: string;
  windowEnd: string;
}

function reliabilityNote(r2: number): { label: string; className: string } {
  if (r2 >= 0.4) return { label: "moderate fit", className: "text-ok" };
  if (r2 >= 0.2) return { label: "weak fit", className: "text-accent" };
  return { label: "near-meaningless fit", className: "text-danger" };
}

export function HoldingsTable({
  positions,
  betaStats,
  portfolioValue,
}: {
  positions: Position[];
  betaStats: Map<string, BetaStats>;
  portfolioValue: number;
}) {
  return (
    <section id="holdings" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-text-faint">
          Holdings — portfolio value {formatINR(portfolioValue)}
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-strong text-left text-xs uppercase tracking-wide text-text-faint">
                <th className="py-2 pr-4">Symbol</th>
                <th className="py-2 pr-4">Sector</th>
                <th className="py-2 pr-4 text-right">Qty</th>
                <th className="py-2 pr-4 text-right">Price</th>
                <th className="py-2 pr-4 text-right">Market value</th>
                <th className="py-2 pr-4 text-right">Weight</th>
                <th className="py-2 pr-4 text-right">β market</th>
                <th className="py-2 pr-4 text-right">β infra</th>
                <th className="py-2 pr-4 text-right">R²</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const stats = betaStats.get(p.symbol);
                const reliability = stats ? reliabilityNote(stats.r2) : null;
                return (
                  <tr key={p.id} className="border-b border-border/60 align-top">
                    <td className="py-3 pr-4 font-medium text-text">
                      {p.symbol}
                      <div className="text-xs font-normal text-text-faint">{p.name}</div>
                    </td>
                    <td className="py-3 pr-4 text-text-dim">{p.sector}</td>
                    <td className="mono-num py-3 pr-4 text-right text-text-dim">{p.quantity}</td>
                    <td className="mono-num py-3 pr-4 text-right text-text-dim">{formatINR(p.price, true)}</td>
                    <td className="mono-num py-3 pr-4 text-right text-text">{formatINR(p.marketValue)}</td>
                    <td className="mono-num py-3 pr-4 text-right text-text-dim">{formatPct(p.portfolioWeight)}</td>
                    <td className="mono-num py-3 pr-4 text-right text-text">
                      {stats ? formatNumber(stats.betaMarket) : "—"}
                      {stats && <div className="text-xs text-text-faint">±{formatNumber(stats.seBetaMarket)}</div>}
                    </td>
                    <td className="mono-num py-3 pr-4 text-right text-text">
                      {stats ? formatNumber(stats.betaInfra) : "—"}
                      {stats && <div className="text-xs text-text-faint">±{formatNumber(stats.seBetaInfra)}</div>}
                    </td>
                    <td className="mono-num py-3 pr-4 text-right">
                      {stats ? (
                        <>
                          <span className="text-text">{formatNumber(stats.r2, 2)}</span>
                          <div className={`text-xs ${reliability?.className}`}>{reliability?.label}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-text-faint">
          Betas are OLS-regressed against NIFTY 50 (market) and NIFTY Infrastructure (infra) daily log returns —
          see <code className="text-text-dim">scripts/estimate_betas.ts</code> and{" "}
          <code className="text-text-dim">data/betas.json</code>. A beta with low R² and a wide standard error is a
          noisy estimate, not a fact — read it as one.
        </p>
      </div>
    </section>
  );
}
