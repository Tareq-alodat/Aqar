import { useFetcher, useRouteLoaderData } from "react-router";
import { headerControl } from "~/components/layout/headerStyles";
import { useT } from "~/i18n/useT";
import type { loader as rootLoader } from "~/root";
import { DEFAULT_THEME, themeSchema } from "~/shared/schemas/theme";

export function ThemeToggle() {
  const t = useT();
  const fetcher = useFetcher();
  const data = useRouteLoaderData<typeof rootLoader>("root");
  const pending = themeSchema.safeParse(fetcher.formData?.get("theme"));
  const current = pending.success ? pending.data : (data?.theme ?? DEFAULT_THEME);
  const next = current === "dark" ? "light" : "dark";
  const label = t(next === "light" ? "header.switchToLight" : "header.switchToDark");

  return (
    <fetcher.Form method="post" action="/theme">
      <input type="hidden" name="theme" value={next} />
      <button
        type="submit"
        aria-label={label}
        title={label}
        className={`flex size-9 items-center justify-center ${headerControl}`}
      >
        {current === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
    </fetcher.Form>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
