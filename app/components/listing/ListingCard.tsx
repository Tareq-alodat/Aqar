import { Bath, BedDouble, Building2, Home, House, LandPlot, Maximize2, Store, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import type { ListingCard as Card } from "~/components/map/types";
import { useLocale, useT } from "~/i18n/useT";
import type { Category, ListingType, RentPeriod } from "~/shared/constants";
import { listingPath } from "~/shared/listingUrl";
import { formatNumber, formatPrice } from "~/utils/format";

/** Solid badge per listing type (SPEC §14 colours): white on sale and rent, dark ink on the amber exchange. */
export const TYPE_BADGE: Record<ListingType, string> = {
  sale: "bg-sale text-on-primary",
  rent: "bg-rent text-on-primary",
  exchange: "bg-exchange text-on-accent",
};

/** Placeholder backdrop when a listing has no photo: a soft vertical gradient in the type's colour. */
const TYPE_GRADIENT: Record<ListingType, string> = {
  sale: "bg-linear-to-b from-sale/80 to-primary-hover text-on-primary",
  rent: "bg-linear-to-b from-rent/80 to-secondary-hover text-on-primary",
  exchange: "bg-linear-to-b from-exchange/80 to-accent-hover text-on-accent",
};

const CATEGORY_ICON: Record<Category, LucideIcon> = {
  apartment: Building2,
  house: House,
  villa: Home,
  land: LandPlot,
  commercial: Store,
};

export function PriceText({
  price,
  currency,
  decimals,
  rentPeriod,
  className,
}: {
  price: number | null;
  currency: string;
  decimals: number;
  rentPeriod: RentPeriod | null;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  if (price === null) return <span className={className}>{t("listing.types.exchange")}</span>;
  return (
    <span className={className}>
      {/* Prices read left-to-right even in Arabic text. */}
      <bdi>{formatPrice(price, currency, decimals, locale)}</bdi>
      {rentPeriod && <span className="text-sm font-normal text-muted">{t(rentPeriod === "monthly" ? "listing.perMonth" : "listing.perYear")}</span>}
    </span>
  );
}

interface ListingCardProps {
  item: Card;
  currencyDecimals: number;
  active?: boolean;
  /** Small side-by-side card (the mobile mini card for a clicked pin). */
  compact?: boolean;
  onHover?: (id: number | null) => void;
}

/**
 * Result card (SPEC §5.4, design v2): image on top (4:3), solid type badge,
 * price large in the primary colour, title, area, and key facts as icons.
 * The whole card links to the detail page (the title is the real link,
 * stretched over the card). Highlighted when its pin is hovered/selected.
 */
export function ListingCard({ item, currencyDecimals, active, compact, onHover }: ListingCardProps) {
  const t = useT();
  const locale = useLocale();
  const CategoryIcon = CATEGORY_ICON[item.category];
  const noRooms = item.category === "land";
  const facts: Array<{ icon: LucideIcon; value: string; label: string }> = [];
  if (!noRooms && item.bedrooms !== null) facts.push({ icon: BedDouble, value: formatNumber(item.bedrooms, locale), label: t("listing.beds", { count: item.bedrooms }) });
  if (!noRooms && item.bathrooms !== null) facts.push({ icon: Bath, value: formatNumber(item.bathrooms, locale), label: t("listing.baths", { count: item.bathrooms }) });
  if (item.areaSqm !== null) facts.push({ icon: Maximize2, value: t("listing.sqm", { area: formatNumber(item.areaSqm, locale) }), label: t("listing.sqm", { area: formatNumber(item.areaSqm, locale) }) });

  const image = (
    <div className={`relative shrink-0 overflow-hidden ${compact ? "size-24 rounded-lg" : "aspect-[4/3] w-full"} ${item.thumbnailUrl ? "bg-card" : TYPE_GRADIENT[item.listingType]}`}>
      {item.thumbnailUrl ? (
        <img src={item.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
      ) : (
        <span className="flex size-full items-center justify-center" title={t("listing.noPhoto")}>
          <CategoryIcon aria-hidden="true" className={compact ? "size-8" : "size-14"} strokeWidth={1.5} />
        </span>
      )}
      {!compact && (
        <span className={`absolute end-2 top-2 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm ${TYPE_BADGE[item.listingType]}`}>
          {t(`listing.types.${item.listingType}`)}
        </span>
      )}
      {item.isFeatured && (
        <span className="absolute start-2 top-2 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-on-accent shadow-sm">{t("listing.featured")}</span>
      )}
    </div>
  );

  return (
    <article
      data-listing-id={item.id}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`group relative flex overflow-hidden rounded-xl border bg-card shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-within:shadow-card-hover ${
        compact ? "gap-3 p-2.5" : "flex-col"
      } ${active ? "border-primary-text ring-1 ring-primary-text" : "border-border"}`}
    >
      {image}
      <div className={`flex min-w-0 flex-1 flex-col gap-1 ${compact ? "" : "p-3"}`}>
        <div className="flex items-start justify-between gap-2">
          <PriceText price={item.price} currency={item.currency} decimals={currencyDecimals} rentPeriod={item.rentPeriod} className="text-lg font-bold text-primary-text" />
          {compact && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_BADGE[item.listingType]}`}>{t(`listing.types.${item.listingType}`)}</span>}
        </div>
        <Link
          to={listingPath(locale, item.id, item.slug)}
          className="line-clamp-2 text-start text-sm font-semibold outline-none transition-colors duration-150 after:absolute after:inset-0 after:rounded-xl group-hover:text-primary-text focus-visible:text-primary-text focus-visible:after:ring-2 focus-visible:after:ring-primary-text"
        >
          {item.title}
        </Link>
        <p className="truncate text-xs text-muted">
          {t(`listing.categories.${item.category}`)}
          {item.areaName ? ` · ${item.areaName}` : ""}
        </p>
        {facts.length > 0 && (
          <ul className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {facts.map((f) => (
              <li key={f.label} className="flex items-center gap-1" title={f.label}>
                <f.icon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="sr-only">{f.label}</span>
                <bdi aria-hidden="true">{f.value}</bdi>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
