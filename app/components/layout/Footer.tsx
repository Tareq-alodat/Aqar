import { Link } from "react-router";
import { useLocale, useT } from "~/i18n/useT";
import { DEFAULT_COUNTRY } from "~/shared/countries";

/**
 * Site footer (design v2): names the operating company, "شركة الذكاء العقاري –
 * Aqar Intelligence" (the platform itself is AQAR / عقار). Not shown on the
 * full-screen map page.
 */
export function Footer() {
  const t = useT();
  const locale = useLocale();
  const company = t("brand.company");
  const link = "rounded transition-colors duration-150 hover:text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text";
  return (
    <footer aria-label={t("footer.label")} className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p>{t("footer.operatedBy", { company })}</p>
          <p>{t("footer.rights", { year: String(new Date().getFullYear()), company })}</p>
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
