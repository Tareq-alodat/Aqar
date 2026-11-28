import { describe, expect, it } from "vitest";
import type { CompanyLegal } from "../app/shared/companyLegal";
import { COMMISSION_TERMS_VERSION } from "../app/shared/terms";
import { companyLegalFromEnv, type Env } from "./env";
import { assertLaunchReady, COMPANY_LEGAL_ENV, launchProblems } from "./launchChecks";
import { CommissionRateError, listingCommissionRate, validateCommissionRate } from "./services/commissionService";

const company: CompanyLegal = {
  nameAr: "شركة الذكاء العقاري",
  nameEn: "Aqar Intelligence",
  commercialRegistrationNumber: "12345",
  taxNumber: "123456789",
  salesTaxRegistered: false,
  dlsLicenseNumber: "RE-778",
};

describe("production launch guard (SPEC §20)", () => {
  it("passes with reviewed terms and every legal detail (sales tax may be 'not registered')", () => {
    expect(launchProblems({ termsVersion: COMMISSION_TERMS_VERSION, company })).toEqual([]);
    expect(() => assertLaunchReady({ termsVersion: COMMISSION_TERMS_VERSION, company })).not.toThrow();
  });

  it("refuses draft terms and names each missing setting, never a value", () => {
    const problems = launchProblems({ termsVersion: "2026-11-draft", company: { nameAr: company.nameAr, taxNumber: company.taxNumber } });
    expect(problems[0]).toMatch(/draft/);
    for (const name of ["COMPANY_LEGAL_NAME_EN", "COMPANY_CR_NUMBER", "COMPANY_SALES_TAX_REGISTERED", "COMPANY_DLS_LICENSE_NUMBER"]) {
      expect(problems.join("\n")).toContain(name);
    }
    expect(problems.join("\n")).not.toContain(company.taxNumber);
    expect(problems).toHaveLength(5);
    expect(() => assertLaunchReady({ termsVersion: COMMISSION_TERMS_VERSION, company: {} })).toThrow(/Refusing to start in production/);
    expect(Object.keys(COMPANY_LEGAL_ENV).sort()).toEqual(Object.keys(company).sort());
  });

  it("reads the details from env; the sales-tax status is explicit true/false", () => {
    const env = {
      COMPANY_LEGAL_NAME_AR: company.nameAr,
      COMPANY_LEGAL_NAME_EN: company.nameEn,
      COMPANY_CR_NUMBER: "12345",
      COMPANY_TAX_NUMBER: "123456789",
      COMPANY_SALES_TAX_REGISTERED: "true",
      COMPANY_DLS_LICENSE_NUMBER: "RE-778",
    } as Env;
    expect(companyLegalFromEnv(env)).toEqual({ ...company, salesTaxRegistered: true });
    expect(companyLegalFromEnv({ ...env, COMPANY_SALES_TAX_REGISTERED: "false" }).salesTaxRegistered).toBe(false);
    expect(companyLegalFromEnv({ ...env, COMPANY_SALES_TAX_REGISTERED: undefined }).salesTaxRegistered).toBeUndefined();
  });
});

describe("commission rate rules (SPEC §19)", () => {
  const jordan = { commissionRate: 0.01, commissionRateMax: 0.05 };
  it("defaults to the country's rate; an agreed rate must be > 0 and ≤ the cap", () => {
    expect(listingCommissionRate(jordan)).toBe(0.01);
    expect(listingCommissionRate(jordan, 0.025)).toBe(0.025);
    expect(listingCommissionRate(jordan, 0.05)).toBe(0.05);
    expect(() => listingCommissionRate(jordan, 0.0501)).toThrow(CommissionRateError);
    expect(() => validateCommissionRate(0, 0.05)).toThrow("rate_not_positive");
    expect(() => validateCommissionRate(-0.01, 0.05)).toThrow("rate_not_positive");
    expect(() => validateCommissionRate(Number.NaN, 0.05)).toThrow("rate_not_positive");
    expect(() => validateCommissionRate(0.06, 0.05)).toThrow("rate_above_cap");
  });
});
