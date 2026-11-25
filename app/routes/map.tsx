import { data } from "react-router";
import { getT } from "~/i18n";
import { useT } from "~/i18n/useT";
import { mapParamsSchema } from "~/shared/schemas/routeParams";
import type { Route } from "./+types/map";

export function loader({ params }: Route.LoaderArgs) {
  const parsed = mapParamsSchema.safeParse(params);
  if (!parsed.success) throw data(null, { status: 404 });
  return { country: parsed.data.country };
}

export function meta({ params }: Route.MetaArgs) {
  const parsed = mapParamsSchema.safeParse(params);
  if (!parsed.success) return [];
  const t = getT(parsed.data.lang);
  return [
    { title: `${t("map.title")} | ${t("app.name")}` },
    { name: "description", content: t("app.tagline") },
  ];
}

/** Layout shell for the map search page; the map itself arrives in milestone 4. */
export default function MapPage() {
  const t = useT();
  const resultCount = 0;

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-card bg-surface px-4 py-3 text-sm text-muted">
        {t("map.filtersPlaceholder")}
      </div>
      {/* Results list on the start side (right in Arabic, left in English); map ~60%. */}
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[2fr_3fr]">
        <section
          aria-labelledby="results-heading"
          className="order-2 border-card p-4 lg:order-1 lg:border-e"
        >
          <h1 id="results-heading" className="text-lg font-semibold">
            {t("map.listHeading")}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t("map.resultsCount", { count: resultCount })}
          </p>
        </section>
        <div className="order-1 flex min-h-80 items-center justify-center bg-card text-muted lg:order-2">
          {t("map.mapPlaceholder")}
        </div>
      </div>
    </div>
  );
}
