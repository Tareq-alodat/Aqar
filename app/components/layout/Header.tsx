import { Link, useLocation, useParams } from "react-router";
import { ThemeToggle } from "~/components/ui/ThemeToggle";
import { useAuth } from "~/hooks/useAuth";
import { LISTER_ROLES } from "~/shared/constants";
import { UserMenu } from "./UserMenu";
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
  const user = useAuth();
  // Visitors are sent to log in first (the page requires a session); admins do not list properties.
  const canAdd = !user || (LISTER_ROLES as readonly string[]).includes(user.role);

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-border bg-surface px-4">
      <div className="flex items-center gap-3">
        {/* Logo (SPEC §14): full logo, mark only below 400 px; light/dark files follow the theme class.
            Only one image is displayed at a time, so screen readers read one alt text. */}
        <Link to={`/${locale}/${DEFAULT_COUNTRY}/map`} title={t("header.home")} className="flex shrink-0 items-center rounded-lg">
          <img src="/brand/aqar-logo.svg" alt={t("header.logoAlt")} width={260} height={120} className="h-11 w-auto dark:hidden max-[399px]:hidden" />
          <img
            src="/brand/aqar-logo-dark.svg"
            alt={t("header.logoAlt")}
            width={260}
            height={120}
            className="hidden h-11 w-auto dark:block max-[399px]:dark:hidden"
          />
          <img src="/brand/aqar-mark.svg" alt={t("header.logoAlt")} width={120} height={120} className="hidden size-9 max-[399px]:block max-[399px]:dark:hidden" />
          <img src="/brand/aqar-mark-dark.svg" alt={t("header.logoAlt")} width={120} height={120} className="hidden size-9 max-[399px]:dark:block" />
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
      <nav className="flex items-center gap-1 sm:gap-2">
        {canAdd && (
          <Link
            to={`/${locale}/listings/new`}
            aria-label={t("headerAdd.add")}
            className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-hover"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="hidden sm:inline">{t("headerAdd.add")}</span>
          </Link>
        )}
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
        <UserMenu />
      </nav>
    </header>
  );
}
