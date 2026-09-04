export const COUNTERPARTY_TYPES = ["GOVERNMENT_AGENCY", "CORPORATE", "REGULATOR"] as const;
export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

export const EXTRACTION_SOURCES = ["LLM", "MANUAL"] as const;
export type ExtractionSource = (typeof EXTRACTION_SOURCES)[number];

export const SHOCK_PROVENANCE = ["HISTORICAL", "USER_DEFINED"] as const;
export type ShockProvenance = (typeof SHOCK_PROVENANCE)[number];

// The five factors this build's data model recognises. Only INDIA_EQUITY and
// INFRASTRUCTURE have a regressed beta (see scripts/estimate_betas.ts) —
// CREDIT, RATES and FX are named here for the taxonomy but have no
// implemented proxy in this build. See README limitations.
export const RISK_FACTORS = ["INDIA_EQUITY", "INFRASTRUCTURE", "CREDIT", "RATES", "FX"] as const;
export type RiskFactor = (typeof RISK_FACTORS)[number];

export const FACTORS_WITH_REGRESSED_BETA: RiskFactor[] = ["INDIA_EQUITY", "INFRASTRUCTURE"];
