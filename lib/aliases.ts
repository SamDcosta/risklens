/**
 * Deterministic alias map used to resolve names extracted by the LLM
 * (companies, counterparties) to our own Position/Counterparty rows.
 * Resolution is a plain lookup against this table, never another LLM call.
 */

export interface PositionAlias {
  symbol: string;
  aliases: string[];
}

export const POSITION_ALIASES: PositionAlias[] = [
  {
    symbol: "KNRCON",
    aliases: [
      "knr constructions",
      "knr construction",
      "knr",
      "knr constructions ltd",
      "knr constructions limited",
    ],
  },
  {
    symbol: "HGINFRA",
    aliases: ["hg infra", "hg infra engineering", "h.g. infra", "h.g. infra engineering", "hg infra engineering ltd"],
  },
  {
    symbol: "IRB",
    aliases: [
      "irb",
      "irb infrastructure",
      "irb infrastructure developers",
      "irb infra",
      "the mumbai-pune concessionaire",
      "mumbai-pune concessionaire",
      "mumbai pune expressway concessionaire",
    ],
  },
  {
    symbol: "HDFCBANK",
    aliases: ["hdfc bank", "hdfc bank ltd", "hdfc bank limited", "hdfc"],
  },
  {
    symbol: "RELIANCE",
    aliases: ["reliance industries", "reliance industries ltd", "reliance industries limited", "ril", "reliance"],
  },
  {
    symbol: "NIFTYBEES",
    aliases: ["nifty 50 etf", "niftybees", "nifty bees", "nippon india etf nifty bees"],
  },
];

export interface CounterpartyAlias {
  name: string;
  aliases: string[];
}

export const COUNTERPARTY_ALIASES: CounterpartyAlias[] = [
  {
    name: "NHAI",
    aliases: [
      "nhai",
      "national highways authority of india",
      "national highway authority of india",
      "national highways authority",
    ],
  },
];

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Returns the position symbol a free-text entity name resolves to, or null if unresolved. */
export function resolvePositionAlias(name: string): string | null {
  const normalized = normalize(name);
  for (const entry of POSITION_ALIASES) {
    if (normalized === normalize(entry.symbol) || entry.aliases.some((a) => normalize(a) === normalized)) {
      return entry.symbol;
    }
  }
  return null;
}

/** Returns the canonical counterparty name a free-text entity name resolves to, or null if unresolved. */
export function resolveCounterpartyAlias(name: string): string | null {
  const normalized = normalize(name);
  for (const entry of COUNTERPARTY_ALIASES) {
    if (normalized === normalize(entry.name) || entry.aliases.some((a) => normalize(a) === normalized)) {
      return entry.name;
    }
  }
  return null;
}
