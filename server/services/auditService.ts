import type { Knex } from "knex";

/**
 * Append-only audit trail (`audit_log`, SPEC §9) and status history
 * (`status_history`, SPEC §26). Always written inside the caller's
 * transaction, so an action and its record are saved together or not at all.
 *
 * Personal data (names, emails, phones, passwords) is never copied into
 * `before`/`after`: such fields are recorded as `"[changed]"` only.
 */

type Db = Knex | Knex.Transaction;

export const AUDIT_ACTIONS = [
  "supervisor_created",
  "supervisor_updated",
  "supervisor_scopes_changed",
  "supervisor_activated",
  "supervisor_deactivated",
  "password_issued",
  "password_changed",
  "listing_assigned",
  "listing_reassigned",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntityType = "user" | "listing";
export type StatusEntityType = "listing";

export type AuditValue = string | number | boolean | null | number[];
export type AuditValues = Record<string, AuditValue>;

/** Recorded in place of a personal value (SPEC §9: "the entry records that the field changed"). */
export const CHANGED = "[changed]";

/** Field names whose values are personal data or secrets (deliberately broad: when in doubt, don't copy). */
const PERSONAL = /name|email|phone|password|e164/i;

export function isPersonalField(key: string): boolean {
  return PERSONAL.test(key);
}

/** Copies `values`, replacing personal fields with `CHANGED`. */
export function sanitizeAuditValues(values: AuditValues | undefined): AuditValues | null {
  if (!values) return null;
  const out: AuditValues = {};
  for (const [k, v] of Object.entries(values)) out[k] = isPersonalField(k) ? CHANGED : v;
  return out;
}

export interface AuditEntry {
  actorUserId: number | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: number | null;
  before?: AuditValues;
  after?: AuditValues;
  reason?: string | null;
  ipHash?: string | null;
}

export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  const before = sanitizeAuditValues(entry.before);
  const after = sanitizeAuditValues(entry.after);
  await db("audit_log").insert({
    actor_user_id: entry.actorUserId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    reason: entry.reason ?? null,
    ip_hash: entry.ipHash ?? null,
  });
}

export interface StatusChange {
  entityType: StatusEntityType;
  entityId: number;
  from: string | null;
  to: string;
  actorUserId: number | null;
  reason?: string | null;
}

export async function recordStatusChange(db: Db, change: StatusChange): Promise<void> {
  await db("status_history").insert({
    entity_type: change.entityType,
    entity_id: change.entityId,
    from_status: change.from,
    to_status: change.to,
    actor_user_id: change.actorUserId,
    reason: change.reason ?? null,
  });
}
