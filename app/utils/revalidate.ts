import type { ShouldRevalidateFunctionArgs } from "react-router";

/**
 * Map moves and filter changes only change the query string; the map page
 * fetches those results itself (/api/v1), so loaders are not re-run for them.
 * Form submissions (theme, login, logout) and path changes still revalidate.
 */
export function skipSearchOnlyRevalidation({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (!formMethod && currentUrl.pathname === nextUrl.pathname) return false;
  return defaultShouldRevalidate;
}
