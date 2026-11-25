import { redirect } from "react-router";
import { DEFAULT_COUNTRY } from "~/shared/countries";
import { DEFAULT_LOCALE } from "~/shared/locales";

export function loader() {
  return redirect(`/${DEFAULT_LOCALE}/${DEFAULT_COUNTRY}/map`);
}
