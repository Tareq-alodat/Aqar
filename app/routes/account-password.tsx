import { data, Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { AuthCard, authErrorText, SubmitButton } from "~/components/auth/AuthCard";
import { TextField } from "~/components/ui/TextField";
import { getT } from "~/i18n";
import { useT } from "~/i18n/useT";
import { isStaffRole } from "~/shared/constants";
import { PASSWORD_MIN, AUTH_ERROR_STATUS, type AuthErrorCode } from "~/shared/schemas/auth";
import { changePasswordSchema, issueCodes } from "~/shared/schemas/backoffice";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { homePath, requireUser } from "~/utils/auth.server";
import type { Route } from "./+types/account-password";

/**
 * Minimal change-password page (milestone 7a). The only page a user with a
 * one-time password can reach; the full settings screen comes with milestone 8.
 */

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

export function meta({ params }: Route.MetaArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) return [];
  const t = getT(parsed.data.lang);
  return [{ title: `${t("account.password.title")} | ${t("app.name")}` }, { name: "robots", content: "noindex" }];
}

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
  const out = new Headers(PRIVATE_HEADERS);
  const retry = actionHeaders.get("Retry-After") ?? loaderHeaders.get("Retry-After");
  if (retry) out.set("Retry-After", retry);
  return out;
}

export function loader({ params, request, context }: Route.LoaderArgs) {
  if (!langParamsSchema.safeParse(params).success) throw data(null, { status: 404 });
  const user = requireUser(context, request, { allowPasswordChange: true });
  return data({ forced: user.mustChangePassword }, { headers: PRIVATE_HEADERS });
}

type FieldCode = AuthErrorCode | "password_mismatch" | "password_unchanged";
interface ActionResult {
  error?: AuthErrorCode;
  fields?: Record<string, FieldCode>;
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) throw data(null, { status: 404 });
  const user = requireUser(context, request, { allowPasswordChange: true });
  const form = await request.formData();
  const input = changePasswordSchema.safeParse({
    currentPassword: form.get("currentPassword"),
    newPassword: form.get("newPassword"),
    confirmPassword: form.get("confirmPassword"),
  });
  if (!input.success) return data<ActionResult>({ fields: issueCodes(input.error) as Record<string, FieldCode> }, { status: 400 });

  const result = await context.services.auth.changePassword(context.session!, input.data, context.meta);
  if (!result.ok) {
    const headers = result.retryAfterS ? { "Retry-After": String(result.retryAfterS) } : undefined;
    return data<ActionResult>({ error: result.error }, { status: AUTH_ERROR_STATUS[result.error], headers });
  }
  const locale = parsed.data.lang;
  return redirect(isStaffRole(user.role) ? `/${locale}/backoffice` : homePath(locale));
}

export default function AccountPasswordPage() {
  const t = useT();
  const { forced } = useLoaderData<typeof loader>();
  const result = useActionData<ActionResult>();
  const busy = useNavigation().state === "submitting";
  const fieldText = (code: FieldCode | undefined) =>
    code === "password_mismatch" || code === "password_unchanged" ? t(`account.password.errors.${code}`) : authErrorText(t, code);
  const error = result?.error === "invalid_credentials" ? undefined : authErrorText(t, result?.error);

  return (
    <AuthCard heading={t("account.password.heading")} error={error}>
      {forced && (
        <p className="mb-4 rounded-lg border border-border bg-background px-3 py-2 text-sm" role="status">
          {t("account.password.forced")}
        </p>
      )}
      <Form method="post" className="flex flex-col gap-4" noValidate>
        <TextField
          label={t(forced ? "account.password.currentForced" : "account.password.current")}
          name="currentPassword"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          required
          error={result?.error === "invalid_credentials" ? authErrorText(t, "invalid_credentials") : fieldText(result?.fields?.currentPassword)}
        />
        <TextField
          label={t("account.password.new")}
          name="newPassword"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          hint={t("auth.register.passwordHint", { min: PASSWORD_MIN })}
          error={fieldText(result?.fields?.newPassword)}
        />
        <TextField
          label={t("account.password.confirm")}
          name="confirmPassword"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          required
          error={fieldText(result?.fields?.confirmPassword)}
        />
        <SubmitButton label={t("account.password.submit")} busy={busy} />
      </Form>
    </AuthCard>
  );
}
