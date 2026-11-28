import { KeyRound } from "lucide-react";
import { useId, useMemo, useState, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { TextField } from "~/components/ui/TextField";
import type { TFunction } from "~/i18n";
import { useLocale, useT } from "~/i18n/useT";
import { BACKOFFICE_ERROR_CODES, PHONE_COUNTRIES } from "~/shared/schemas/backoffice";

/** Translated text for a back-office error code (unknown codes → the generic form error). */
export function backofficeErrorText(t: TFunction, code: string | undefined): string | undefined {
  if (!code) return undefined;
  return t(`backoffice.errors.${(BACKOFFICE_ERROR_CODES as readonly string[]).includes(code) ? code : "invalid_input"}`);
}

export function Card({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} id={id} className="rounded-2xl border border-border bg-card p-5">
      <h2 id={headingId} className="mb-4 text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "border-error/40 bg-error/10 text-error-text"
      : tone === "success"
        ? "border-success/40 bg-success/10 text-foreground"
        : "border-border bg-background text-foreground";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>
      {children}
    </p>
  );
}

export function PrimaryButton({ children, busy, tone = "primary", ...rest }: { children: ReactNode; busy?: boolean; tone?: "primary" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = tone === "danger" ? "bg-error text-on-primary hover:opacity-90" : "bg-primary text-on-primary hover:bg-primary-hover";
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy || undefined}
      className={`self-start rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-150 disabled:opacity-60 ${cls}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SelectField({ label, children, ...rest }: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} className="rounded-lg border border-muted bg-background px-3 py-2 text-foreground" {...rest}>
        {children}
      </select>
    </div>
  );
}

export function TextAreaField({ label, hint, error, ...rest }: { label: string; hint?: string; error?: string | undefined } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`rounded-lg border bg-background px-3 py-2 text-foreground ${error ? "border-error-text" : "border-muted"}`}
        {...rest}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-error-text">
          {error}
        </p>
      )}
    </div>
  );
}

export interface ProfileValues {
  name: string;
  email?: string;
  workPhone: string;
  phoneCountry: string;
  whatsapp: boolean;
  titleAr: string;
  titleEn: string;
}

/** Supervisor profile inputs (create and edit). The email is only editable on create. */
export function SupervisorProfileFields({ values, fields, withEmail }: { values: ProfileValues; fields?: Record<string, string> | undefined; withEmail: boolean }) {
  const t = useT();
  const err = (k: string) => backofficeErrorText(t, fields?.[k]);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label={t("backoffice.form.name")} name="name" required maxLength={80} defaultValue={values.name} error={err("name")} autoComplete="off" />
      {withEmail && (
        <TextField
          label={t("backoffice.form.email")}
          name="email"
          type="email"
          dir="ltr"
          required
          defaultValue={values.email}
          hint={t("backoffice.form.emailHint")}
          error={err("email")}
          autoComplete="off"
        />
      )}
      <TextField
        label={t("backoffice.form.workPhone")}
        name="workPhone"
        type="tel"
        dir="ltr"
        required
        maxLength={32}
        defaultValue={values.workPhone}
        hint={t("backoffice.form.workPhoneHint")}
        error={err("workPhone")}
        autoComplete="off"
      />
      <SelectField label={t("backoffice.form.phoneCountry")} name="phoneCountry" defaultValue={values.phoneCountry}>
        {PHONE_COUNTRIES.map((c) => (
          <option key={c} value={c}>
            {t(`countries.${c.toLowerCase()}`)}
          </option>
        ))}
      </SelectField>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="whatsapp" defaultChecked={values.whatsapp} className="size-4 accent-primary" />
        {t("backoffice.form.whatsapp")}
      </label>
      <TextField label={t("backoffice.form.titleAr")} name="titleAr" dir="rtl" lang="ar" maxLength={80} defaultValue={values.titleAr} hint={t("backoffice.form.optional")} error={err("titleAr")} />
      <TextField label={t("backoffice.form.titleEn")} name="titleEn" dir="ltr" lang="en" maxLength={80} defaultValue={values.titleEn} hint={t("backoffice.form.optional")} error={err("titleEn")} />
    </div>
  );
}

/** The one-time password, shown once after create or reset. Never stored client-side beyond this render. */
export function OneTimePassword({ heading, password, children }: { heading: string; password: string; children?: ReactNode }) {
  const t = useT();
  return (
    <div role="status" className="flex flex-col gap-3 rounded-2xl border border-success/40 bg-success/10 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <KeyRound aria-hidden="true" className="size-5" />
        {heading}
      </h2>
      <div>
        <p className="text-sm font-medium">{t("backoffice.created.otpLabel")}</p>
        <p dir="ltr" className="mt-1 select-all rounded-lg border border-border bg-background px-3 py-2 text-start font-mono text-lg tracking-wide">
          {password}
        </p>
      </div>
      <p className="text-sm">{t("backoffice.created.otpNote")}</p>
      {children}
    </div>
  );
}

export interface TreeArea {
  id: number;
  parentId: number | null;
  level: string;
  nameAr: string;
  nameEn: string;
}

/**
 * Scope picker: the country's area tree with checkboxes (`name="areaId"`).
 * Works without JavaScript; the selected count updates with it.
 */
export function ScopePicker({ countries, selected }: { countries: Array<{ code: string; areas: TreeArea[] }>; selected: number[] }) {
  const t = useT();
  const locale = useLocale();
  const [checked, setChecked] = useState(() => new Set(selected));
  const byParent = useMemo(() => {
    const m = new Map<number | null, TreeArea[]>();
    for (const c of countries) for (const a of c.areas) m.set(a.parentId, [...(m.get(a.parentId) ?? []), a]);
    const name = (a: TreeArea) => (locale === "ar" ? a.nameAr : a.nameEn);
    for (const list of m.values()) list.sort((a, b) => name(a).localeCompare(name(b), locale));
    return m;
  }, [countries, locale]);
  // Groups with saved selections inside start open (initial state only, so user toggles are kept).
  const initial = useMemo(() => new Set(selected), [selected]);
  const hasCheckedBelow = (id: number): boolean => (byParent.get(id) ?? []).some((c) => initial.has(c.id) || hasCheckedBelow(c.id));

  const toggle = (id: number, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const renderNode = (a: TreeArea, depth: number): ReactNode => {
    const children = byParent.get(a.id) ?? [];
    const box = (
      <label className="flex items-center gap-2 py-1 text-sm">
        <input
          type="checkbox"
          name="areaId"
          value={a.id}
          defaultChecked={selected.includes(a.id)}
          onChange={(e) => toggle(a.id, e.currentTarget.checked)}
          className="size-4 accent-primary"
        />
        <span>{locale === "ar" ? a.nameAr : a.nameEn}</span>
        <span className="text-xs text-muted">{t(`backoffice.scopes.levels.${a.level}`)}</span>
      </label>
    );
    if (!children.length) return <li key={a.id}>{box}</li>;
    return (
      <li key={a.id}>
        {box}
        <details open={depth === 0 && hasCheckedBelow(a.id)} className="ms-6">
          <summary className="cursor-pointer py-0.5 text-xs text-muted">{t("backoffice.scopes.inside", { count: children.length })}</summary>
          <ul className="border-s border-border ps-3">{children.map((c) => renderNode(c, depth + 1))}</ul>
        </details>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium" aria-live="polite">
        {t("backoffice.scopes.selected", { count: checked.size })}
      </p>
      {countries.map((c) => {
        const roots = c.areas.filter((a) => a.parentId === null || !c.areas.some((p) => p.id === a.parentId));
        return (
          <fieldset key={c.code} className="rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold">{t(`countries.${c.code.toLowerCase()}`)}</legend>
            <ul className="max-h-96 overflow-y-auto">{roots.map((a) => renderNode(a, 0))}</ul>
          </fieldset>
        );
      })}
    </div>
  );
}
