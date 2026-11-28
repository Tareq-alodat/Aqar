import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { backofficeErrorText, Card, Notice, OneTimePassword, PrimaryButton, SupervisorProfileFields, type ProfileValues } from "~/components/backoffice/parts";
import { useLocale, useT } from "~/i18n/useT";
import { issueCodes, supervisorCreateSchema } from "~/shared/schemas/backoffice";
import { auditContext, BACKOFFICE_HEADERS, requireStaff } from "~/utils/backoffice.server";
import { createSupervisor, SupervisorError } from "../../server/services/supervisorService";
import type { Route } from "./+types/backoffice-supervisor-new";

export function headers() {
  return BACKOFFICE_HEADERS;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireStaff(context, request, "super_admin");
  return data(null, { headers: BACKOFFICE_HEADERS });
}

type ActionResult =
  | { ok: true; id: number; oneTimePassword: string }
  | { ok: false; error?: string; fields?: Record<string, string>; values: ProfileValues };

/**
 * Creates a supervisor account. The one-time password is returned in this
 * response only (shown once); it is not stored in plain text, logged or audited.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const staff = await requireStaff(context, request, "super_admin");
  const form = await request.formData();
  const raw = Object.fromEntries(["name", "email", "workPhone", "phoneCountry", "whatsapp", "titleAr", "titleEn"].map((k) => [k, form.get(k) ?? undefined]));
  const values: ProfileValues = {
    name: String(raw.name ?? "").slice(0, 80),
    email: String(raw.email ?? "").slice(0, 254),
    workPhone: String(raw.workPhone ?? "").slice(0, 32),
    phoneCountry: String(raw.phoneCountry ?? "JO").slice(0, 2),
    whatsapp: raw.whatsapp === "on",
    titleAr: String(raw.titleAr ?? "").slice(0, 80),
    titleEn: String(raw.titleEn ?? "").slice(0, 80),
  };
  const input = supervisorCreateSchema.safeParse(raw);
  if (!input.success) return data<ActionResult>({ ok: false, fields: issueCodes(input.error), values }, { status: 400, headers: BACKOFFICE_HEADERS });
  try {
    const created = await createSupervisor(context.services.backoffice.db, staff, input.data, auditContext(context));
    return data<ActionResult>({ ok: true, ...created }, { headers: BACKOFFICE_HEADERS });
  } catch (error) {
    if (error instanceof SupervisorError && error.code === "email_taken") {
      return data<ActionResult>({ ok: false, fields: { email: "email_taken" }, values }, { status: 409, headers: BACKOFFICE_HEADERS });
    }
    throw error;
  }
}

const EMPTY: ProfileValues = { name: "", email: "", workPhone: "", phoneCountry: "JO", whatsapp: true, titleAr: "", titleEn: "" };

export default function NewSupervisorPage() {
  const t = useT();
  const locale = useLocale();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const base = `/${locale}/backoffice/supervisors`;

  if (result?.ok) {
    return (
      <section className="flex flex-col gap-4">
        <OneTimePassword heading={t("backoffice.created.heading")} password={result.oneTimePassword}>
          <Link to={`${base}/${result.id}`} className="self-start font-semibold text-primary-text hover:underline">
            {t("backoffice.created.open")}
          </Link>
        </OneTimePassword>
      </section>
    );
  }

  const failed = result && !result.ok ? result : undefined;
  return (
    <section className="flex flex-col gap-4">
      <Link to={base} className="text-sm text-primary-text hover:underline">
        {t("backoffice.supervisors.back")}
      </Link>
      <h1 className="text-2xl font-bold">{t("backoffice.supervisors.add")}</h1>
      <Card title={t("backoffice.form.profileHeading")}>
        <Form method="post" className="flex flex-col gap-4" noValidate>
          {failed?.fields && <Notice tone="error">{backofficeErrorText(t, "invalid_input")}</Notice>}
          <SupervisorProfileFields values={failed?.values ?? EMPTY} fields={failed?.fields} withEmail />
          <PrimaryButton busy={busy}>{t("backoffice.form.create")}</PrimaryButton>
        </Form>
      </Card>
    </section>
  );
}
