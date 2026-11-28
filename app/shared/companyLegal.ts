/**
 * The operating company's legal details (SPEC §20, legal & tax update):
 * shown in the footer and on invoices. Public information by nature.
 * Set through env (`COMPANY_*`); the server refuses to start in production
 * while any of them is missing (`server/launchChecks.ts`).
 */
export interface CompanyLegal {
  nameAr: string;
  nameEn: string;
  /** Commercial registration number (السجل التجاري). */
  commercialRegistrationNumber: string;
  /** Tax identification number (الرقم الضريبي). */
  taxNumber: string;
  /** Registered for general sales tax: commission invoices then add the tax (SPEC §19). */
  salesTaxRegistered: boolean;
  /** Department of Lands and Survey real-estate office licence number. */
  dlsLicenseNumber: string;
}

export type PartialCompanyLegal = Partial<CompanyLegal>;
