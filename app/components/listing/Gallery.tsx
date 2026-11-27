import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useT } from "~/i18n/useT";
import { dirFor } from "~/shared/locales";

export interface GalleryImage {
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

/**
 * Listing photos (SPEC §10; milestone 5 decision: our own component).
 * Touch swipe is the browser's native scroll-snap, which mirrors in RTL (the
 * first photo sits on the right in Arabic); arrow keys follow the reading
 * direction; only the visible photo and its neighbours are loaded; a
 * full-screen lightbox uses <dialog> (Esc closes it, focus stays inside).
 */
export function Gallery({ images, alt }: { images: GalleryImage[]; alt: string }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (lightbox && !d.open) d.showModal();
    if (!lightbox && d.open) d.close();
  }, [lightbox]);

  if (images.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <Slides images={images} alt={alt} index={index} onIndex={setIndex} onOpen={() => setLightbox(true)} size="page" />
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t("detail.gallery.thumbnails")}>
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={t("detail.gallery.photoOf", { n: i + 1, total: images.length })}
              onClick={() => setIndex(i)}
              className={`h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 ${i === index ? "border-primary-text" : "border-transparent opacity-70 hover:opacity-100"}`}
            >
              <img src={img.thumbnailUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <dialog
        ref={dialogRef}
        onClose={() => setLightbox(false)}
        aria-label={t("detail.gallery.lightbox")}
        className="m-0 size-full max-h-none max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
      >
        {lightbox && (
          <div className="flex size-full flex-col">
            <div className="flex justify-end p-3">
              <button
                type="button"
                onClick={() => setLightbox(false)}
                className="rounded-lg px-3 py-1.5 text-sm hover:bg-white/10"
                autoFocus
              >
                {t("detail.gallery.close")}
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Slides images={images} alt={alt} index={index} onIndex={setIndex} size="lightbox" />
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

function Slides({
  images,
  alt,
  index,
  onIndex,
  onOpen,
  size,
}: {
  images: GalleryImage[];
  alt: string;
  index: number;
  onIndex(i: number): void;
  onOpen?(): void;
  size: "page" | "lightbox";
}) {
  const t = useT();
  const dir = dirFor(useLocale());
  const trackRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set([0, 1]));
  // Set while we scroll programmatically, so the observer does not fight the target index.
  const target = useRef<number | null>(null);

  const scrollTo = useCallback((i: number, smooth = true) => {
    const slide = trackRef.current?.children[i] as HTMLElement | undefined;
    if (!slide) return;
    target.current = i;
    slide.scrollIntoView({ behavior: smooth ? "smooth" : "instant", inline: "center", block: "nearest" });
  }, []);

  // External index changes (thumbnails, lightbox opening) move the track.
  useEffect(() => {
    scrollTo(index, size === "page");
  }, [index, scrollTo, size]);

  // Lazy loading: the current photo and its neighbours are loaded, others wait.
  // Updated while rendering (React's "adjust state on prop change" pattern), not in an effect.
  const wanted = [index - 1, index, index + 1].filter((i) => i >= 0 && i < images.length);
  if (wanted.some((i) => !loaded.has(i))) setLoaded(new Set([...loaded, ...wanted]));

  // Swiping (native scroll) updates the index: the slide mostly in view wins.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || e.intersectionRatio < 0.6) continue;
          const i = Number((e.target as HTMLElement).dataset.index);
          if (target.current !== null && target.current !== i) continue;
          target.current = null;
          if (i !== index) onIndex(i);
        }
      },
      { root: track, threshold: [0.6] },
    );
    for (const child of Array.from(track.children)) io.observe(child);
    return () => io.disconnect();
  }, [index, onIndex]);

  const go = (delta: number) => onIndex(Math.min(images.length - 1, Math.max(0, index + delta)));
  // Arrow keys follow reading direction: in Arabic, ← is "next".
  const onKeyDown = (e: KeyboardEvent) => {
    const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    if (e.key === forward) go(1);
    else if (e.key === back) go(-1);
    else if (e.key === "Home") onIndex(0);
    else if (e.key === "End") onIndex(images.length - 1);
    else return;
    e.preventDefault();
  };

  const arrow = "absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65 disabled:opacity-0";
  return (
    <div className={`relative ${size === "lightbox" ? "size-full" : ""}`}>
      <div
        ref={trackRef}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label={t("detail.gallery.label")}
        onKeyDown={onKeyDown}
        className={`flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-xl bg-card outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-primary-text ${
          size === "lightbox" ? "size-full rounded-none bg-transparent" : "aspect-[3/2]"
        }`}
      >
        {images.map((img, i) => (
          <div key={img.url} data-index={i} className="relative flex size-full shrink-0 snap-center items-center justify-center">
            {loaded.has(i) ? (
              <img
                src={img.url}
                alt={i === 0 ? alt : `${alt} (${i + 1})`}
                width={img.width}
                height={img.height}
                decoding="async"
                onClick={onOpen}
                className={`max-h-full ${size === "lightbox" ? "object-contain" : "size-full cursor-zoom-in object-cover"}`}
              />
            ) : (
              <span className="sr-only">{t("detail.gallery.photoOf", { n: i + 1, total: images.length })}</span>
            )}
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <>
          <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label={t("detail.gallery.previous")} className={`${arrow} start-2`}>
            <Chevron back />
          </button>
          <button type="button" onClick={() => go(1)} disabled={index === images.length - 1} aria-label={t("detail.gallery.next")} className={`${arrow} end-2`}>
            <Chevron />
          </button>
          <span className="absolute bottom-2 end-2 rounded-full bg-black/55 px-2.5 py-0.5 text-xs text-white" aria-live="polite">
            <bdi>
              {index + 1} / {images.length}
            </bdi>
          </span>
        </>
      )}
    </div>
  );
}

/** Points toward the end side (next) or start side (back), mirrored in RTL. */
function Chevron({ back }: { back?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-5 ${back ? "ltr:rotate-180" : "rtl:rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
