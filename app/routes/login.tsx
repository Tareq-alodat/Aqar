import { data, Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { AuthCard, authErrorText, SubmitButton } from "~/components/auth/AuthCard";
import { TextField } from "~/components/ui/TextField";
import { getT } from "~/i18n";
import { useLocale, useT } from "~/i18n/useT";
import { safeNextPath } from "~/shared/nextPath";
import { AUTH_ERROR_STATUS, fieldErrors, loginSchema, type AuthErrorCode } from "~/shared/schemas/auth";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { cookieHeaders, homePath } from "~/utils/auth.server";
import type { Route } from "./+types/login";

export function meta({ params }: Route.MetaArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) return [];
  const t = getT(parsed.data.lang);
  return [{ title: `${t("auth.login.title")} | ${t("app.name")}` }, { name: "robots", content: "noindex" }];
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
  email: string;
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const parsed = langParamsSchema.safeParse(params);
  if (!parsed.success) throw data(null, { status: 404 });
  const form = await request.formData();
  const next = safeNextPath(form.get("next"), homePath(parsed.data.lang));
  const email = String(form.get("email") ?? "").slice(0, 254);

  const input = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!input.success) {
    return data<ActionResult>({ fields: fieldErrors(input.error), email }, { status: 400 });
  }
  const result = await context.services.auth.login(input.data, context.meta);
  if (!result.ok) {
    const headers = result.retryAfterS ? { "Retry-After": String(result.retryAfterS) } : undefined;
    return data<ActionResult>({ error: result.error, email }, { status: AUTH_ERROR_STATUS[result.error], headers });
  }
  return redirect(next, { headers: cookieHeaders(context.services.cookies.issue(result.issued, new Date())) });
}

export default function LoginPage() {
  const t = useT();
  const locale = useLocale();
  const { next } = useLoaderData<typeof loader>();
  const result = useActionData<ActionResult>();
  const busy = useNavigation().state === "submitting";
  const registerHref = `/${locale}/register?next=${encodeURIComponent(next)}`;

  return (
    <AuthCard
      heading={t("auth.login.heading")}
      error={authErrorText(t, result?.error)}
      footer={
        <>
          {t("auth.login.noAccount")}{" "}
          <Link to={registerHref} className="font-semibold text-primary hover:underline">
            {t("auth.login.registerLink")}
          </Link>
        </>
      }
    >
      <Form method="post" className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <TextField
          label={t("auth.fields.email")}
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          required
          defaultValue={result?.email}
          error={authErrorText(t, result?.fields?.email)}
        />
        <TextField
          label={t("auth.fields.password")}
          name="password"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          required
          error={authErrorText(t, result?.fields?.password)}
        />
        <SubmitButton label={t("auth.login.submit")} busy={busy} />
      </Form>
    </AuthCard>
  );
}
