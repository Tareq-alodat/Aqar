import { data, useLoaderData } from "react-router";
import { useT } from "~/i18n/useT";
import { OPEN_LISTING_STATUSES } from "~/shared/constants";
import { BACKOFFICE_HEADERS, requireStaff } from "~/utils/backoffice.server";
import type { Route } from "./+types/backoffice-home";

export function headers() {
  return BACKOFFICE_HEADERS;
}

/** Overview: the signed-in staff member's assigned work; the super_admin also sees the totals and the unassigned queue. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const staff = await requireStaff(context, request);
  const { db } = context.services.backoffice;
  const count = async (q: ReturnType<typeof db>) => Number((await q.count({ n: "*" }).first())?.n ?? 0);
  const mine = {
    assignedPending: await count(db("properties").where({ assigned_supervisor_id: staff.id, status: "pending" })),
    assignedOpen: await count(db("properties").where({ assigned_supervisor_id: staff.id }).whereIn("status", [...OPEN_LISTING_STATUSES])),
  };
  const totals =
    staff.role === "super_admin"
      ? {
          allPending: await count(db("properties").where({ status: "pending" })),
          queuePending: await count(db("properties").where({ status: "pending" }).whereNull("assigned_supervisor_id")),
          supervisors: await count(db("supervisor_profiles").where({ is_active: true })),
        }
      : null;
  return data({ name: staff.name, role: staff.role, mine, totals }, { headers: BACKOFFICE_HEADERS });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold text-primary-text">{value.toLocaleString("en")}</p>
    </div>
  );
}

export default function BackofficeHome() {
  const t = useT();
  const { name, role, mine, totals } = useLoaderData<typeof loader>();
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">{t("backoffice.home.heading")}</h1>
        <p className="mt-1 text-sm text-muted">{t("backoffice.home.welcome", { name })}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {role === "supervisor" && (
          <>
            <Stat label={t("backoffice.home.assignedPending")} value={mine.assignedPending} />
            <Stat label={t("backoffice.home.assignedOpen")} value={mine.assignedOpen} />
          </>
        )}
        {totals && (
          <>
            <Stat label={t("backoffice.home.allPending")} value={totals.allPending} />
            <Stat label={t("backoffice.home.queuePending")} value={totals.queuePending} />
            <Stat label={t("backoffice.home.supervisors")} value={totals.supervisors} />
          </>
        )}
      </div>
    </section>
  );
}
