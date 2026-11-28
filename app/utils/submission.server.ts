import { data, redirect, type AppLoadContext } from "react-router";
import { LISTER_ROLES } from "~/shared/constants";
import { DEFAULT_COUNTRY, toCountryCode } from "~/shared/countries";
import type { Locale } from "~/shared/locales";
import { typeStepSchema, wizardStepSchema, type WizardStep } from "~/shared/schemas/listingForm";
import { COMMISSION_TERMS_VERSION, isDraftTermsVersion } from "~/shared/terms";
import { env } from "../../server/env";
import { getAreaTree } from "../../server/services/areaService";
import { getCountry, getCountryAddressFields, getCountrySubmissionInfo } from "../../server/services/countryService";
import { getIdentifierScheme } from "../../server/services/identifierService";
import {
  createDraft,
  getDraft,
  getListerLimits,
  getRequirements,
  listDrafts,
  maskedProfilePhone,
  SubmissionError,
  type Lister,
} from "../../server/services/submissionService";
import type { WizardField, WizardIdentifier } from "~/components/form/types";
import { requireUser } from "./auth.server";

/**
 * Submit wizard pages (SPEC §7). Loaders stay thin over submissionService.
 * Everything here is the signed-in lister's own data: responses are
 * `private, no-store` and not indexed. The phone is only ever sent masked.
 */

export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

const isLister = (role: string) => (LISTER_ROLES as readonly string[]).includes(role);

function listerFrom(context: AppLoadContext, request: Request): Lister | null {
  const user = requireUser(context, request);
  return isLister(user.role) ? { id: user.id, role: user.role } : null;
}

/** /:lang/listings/new — step 1 plus the lister's drafts and limits. */
export async function loadNewListing(context: AppLoadContext, request: Request) {
  const lister = listerFrom(context, request);
  if (!lister) return data({ forbidden: true as const }, { headers: PRIVATE_HEADERS });
  const { submission } = context.services;
  const [drafts, limits] = await Promise.all([listDrafts(submission.db, lister), getListerLimits(submission, lister)]);
  return data({ forbidden: false as const, drafts, limits }, { headers: PRIVATE_HEADERS });
}

/** Creates a draft from step 1 and continues at the location step. */
export async function createListingAction(context: AppLoadContext, request: Request, locale: Locale) {
  const lister = listerFrom(context, request);
  if (!lister) throw data(null, { status: 403 });
  const form = await request.formData();
  const rent = form.get("rentPeriod");
  const parsed = typeStepSchema.safeParse({
    category: form.get("category"),
    listingType: form.get("listingType"),
    // Without JavaScript the rent-period choice may not be shown yet: default to monthly (editable in the wizard).
    rentPeriod: form.get("listingType") === "rent" ? (typeof rent === "string" && rent ? rent : "monthly") : null,
  });
  if (!parsed.success) return data({ error: "invalid_input" as const }, { status: 400 });
  try {
    const id = await createDraft(context.services.submission, lister, toCountryCode(DEFAULT_COUNTRY), parsed.data);
    return redirect(`/${locale}/listings/${id}/edit?step=location`);
  } catch (error) {
    if (error instanceof SubmissionError && error.code === "draft_limit") return data({ error: "draft_limit" as const }, { status: 409 });
    throw error;
  }
}

/** /:lang/listings/:id/edit?step= — the wizard for one of the lister's drafts. */
export async function loadEditListing(context: AppLoadContext, request: Request, locale: Locale, idParam: string | undefined) {
  const lister = listerFrom(context, request);
  if (!lister) throw data(null, { status: 403 });
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) throw data(null, { status: 404 });
  const stepParam = wizardStepSchema.safeParse(new URL(request.url).searchParams.get("step"));
  const step: WizardStep = stepParam.success ? stepParam.data : "type";

  const { submission } = context.services;
  let draft;
  try {
    draft = await getDraft(submission.db, lister, id);
  } catch (error) {
    if (error instanceof SubmissionError && error.code === "not_found") throw data(null, { status: 404, headers: PRIVATE_HEADERS });
    throw error;
  }

  const code = draft.countryCode;
  const [country, info, fields, tree, requirements, limits] = await Promise.all([
    getCountry(submission.db, code),
    getCountrySubmissionInfo(submission.db, code),
    getCountryAddressFields(submission.db, code),
    getAreaTree(submission.db, code),
    getRequirements(submission.db, code),
    getListerLimits(submission, lister),
  ]);
  if (!country || !info) throw data(null, { status: 404 });
  const label = (f: { label_ar: string; label_en: string }) => (locale === "ar" ? f.label_ar : f.label_en);

  const address: WizardField[] = fields
    .filter((f) => f.kind === "text" || f.kind === "number")
    .map((f) => ({ key: f.field_key, label: label(f), required: f.is_required, visibility: f.visibility }));
  const identifiers: WizardIdentifier[] = [];
  for (const f of fields.filter((f) => f.kind === "identifier")) {
    const scheme = await getIdentifierScheme(submission.db, f.field_key);
    if (!scheme) continue;
    identifiers.push({
      key: f.field_key,
      label: label(f),
      required: f.is_required,
      parts: scheme.parts?.map((p) => ({ key: p.key, label: label(p), required: p.required, numeric: p.numeric })) ?? null,
    });
  }

  return data(
    {
      step,
      draft,
      country: { code, currency: info.currency, currencyDecimals: info.currencyDecimals, center: country.center, zoom: country.zoom },
      address,
      identifiers,
      requirements,
      jumpAreas: tree.areas,
      // Masked only: the number itself never reaches the page (CLAUDE.md rule 1).
      maskedPhone: await maskedProfilePhone(submission, lister, info),
      limits,
      terms: { version: COMMISSION_TERMS_VERSION, draft: isDraftTermsVersion(COMMISSION_TERMS_VERSION) },
      styles: { dark: env.MAP_STYLE_URL_DARK, light: env.MAP_STYLE_URL_LIGHT },
    },
    { headers: PRIVATE_HEADERS },
  );
}

/** /:lang/terms/commission — the rate comes from the country settings. */
export async function loadCommissionTerms(context: AppLoadContext) {
  const info = await getCountrySubmissionInfo(context.services.db, toCountryCode(DEFAULT_COUNTRY));
  return {
    rate: info?.commissionRate ?? 0.01,
    version: COMMISSION_TERMS_VERSION,
    draft: isDraftTermsVersion(COMMISSION_TERMS_VERSION),
  };
}
