import { LoaderCircle, LocateFixed, MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useT } from "~/i18n/useT";
import { cleanQuery, Q_MAX_LENGTH, RADII_KM, roundNear, type LngLat, type RadiusKm } from "~/shared/schemas/mapSearch";
import { useMapUi } from "~/store/mapUiStore";
import { fetchSuggestions } from "./api";
import type { AreaSuggestion } from "./types";

/**
 * Search bar of the map page (SPEC §5.6): one bilingual free-text box with
 * location autocomplete, and "near me".
 */

const SUGGEST_DEBOUNCE_MS = 250;
const SUGGEST_MIN_CHARS = 2;

/** "عبدون، عمان": the area and its ancestors, without repeating a name (Amman city in Amman governorate). */
export function suggestionPath(s: AreaSuggestion, locale: "ar" | "en", separator: string): string {
  const names = [s, ...s.parents].map((a) => (locale === "ar" ? a.nameAr : a.nameEn));
  return names.filter((n, i) => i === 0 || n !== names[i - 1]).join(separator);
}

interface SearchBoxProps {
  country: string;
  q: string | undefined;
  onSearch(q: string | undefined): void;
  onLocation(area: AreaSuggestion): void;
}

type Option = { kind: "text"; q: string } | { kind: "area"; area: AreaSuggestion };

/** Free-text box (ARIA combobox): Enter searches listings; choosing an area flies the map there instead. */
export function SearchBox({ country, q, onSearch, onLocation }: SearchBoxProps) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(q ?? "");
  const [focused, setFocused] = useState(false);
  /** Suggestions and the query they answer (older answers are not shown). */
  const [fetched, setFetched] = useState<{ q: string; items: AreaSuggestion[] }>({ q: "", items: [] });
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The URL changed (Back, a shared link, "clear"): show its query.
  const [shownQ, setShownQ] = useState(q);
  if (q !== shownQ) {
    setShownQ(q);
    setText(q ?? "");
  }

  const cleaned = cleanQuery(text);
  const wantSuggestions = focused && cleaned !== undefined && cleaned.length >= SUGGEST_MIN_CHARS;
  const suggestions = wantSuggestions && fetched.q === cleaned ? fetched.items : [];
  useEffect(() => {
    if (!wantSuggestions || !cleaned) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchSuggestions(country, cleaned, controller.signal)
        .then((r) => setFetched({ q: cleaned, items: r.items }))
        // Suggestions are optional: on any error (incl. 429) just show none.
        .catch((error) => {
          if ((error as Error).name !== "AbortError") setFetched({ q: cleaned, items: [] });
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [country, cleaned, wantSuggestions]);

  const options: Option[] = [...(cleaned ? [{ kind: "text" as const, q: cleaned }] : []), ...suggestions.map((area) => ({ kind: "area" as const, area }))];
  const open = focused && !dismissed && cleaned !== undefined && options.length > 0;

  const choose = (o: Option) => {
    setDismissed(true);
    setActive(-1);
    if (o.kind === "text") {
      onSearch(o.q);
    } else {
      // A place, not a text filter: fly there and keep the current query in the box.
      setText(q ?? "");
      onLocation(o.area);
    }
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setDismissed(false);
      if (options.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && options[active]) choose(options[active]);
      else {
        setDismissed(true);
        onSearch(cleaned);
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      if (open) setDismissed(true);
      else setText("");
    }
  };

  const clear = () => {
    setText("");
    if (q) onSearch(undefined);
    inputRef.current?.focus();
  };

  const optionId = (i: number) => `${id}-opt-${i}`;
  const separator = t("search.pathSeparator");

  return (
    <div role="search" className="relative min-w-0 flex-1">
      <label htmlFor={`${id}-input`} className="sr-only">
        {t("search.label")}
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        id={`${id}-input`}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        enterKeyHint="search"
        maxLength={Q_MAX_LENGTH}
        value={text}
        placeholder={t("search.placeholder")}
        onChange={(e) => {
          setText(e.target.value);
          setActive(-1);
          setDismissed(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-full border border-muted bg-background ps-9 pe-9 text-sm placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          onClick={clear}
          aria-label={t("search.clear")}
          title={t("search.clear")}
          className="absolute end-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-card hover:text-foreground"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}

      <ul
        id={listId}
        role="listbox"
        aria-label={t("search.label")}
        hidden={!open}
        className="absolute inset-x-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-lg"
      >
        {options.map((o, i) => (
          <li
            key={o.kind === "text" ? "text" : o.area.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            // Keep the focus in the input until the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(o)}
            onMouseEnter={() => setActive(i)}
            className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${i === active ? "bg-surface" : ""}`}
          >
            {o.kind === "text" ? (
              <>
                <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
                <span className="truncate">{t("search.forText", { q: o.q })}</span>
              </>
            ) : (
              <>
                <MapPin aria-hidden="true" className="size-4 shrink-0 text-primary-text" />
                <span className="truncate">{suggestionPath(o.area, locale, separator)}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface NearMeProps {
  near: LngLat | undefined;
  radius: RadiusKm;
  onNear(near: LngLat | undefined): void;
  onRadius(radius: RadiusKm): void;
}

/**
 * "Near me": asks for the browser's location only when pressed (never on page
 * load), rounded to 3 decimals before it leaves this component (SPEC §5.6).
 */
export function NearMe({ near, radius, onNear, onRadius }: NearMeProps) {
  const t = useT();
  const setNotice = useMapUi((s) => s.setNotice);
  const [locating, setLocating] = useState(false);

  const locate = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setNotice("geo_unavailable");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onNear(roundNear({ lng: pos.coords.longitude, lat: pos.coords.latitude }));
      },
      (error) => {
        setLocating(false);
        setNotice(error.code === error.PERMISSION_DENIED ? "geo_denied" : "geo_unavailable");
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  if (!near) {
    return (
      <button
        type="button"
        onClick={locate}
        disabled={locating}
        aria-busy={locating || undefined}
        className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-muted bg-background px-3 text-sm font-medium transition-colors duration-150 hover:border-foreground disabled:opacity-70"
      >
        {locating ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <LocateFixed aria-hidden="true" className="size-4" />}
        <span className={locating ? "" : "max-sm:sr-only"}>{locating ? t("search.locating") : t("search.nearMe")}</span>
      </button>
    );
  }

  return (
    <div role="group" aria-label={t("search.nearActive", { km: radius })} className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-primary ps-3 pe-1 text-sm text-on-primary">
      <LocateFixed aria-hidden="true" className="size-4" />
      <label className="flex items-center">
        <span className="sr-only">{t("search.radius")}</span>
        <select
          value={radius}
          onChange={(e) => onRadius(Number(e.target.value) as RadiusKm)}
          className="cursor-pointer rounded-md bg-transparent px-1 py-1 font-semibold text-on-primary focus-visible:outline-2 focus-visible:outline-on-primary [&>option]:bg-card [&>option]:text-foreground"
        >
          {RADII_KM.map((r) => (
            <option key={r} value={r}>
              {t("search.radiusKm", { km: r })}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => onNear(undefined)}
        aria-label={t("search.clearNear")}
        title={t("search.clearNear")}
        className="flex size-8 items-center justify-center rounded-full transition-colors duration-150 hover:bg-primary-hover"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
