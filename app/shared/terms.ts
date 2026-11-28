/**
 * Listing & commission terms (SPEC §19). Listings store the version the lister
 * accepted. The text is `docs/legal/commission-terms.md`; its header must carry
 * this version (tested). A version ending in "-draft" is placeholder text: the
 * server refuses to start in production while one is active (SPEC §20).
 */
export const COMMISSION_TERMS_VERSION = "2026-12-v1";

export function isDraftTermsVersion(version: string): boolean {
  return version.endsWith("-draft");
}
