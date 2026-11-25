import { Link, useLocation, useParams } from "react-router";
import { ThemeToggle } from "~/components/ui/ThemeToggle";
import { useLocale, useT } from "~/i18n/useT";
import { DEFAULT_COUNTRY } from "~/shared/countries";
import { switchLocalePath } from "~/shared/locales";
import { activeCountrySchema } from "~/shared/schemas/routeParams";

export function Header() {
  const t = useT();
  const locale = useLocale();
  const location = useLocation();
  const params = useParams();
  const country = activeCountrySchema.safeParse(params.country);
  const otherLocale = locale === "ar" ? "en" : "ar";

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-card bg-surface px-4">
      <div className="flex items-center gap-3">
        <Link
          to={`/${locale}/${DEFAULT_COUNTRY}/map`}
          aria-label={t("header.home")}
          className="text-xl font-bold text-primary"
        >
          {t("app.name")}
        </Link>
        {country.success && (
          <span
            className="rounded-full bg-card px-3 py-1 text-xs text-muted"
            title={t("header.country", { country: t(`countries.${country.data}`) })}
          >
            {t(`countries.${country.data}`)}
          </span>
        )}
      </div>
      <nav className="flex items-center gap-2">
        <Link
          to={switchLocalePath(location.pathname, otherLocale) + location.search}
          lang={otherLocale}
          hrefLang={otherLocale}
          aria-label={t("header.switchLanguageLabel")}
          className={`rounded-lg px-3 py-1.5 text-sm hover:bg-card ${
            otherLocale === "ar" ? "font-arabic" : "font-latin"
          }`}
        >
          {t("header.switchLanguage")}
        </Link>
        <ThemeToggle />
      </nav>
    </header>
  );
}
