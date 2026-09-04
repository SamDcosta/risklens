/**
 * Regresses each holding's daily log returns on NIFTY 50 (market) and NIFTY
 * Infrastructure (infra) index returns, via OLS, and writes data/betas.json.
 *
 * Run once, output committed: `npm run estimate-betas`.
 *
 * Data source: Yahoo Finance's public chart endpoint (no key required).
 * Raw daily closes are cached under data/raw/ so the regression is
 * reproducible without re-fetching, and so the numbers behind every beta are
 * inspectable, not just the coefficients.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const RANGE = "2y";
const INTERVAL = "1d";

const HOLDINGS = [
  { displaySymbol: "KNRCON", yahooSymbol: "KNRCON.NS", name: "KNR Constructions" },
  { displaySymbol: "HGINFRA", yahooSymbol: "HGINFRA.NS", name: "HG Infra Engineering" },
  { displaySymbol: "IRB", yahooSymbol: "IRB.NS", name: "IRB Infrastructure" },
  { displaySymbol: "HDFCBANK", yahooSymbol: "HDFCBANK.NS", name: "HDFC Bank" },
  { displaySymbol: "RELIANCE", yahooSymbol: "RELIANCE.NS", name: "Reliance Industries" },
  { displaySymbol: "NIFTYBEES", yahooSymbol: "NIFTYBEES.NS", name: "Nifty 50 ETF" },
] as const;

const MARKET_INDEX = { displaySymbol: "NIFTY50", yahooSymbol: "^NSEI", name: "NIFTY 50" };
const INFRA_INDEX = { displaySymbol: "NIFTYINFRA", yahooSymbol: "^CNXINFRA", name: "NIFTY Infrastructure" };

interface DailySeries {
  symbol: string;
  dates: string[]; // YYYY-MM-DD, ascending
  closes: number[];
}

interface YahooChartResponse {
  chart: {
    result: {
      meta: { gmtoffset?: number };
      timestamp: number[];
      indicators: { quote: { close: (number | null)[] }[] };
    }[] | null;
    error: unknown;
  };
}

async function fetchDailyCloses(yahooSymbol: string): Promise<DailySeries> {
  const url = `${YAHOO_CHART_URL}${encodeURIComponent(yahooSymbol)}?range=${RANGE}&interval=${INTERVAL}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Yahoo chart fetch failed for ${yahooSymbol}: HTTP ${res.status}`);
  }
  const json = (await res.json()) as YahooChartResponse;
  const result = json?.chart?.result?.[0];
  if (!result) {
    const err = json?.chart?.error;
    throw new Error(`No chart data for ${yahooSymbol}: ${err ? JSON.stringify(err) : "empty result"}`);
  }

  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const gmtoffset: number = result.meta?.gmtoffset ?? 19800;

  const dates: string[] = [];
  const cleanCloses: number[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null) continue;
    const localMs = (timestamps[i] + gmtoffset) * 1000;
    const iso = new Date(localMs).toISOString().slice(0, 10);
    dates.push(iso);
    cleanCloses.push(close);
  }

  return { symbol: yahooSymbol, dates, closes: cleanCloses };
}

function toReturnSeries(series: DailySeries): Map<string, number> {
  const returns = new Map<string, number>();
  for (let i = 1; i < series.closes.length; i++) {
    const prev = series.closes[i - 1];
    const cur = series.closes[i];
    if (prev > 0 && cur > 0) {
      returns.set(series.dates[i], Math.log(cur / prev));
    }
  }
  return returns;
}

// ---- small linear algebra: solve OLS via normal equations ----

type Matrix = number[][];

function transpose(m: Matrix): Matrix {
  return m[0].map((_, j) => m.map((row) => row[j]));
}

function matmul(a: Matrix, b: Matrix): Matrix {
  const out: Matrix = Array.from({ length: a.length }, () => new Array(b[0].length).fill(0));
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b[0].length; j++) {
      let s = 0;
      for (let k = 0; k < b.length; k++) s += a[i][k] * b[k][j];
      out[i][j] = s;
    }
  }
  return out;
}

/** Gauss-Jordan inversion of a small square matrix. */
function invert(m: Matrix): Matrix {
  const n = m.length;
  const aug: Matrix = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivotRow][col])) pivotRow = row;
    }
    if (Math.abs(aug[pivotRow][col]) < 1e-12) {
      throw new Error("Matrix is singular — regression inputs are collinear or degenerate.");
    }
    [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];

    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  return aug.map((row) => row.slice(n));
}

interface OlsResult {
  coefficients: number[]; // [intercept, betaMarket, betaInfra]
  standardErrors: number[];
  r2: number;
  n: number;
}

/** y = X * beta + e, X's first column must be all-ones (intercept). */
function ols(X: Matrix, y: number[]): OlsResult {
  const n = X.length;
  const k = X[0].length;
  const Y: Matrix = y.map((v) => [v]);

  const Xt = transpose(X);
  const XtX = matmul(Xt, X);
  const XtXInv = invert(XtX);
  const XtY = matmul(Xt, Y);
  const betaMatrix = matmul(XtXInv, XtY);
  const coefficients = betaMatrix.map((row) => row[0]);

  const yHat = matmul(X, betaMatrix).map((row) => row[0]);
  const residuals = y.map((v, i) => v - yHat[i]);
  const sse = residuals.reduce((s, e) => s + e * e, 0);
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const r2 = sst > 0 ? 1 - sse / sst : 0;

  const dof = n - k;
  const sigma2 = dof > 0 ? sse / dof : NaN;
  const standardErrors = XtXInv.map((row, i) => Math.sqrt(Math.max(sigma2 * row[i], 0)));

  return { coefficients, standardErrors, r2, n };
}

async function main() {
  console.log(`Fetching ${RANGE} of daily closes for ${HOLDINGS.length} holdings + 2 indices from Yahoo Finance...`);

  const allSymbols = [...HOLDINGS, MARKET_INDEX, INFRA_INDEX];
  const rawDir = path.join(process.cwd(), "data", "raw");
  mkdirSync(rawDir, { recursive: true });

  const seriesBySymbol = new Map<string, DailySeries>();
  for (const s of allSymbols) {
    // sequential + small delay: Yahoo's endpoint rate-limits bursts of requests.
    const series = await fetchDailyCloses(s.yahooSymbol);
    seriesBySymbol.set(s.displaySymbol, series);
    writeFileSync(path.join(rawDir, `${s.displaySymbol}.json`), JSON.stringify(series, null, 2));
    console.log(`  ${s.displaySymbol} (${s.yahooSymbol}): ${series.closes.length} daily closes`);
    await new Promise((r) => setTimeout(r, 400));
  }

  const marketReturns = toReturnSeries(seriesBySymbol.get(MARKET_INDEX.displaySymbol)!);
  const infraReturns = toReturnSeries(seriesBySymbol.get(INFRA_INDEX.displaySymbol)!);

  const results = HOLDINGS.map((holding) => {
    const holdingReturns = toReturnSeries(seriesBySymbol.get(holding.displaySymbol)!);

    // Align on dates present in all three series.
    const commonDates = [...holdingReturns.keys()]
      .filter((d) => marketReturns.has(d) && infraReturns.has(d))
      .sort();

    const y = commonDates.map((d) => holdingReturns.get(d)!);
    const X: Matrix = commonDates.map((d) => [1, marketReturns.get(d)!, infraReturns.get(d)!]);

    const { coefficients, standardErrors, r2, n } = ols(X, y);
    const [alpha, betaMarket, betaInfra] = coefficients;
    const [seAlpha, seBetaMarket, seBetaInfra] = standardErrors;

    return {
      symbol: holding.displaySymbol,
      name: holding.name,
      alpha,
      seAlpha,
      betaMarket,
      seBetaMarket,
      betaInfra,
      seBetaInfra,
      r2,
      sampleSize: n,
      windowStart: commonDates[0],
      windowEnd: commonDates[commonDates.length - 1],
    };
  });

  const output = {
    methodology:
      "OLS: dailyReturn_holding = alpha + betaMarket * dailyReturn_NIFTY50 + betaInfra * dailyReturn_NIFTYINFRA + error. " +
      "Returns are log returns on daily closes. Dates are aligned by intersection across all three series per holding.",
    source: "Yahoo Finance chart API (query1.finance.yahoo.com), unauthenticated, no key required.",
    marketIndex: MARKET_INDEX.yahooSymbol,
    infraIndex: INFRA_INDEX.yahooSymbol,
    computedAt: new Date().toISOString(),
    betas: results,
  };

  const outPath = path.join(process.cwd(), "data", "betas.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
  for (const r of results) {
    console.log(
      `  ${r.symbol}: betaMarket=${r.betaMarket.toFixed(2)} (se=${r.seBetaMarket.toFixed(2)}) ` +
        `betaInfra=${r.betaInfra.toFixed(2)} (se=${r.seBetaInfra.toFixed(2)}) R2=${r.r2.toFixed(3)} n=${r.sampleSize}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
