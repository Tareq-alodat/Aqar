import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "~/hooks/useAuth";
import { useLocale, useT } from "~/i18n/useT";
import type { AmenityTag, Category, Furnished, LocationPrecision } from "~/shared/constants";
import { formatPhone, telHref, whatsappChatHref, whatsappShareHref } from "~/shared/contactLinks";
import { DEFAULT_COUNTRY } from "~/shared/countries";
import type { BBox } from "~/shared/geo";
import { dirFor } from "~/shared/locales";
import { formatNumber } from "~/utils/format";

const DetailMap = lazy(() => import("./DetailMap"));
const noSubscribe = () => () => {};

const card = "rounded-2xl border border-card bg-surface p-4";

/** Breadcrumb from the area hierarchy (SPEC §10); each step opens the map on that area. */
export function AreaBreadcrumb({ path }: { path: Array<{ id: number; name: string; bbox: BBox }> }) {
  const t = useT();
  const locale = useLocale();
  const mapAt = (b: BBox) => {
    const lng = (b[0] + b[2]) / 2;
    const lat = (b[1] + b[3]) / 2;
    const span = Math.max(b[2] - b[0], b[3] - b[1], 0.005);
    const z = Math.max(6, Math.min(15, Math.log2(360 / span)));
    return `/${locale}/${DEFAULT_COUNTRY}/map?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&z=${z.toFixed(1)}`;
  };
  return (
    <nav aria-label={t("detail.breadcrumb")}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <li>
          <Link to={`/${locale}/${DEFAULT_COUNTRY}/map`} className="hover:text-primary hover:underline">
            {t(`countries.${DEFAULT_COUNTRY}`)}
          </Link>
        </li>
        {path.map((a) => (
          <li key={a.id} className="flex items-center gap-1.5">
            <span aria-hidden="true">›</span>
            <Link to={mapAt(a.bbox)} className="hover:text-primary hover:underline">
              {a.name}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export interface FeatureValues {
  category: Category;
  areaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  floorNumber: number | null;
  ageYears: number | null;
  furnished: Furnished | null;
  features: { parking: boolean; garden: boolean; pool: boolean; elevator: boolean };
  amenities: AmenityTag[];
}

/** Features grid + amenity chips (SPEC §10). Land listings hide room and floor fields. */
export function FeatureGrid({ v }: { v: FeatureValues }) {
  const t = useT();
  const locale = useLocale();
  const isLand = v.category === "land";
  const rows: Array<[string, string]> = [];
  if (v.areaSqm !== null) rows.push([t("detail.features.area"), t("listing.sqm", { area: formatNumber(v.areaSqm, locale) })]);
  if (!isLand) {
    if (v.bedrooms !== null) rows.push([t("detail.features.bedrooms"), formatNumber(v.bedrooms, locale)]);
    if (v.bathrooms !== null) rows.push([t("detail.features.bathrooms"), formatNumber(v.bathrooms, locale)]);
    if (v.floors !== null) rows.push([t("detail.features.floors"), formatNumber(v.floors, locale)]);
    if (v.floorNumber !== null) rows.push([t("detail.features.floorNumber"), v.floorNumber === 0 ? t("detail.features.groundFloor") : formatNumber(v.floorNumber, locale)]);
    if (v.ageYears !== null) rows.push([t("detail.features.age"), v.ageYears === 0 ? t("detail.features.new") : t("detail.features.years", { count: v.ageYears })]);
    if (v.furnished) rows.push([t("detail.features.furnished"), t(`detail.furnished.${v.furnished}`)]);
  }
  const chips = [
    ...(["parking", "garden", "pool", "elevator"] as const).filter((k) => v.features[k]).map((k) => t(`filters.amen.${k}`)),
    ...v.amenities.map((a) => t(`listing.amenityTags.${a}`)),
  ];
  return (
    <section aria-labelledby="features-title" className="flex flex-col gap-3">
      <h2 id="features-title" className="text-lg font-semibold">
        {t("detail.features.title")}
      </h2>
      {rows.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {rows.map(([k, val]) => (
            <div key={k} className="rounded-xl bg-card px-3 py-2">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-semibold">{val}</dd>
            </div>
          ))}
        </dl>
      )}
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t("detail.features.amenities")}>
          {chips.map((c) => (
            <li key={c} className="rounded-full border border-card px-3 py-1 text-sm">
              {c}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Proxy number with Call and WhatsApp (SPEC §8). `sticky`: the mobile bar at the bottom. */
export function ContactBox({ phone, whatsapp, message, sticky }: { phone: string; whatsapp: boolean; message: string; sticky?: boolean }) {
  const t = useT();
  const button = "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold";
  const actions = (
    <div className="flex gap-2">
      <a href={telHref(phone)} className={`${button} bg-primary text-on-accent`}>
        <PhoneIcon />
        {t("detail.contact.call")}
      </a>
      {whatsapp && (
        <a href={whatsappChatHref(phone, message)} target="_blank" rel="noopener noreferrer" className={`${button} bg-success text-on-accent`}>
          <ChatIcon />
          {t("detail.contact.whatsapp")}
        </a>
      )}
    </div>
  );
  if (sticky) {
    return <div className="fixed inset-x-0 bottom-0 z-30 border-t border-card bg-surface/95 p-3 backdrop-blur lg:hidden">{actions}</div>;
  }
  return (
    <section aria-labelledby="contact-title" className={card}>
      <h2 id="contact-title" className="text-sm text-muted">
        {t("detail.contact.title")}
      </h2>
      <p className="my-2 text-xl font-bold" dir="ltr">
        {formatPhone(phone)}
      </p>
      {actions}
      <p className="mt-3 text-xs text-muted">{t("detail.contact.proxyNote")}</p>
    </section>
  );
}

/** Favourite toggle (PUT/DELETE /api/v1/listings/:id/save). Guests go to login and come back. */
export function FavoriteButton({ listingId, initial }: { listingId: number; initial: boolean }) {
  const t = useT();
  const locale = useLocale();
  const user = useAuth();
  const location = useLocation();
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const className = "flex items-center gap-2 rounded-xl border border-card px-3 py-2 text-sm font-medium hover:bg-card";

  if (!user) {
    return (
      <Link to={`/${locale}/login?next=${encodeURIComponent(location.pathname)}`} className={className}>
        <HeartIcon filled={false} />
        {t("detail.save")}
      </Link>
    );
  }
  const toggle = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/listings/${listingId}/save`, { method: saved ? "DELETE" : "PUT" });
      if (!res.ok) throw new Error(String(res.status));
      setSaved(((await res.json()) as { saved: boolean }).saved);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={toggle} disabled={busy} aria-pressed={saved} className={className}>
        <HeartIcon filled={saved} />
        {saved ? t("detail.saved") : t("detail.save")}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-error">
        {failed ? t("detail.saveError") : ""}
      </span>
    </div>
  );
}

/** Share: native share sheet where available, copy link, WhatsApp. */
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  // false on the server and during hydration; the real value afterwards.
  const canShare = useSyncExternalStore(
    noSubscribe,
    () => "share" in navigator,
    () => false,
  );
  const className = "flex items-center gap-2 rounded-xl border border-card px-3 py-2 text-sm font-medium hover:bg-card";
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {canShare && (
        <button type="button" className={className} onClick={() => navigator.share({ title, url }).catch(() => {})}>
          {t("detail.share.share")}
        </button>
      )}
      <button type="button" className={className} onClick={copy}>
        {copied ? t("detail.share.copied") : t("detail.share.copy")}
      </button>
      <a className={className} href={whatsappShareHref(`${title}\n${url}`)} target="_blank" rel="noopener noreferrer">
        {t("detail.share.whatsapp")}
      </a>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t("detail.share.copied") : ""}
      </span>
    </div>
  );
}

/** Owner/agent card (SPEC §10): name, initials avatar, member since, company + verified — never a phone or email. */
export function OwnerCard({
  owner,
}: {
  owner: { name: string; role: string; memberSince: string; company: { name: string; logoUrl: string | null; verified: boolean } | null };
}) {
  const t = useT();
  const locale = useLocale();
  const since = new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en", { month: "long", year: "numeric" }).format(
    new Date(owner.memberSince),
  );
  const initials = owner.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <section aria-labelledby="owner-title" className={`${card} flex items-center gap-3`}>
      <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card text-lg font-bold text-primary">
        {initials}
      </span>
      <div className="min-w-0">
        <h2 id="owner-title" className="truncate font-semibold">
          {owner.name}
        </h2>
        <p className="text-xs text-muted">
          {t(owner.role === "agent" ? "detail.owner.agent" : "detail.owner.owner")} · {t("detail.owner.memberSince", { date: since })}
        </p>
        {owner.company && (
          <p className="mt-1 flex items-center gap-1.5 text-sm">
            {owner.company.logoUrl && <img src={owner.company.logoUrl} alt="" className="size-5 rounded object-cover" />}
            <span className="truncate">{owner.company.name}</span>
            {owner.company.verified && (
              <span className="rounded-full bg-success px-2 py-0.5 text-[11px] font-semibold text-on-accent">{t("detail.owner.verified")}</span>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

/** The location map, loaded only when scrolled near (MapLibre is large). */
export function LazyDetailMap({
  lng,
  lat,
  precision,
  styleUrl,
}: {
  lng: number;
  lat: number;
  precision: LocationPrecision;
  styleUrl: string;
}) {
  const t = useT();
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setShow(true);
        io.disconnect();
      }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Stable object: DetailMap rebuilds the map when its props change.
  const controlLabels = useMemo(
    () => ({
      "NavigationControl.ZoomIn": t("map.controls.zoomIn"),
      "NavigationControl.ZoomOut": t("map.controls.zoomOut"),
      "AttributionControl.ToggleAttribution": t("map.controls.attribution"),
      "Map.Title": t("detail.location.mapLabel"),
    }),
    [t],
  );
  return (
    <div ref={ref} className="relative h-72 overflow-hidden rounded-2xl bg-card">
      {show ? (
        <Suspense fallback={<p className="p-4 text-sm text-muted">{t("map.loadingMap")}</p>}>
          <DetailMap lng={lng} lat={lat} precision={precision} styleUrl={styleUrl} locale={locale} dir={dirFor(locale)} controlLabels={controlLabels} />
        </Suspense>
      ) : (
        <p className="p-4 text-sm text-muted">{t("map.loadingMap")}</p>
      )}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-12.5 7.4L3 21l2.1-5.5A8.4 8.4 0 1 1 21 11.5z" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-5 ${filled ? "fill-error text-error" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}
