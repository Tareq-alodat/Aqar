import { useId, type InputHTMLAttributes } from "react";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  name: string;
  hint?: string;
  /** Translated error message for this field. */
  error?: string;
}

/** Labelled input with optional hint and error, linked for screen readers. */
export function TextField({ label, hint, error, className, ...input }: TextFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`rounded-lg border bg-background px-3 py-2 text-foreground outline-none focus:border-primary-text focus:ring-1 focus:ring-primary-text ${
          error ? "border-error-text" : "border-muted"
        } ${className ?? ""}`}
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-error-text">
          {error}
        </p>
      )}
    </div>
  );
}
