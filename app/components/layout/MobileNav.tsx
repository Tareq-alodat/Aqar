import { Link, useLocation } from "react-router";
import { useAuth } from "~/hooks/useAuth";
import { useLocale, useT } from "~/i18n/useT";
import { DEFAULT_COUNTRY } from "~/shared/countries";

/**
 * Mobile bottom navigation (SPEC §5.1). Phase 1 so far: Map and the account
 * link only; Saved, Add and Profile join when they exist (milestones 6, 8).
 */
export function MobileNav() {
  const t = useT();
  const locale = useLocale();
  const user = useAuth();
  const location = useLocation();
  const mapHref = `/${locale}/${DEFAULT_COUNTRY}/map`;
  const onMap = location.pathname.endsWith("/map");
  const accountHref = user ? mapHref : `/${locale}/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  const item = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 py-1.5 text-xs ${active ? "text-primary" : "text-muted hover:text-foreground"}`;

  return (
    <nav aria-label={t("nav.label")} className="z-30 flex h-14 shrink-0 border-t border-card bg-surface lg:hidden">
      <Link to={mapHref} className={item(onMap)} aria-current={onMap ? "page" : undefined}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
        </svg>
        {t("nav.map")}
      </Link>
      <Link to={accountHref} className={item(false)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
        <span className="max-w-24 truncate">{user ? user.name : t("nav.account")}</span>
      </Link>
    </nav>
  );
}
