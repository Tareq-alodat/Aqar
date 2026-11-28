import type { PartialCompanyLegal } from "~/shared/companyLegal";
import { companyLegalFromEnv } from "../../server/env";

/** The company's legal details for pages (root loader): footer, terms and invoices. */
export function loadCompanyLegal(): PartialCompanyLegal {
  return companyLegalFromEnv();
}
