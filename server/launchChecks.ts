import type { CompanyLegal, PartialCompanyLegal } from "../app/shared/companyLegal";
import { isDraftTermsVersion } from "../app/shared/terms";

/**
 * Production launch guard (SPEC §20): the server refuses to start in
 * production while the active terms are a draft or any of the company's
 * legal details is missing. Messages name the setting, never a value.
 */

/** Env variable for each legal detail (what the operator must set). */
export const COMPANY_LEGAL_ENV: Record<keyof CompanyLegal, string> = {
  nameAr: "COMPANY_LEGAL_NAME_AR",
  nameEn: "COMPANY_LEGAL_NAME_EN",
  commercialRegistrationNumber: "COMPANY_CR_NUMBER",
  taxNumber: "COMPANY_TAX_NUMBER",
  salesTaxRegistered: "COMPANY_SALES_TAX_REGISTERED",
  dlsLicenseNumber: "COMPANY_DLS_LICENSE_NUMBER",
};

export function launchProblems(input: { termsVersion: string; company: PartialCompanyLegal }): string[] {
  const problems: string[] = [];
  if (isDraftTermsVersion(input.termsVersion)) {
    problems.push(`The active commission terms version (${input.termsVersion}) is a draft; publish the reviewed terms first.`);
  }
  for (const [key, name] of Object.entries(COMPANY_LEGAL_ENV) as Array<[keyof CompanyLegal, string]>) {
    if (input.company[key] === undefined) problems.push(`${name} is not set (company legal details are required in production).`);
  }
  return problems;
}

/** Throws (listing every problem) unless the server may start in production. */
export function assertLaunchReady(input: { termsVersion: string; company: PartialCompanyLegal }): void {
  const problems = launchProblems(input);
  if (problems.length) throw new Error(`Refusing to start in production:\n- ${problems.join("\n- ")}`);
}
