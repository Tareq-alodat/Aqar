import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "~/root";
import type { ClientUser } from "~/shared/schemas/auth";

/** The signed-in user ({ id, name, role }) or null. Comes from the root loader. */
export function useAuth(): ClientUser | null {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  return data?.user ?? null;
}
