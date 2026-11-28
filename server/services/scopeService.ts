import type { Knex } from "knex";
import { OPEN_LISTING_STATUSES, type Role } from "../../app/shared/constants";

/**
 * Supervisor scope (SPEC §3, §13; CLAUDE.md rule 10): the only place that
 * decides which listings a back-office user may see or act on. A supervisor's
 * scope is a set of admin areas, descendants included; the super_admin sees
 * everything. Filtering happens here, in SQL — never only in the UI — and an
 * out-of-scope id is reported as not found by the callers.
 */

type Db = Knex | Knex.Transaction;

/** Who is acting: the signed-in user's id and role (read from the database on this request). */
export interface Actor {
  id: number;
  role: Role;
}

/**
 * Back-office access (SPEC §9): the super_admin, or a supervisor whose profile
 * is active. `password` while a one-time password must be changed first.
 */
export async function getStaffAccess(
  db: Db,
  user: Actor & { mustChangePassword?: boolean },
): Promise<"ok" | "forbidden" | "password"> {
  if (user.role !== "super_admin" && user.role !== "supervisor") return "forbidden";
  if (user.mustChangePassword) return "password";
  if (user.role === "super_admin") return "ok";
  const profile = await db("supervisor_profiles").where({ user_id: user.id, is_active: true }).first("user_id");
  return profile ? "ok" : "forbidden";
}

/**
 * True when the listing's area (or one of its ancestors) is in the
 * supervisor's scope. Binding: the supervisor id. `areaColumn` must be a
 * trusted column reference such as `p.admin_area_id`.
 */
const inScopeSql = (areaColumn: string) => `EXISTS (
  WITH RECURSIVE up AS (
    SELECT a.id, a.parent_id FROM admin_areas a WHERE a.id = ${areaColumn}
    UNION ALL
    SELECT a.id, a.parent_id FROM admin_areas a JOIN up ON a.id = up.parent_id
  )
  SELECT 1 FROM up JOIN supervisor_scopes s ON s.admin_area_id = up.id WHERE s.supervisor_id = ?
)`;

const COLUMN = /^[a-z_]+\.[a-z_]+$/;

/**
 * Limits a listings query (`properties` aliased as `alias`) to what `actor`
 * may see in the back office: everything for the super_admin, the scope for a
 * supervisor (listings without an area are the super_admin's only), nothing
 * for anyone else.
 */
export function whereListingInScope<T extends Knex.QueryBuilder>(qb: T, actor: Actor, alias = "p"): T {
  const column = `${alias}.admin_area_id`;
  if (!COLUMN.test(column)) throw new Error("invalid alias");
  if (actor.role === "super_admin") return qb;
  if (actor.role === "supervisor") return qb.whereRaw(inScopeSql(column), [actor.id]) as T;
  return qb.whereRaw("false") as T;
}

/** Whether `areaId` is inside the supervisor's scope (the area itself or a descendant of a scope area). */
export async function isAreaInScope(db: Db, supervisorId: number, areaId: number | null): Promise<boolean> {
  if (areaId === null) return false;
  const r = await db.raw<{ rows: Array<{ ok: boolean }> }>(`SELECT ${inScopeSql("?::int")} AS ok`, [areaId, supervisorId]);
  return Boolean(r.rows[0]?.ok);
}

/**
 * Self-review guard (milestone 7a): staff never act on a listing they own.
 * Assignment skips the owner, and every back-office listing action checks
 * this before doing anything.
 */
export function isOwnListing(actor: Pick<Actor, "id">, listing: { ownerId: number }): boolean {
  return actor.id === listing.ownerId;
}

/**
 * The supervisor a listing in `adminAreaId` goes to (SPEC §4.2): the deepest
 * scope area on the listing's area path wins; ties → fewer open listings,
 * then the lowest id. Only supervisors with an active profile and an active
 * account; never the listing's owner or anyone in `exclude`. Null → the
 * super_admin's queue.
 */
export async function findAssignee(
  db: Db,
  listing: { adminAreaId: number | null; ownerId: number },
  exclude: number[] = [],
): Promise<number | null> {
  if (listing.adminAreaId === null) return null;
  const r = await db.raw<{ rows: Array<{ supervisor_id: number }> }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, 0 AS depth FROM admin_areas WHERE id = ?
       UNION ALL
       SELECT a.id, a.parent_id, up.depth + 1 FROM admin_areas a JOIN up ON a.id = up.parent_id
     ),
     candidates AS (
       SELECT s.supervisor_id, min(up.depth) AS depth
         FROM supervisor_scopes s
         JOIN up ON up.id = s.admin_area_id
         JOIN supervisor_profiles sp ON sp.user_id = s.supervisor_id AND sp.is_active
         JOIN users u ON u.id = s.supervisor_id AND u.status = 'active' AND u.role = 'supervisor'
        WHERE s.supervisor_id <> ? AND NOT (s.supervisor_id = ANY(?::int[]))
        GROUP BY s.supervisor_id
     )
     SELECT c.supervisor_id
       FROM candidates c
      ORDER BY c.depth,
               (SELECT count(*) FROM properties p
                 WHERE p.assigned_supervisor_id = c.supervisor_id AND p.status = ANY(?::text[])),
               c.supervisor_id
      LIMIT 1`,
    [listing.adminAreaId, listing.ownerId, exclude, [...OPEN_LISTING_STATUSES]],
  );
  return r.rows[0]?.supervisor_id ?? null;
}

/** Whether `supervisorId` can take a listing now: an active supervisor whose scope contains it, and not its owner. */
export async function canBeAssigned(db: Db, supervisorId: number, listing: { adminAreaId: number | null; ownerId: number }): Promise<boolean> {
  if (supervisorId === listing.ownerId) return false;
  const active = await db("supervisor_profiles as sp")
    .join("users as u", "u.id", "sp.user_id")
    .where({ "sp.user_id": supervisorId, "sp.is_active": true, "u.status": "active", "u.role": "supervisor" })
    .first("sp.user_id");
  return Boolean(active) && (await isAreaInScope(db, supervisorId, listing.adminAreaId));
}
