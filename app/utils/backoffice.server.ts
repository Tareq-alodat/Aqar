import { data, redirect, type AppLoadContext } from "react-router";
import type { StaffRole } from "~/shared/constants";
import { localeFromPathname } from "~/shared/locales";
import { getStaffAccess, type Actor } from "../../server/services/scopeService";
import { hashIp } from "../../server/services/tokenService";
import { changePasswordPath, requireUser } from "./auth.server";

/**
 * Back-office pages (SPEC §9). Loaders and actions stay thin over the same
 * services as `/api/v1/backoffice`. Everything here is private: never cached,
 * never indexed.
 */

export const BACKOFFICE_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

/**
 * The signed-in staff member (super_admin, or a supervisor with an active
 * profile), optionally limited to `roles`; 403 otherwise. Users who must
 * change a one-time password are redirected to do that first.
 */
export async function requireStaff(context: AppLoadContext, request: Request, ...roles: StaffRole[]): Promise<Actor & { name: string }> {
  const user = requireUser(context, request);
  const access = await getStaffAccess(context.services.backoffice.db, user);
  if (access === "password") throw redirect(changePasswordPath(localeFromPathname(new URL(request.url).pathname)));
  if (access !== "ok") throw data(null, { status: 403, headers: BACKOFFICE_HEADERS });
  if (roles.length && !(roles as string[]).includes(user.role)) throw data(null, { status: 403, headers: BACKOFFICE_HEADERS });
  return { id: user.id, role: user.role, name: user.name };
}

/** Audit context for a page action: the hashed client IP. */
export function auditContext(context: AppLoadContext) {
  return { ipHash: hashIp(context.meta.ip, context.services.backoffice.ipHashSecret) };
}

/** A positive integer route param, or 404. */
export function idParam(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) throw data(null, { status: 404, headers: BACKOFFICE_HEADERS });
  return id;
}
