# RiskLens — Architecture

A counterparty-exposure tool built around one constraint: **nothing that reaches the screen may be invented
at request time.**

---

## The central split

Every expensive or unverifiable operation — fetching market data, regressing betas, sourcing quoted
dependencies — happens *before* deployment and is committed to the repository. At request time the
application only reads.

This isn't a performance decision. It's what makes the numbers auditable: the regression inputs, the
regression output, and the database are all in git, so any figure on screen traces back to a committed file
and can be recomputed. It's also what lets SQLite work on a read-only serverless filesystem at all.

```mermaid
flowchart TB
    subgraph build["BUILD TIME — run once, output committed to git"]
        direction LR
        YF["Yahoo Finance<br/>chart API"]
        EB["scripts/estimate_betas.ts<br/>OLS regression"]
        BJ["data/betas.json<br/>data/raw/*.json"]
        RJ["research/nhai_dependencies.json<br/>hand-sourced verbatim quotes"]
        SEED["prisma/seed.ts<br/>enforces source spans"]
        YF -->|"2y daily closes"| EB
        EB -->|"beta, std error, R2"| BJ
        BJ --> SEED
        RJ --> SEED
    end

    SEED -->|"writes"| DB[("prisma/dev.db")]

    subgraph runtime["REQUEST TIME — read-only, no writes"]
        direction LR
        TMP[("/tmp/risklens.db")]
        PAGE["app/page.tsx<br/>server component"]
        BJ2["data/betas.json"]
        RES["eval/results.json"]
        ENG["lib/engine/<br/>exposure + impact"]
        UI["6 UI panels"]
        TMP --> PAGE
        BJ2 --> PAGE
        RES --> PAGE
        PAGE --> ENG
        ENG --> UI
    end

    DB -->|"shipped in bundle, copied on cold start"| TMP
```

**The database is a build artifact, not a live store.** Because nothing writes at request time, the
pre-seeded SQLite file can ship inside the deployment bundle and be copied to `/tmp` on cold start — the only
writable path in Vercel's runtime.

---

## Layers

| Layer | Responsibility |
|---|---|
| `scripts/` + `research/` | Data generation. Two years of daily closes → log returns → OLS against NIFTY 50 and NIFTY Infrastructure, emitting coefficients with standard errors and R². Raw closes are committed alongside the output so the regression can be recomputed by hand rather than taken on trust. |
| `prisma/` | Persistence. Four tables: Position, Counterparty, Dependency, Shock. The seed is driven entirely by the research JSON — counterparties are created from what that file declares, so adding a second one is a data edit, not a code change. |
| `lib/engine/` | Calculation. Two pure functions over plain data, no I/O. They import Prisma *types* but never the client, so the same code runs on the server and in the browser for the live shock slider. |
| `lib/extract/` | Entity extraction. Two interchangeable extractors behind one dispatcher, sharing a single validation gate. |
| `app/` | Interface. A server component reads the database and both JSON files per request (`force-dynamic`). Only three components are client-side — the shock slider, the event box, and the graph — because only those need interactivity. |

### The enforced write path

`lib/dependencies.ts` is the **only** write path for dependency rows, and it throws when the source span is
empty. "No quote, no row" is enforced in the insert path rather than left as a convention for callers to
remember.

---

## The extraction path

This is the only place a language model touches the system, and its job is deliberately narrow: extract
entity names and link them to holdings. It never receives portfolio values, and the response schema contains
no numeric field for it to populate.

```mermaid
flowchart TB
    REQ["POST /api/analyze-event"]
    VAL["Zod validation<br/>text &le; 4,000 chars"]
    ERR["400 Bad Request"]
    BUD["checkLlmBudget by IP<br/>in-memory, per instance"]
    GEM["analyzeEventGemini<br/>temperature 0, strict schema"]
    BASE["analyzeEventBaseline<br/>alias table, no model"]
    FIN["finalize — SHARED GATE<br/>filterByContainment: drops any span<br/>not literally present in the input<br/>resolveEntities: alias table lookup"]
    RESULT["ExtractionResult<br/>carries which extractor ran"]
    BADGE["UI badge:<br/>'Gemini · LLM' or 'Alias matcher · no LLM'"]

    REQ --> VAL
    VAL -->|"invalid"| ERR
    VAL -->|"valid"| BUD
    BUD -->|"within budget"| GEM
    BUD -->|"over budget / no key"| BASE
    GEM -.->|"NO FALLBACK on runtime failure — known gap"| BASE
    GEM --> FIN
    BASE --> FIN
    FIN --> RESULT
    RESULT --> BADGE
```

**The safety check sits below the branch, not inside either extractor.** Both paths converge on the same
containment filter and alias resolution, so a fabricated span cannot reach the UI regardless of which
extractor produced it — and swapping the model can't accidentally bypass the check.

The dotted edge is the one that **doesn't exist**. See [Known gap](#known-gap).

---

## Why the benchmark bypasses all of this

The evaluation harness imports the two extractors directly and never calls the dispatcher.

```mermaid
flowchart LR
    EV["eval/run.ts<br/>25 hand-labeled items"]
    GEM["analyzeEventGemini"]
    BASE["analyzeEventBaseline"]
    DISP["analyzeEvent dispatcher<br/>NOT USED by eval"]
    SCORE["scored separately<br/>per extractor"]

    EV -->|"direct import"| GEM
    EV -->|"direct import"| BASE
    GEM --> SCORE
    BASE --> SCORE
    EV -.->|"deliberately bypassed"| DISP
```

**Routing the benchmark through the dispatcher would silently corrupt it.** A rate-limited item would return
baseline results and be scored as the model's — quietly deflating one extractor and inflating the other, with
nothing in the output to indicate it happened.

The same principle governs how failures are counted: a quota error means no response was obtained and says
nothing about extraction quality, so those items are excluded from the quality metrics and reported as
`errorRate` / `coverage`. Only a model that was actually reached and declined counts toward `abstentionRate`.

---

## Known gap

**Runtime model failures have no fallback path.**

The switch to the baseline extractor fires only on the *pre-emptive* budget check. If Gemini is actually
called and then fails — a real 429, a timeout, a network error — `analyzeEventGemini` returns a failed result
and the dispatcher passes it straight through.

So the scenario the budget guard was written for (quota exhausted during judging) still surfaces as
*"Could not analyse: Extraction failed: 429…"*. The in-memory limiter won't intercept it first, because it
barely fires in production — Vercel routes consecutive requests to different instances, so its counter
restarts almost every time (measured: four consecutive requests hit four distinct instances).

The fix is roughly five lines: inspect `result.failed` after the model call and fall through to the baseline
with an explanatory note, exactly as the budget path already does. Documented here rather than quietly left
in the code.

---

## Deployment

Next.js on Vercel, with three adaptations the default setup doesn't handle:

| Adaptation | Where | Why |
|---|---|---|
| `/tmp` copy on cold start | `lib/db.ts` | SQLite wants a writable directory beside its file even for pure reads, so the committed snapshot is copied to `/tmp` and Prisma is pointed at the copy. |
| Output file tracing | `next.config.ts` | Next's bundler can't see through `readFileSync`, so `prisma/dev.db`, `data/betas.json` and `eval/results.json` are declared in `outputFileTracingIncludes`. Without it they're absent from the bundle and the page renders silently empty. |
| Extra engine target | `prisma/schema.prisma` | `rhel-openssl-3.0.x` alongside `native`, since the query engine binary that runs locally isn't the one Vercel's Linux runtime needs. |
