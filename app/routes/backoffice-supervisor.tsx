import { data, Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  backofficeErrorText,
  Card,
  Notice,
  OneTimePassword,
  PrimaryButton,
  ScopePicker,
  SupervisorProfileFields,
  TextAreaField,
  type ProfileValues,
} from "~/components/backoffice/parts";
import { useLocale, useT } from "~/i18n/useT";
import { issueCodes, scopesSchema, supervisorActiveSchema, supervisorUpdateSchema } from "~/shared/schemas/backoffice";
import { auditContext, BACKOFFICE_HEADERS, idParam, requireStaff } from "~/utils/backoffice.server";
import {
  getSupervisor,
  resetSupervisorPassword,
  scopeAreaTree,
  scopeCountries,
  setSupervisorActive,
  setSupervisorScopes,
  SupervisorError,
  updateSupervisor,
} from "../../server/services/supervisorService";
import type { Route } from "./+types/backoffice-supervisor";

export function headers() {
  return BACKOFFICE_HEADERS;
}

const notFound = () => data(null, { status: 404, headers: BACKOFFICE_HEADERS });

/** One supervisor (super_admin only): profile, scope, status and password reset. */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const staff = await requireStaff(context, request, "super_admin");
  const id = idParam(params.id);
  const { db } = context.services.backoffice;
  let supervisor;
  try {
    supervisor = await getSupervisor(db, staff, id);
  } catch (error) {
    if (error instanceof SupervisorError && error.code === "not_found") throw notFound();
    throw error;
  }
  const countries = await Promise.all((await scopeCountries(db)).map(async (code) => ({ code, areas: await scopeAreaTree(db, code) })));
  return data({ supervisor, countries }, { headers: BACKOFFICE_HEADERS });
}

type Intent = "profile" | "scopes" | "status" | "password";
type ActionResult =
  | { intent: "profile"; ok: boolean; fields?: Record<string, string>; values?: ProfileValues }
  | { intent: "scopes"; ok: boolean; moved?: number; picked?: number; error?: string }
  | { intent: "status"; ok: boolean; active?: boolean; moved?: number; error?: string; fields?: Record<string, string> }
  | { intent: "password"; ok: true; oneTimePassword: string };

export async function action({ params, request, context }: Route.ActionArgs) {
  const staff = await requireStaff(context, request, "super_admin");
  const id = idParam(params.id);
  const { db } = context.services.backoffice;
  const ctx = auditContext(context);
  const form = await request.formData();
  const intent = form.get("intent") as Intent | null;
  const reply = (body: ActionResult, status = 200) => data<ActionResult>(body, { status, headers: BACKOFFICE_HEADERS });

  try {
    switch (intent) {
      case "profile": {
        const raw = Object.fromEntries(["name", "workPhone", "phoneCountry", "whatsapp", "titleAr", "titleEn"].map((k) => [k, form.get(k) ?? undefined]));
        const input = supervisorUpdateSchema.safeParse(raw);
        if (!input.success) {
          const values: ProfileValues = {
            name: String(raw.name ?? "").slice(0, 80),
            workPhone: String(raw.workPhone ?? "").slice(0, 32),
            phoneCountry: String(raw.phoneCountry ?? "JO").slice(0, 2),
            whatsapp: raw.whatsapp === "on",
            titleAr: String(raw.titleAr ?? "").slice(0, 80),
            titleEn: String(raw.titleEn ?? "").slice(0, 80),
          };
          return reply({ intent, ok: false, fields: issueCodes(input.error), values }, 400);
        }
        await updateSupervisor(db, staff, id, input.data, ctx);
        return reply({ intent, ok: true });
      }
      case "scopes": {
        const input = scopesSchema.safeParse({ areaIds: form.getAll("areaId") });
        if (!input.success) return reply({ intent, ok: false, error: "area_invalid" }, 400);
        const r = await setSupervisorScopes(db, staff, id, input.data, ctx);
        return reply({ intent, ok: true, ...r });
      }
      case "status": {
        const input = supervisorActiveSchema.safeParse({ active: form.get("active"), reason: form.get("reason") });
        if (!input.success) return reply({ intent, ok: false, fields: issueCodes(input.error) }, 400);
        const r = await setSupervisorActive(db, staff, id, input.data, ctx);
        return reply({ intent, ok: true, active: input.data.active, ...r });
      }
      case "password": {
        // Shown once in this response; never stored in plain text, logged or audited.
        const r = await resetSupervisorPassword(db, staff, id, ctx);
        return reply({ intent, ok: true, ...r });
      }
      default:
        throw data(null, { status: 400, headers: BACKOFFICE_HEADERS });
    }
  } catch (error) {
    if (error instanceof SupervisorError) {
      if (error.code === "not_found") throw notFound();
      if (intent === "scopes" || intent === "status") return reply({ intent, ok: false, error: error.code }, error.code === "already_in_state" ? 409 : 400);
    }
    throw error;
  }
}

export default function SupervisorPage() {
  const t = useT();
  const locale = useLocale();
  const { supervisor: s, countries } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busyIntent = navigation.state === "submitting" ? navigation.formData?.get("intent") : null;
  const r = <I extends Intent>(intent: I) => (result?.intent === intent ? (result as Extract<ActionResult, { intent: I }>) : undefined);
  const profile = r("profile");
  const scopes = r("scopes");
  const status = r("status");
  const password = r("password");

  const values: ProfileValues = profile?.values ?? {
    name: s.name,
    workPhone: s.workPhone,
    phoneCountry: "JO",
    whatsapp: s.whatsapp,
    titleAr: s.titleAr ?? "",
    titleEn: s.titleEn ?? "",
  };

  return (
    <section className="flex flex-col gap-5">
      <Link to={`/${locale}/backoffice/supervisors`} className="text-sm text-primary-text hover:underline">
        {t("backoffice.supervisors.back")}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{s.name}</h1>
        <p className="text-sm text-muted">
          <bdi dir="ltr">{s.email}</bdi>
        </p>
        {s.mustChangePassword && <p className="mt-1 text-sm text-muted">{t("backoffice.supervisors.mustChange")}</p>}
      </div>

      {password && <OneTimePassword heading={t("backoffice.created.resetHeading")} password={password.oneTimePassword} />}

      <Card title={t("backoffice.form.profileHeading")}>
        <Form method="post" className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="intent" value="profile" />
          {profile?.ok && <Notice tone="success">{t("backoffice.form.saved")}</Notice>}
          {profile && !profile.ok && <Notice tone="error">{backofficeErrorText(t, "invalid_input")}</Notice>}
          <SupervisorProfileFields key={profile?.ok ? "saved" : "edit"} values={values} fields={profile?.fields} withEmail={false} />
          <PrimaryButton busy={busyIntent === "profile"}>{t("backoffice.form.save")}</PrimaryButton>
        </Form>
      </Card>

      <Card title={t("backoffice.scopes.heading")}>
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="scopes" />
          <p className="text-sm text-muted">{t("backoffice.scopes.hint")}</p>
          {scopes?.ok && <Notice tone="success">{t("backoffice.scopes.saved", { moved: scopes.moved ?? 0, picked: scopes.picked ?? 0 })}</Notice>}
          {scopes && !scopes.ok && <Notice tone="error">{backofficeErrorText(t, scopes.error)}</Notice>}
          <ScopePicker key={s.scopes.map((a) => a.id).join(",")} countries={countries} selected={s.scopes.map((a) => a.id)} />
          <PrimaryButton busy={busyIntent === "scopes"}>{t("backoffice.scopes.save")}</PrimaryButton>
        </Form>
      </Card>

      <Card title={t("backoffice.status.heading")}>
        <Form method="post" className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="intent" value="status" />
          <input type="hidden" name="active" value={s.isActive ? "false" : "true"} />
          {status?.ok && (
            <Notice tone="success">{status.active ? t("backoffice.status.activated") : t("backoffice.status.deactivated", { moved: status.moved ?? 0 })}</Notice>
          )}
          {status && !status.ok && status.error && <Notice tone="error">{backofficeErrorText(t, status.error)}</Notice>}
          <p className="text-sm">{t(s.isActive ? "backoffice.status.activeNow" : "backoffice.status.inactiveNow")}</p>
          {s.isActive && <p className="text-sm text-muted">{t("backoffice.status.deactivateNote", { count: s.openListings })}</p>}
          <TextAreaField
            key={status?.ok ? "done" : "reason"}
            label={t("backoffice.status.reason")}
            name="reason"
            required
            maxLength={500}
            hint={t("backoffice.status.reasonHint")}
            error={backofficeErrorText(t, status?.fields?.reason)}
          />
          <PrimaryButton busy={busyIntent === "status"} tone={s.isActive ? "danger" : "primary"}>
            {t(s.isActive ? "backoffice.status.deactivate" : "backoffice.status.activate")}
          </PrimaryButton>
        </Form>
      </Card>

      <Card title={t("backoffice.password.heading")}>
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="password" />
          <p className="text-sm text-muted">{t("backoffice.password.note")}</p>
          <PrimaryButton busy={busyIntent === "password"}>{t("backoffice.password.reset")}</PrimaryButton>
        </Form>
      </Card>
    </section>
  );
}
