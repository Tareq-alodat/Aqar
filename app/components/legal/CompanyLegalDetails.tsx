import { useLocale, useT } from "~/i18n/useT";
import type { PartialCompanyLegal } from "~/shared/companyLegal";

/**
 * The operating company's legal details (SPEC §20): legal name, commercial
 * registration, tax number, sales-tax registration status and the Department
 * of Lands and Survey real-estate office licence. Used in the footer and, from
 * milestone 11, on invoices. Missing details (development) are left out.
 */
export function CompanyLegalDetails({ company, className }: { company: PartialCompanyLegal; className?: string }) {
  const t = useT();
  const locale = useLocale();
  const name = locale === "ar" ? (company.nameAr ?? company.nameEn) : (company.nameEn ?? company.nameAr);
  const parts = [
    company.commercialRegistrationNumber && t("legal.cr", { number: company.commercialRegistrationNumber }),
    company.taxNumber && t("legal.taxNumber", { number: company.taxNumber }),
    company.salesTaxRegistered !== undefined && t(company.salesTaxRegistered ? "legal.salesTaxRegistered" : "legal.salesTaxNotRegistered"),
    company.dlsLicenseNumber && t("legal.dlsLicense", { number: company.dlsLicenseNumber }),
  ].filter((p): p is string => Boolean(p));
  if (!name && parts.length === 0) return null;
  return (
    <p className={className}>
      {name && <span className="font-medium">{name}</span>}
      {parts.map((p) => (
        <span key={p}>
          {name || p !== parts[0] ? " · " : ""}
          <bdi>{p}</bdi>
        </span>
      ))}
    </p>
  );
}
