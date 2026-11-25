/** Per-household AI opt-in, stored on households.ai. Everything defaults to off. */
export interface AiSettings {
  enabled: boolean;
  categorize: boolean;
  digest: boolean;
  /** Monthly check of wallet cards and point values against issuers' pages (public data only). */
  catalogRefresh: boolean;
  /** ISO time the owner accepted the data-sharing notice. */
  consentedAt?: string;
  /** Most tokens (input plus output) all AI features may use in a calendar month. */
  monthlyTokenBudget: number;
}

export const DEFAULT_MONTHLY_TOKEN_BUDGET = 2_000_000;
export const MIN_MONTHLY_TOKEN_BUDGET = 50_000;
export const MAX_MONTHLY_TOKEN_BUDGET = 100_000_000;

export function parseAiSettings(raw: unknown): AiSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const enabled = s.enabled === true;
  return {
    enabled,
    categorize: enabled && s.categorize === true,
    digest: enabled && s.digest === true,
    catalogRefresh: enabled && s.catalogRefresh === true,
    consentedAt: typeof s.consentedAt === "string" ? s.consentedAt : undefined,
    monthlyTokenBudget:
      typeof s.monthlyTokenBudget === "number" &&
      Number.isInteger(s.monthlyTokenBudget) &&
      s.monthlyTokenBudget >= MIN_MONTHLY_TOKEN_BUDGET &&
      s.monthlyTokenBudget <= MAX_MONTHLY_TOKEN_BUDGET
        ? s.monthlyTokenBudget
        : DEFAULT_MONTHLY_TOKEN_BUDGET,
  };
}
