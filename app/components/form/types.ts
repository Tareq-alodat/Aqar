import type { AreaSummary } from "~/components/map/types";
import type { DraftView, LngLat, SubmitRequirements, WizardStep } from "~/shared/schemas/listingForm";

/** A typed address field as the wizard shows it (label in the page language). */
export interface WizardField {
  key: string;
  label: string;
  required: boolean;
  visibility: "public" | "exact_only" | "admin_only";
}

/** A property identifier scheme (never public); multi-part schemes list their parts. */
export interface WizardIdentifier {
  key: string;
  label: string;
  required: boolean;
  parts: Array<{ key: string; label: string; required: boolean; numeric: boolean }> | null;
}

export interface ListerLimits {
  drafts: number;
  draftLimit: number;
  atDraftLimit: boolean;
  submittedToday: number;
  submissionsPerDay: number;
  atSubmissionLimit: boolean;
}

/** Loader data of /:lang/listings/:id/edit. */
export interface WizardData {
  step: WizardStep;
  draft: DraftView;
  country: { code: string; currency: string; currencyDecimals: number; center: LngLat; zoom: number };
  address: WizardField[];
  identifiers: WizardIdentifier[];
  requirements: SubmitRequirements;
  jumpAreas: AreaSummary[];
  /** The lister's profile phone, masked; never the number itself. */
  maskedPhone: string | null;
  limits: ListerLimits;
  terms: { version: string; draft: boolean };
  styles: { dark: string; light: string };
}

/** Shared control styles (theme tokens; form-control borders in `muted`, CLAUDE.md). */
export const field = "w-full rounded-lg border border-muted bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-primary-text focus:outline-none focus:ring-1 focus:ring-primary-text";
export const card = "rounded-2xl border border-border bg-surface p-4 sm:p-5";
export const primaryButton = "rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60";
export const secondaryButton = "rounded-lg border border-muted px-4 py-2 font-medium hover:bg-card disabled:opacity-60";
export const choice = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary text-on-primary" : "border-muted/60 bg-background hover:border-foreground"}`;
