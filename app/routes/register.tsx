import { data, Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { AuthCard, authErrorText, SubmitButton } from "~/components/auth/AuthCard";
import { TextField } from "~/components/ui/TextField";
import { getT } from "~/i18n";
import { useLocale, useT } from "~/i18n/useT";
import { DEFAULT_COUNTRY, toCountryCode } from "~/shared/countries";
import { safeNextPath } from "~/shared/nextPath";
import {
  AUTH_ERROR_STATUS,
  fieldErrors,
  PASSWORD_MIN,
  registerSchema,
  type AuthErrorCode,
} from "~/shared/schemas/auth";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { cookieHeaders, homePath } from "~/utils/auth.server";
import { getTheme } from "~/utils/theme.server";
import type { Route } from "./+types/register";

export function meta({ params }: Route.MetaArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) return [];
  const t = getT(parsed.data.lang);
  return [{ title: `${t("auth.register.title")} | ${t("app.name")}` }, { name: "robots", content: "noindex" }];
}

/** Passes the action's Retry-After (429) through to the document response. */
export function headers({ actionHeaders }: Route.HeadersArgs) {
  return actionHeaders;
}

export function loader({ params, request, context }: Route.LoaderArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) throw data(null, { status: 404 });
  const next = safeNextPath(new URL(request.url).searchParams.get("next"), homePath(parsed.data.lang));
  if (context.session) throw redirect(next);
  return { next };
}

interface ActionResult {
  error?: AuthErrorCode;
  fields?: Record<string, AuthErrorCode>;
  values: { name: string; email: string; phone: string };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) throw data(null, { status: 404 });
  const locale = parsed.data.lang;
  const form = await request.formData();
  const next = safeNextPath(form.get("next"), homePath(locale));
  // Echoed back into the form on errors (never the password).
  const values = {
    name: String(form.get("name") ?? "").slice(0, 80),
    email: String(form.get("email") ?? "").slice(0, 254),
    phone: String(form.get("phone") ?? "").slice(0, 32),
  };

  // Phase 1: registration is for Jordan (phone rules of the active country).
  const countryCode = toCountryCode(DEFAULT_COUNTRY);
  const input = registerSchema(countryCode).safeParse({
    name: form.get("name"),
    email: form.get("email"),
    password: form.get("password"),
    phone: form.get("phone") ?? undefined,
  });
  if (!input.success) {
    return data<ActionResult>({ fields: fieldErrors(input.error), values }, { status: 400 });
  }
  const result = await context.services.auth.register(
    input.data,
    { countryCode, locale, theme: await getTheme(request) },
    context.meta,
  );
  if (!result.ok) {
    const headers = result.retryAfterS ? { "Retry-After": String(result.retryAfterS) } : undefined;
    const fields = result.error === "email_taken" ? { email: result.error } : undefined;
    return data<ActionResult>(
      { error: fields ? undefined : result.error, fields, values },
      { status: AUTH_ERROR_STATUS[result.error], headers },
    );
  }
  return redirect(next, { headers: cookieHeaders(context.services.cookies.issue(result.issued, new Date())) });
}

export default function RegisterPage() {
  const t = useT();
  const locale = useLocale();
  const { next } = useLoaderData<typeof loader>();
  const result = useActionData<ActionResult>();
  const busy = useNavigation().state === "submitting";
  const loginHref = `/${locale}/login?next=${encodeURIComponent(next)}`;
  const fieldError = (name: string) => authErrorText(t, result?.fields?.[name]);

  return (
    <AuthCard
      heading={t("auth.register.heading")}
      error={authErrorText(t, result?.error)}
      footer={
        <>
          {t("auth.register.haveAccount")}{" "}
          <Link to={loginHref} className="font-semibold text-primary-text hover:underline">
            {t("auth.register.loginLink")}
          </Link>
        </>
      }
    >
      <Form method="post" className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <TextField
          label={t("auth.fields.name")}
          name="name"
          autoComplete="name"
          required
          defaultValue={result?.values.name}
          error={fieldError("name")}
        />
        <TextField
          label={t("auth.fields.email")}
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          required
          defaultValue={result?.values.email}
          error={fieldError("email")}
        />
        <TextField
          label={t("auth.fields.password")}
          name="password"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          hint={t("auth.register.passwordHint", { min: PASSWORD_MIN })}
          error={fieldError("password")}
        />
        <TextField
          label={t("auth.fields.phone")}
          name="phone"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={result?.values.phone}
          hint={t("auth.register.phoneHint")}
          error={fieldError("phone")}
        />
        <SubmitButton label={t("auth.register.submit")} busy={busy} />
      </Form>
    </AuthCard>
  );
}
