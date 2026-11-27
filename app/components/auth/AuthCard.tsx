import type { ReactNode } from "react";
import type { TFunction } from "~/i18n";
import { PASSWORD_MAX, PASSWORD_MIN, type AuthErrorCode } from "~/shared/schemas/auth";

/** Translated text for an auth error code. */
export function authErrorText(t: TFunction, code: AuthErrorCode | undefined): string | undefined {
  return code ? t(`auth.errors.${code}`, { min: PASSWORD_MIN, max: PASSWORD_MAX }) : undefined;
}

/** Centered card for the login/register forms. */
export function AuthCard({ heading, error, children, footer }: { heading: string; error?: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-lg">
        <h1 className="mb-5 text-xl font-bold">{heading}</h1>
        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error-text">
            {error}
          </p>
        )}
        {children}
        <p className="mt-5 text-center text-sm text-muted">{footer}</p>
      </div>
    </div>
  );
}

export function SubmitButton({ label, busy }: { label: string; busy: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy || undefined}
      className="mt-2 rounded-lg bg-primary px-4 py-2.5 font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
    >
      {label}
    </button>
  );
}
