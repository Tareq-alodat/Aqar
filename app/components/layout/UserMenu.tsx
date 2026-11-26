import { Form, Link, useLocation } from "react-router";
import { useAuth } from "~/hooks/useAuth";
import { useLocale, useT } from "~/i18n/useT";

/** Header: the user's name and a logout button, or a login link that returns here. */
export function UserMenu() {
  const t = useT();
  const locale = useLocale();
  const user = useAuth();
  const location = useLocation();
  const here = location.pathname + location.search;

  if (!user) {
    const onAuthPage = /^\/(ar|en)\/(login|register)\/?$/.test(location.pathname);
    const href = onAuthPage ? `/${locale}/login${location.search}` : `/${locale}/login?next=${encodeURIComponent(here)}`;
    return (
      <Link to={href} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-primary hover:bg-card">
        {t("auth.loginLink")}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="max-w-32 truncate text-sm text-muted" title={t("auth.signedInAs", { name: user.name })}>
        {user.name}
      </span>
      <Form method="post" action="/logout">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="next" value={here} />
        <button type="submit" className="rounded-lg px-3 py-1.5 text-sm hover:bg-card">
          {t("auth.logout")}
        </button>
      </Form>
    </div>
  );
}
