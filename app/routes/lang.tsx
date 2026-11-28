import { Outlet, data, useMatches } from "react-router";
import { Footer } from "~/components/layout/Footer";
import { Header } from "~/components/layout/Header";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { skipSearchOnlyRevalidation } from "~/utils/revalidate";
import type { Route } from "./+types/lang";

export const shouldRevalidate = skipSearchOnlyRevalidation;

export function loader({ params }: Route.LoaderArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) throw data(null, { status: 404 });
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
