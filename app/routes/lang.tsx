import { Outlet, data, redirect, useMatches } from "react-router";
import { Footer } from "~/components/layout/Footer";
import { Header } from "~/components/layout/Header";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { changePasswordPath } from "~/utils/auth.server";
import { skipSearchOnlyRevalidation } from "~/utils/revalidate";
import type { Route } from "./+types/lang";

export const shouldRevalidate = skipSearchOnlyRevalidation;

export function loader({ params, request, context }: Route.LoaderArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) throw data(null, { status: 404 });
  // A one-time password must be changed before anything else (milestone 7a).
  const target = changePasswordPath(parsed.data.lang);
  if (context.session?.user.mustChangePassword && new URL(request.url).pathname !== target) throw redirect(target);
  return null;
}

export default function LangLayout() {
  // The map page fills the viewport below the header; every other page gets the footer.
  const onMap = useMatches().some((m) => m.id === "routes/map");
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      {!onMap && <Footer />}
    </div>
  );
}
