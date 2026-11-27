import { useFetchers, useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "~/root";
import { DEFAULT_THEME, themeSchema, type Theme } from "~/shared/schemas/theme";

/** Current theme, including one being submitted by the toggle (so the map switches with the page). */
export function useTheme(): Theme {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  const fetcher = useFetchers().find((f) => f.formAction === "/theme" && f.formData);
  const pending = themeSchema.safeParse(fetcher?.formData?.get("theme"));
  return pending.success ? pending.data : (data?.theme ?? DEFAULT_THEME);
}
