import { redirect } from "react-router";
import { safeNextPath } from "~/shared/nextPath";
import { isLocale, DEFAULT_LOCALE } from "~/shared/locales";
import { cookieHeaders, homePath } from "~/utils/auth.server";
import type { Route } from "./+types/logout";

/** POST /logout: ends the session and clears the auth cookies (form in the header). */
export async function action({ request, context }: Route.ActionArgs) {
  const { auth, cookies } = context.services;
  await auth.logout(cookies.read(request.headers.get("Cookie") ?? undefined), context.session);
  const form = await request.formData();
  const localeValue = form.get("locale");
  const locale = isLocale(localeValue) ? localeValue : DEFAULT_LOCALE;
  return redirect(safeNextPath(form.get("next"), homePath(locale)), { headers: cookieHeaders(cookies.clear()) });
}

/** GET /logout is not a way to log out (that would allow cross-site logout links). */
export function loader() {
  return redirect("/");
}
