import type { Knex } from "knex";
import { OPEN_LISTING_STATUSES, type ListingStatus } from "../../app/shared/constants";
import { recordAudit } from "./auditService";
import { canBeAssigned, findAssignee, isAreaInScope, type Actor } from "./scopeService";

/**
 * Listing assignment (SPEC §4.2): every submitted listing goes to the
 * supervisor whose scope contains its area (`scopeService.findAssignee`), or
 * to the super_admin's queue (`assigned_supervisor_id = null`). The
 * super_admin can reassign with a reason. Every change is audited.
 */

type Db = Knex | Knex.Transaction;

export class AssignmentError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "not_assignable" | "invalid_assignee" | "reason_required") {
    super(code);
  }
}

/** Reason codes for automatic moves (stored in `audit_log.reason`). */
export const AUTO_REASONS = {
  submitted: "submitted",
  supervisorDeactivated: "supervisor_deactivated",
  scopeChanged: "scope_changed",
} as const;

const isOpen = (s: ListingStatus) => (OPEN_LISTING_STATUSES as readonly string[]).includes(s);

interface ListingRow {
  id: number;
  owner_id: number;
  admin_area_id: number | null;
  status: ListingStatus;
  assigned_supervisor_id: number | null;
}

async function setAssignee(
  db: Db,
  row: ListingRow,
  to: number | null,
  audit: { actorUserId: number | null; action: "listing_assigned" | "listing_reassigned"; reason: string; ipHash?: string | null },
): Promise<boolean> {
  if (row.assigned_supervisor_id === to) return false;
  await db("properties")
    .where({ id: row.id })
    .update({ assigned_supervisor_id: to, assigned_at: to === null ? null : db.fn.now() });
  await recordAudit(db, {
    actorUserId: audit.actorUserId,
    action: audit.action,
    entityType: "listing",
    entityId: row.id,
    before: { assigned_supervisor_id: row.assigned_supervisor_id },
    after: { assigned_supervisor_id: to },
    reason: audit.reason,
    ipHash: audit.ipHash ?? null,
  });
  return true;
}

const LISTING_COLUMNS = ["id", "owner_id", "admin_area_id", "status", "assigned_supervisor_id"];

/** Called by `submitDraft` inside its transaction, after the listing became `pending`. Returns the assignee. */
export async function assignOnSubmit(trx: Knex.Transaction, listingId: number): Promise<number | null> {
  const row = (await trx("properties").where({ id: listingId }).forUpdate().first(...LISTING_COLUMNS)) as ListingRow;
  const to = await findAssignee(trx, { adminAreaId: row.admin_area_id, ownerId: row.owner_id });
  await setAssignee(trx, row, to, { actorUserId: null, action: "listing_assigned", reason: AUTO_REASONS.submitted });
  return to;
}

/**
 * Super_admin reassignment (SPEC §4.2): to a supervisor whose scope contains
 * the listing (never its owner), or `null` for the super_admin's queue.
 * `reason` is required (validated by the caller's schema; checked again here).
 */
export async function reassignListing(
  db: Knex,
  actor: Actor,
  listingId: number,
  input: { supervisorId: number | null; reason: string; ipHash?: string | null },
): Promise<{ assignedSupervisorId: number | null; changed: boolean }> {
  if (actor.role !== "super_admin") throw new AssignmentError("forbidden");
  const reason = input.reason.trim();
  if (!reason) throw new AssignmentError("reason_required");
  return db.transaction(async (trx) => {
    const row = (await trx("properties").where({ id: listingId }).forUpdate().first(...LISTING_COLUMNS)) as ListingRow | undefined;
    if (!row) throw new AssignmentError("not_found");
    if (row.owner_id === actor.id) throw new AssignmentError("forbidden");
    if (!isOpen(row.status)) throw new AssignmentError("not_assignable");
    if (input.supervisorId !== null && !(await canBeAssigned(trx, input.supervisorId, { adminAreaId: row.admin_area_id, ownerId: row.owner_id }))) {
      throw new AssignmentError("invalid_assignee");
    }
    const changed = await setAssignee(trx, row, input.supervisorId, {
      actorUserId: actor.id,
      action: "listing_reassigned",
      reason,
      ipHash: input.ipHash ?? null,
    });
    return { assignedSupervisorId: input.supervisorId, changed };
  });
}

/**
 * Moves a supervisor's open listings to the next match (excluding them), e.g.
 * when they are deactivated. Returns how many listings moved.
 */
export async function reassignOpenListingsOf(
  trx: Knex.Transaction,
  supervisorId: number,
  audit: { actorUserId: number; reason: string; ipHash?: string | null; onlyOutOfScope?: boolean },
): Promise<number> {
  const rows = (await trx("properties")
    .where({ assigned_supervisor_id: supervisorId })
    .whereIn("status", [...OPEN_LISTING_STATUSES])
    .orderBy("id")
    .forUpdate()
    .select(...LISTING_COLUMNS)) as ListingRow[];
  let moved = 0;
  for (const row of rows) {
    if (audit.onlyOutOfScope && (await isAreaInScope(trx, supervisorId, row.admin_area_id))) continue;
    const to = await findAssignee(trx, { adminAreaId: row.admin_area_id, ownerId: row.owner_id }, [supervisorId]);
    if (await setAssignee(trx, row, to, { actorUserId: audit.actorUserId, action: "listing_reassigned", reason: audit.reason, ipHash: audit.ipHash ?? null })) moved++;
  }
  return moved;
}

/** Open listings in the super_admin's queue that a supervisor's (new) scope now covers get assigned. */
export async function assignQueuedInScopeOf(
  trx: Knex.Transaction,
  supervisorId: number,
  audit: { actorUserId: number; reason: string; ipHash?: string | null },
): Promise<number> {
  const rows = (await trx("properties")
    .whereNull("assigned_supervisor_id")
    .whereNotNull("admin_area_id")
    .whereIn("status", [...OPEN_LISTING_STATUSES])
    .orderBy("id")
    .forUpdate()
    .select(...LISTING_COLUMNS)) as ListingRow[];
  let moved = 0;
  for (const row of rows) {
    if (!(await isAreaInScope(trx, supervisorId, row.admin_area_id))) continue;
    const to = await findAssignee(trx, { adminAreaId: row.admin_area_id, ownerId: row.owner_id });
    if (to !== null && (await setAssignee(trx, row, to, { actorUserId: audit.actorUserId, action: "listing_assigned", reason: audit.reason, ipHash: audit.ipHash ?? null }))) moved++;
  }
  return moved;
}

/** Open listings assigned to a supervisor (workload; shown before deactivating). */
export async function openListingCount(db: Db, supervisorId: number): Promise<number> {
  const r = await db("properties").where({ assigned_supervisor_id: supervisorId }).whereIn("status", [...OPEN_LISTING_STATUSES]).count({ n: "*" }).first();
  return Number(r?.n ?? 0);
}
