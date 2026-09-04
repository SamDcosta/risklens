# Evaluation

`dataset.json` is a hand-labeled set of short (~60-word) verbatim excerpts from real news items about the
six holdings, NHAI, and Indian infrastructure generally — including a few "hard" cases where a holding is
named indirectly (a nickname, a project name, a descriptive phrase) rather than by its exact name. Full
articles are not stored, only short excerpts with attribution (`sourceUrl`, `publisher`, `publishedDate`),
per the copyright limits this project was built under — see the top-level README's Evaluation section.

Each item's `labels.entities[].span` is a verbatim substring of that item's `excerpt` — this is checked, not
assumed.

Run `npm run eval` to run the extractor (in-process, not over HTTP) against every item and write
`results.json`. Without `ANTHROPIC_API_KEY` set, every item abstains without a model call and the resulting
metrics reflect that stubbed state, not extractor quality — `results.json` says so explicitly via
`llmConfigured: false`.

Metrics computed (see `run.ts`):

| Metric | Definition |
|---|---|
| Entity precision | correctly identified entities / all identified |
| Entity recall | correctly identified / all present in labels |
| Counterparty linking accuracy | items where the resolved counterparty set exactly matches ground truth |
| Hallucination rate | entities the model returned whose span was absent from the source text, before the containment filter runs (only measurable when the LLM actually ran) |
| Abstention rate | items where the system declined rather than guess |
| Unresolved-entity rate | extracted names that didn't match any known alias |
