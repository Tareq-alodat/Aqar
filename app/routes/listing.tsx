import { useEffect } from "react";
import { data, Link, useLoaderData } from "react-router";
import {
  AreaBreadcrumb,
  ContactBox,
  FavoriteButton,
  FeatureGrid,
  LazyDetailMap,
  OwnerCard,
  ShareButtons,
} from "~/components/listing/DetailParts";
import { Gallery } from "~/components/listing/Gallery";
import { ListingCard, PriceText, TYPE_BADGE } from "~/components/listing/ListingCard";
import { useTheme } from "~/hooks/useTheme";
import { getT } from "~/i18n";
import { useLocale, useT } from "~/i18n/useT";
import { DEFAULT_COUNTRY } from "~/shared/countries";
import { langParamsSchema } from "~/shared/schemas/routeParams";
import { formatNumber, formatPrice } from "~/utils/format";
import { loadListingPage } from "~/utils/listing.server";
import type { Route } from "./+types/listing";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!lang.success) throw data(null, { status: 404 });
  return loadListingPage(context, request, lang.data.lang, params.idSlug);
}

/** Forwards the loader's headers: the visitor cookie, and no-store/noindex for previews. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ data: d, params }: Route.MetaArgs) {
  const lang = langParamsSchema.safeParse(params);
  if (!d || !lang.success) return [];
  const t = getT(lang.data.lang);
  const { listing } = d;
  const place = listing.areaPath.at(-1)?.name;
  const description = (listing.description ?? `${listing.title}${place ? ` — ${place}` : ""}`).replace(/\s+/g, " ").slice(0, 160);
  return [
    { title: `${listing.title} | ${t("app.name")}` },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: d.canonical },
    ...(d.access === "preview" ? [{ name: "robots", content: "noindex" }] : []),
  ];
}

export default function ListingPage() {
  const { listing, access, similar, saved, canonical, styles } = useLoaderData<typeof loader>();
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();

  // Count the view from the browser after load (bots and prefetches do not run this).
  useEffect(() => {
    if (access !== "public") return;
    const url = `/api/v1/listings/${listing.id}/view`;
    if (!navigator.sendBeacon?.(url)) void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  }, [access, listing.id]);

  const contactMessage = t("detail.contact.message", { title: listing.title, url: canonical });
  const mapHref = listing.location
    ? `/${locale}/${DEFAULT_COUNTRY}/map?lat=${listing.location.lat}&lng=${listing.location.lng}&z=15`
    : `/${locale}/${DEFAULT_COUNTRY}/map`;

  return (
    <div className={`mx-auto w-full max-w-6xl px-4 py-5 ${listing.contact ? "pb-24 lg:pb-8" : ""}`}>
      <AreaBreadcrumb path={listing.areaPath} />

      {access === "preview" && (
        <p role="status" className="mt-3 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 text-sm">
          {t("detail.preview", { status: t(`detail.status.${listing.status}`) })}
        </p>
      )}
      {access === "public" && listing.status !== "published" && (
        <p role="status" className="mt-3 rounded-xl border border-card bg-card px-4 py-2 text-sm font-semibold">
          {t(`detail.statusBanner.${listing.status}`)}
        </p>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <article className="flex min-w-0 flex-col gap-6">
          {listing.images.length > 0 ? (
            <Gallery images={listing.images} alt={listing.title} />
          ) : (
            <div className="flex aspect-[3/2] items-center justify-center rounded-xl bg-card text-sm text-muted">{t("listing.noPhoto")}</div>
          )}

          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_BADGE[listing.listingType]}`}>
                {t(`listing.types.${listing.listingType}`)}
              </span>
              <span className="rounded-full bg-card px-2.5 py-0.5 text-xs">{t(`listing.categories.${listing.category}`)}</span>
              {listing.isFeatured && <span className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-semibold text-background">{t("listing.featured")}</span>}
            </div>
            <h1 className="text-2xl font-bold">{listing.title}</h1>
            <PriceText
              price={listing.price}
              currency={listing.currency}
              decimals={listing.currencyDecimals}
              rentPeriod={listing.rentPeriod}
              className="text-2xl font-bold text-primary"
            />
            {listing.pricePerSqm !== null && listing.rentPeriod === null && (
              <p className="text-sm text-muted">
                {t("detail.pricePerSqm", { price: formatPrice(listing.pricePerSqm, listing.currency, listing.currencyDecimals, locale) })}
              </p>
            )}
            <p className="text-xs text-muted">{t("detail.views", { count: listing.viewCount, formatted: formatNumber(listing.viewCount, locale) })}</p>
          </header>

          {listing.address.length > 0 && (
            <section aria-labelledby="address-title">
              <h2 id="address-title" className="mb-2 text-lg font-semibold">
                {t("detail.address")}
              </h2>
              <dl className="grid gap-1 text-sm sm:grid-cols-2">
                {listing.address.map((a) => (
                  <div key={a.key} className="flex gap-2">
                    <dt className="text-muted">{a.label}:</dt>
                    <dd>{a.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <FeatureGrid v={listing} />

          {listing.description && (
            <section aria-labelledby="description-title">
              <h2 id="description-title" className="mb-2 text-lg font-semibold">
                {t("detail.description")}
              </h2>
              <p className="whitespace-pre-line leading-relaxed">{listing.description}</p>
            </section>
          )}

          {listing.location && (
            <section aria-labelledby="location-title" className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 id="location-title" className="text-lg font-semibold">
                  {t("detail.location.title")}
                </h2>
                <Link to={mapHref} className="text-sm text-primary hover:underline">
                  {t("detail.location.viewOnMap")}
                </Link>
              </div>
              {listing.location.precision === "approximate" && <p className="text-sm text-muted">{t("detail.location.approximate")}</p>}
              <LazyDetailMap lng={listing.location.lng} lat={listing.location.lat} precision={listing.location.precision} styleUrl={styles[theme]} />
            </section>
          )}
        </article>

        <aside className="flex flex-col gap-4">
          {listing.contact ? (
            <ContactBox phone={listing.contact.phone} whatsapp={listing.contact.whatsapp} message={contactMessage} />
          ) : (
            listing.status !== "published" && <p className="rounded-2xl border border-card bg-surface p-4 text-sm text-muted">{t("detail.contact.unavailable")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {access === "public" && <FavoriteButton listingId={listing.id} initial={saved} />}
          </div>
          <ShareButtons url={canonical} title={listing.title} />
          <OwnerCard owner={listing.owner} />
        </aside>
      </div>

      {similar.length > 0 && (
        <section aria-labelledby="similar-title" className="mt-10">
          <h2 id="similar-title" className="mb-3 text-lg font-semibold">
            {t("detail.similar")}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {similar.map((item) => (
              <li key={item.id}>
                <ListingCard item={item} currencyDecimals={listing.currencyDecimals} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {listing.contact && <ContactBox phone={listing.contact.phone} whatsapp={listing.contact.whatsapp} message={contactMessage} sticky />}
    </div>
  );
}
