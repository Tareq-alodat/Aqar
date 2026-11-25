import { data } from "react-router";
import { themeFormSchema } from "~/shared/schemas/theme";
import { themeCookie } from "~/utils/theme.server";
import type { Route } from "./+types/theme";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = themeFormSchema.safeParse({ theme: form.get("theme") });
  if (!parsed.success) return data({ ok: false }, { status: 400 });
  return data(
    { ok: true },
    { headers: { "Set-Cookie": await themeCookie.serialize(parsed.data.theme) } },
  );
}
