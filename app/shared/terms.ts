/**
 * Commission terms (SPEC §19). Listings store the version the lister accepted.
 * A version ending in "-draft" is placeholder text pending legal review: the
 * server must refuse to start in production while it is active (milestone 11, SPEC §20).
 */
export const COMMISSION_TERMS_VERSION = "2026-11-draft";

export function isDraftTermsVersion(version: string): boolean {
  return version.endsWith("-draft");
}
