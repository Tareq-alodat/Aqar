import { Outlet, data } from "react-router";
import { Header } from "~/components/layout/Header";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import type { Route } from "./+types/lang";

export function loader({ params }: Route.LoaderArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) throw data(null, { status: 404 });
  return null;
}

export default function LangLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
