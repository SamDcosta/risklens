# RiskLens

A portfolio exposure tool that surfaces **shared counterparty dependencies** — risks that cross sector
boundaries and are therefore invisible to every sector-based portfolio view.

The motivating case: KNR Constructions, HG Infra Engineering and IRB Infrastructure are three separate
tickers in three separate positions. All three depend on NHAI (National Highways Authority of India) tender
awards. A sector view calls that "infrastructure exposure." A counterparty view calls it a single point of
failure.

**The headline claim is exposure measurement, not loss prediction.** RiskLens reports how much capital sits
behind a shared dependency. It does not predict what will happen to it. **This is not investment advice.**

📐 **[Architecture](docs/ARCHITECTURE.md)** — the build-time/request-time split, the dual-extractor pipeline,
why the benchmark bypasses the dispatcher, and the one gap still open.

---

## Setup

```bash
npm install
cp .env.example .env          # DATABASE_URL is already filled in; GEMINI_API_KEY is optional
npm run db:push               # create the SQLite schema
npm run estimate-betas        # pulls ~2y of daily closes from Yahoo Finance, writes data/betas.json
npm run db:seed               # seeds positions, counterparty dependency rows, and historical shocks
npm run dev
```

`GEMINI_API_KEY` (free, from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)) is optional.
Without it, `/api/analyze-event` falls back to the deterministic alias matcher instead of calling a model —
the endpoint still works, and the UI always labels which extractor produced a result.

### Changing the data and re-running everything

Nothing here has an in-app data-entry form on purpose — every number stays traceable to a committed source
file, not a database row someone typed into a UI. To change the data:

- **Holdings**: edit `HOLDINGS` in both [`scripts/estimate_betas.ts`](scripts/estimate_betas.ts) (needs a
  valid Yahoo Finance symbol) and [`prisma/seed.ts`](prisma/seed.ts) (uses the same symbol as the key).
- **Counterparties and dependencies**: edit
  [`research/nhai_dependencies.json`](research/nhai_dependencies.json) — add an entry to `counterparties`
  (`{ name, type }`) and reference it by name from any `dependencies[].counterparty` or
  `historicalShocks[].counterparty`. This is genuinely data-driven: `prisma/seed.ts` creates every
  counterparty this file lists, not just NHAI. A `sourceSpan` that's empty is still refused at insert time.
- **Evaluation items**: edit [`eval/dataset.json`](eval/dataset.json), following the existing item shape.
  Every labeled `span` must be an exact substring of that item's `excerpt` — `eval/run.ts` matches on exact
  span equality, so a mismatched quote just shows as "missed," not an error.

Then rerun whichever of these actually changed, in order:

```bash
npm run estimate-betas   # only if you touched HOLDINGS
npm run db:push          # only if you touched prisma/schema.prisma
npm run db:seed          # holdings + counterparties + dependencies + shocks
npm run eval              # evaluation dataset
```

or run all four in sequence with `npm run data:refresh`. The running dev server picks up the new data on
the next request without a restart (`app/page.tsx` and the Evaluation panel both read fresh on every
request). On Windows, if `npm run dev` is running in another terminal while you run this, `prisma db push`
may print a harmless `EPERM` warning about the query engine `.dll` being locked — the schema and client
still update correctly; stop the dev server first if you want a clean run.

The event-analysis and shock panels are scoped to whichever counterparty carries the most total exposure —
if you add a second counterparty, it still appears in the Counterparty Concentration panel, just without its
own shock/impact panel below.

---

## Data model

- **Position** (6 holdings): symbol, name, sector, quantity, price, marketValue, portfolioWeight,
  betaMarket, betaInfra, betaSource. Betas are *regressed*, never authored — see [Methodology](#methodology).
- **Counterparty**: NHAI, type `GOVERNMENT_AGENCY`.
- **Dependency**: links a Position to a Counterparty. **A dependency with no verbatim `sourceSpan` is never
  written** — enforced in [`lib/dependencies.ts`](lib/dependencies.ts)'s `createDependency()`, the single
  write path for the table, not left as a convention for callers to remember.
- **Shock**: a magnitude with an explicit provenance tag — `HISTORICAL` (cited, with `sourceUrl`,
  `eventDate`, `observedDrawdownPct`, `windowDays`) or `USER_DEFINED` (a slider labelled "assumption," never
  a probability). There is no third category: no LLM-generated shock magnitudes or probabilities anywhere in
  this codebase.

### Risk factor taxonomy

Five factors are named in the domain model: India equity, Infrastructure, Credit, Rates, FX. Only **India
equity** and **Infrastructure** have a regressed beta in this build — each has an investable index proxy
(NIFTY 50, NIFTY Infrastructure) that `scripts/estimate_betas.ts` can actually regress against. Credit,
Rates and FX are named for completeness but have no implemented proxy here; treating them as measured would
be exactly the "a factor you cannot estimate is a made-up number wearing a chart" mistake this project is
built to avoid. Regulatory risk and Energy were dropped from the original 7-factor list for the same reason.

---

## Methodology

### Betas

`scripts/estimate_betas.ts` pulls ~2 years of daily closes for the six holdings plus NIFTY 50 and NIFTY
Infrastructure from Yahoo Finance's public chart endpoint (no key required), computes daily log returns, and
runs OLS: `holdingReturn = alpha + betaMarket * niftyReturn + betaInfra * niftyInfraReturn + error`, aligning
dates by intersection across all three series per holding. Standard errors come from the OLS covariance
matrix; R² from explained/total variance. The script, the raw daily closes (`data/raw/*.json`), and the
output (`data/betas.json`) are all committed, so every number in the holdings table traces back to a
reproducible run.

**Read the R² column before the beta column.** Several of these estimates are genuinely weak — e.g. the
three infra holdings have R² between 0.17 and 0.32 against a two-factor model with wide standard errors on
`betaMarket`. A beta with a standard error close to its own magnitude is a noisy estimate, not a fact, and
the UI labels it accordingly ("weak fit" / "near-meaningless fit").

### Counterparty dependencies

The NHAI dependency for each of the three infra holdings is backed by a verbatim quoted span (see
`research/nhai_dependencies.json` and the hover tooltips in the Counterparty Concentration panel). None of
the three companies' annual report PDFs were text-extractable by the tooling used here (they returned as
scanned/signed documents with no parseable narrative text), so the quoted spans come from news coverage of
each company's own exchange disclosure, or — for IRB — the company's own press release, rather than the
annual report body text itself. This is weaker sourcing than the ideal (annual report or investor
presentation prose) and is flagged here rather than presented as equivalent.

### Historical shock

The seeded `HISTORICAL` shock uses PNC Infratech (NSE: PNCINFRA) as an analogue: a comparable NHAI-dependent
road EPC/HAM/BOT developer, not one of this portfolio's own holdings. On 5–6 August 2026, NHAI suspended
toll collection on PNC Infratech's Kanpur–Lucknow Expressway concession after a ~300m subsidence 13 days
post-opening and proposed declaring the company a "non-performer." PNC Infratech shares fell over 6%
intraday on the news and more than 5% further the following session — a real, cited, two-session drawdown
used here as an analogue magnitude, not a prediction about any of this portfolio's own holdings. Source:
[Business Today](https://www.businesstoday.in/markets/stocks/story/pnc-infratech-shares-tumble-6-after-nhai-suspends-toll-collection-on-expressway-547644-2026-08-06).

---

## The engine

```
counterpartyExposure(c)    = Σ marketValue over positions depending on c
counterpartyExposurePct(c) = counterpartyExposure(c) / portfolioValue

positionImpact   = position.marketValue × shockPct × (dependency ? 1 : betaInfra)
portfolioImpact  = Σ positionImpact   — but never shown as one number:
```

Direct (dependency-linked, arithmetic) and indirect (β-linked, resting on a regression) impact are always
shown as **separate columns**, never summed — see [`lib/engine/impact.ts`](lib/engine/impact.ts).

---

## The LLM's job — and only this

`POST /api/analyze-event` does extraction and linking, nothing else. It never receives portfolio values and
never emits a number, probability, or severity. Temperature 0, with a strict `responseSchema` that has no
numeric fields to fill in even if the model wanted to. Every entity's `span` is checked against the input
text with a plain string-containment check *in code* (`filterByContainment` in
[`lib/extract/shared.ts`](lib/extract/shared.ts)) — an entity that survives a well-crafted prompt but fails
this check is still dropped before it reaches the UI. Resolution from extracted names to our own
Position/Counterparty rows is a deterministic alias lookup ([`lib/aliases.ts`](lib/aliases.ts)), not another
model call; unresolved entities are logged, not silently dropped.

### Two extractors, always labelled

- **`GEMINI`** ([`lib/extract/gemini.ts`](lib/extract/gemini.ts)) — Gemini via `@google/genai`, used when
  `GEMINI_API_KEY` is set.
- **`BASELINE`** ([`lib/extract/baseline.ts`](lib/extract/baseline.ts)) — a rule-based matcher that scans for
  names in our own alias table. No model, no key, no cost. It exists as an honest comparison point, **not**
  as a stand-in for a model: it can only find names it was given, so it fails by construction on indirect
  references, which is exactly what the eval quantifies.

Both go through the identical containment check and alias resolution, and every result carries which
extractor produced it — shown as a badge in the UI, and reported separately in the eval. A regex must never
be mistakable for a model.

### Budget guarding on a public endpoint

The deployed endpoint is public and the API key is server-side, so anyone who finds the URL can spend the
project's Gemini quota. Two mitigations ship, and it's worth being precise about how much each one actually
buys, because they are not equal.

**What reliably holds:**

- Input is capped at 4,000 characters — oversized requests get a 400 before any model call happens.
- **Graceful degradation is the load-bearing protection.** If the model path is unavailable for any reason —
  quota gone, rate limited, API down — the request is served by the baseline extractor instead of failing.
  Every response carries its extractor badge, so the downgrade is visible rather than silent, with a note
  explaining why. This is what makes quota exhaustion a cosmetic problem rather than a broken demo.

**What barely holds:** [`lib/rateLimit.ts`](lib/rateLimit.ts) caps model calls at 5/minute per IP and 150/day,
but it is in-memory and Vercel routes consecutive requests to *different* serverless instances — measured on
this deployment, four consecutive requests hit four distinct instances. Each one therefore starts with an
empty counter, and a burst sails straight through. It works locally and under sustained load against one warm
instance; it is close to useless against exactly the casual abuse it was written for.

Making it real requires shared state (Vercel KV, Upstash Redis) — deliberately not added here, because on a
free tier the cost of exhausted quota is a demo that shows the baseline extractor rather than a bill. It is
documented as measured rather than as intended.

A distinction the eval takes seriously: **a failure is not an abstention.** A quota error or timeout means
no response was obtained and says nothing about extraction quality, so those items are excluded from the
quality metrics and reported as `errorRate`/`coverage` instead. Only a model that was actually reached and
declined counts toward `abstentionRate`.

---

## Evaluation

25 hand-labeled items, both extractors scored on the same set.
Model: `gemini-3.5-flash-lite`. Full output in [`eval/results.json`](eval/results.json).

| Metric | Alias matcher (no LLM) | Gemini |
|---|---:|---:|
| Coverage (items scored) | 100.0% | 100.0% |
| Error rate (no response obtained) | 0.0% | 0.0% |
| Entity precision | 57.1% | 62.0% |
| **Entity recall** | **33.3%** | **91.7%** |
| Counterparty linking accuracy | 84.0% | 80.0% |
| **Hallucination rate** | **0.0%** | **0.0%** |
| Abstention rate | 24.0% | 0.0% |
| Unresolved-entity rate | 21.4% | 78.9% |

**Recall is the number that matters**: the LLM finds 91.7% of labeled entities against the baseline's 33.3%,
which is the measured case for using a model here rather than an assumed one.

**Hallucination rate is 0.0% for both** — no returned entity failed the span-containment check. That is the
check working, not an absence of risk: it's enforced in code, so a hallucinated span is structurally unable
to reach the UI.

Three results worth reading honestly rather than as wins:

- **The baseline beats Gemini on counterparty linking (84.0% vs 80.0%).** Within our tiny counterparty
  universe of one, exact string matching is simply hard to beat, and the model occasionally over-attributes.
- **Gemini's unresolved-entity rate is much higher (78.9% vs 21.4%) and this is correct behaviour.** The
  dataset deliberately includes out-of-universe companies (Tata Motors, Adani Road Transport, L&T, SEBI).
  Extracting them *and* correctly declining to resolve them to one of our six holdings is what should happen.
  The baseline scores "better" here only because it cannot see them at all.
- **Named failures are more informative than the aggregates.** In `article-03`, HG Infra is referred to only
  as "the infrastructure major" with no company name in the excerpt — Gemini missed it, exactly the
  indirect-reference case the dataset was built to probe.

Per the copyright limits this build was produced under, `eval/dataset.json` stores short (~60-word) verbatim
excerpts with full source attribution (URL, publisher, date) rather than full article text — enough to
contain the entity mentions in context, not a reproduction of each article. See `eval/dataset.json` for the
full hand-labeled set and `eval/run.ts` for the metric definitions (entity precision/recall, counterparty
linking accuracy, hallucination rate, abstention rate, unresolved-entity rate) and named per-item failures.

---

## Related work

- **[Bloomberg SPLC](https://libraries.emory.edu/sites/default/files/migrated-documents/db-pages/bloomberg-splc.pdf)** —
  a Bloomberg Terminal function giving a full supply-chain breakdown for a company: revenue exposure across
  its suppliers and customers, sourced from filings, transcripts, and other public disclosures, covering
  over 200,000 quantified supply-chain relationships. Institutional-only (Terminal subscription).
- **[FactSet Revere Supply Chain Relationships](https://www.factset.com/marketplace/catalog/product/factset-supply-chain-relationships)** —
  normalises company-to-company relationships (customer, supplier, partner, competitor, with finer
  sub-types) from primary sources, including relationships reverse-linked from a non-disclosing party's
  disclosing counterparty. Institutional-only.
- **Tickertape-class retail tools (India)** — portfolio trackers aimed at retail investors, offering sector
  concentration (e.g. top-3/top-5/top-10 holding weight, "distribution by sector") and portfolio-strength
  scoring. These operate at the sector level, which is exactly the blind spot this project targets: three
  positions each classified "Infrastructure" don't read as concentrated until the shared counterparty behind
  them is named.

**The gap this project targets is retail access and Indian small/mid-cap coverage, not a novel technique.**
Institutional platforms already solve counterparty-dependency mapping at scale; they are not built for a
₹10,00,000 retail portfolio of Indian small/mid-cap infrastructure names, and their coverage of that segment
is not something this project can independently verify.

### Ind AS 108 note

Ind AS 108 (Operating Segments), paragraph 34, requires an entity to disclose when revenue from transactions
with a single external customer amounts to 10% or more of total revenue — and to disclose *the amount*, but
not the customer's identity, unless the entity chooses to name them. This is precisely why the NHAI
dependency in this build had to be recovered from narrative disclosure (an exchange filing, a press release,
news coverage of one) rather than from a company's segment note: the segment note alone would tell you *that*
a >10% counterparty exists, never *which one*.

---

## Limitations

- Single portfolio, six holdings, seeded once — not a live brokerage integration.
- Betas are estimated from a ~2-year daily-return window against two index proxies; several holdings have
  weak R² and wide standard errors (shown in the UI, not hidden).
- The NHAI dependency quotes for all three infra holdings come from news/press-release coverage of exchange
  disclosures, not directly from an annual report or investor presentation body (see
  [Methodology](#methodology) above) — the annual report PDFs available for this build were not
  text-extractable by the tooling used.
- The seeded historical shock is a real, cited analogue from a different (comparable) company, not this
  portfolio's own price history — treat its magnitude as illustrative, not as a forecast for any of the
  three infra holdings.
- Shock magnitudes are either historical analogues or explicit user assumptions — never a model-estimated
  probability or severity.
- Entity extraction is evaluated on a small hand-labeled set of short excerpts (see
  [Evaluation](#evaluation)), not a large benchmark. 25 items is enough to surface named failure modes, not
  enough for tight confidence intervals — read the metrics as directional.
- The deployed data is a snapshot: `prisma/dev.db` is committed pre-seeded, so prices and betas are frozen at
  the last `npm run data:refresh`, not live.
- Gemini runs on a free-tier key with per-minute quotas, so a full eval run is paced and can still hit
  rate limits; those items are reported as errors and excluded from quality metrics rather than being
  silently folded in as abstentions.
- **This tool measures exposure. It does not predict outcomes and is not investment advice.**
