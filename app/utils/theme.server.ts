import { createCookie } from "react-router";
import { DEFAULT_THEME, themeSchema, type Theme } from "~/shared/schemas/theme";

export const themeCookie = createCookie("theme", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
});

export async function getTheme(request: Request): Promise<Theme> {
  const value: unknown = await themeCookie.parse(request.headers.get("Cookie"));
  const parsed = themeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_THEME;
}
