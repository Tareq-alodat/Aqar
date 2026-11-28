import { Link, useRouteLoaderData } from "react-router";
import { CompanyLegalDetails } from "~/components/legal/CompanyLegalDetails";
import type { loader as rootLoader } from "~/root";
import { useLocale, useT } from "~/i18n/useT";
import { DEFAULT_COUNTRY } from "~/shared/countries";

/**
 * Site footer (design v2): names the operating company, "شركة الذكاء العقاري –
 * Aqar Intelligence" (the platform itself is AQAR / عقار). Not shown on the
 * full-screen map page. Below it, the company's legal details (CR, tax
 * number, sales-tax status, DLS real-estate office licence; SPEC §20).
 */
export function Footer() {
  const t = useT();
  const locale = useLocale();
  const company = t("brand.company");
  const legal = useRouteLoaderData<typeof rootLoader>("root")?.company;
  const link = "rounded transition-colors duration-150 hover:text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text";
  return (
    <footer aria-label={t("footer.label")} className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p>{t("footer.operatedBy", { company })}</p>
          <p>{t("footer.rights", { year: String(new Date().getFullYear()), company })}</p>
          {legal && <CompanyLegalDetails company={legal} className="text-xs" />}
        </div>
        <nav className="flex flex-wrap gap-4">
          <Link to={`/${locale}/${DEFAULT_COUNTRY}/map`} className={link}>
            {t("footer.map")}
          </Link>
          <Link to={`/${locale}/terms/commission`} className={link}>
            {t("footer.terms")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
