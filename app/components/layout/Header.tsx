import { Plus } from "lucide-react";
import { Link, useLocation, useParams } from "react-router";
import { ThemeToggle } from "~/components/ui/ThemeToggle";
import { useAuth } from "~/hooks/useAuth";
import { useLocale, useT } from "~/i18n/useT";
import { LISTER_ROLES } from "~/shared/constants";
import { DEFAULT_COUNTRY } from "~/shared/countries";
import { switchLocalePath } from "~/shared/locales";
import { activeCountrySchema } from "~/shared/schemas/routeParams";
import { headerControl } from "./headerStyles";
import { UserMenu } from "./UserMenu";

/**
 * Site header (SPEC §14, design v2): navy bar (`header` token) with the
 * light-on-dark logo in both languages (the mark only below 400 px), the
 * country as a translucent chip, and the amber "Add listing" button.
 */
export function Header() {
  const t = useT();
  const locale = useLocale();
  const location = useLocation();
  const params = useParams();
  const country = activeCountrySchema.safeParse(params.country);
  const otherLocale = locale === "ar" ? "en" : "ar";
  const user = useAuth();
  // Visitors are sent to log in first (the page requires a session); back-office roles do not list properties.
  const canAdd = !user || (LISTER_ROLES as readonly string[]).includes(user.role);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 bg-header px-3 text-on-header shadow-sm sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {/* Only one image is displayed at a time, so screen readers read one alt text. */}
        <Link
          to={`/${locale}/${DEFAULT_COUNTRY}/map`}
          title={t("header.home")}
          className="flex shrink-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-header"
        >
          <img src="/brand/aqar-logo-dark.svg" alt={t("header.logoAlt")} width={275} height={116} className="h-12 w-auto max-[399px]:hidden" />
          <img src="/brand/aqar-mark-dark.svg" alt={t("header.logoAlt")} width={120} height={120} className="hidden size-10 max-[399px]:block" />
        </Link>
        {country.success && (
          <span
            className="hidden rounded-full bg-on-header/15 px-3 py-1 text-xs font-medium text-on-header sm:inline"
            title={t("header.country", { country: t(`countries.${country.data}`) })}
          >
            {t(`countries.${country.data}`)}
          </span>
        )}
      </div>
      <nav className="flex shrink-0 items-center gap-1 sm:gap-2">
        {canAdd && (
          <Link
            to={`/${locale}/listings/new`}
            aria-label={t("headerAdd.add")}
            className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-2 text-sm font-bold text-on-accent shadow-sm transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-header focus-visible:ring-offset-2 focus-visible:ring-offset-header sm:px-5"
          >
            <Plus aria-hidden="true" className="size-4" strokeWidth={3} />
            <span className="hidden sm:inline">{t("headerAdd.add")}</span>
          </Link>
        )}
        <Link
          to={switchLocalePath(location.pathname, otherLocale) + location.search}
          lang={otherLocale}
          hrefLang={otherLocale}
          aria-label={t("header.switchLanguageLabel")}
          className={`${headerControl} px-2.5 py-1.5 text-sm font-medium ${otherLocale === "ar" ? "font-arabic" : "font-latin"}`}
        >
          {t("header.switchLanguage")}
        </Link>
        <ThemeToggle />
        <UserMenu />
      </nav>
    </header>
  );
}
