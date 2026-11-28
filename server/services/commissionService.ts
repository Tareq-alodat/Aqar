/**
 * Commission rate rules (SPEC §19, terms 2026-12-v1): agreed per lister or
 * listing (commission agreements, milestone 11), always > 0 and at most the
 * country's cap (Jordan 5 %); the country's default rate (1 %) applies when no
 * agreement exists. Checked on the server whatever the source of the rate.
 */

export class CommissionRateError extends Error {
  constructor(readonly code: "rate_not_positive" | "rate_above_cap") {
    super(code);
  }
}

export function validateCommissionRate(rate: number, cap: number): number {
  if (!Number.isFinite(rate) || rate <= 0) throw new CommissionRateError("rate_not_positive");
  if (rate > cap) throw new CommissionRateError("rate_above_cap");
  return rate;
}

/**
 * The rate a listing is submitted with: the agreed rate when there is one
 * (agreements arrive with milestone 11), else the country's default; validated.
 */
export function listingCommissionRate(country: { commissionRate: number; commissionRateMax: number }, agreedRate?: number | null): number {
  return validateCommissionRate(agreedRate ?? country.commissionRate, country.commissionRateMax);
}
