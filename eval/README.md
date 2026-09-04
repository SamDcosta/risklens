# Evaluation

`dataset.json` is a hand-labeled set of short (~60-word) verbatim excerpts from real news items about the
six holdings, NHAI, and Indian infrastructure generally — including a few "hard" cases where a holding is
named indirectly (a nickname, a project name, a descriptive phrase) rather than by its exact name. Full
articles are not stored, only short excerpts with attribution (`sourceUrl`, `publisher`, `publishedDate`),
per the copyright limits this project was built under — see the top-level README's Evaluation section.

Each item's `labels.entities[].span` is a verbatim substring of that item's `excerpt` — this is checked, not
assumed.

Run `npm run eval` to run the extractors (in-process, not over HTTP) against every item and write
`results.json`.

**Two extractors are scored on the same items**, so the LLM has an honest comparison point:

- `BASELINE` — the rule-based alias matcher. Always runs; needs no key.
- `GEMINI` — runs only when `GEMINI_API_KEY` is set. Paced to respect free-tier rate limits, which makes a
  full run take a couple of minutes.

Metrics computed (see `run.ts`):

| Metric | Definition |
|---|---|
| Coverage | items where a response was actually obtained and therefore scored |
| Error rate | items where no response could be obtained (quota, timeout, network) — **excluded** from every metric below |
| Entity precision | correctly identified entities / all identified |
| Entity recall | correctly identified / all present in labels |
| Counterparty linking accuracy | items where the resolved counterparty set exactly matches ground truth |
| Hallucination rate | entities returned whose span was absent from the source text, measured before the containment filter drops them |
| Abstention rate | items where the extractor was reached and declined rather than guess |
| Unresolved-entity rate | extracted names that didn't match any known alias |

Two things worth reading carefully rather than at face value:

- **A failure is not an abstention.** A 429 says nothing about extraction accuracy, so those items are
  reported as `errorRate` and excluded from the quality metrics rather than being counted as the model
  choosing to decline.
- **A high unresolved-entity rate is not necessarily bad.** The dataset deliberately contains out-of-universe
  companies (Tata Motors, Adani Road Transport, L&T, SEBI). Correctly extracting them *and* correctly failing
  to resolve them to one of our six holdings is the desired behaviour, and it drives this number up. The
  baseline scores lower here only because it can't see them at all.
