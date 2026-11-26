import { parseCookie, stringifySetCookie } from "cookie";
import { ACCESS_TOKEN_TTL_S } from "./tokenService";

/**
 * Auth cookies (SPEC §13): httpOnly, SameSite=Lax, Path=/ (SSR document
 * requests must carry both so the server can refresh). Over https they are
 * Secure and use the `__Host-` prefix (no Domain, Path=/ enforced by browsers).
 */
export interface AuthCookies {
  names: { access: string; refresh: string };
  read(header: string | undefined): { access?: string; refresh?: string };
  /** Set-Cookie values for a newly issued pair. */
  issue(tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date }, now: Date): string[];
  /** Set-Cookie values that delete both cookies. */
  clear(): string[];
}

export function createAuthCookies(options: { secure: boolean }): AuthCookies {
  const prefix = options.secure ? "__Host-" : "";
  const names = { access: `${prefix}aqar_at`, refresh: `${prefix}aqar_rt` };
  const base = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: options.secure };

  return {
    names,
    read(header) {
      if (!header) return {};
      const jar = parseCookie(header);
      return { access: jar[names.access], refresh: jar[names.refresh] };
    },
    issue({ accessToken, refreshToken, refreshExpiresAt }, now) {
      const refreshMaxAge = Math.max(0, Math.floor((refreshExpiresAt.getTime() - now.getTime()) / 1000));
      return [
        stringifySetCookie({ name: names.access, value: accessToken, maxAge: ACCESS_TOKEN_TTL_S, ...base }),
        stringifySetCookie({ name: names.refresh, value: refreshToken, maxAge: refreshMaxAge, ...base }),
      ];
    },
    clear() {
      return [names.access, names.refresh].map((name) =>
        stringifySetCookie({ name, value: "", maxAge: 0, expires: new Date(0), ...base }),
      );
    },
  };
}
