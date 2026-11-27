import { z } from "zod";

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "light";

export const themeSchema = z.enum(THEMES);
export const themeFormSchema = z.object({ theme: themeSchema });
