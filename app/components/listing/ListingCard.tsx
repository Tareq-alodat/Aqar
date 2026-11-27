import { Link } from "react-router";
import { useLocale, useT } from "~/i18n/useT";
import { listingPath } from "~/shared/listingUrl";
import type { Category, ListingType, RentPeriod } from "~/shared/constants";
import { formatNumber, formatPrice } from "~/utils/format";
import type { ListingCard as Card } from "~/components/map/types";

/** Background token per listing type (SPEC §5.2 colours). */
export const TYPE_BADGE: Record<ListingType, string> = {
  sale: "bg-sale text-on-primary",
  rent: "bg-rent text-on-primary",
  exchange: "bg-exchange text-on-primary",
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

function CategoryIcon({ category }: { category: Category }) {
  const paths: Record<Category, string> = {
    apartment: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 21h5V10a1 1 0 0 0-1-1h-4M8 8h3M8 12h3M8 16h3",
    house: "M3 11l9-7 9 7M5 10v11h14V10M10 21v-6h4v6",
    villa: "M2 12l6-5 6 5M4 11v10h8V11M12 9l5-4 5 4M14 21h8V9",
    land: "M3 20h18M5 16l4-6 4 4 3-3 3 5",
    commercial: "M3 9l1.5-5h15L21 9M3 9h18v2a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0V9M5 13v8h14v-8",
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[category]} />
    </svg>
  );
}

interface ListingCardProps {
  item: Card;
  currencyDecimals: number;
  active?: boolean;
  compact?: boolean;
  onHover?: (id: number | null) => void;
}

/**
 * Result card (SPEC §5.4): photo, price, type, category, area, beds, baths, m².
 * The whole card links to the detail page (`/:lang/property/{id}-{slug}`); the
 * title is the real link, stretched over the card.
 */
export function ListingCard({ item, currencyDecimals, active, compact, onHover }: ListingCardProps) {
  const t = useT();
  const locale = useLocale();
  const specs = [
    item.bedrooms !== null && item.category !== "land" ? t("listing.beds", { count: item.bedrooms }) : null,
    item.bathrooms !== null && item.category !== "land" ? t("listing.baths", { count: item.bathrooms }) : null,
    item.areaSqm !== null ? t("listing.sqm", { area: formatNumber(item.areaSqm, locale) }) : null,
  ].filter((s): s is string => s !== null);

  return (
    <article
      data-listing-id={item.id}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`group relative flex gap-3 rounded-xl border bg-surface p-2.5 transition-colors ${
        active ? "border-primary-text" : "border-border hover:border-muted/60"
      }`}
    >
      <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-card text-muted ${compact ? "size-20" : "h-24 w-28"}`}>
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <span title={t("listing.noPhoto")}>
            <CategoryIcon category={item.category} />
          </span>
        )}
        {item.isFeatured && (
          <span className="absolute start-1 top-1 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
            {t("listing.featured")}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <PriceText
            price={item.price}
            currency={item.currency}
            decimals={currencyDecimals}
            rentPeriod={item.rentPeriod}
            className="text-base font-bold"
          />
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_BADGE[item.listingType]}`}>
            {t(`listing.types.${item.listingType}`)}
          </span>
        </div>
        <Link
          to={listingPath(locale, item.id, item.slug)}
          className="line-clamp-2 text-start text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl group-hover:text-primary-text focus-visible:text-primary-text focus-visible:after:ring-2 focus-visible:after:ring-primary-text"
        >
          {item.title}
        </Link>
        <p className="truncate text-xs text-muted">
          {t(`listing.categories.${item.category}`)}
          {item.areaName ? ` · ${item.areaName}` : ""}
        </p>
        {specs.length > 0 && <p className="truncate text-xs text-muted">{specs.join(" · ")}</p>}
      </div>
    </article>
  );
}
