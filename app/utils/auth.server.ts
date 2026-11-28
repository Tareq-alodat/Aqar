import { data, redirect, type AppLoadContext } from "react-router";
import type { Role } from "~/shared/constants";
import { DEFAULT_COUNTRY } from "~/shared/countries";
import type { Locale } from "~/shared/locales";
import { localeFromPathname } from "~/shared/locales";
import type { SessionUser } from "../../server/services/authService";

/** Where people land after login/logout by default. */
export function homePath(locale: Locale): string {
  return `/${locale}/${DEFAULT_COUNTRY}/map`;
}

/** Set-Cookie headers for an action's response. */
export function cookieHeaders(cookies: string[]): Headers {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

/** The page where a user with a one-time password must choose their own (milestone 7a). */
export function changePasswordPath(locale: Locale): string {
  return `/${locale}/account/password`;
}

/**
 * The signed-in user, or a redirect to the login page that comes back here
 * afterwards. A user who must change a one-time password is sent to the
 * change-password page instead (only that page passes `allowPasswordChange`).
 */
export function requireUser(context: AppLoadContext, request: Request, options: { allowPasswordChange?: boolean } = {}): SessionUser {
  const url = new URL(request.url);
  const locale = localeFromPathname(url.pathname);
  if (context.session) {
    if (context.session.user.mustChangePassword && !options.allowPasswordChange) throw redirect(changePasswordPath(locale));
    return context.session.user;
  }
  throw redirect(`/${locale}/login?next=${encodeURIComponent(url.pathname + url.search)}`);
}

/** Like requireUser, and 403 unless the user has one of `roles` (role read from the database on this request). */
export function requireRole(context: AppLoadContext, request: Request, ...roles: Role[]): SessionUser {
  const user = requireUser(context, request);
  if (!roles.includes(user.role)) throw data(null, { status: 403 });
  return user;
}
