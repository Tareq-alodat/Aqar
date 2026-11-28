import { data, useLoaderData, type ShouldRevalidateFunctionArgs } from "react-router";
import { Wizard } from "~/components/form/Wizard";
import { getT } from "~/i18n";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { loadEditListing, PRIVATE_HEADERS } from "~/utils/submission.server";
import type { Route } from "./+types/listing-edit";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!lang.success) throw data(null, { status: 404 });
  return loadEditListing(context, request, lang.data.lang, params.id);
}

/** Owner-only page with the true pin: never cached or indexed (CLAUDE.md rule 2). */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders.get("Cache-Control") ? loaderHeaders : new Headers(PRIVATE_HEADERS);
}

/** Changing step only changes `?step=`: the wizard keeps its own state, so the loader does not re-run. */
export function shouldRevalidate({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (!formMethod && currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) return false;
  return defaultShouldRevalidate;
}

export function meta({ params }: Route.MetaArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!lang.success) return [];
  const t = getT(lang.data.lang);
  return [{ title: `${t("wizard.editTitle")} | ${t("app.name")}` }, { name: "robots", content: "noindex" }];
}

export default function ListingEditPage() {
  const loaded = useLoaderData<typeof loader>();
  // Remount the wizard for another draft (its state is per draft).
  return <Wizard key={loaded.draft.id} data={loaded} />;
}
