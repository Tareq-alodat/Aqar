import { LayoutDashboard, Users } from "lucide-react";
import { data, NavLink, Outlet, useLoaderData } from "react-router";
import { getT } from "~/i18n";
import { useLocale, useT } from "~/i18n/useT";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { BACKOFFICE_HEADERS, requireStaff } from "~/utils/backoffice.server";
import type { Route } from "./+types/backoffice";

/**
 * Back office shell (SPEC §9): the super_admin and supervisors with an active
 * profile. Never cached or indexed. Navigation shows only the screens built
 * so far; supervisor management is super_admin only.
 */

export function meta({ params }: Route.MetaArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) return [];
  const t = getT(parsed.data.lang);
  return [{ title: `${t("backoffice.title")} | ${t("app.name")}` }, { name: "robots", content: "noindex" }];
}

export function headers() {
  return BACKOFFICE_HEADERS;
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!langParamsSchema.safeParse(params).success) throw data(null, { status: 404 });
  const staff = await requireStaff(context, request);
  return data({ role: staff.role }, { headers: BACKOFFICE_HEADERS });
}

export default function BackofficeLayout() {
  const t = useT();
  const locale = useLocale();
  const { role } = useLoaderData<typeof loader>();
  const base = `/${locale}/backoffice`;
  const items = [
    { to: base, label: t("backoffice.nav.home"), icon: LayoutDashboard, end: true },
    ...(role === "super_admin" ? [{ to: `${base}/supervisors`, label: t("backoffice.nav.supervisors"), icon: Users, end: false }] : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5 lg:flex-row lg:gap-6">
      <nav aria-label={t("backoffice.navLabel")} className="shrink-0 lg:w-52">
        <p className="mb-2 hidden text-xs font-semibold uppercase tracking-wide text-muted lg:block">{t("backoffice.title")}</p>
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {items.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    isActive ? "bg-primary text-on-primary" : "text-foreground hover:bg-surface"
                  }`
                }
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
