import { data, redirect } from "react-router";
import { DEFAULT_COUNTRY } from "~/shared/countries";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import type { Route } from "./+types/lang-home";

export function loader({ params }: Route.LoaderArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) throw data(null, { status: 404 });
  return redirect(`/${parsed.data.lang}/${DEFAULT_COUNTRY}/map`);
}
