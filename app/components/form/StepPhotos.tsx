import { useEffect, useRef, useState, type DragEvent } from "react";
import { useT } from "~/i18n/useT";
import { MAX_PHOTOS, MAX_UPLOAD_BYTES } from "~/shared/constants";
import { photosRequired, type DraftView } from "~/shared/schemas/listingForm";
import { ApiError, deleteImage, reorderImages, resizeForUpload, uploadImage } from "./api";
import { card, secondaryButton } from "./types";

type Images = DraftView["images"];

const ERROR_KEYS: Record<string, string> = {
  image_unsupported: "unsupported",
  image_too_large: "too_large",
  image_invalid: "invalid",
  too_many_photos: "too_many",
  rate_limited: "rate_limited",
};

/**
 * Step 4 (SPEC §4.4, §7): upload (resized in the browser first), reorder by
 * drag-and-drop or with the buttons (keyboard), delete; the first photo is
 * the cover. At least one photo is required except for land.
 */
export function StepPhotos({ draft, onImages }: { draft: DraftView; onImages: (images: Images) => void }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragId, setDragId] = useState<number | null>(null);
  const images = draft.images;
  // Latest photos for the upload loop (which outlives a render).
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const messageFor = (error: unknown, name: string) => {
    const code = error instanceof ApiError ? ERROR_KEYS[error.code] : undefined;
    return t(`wizard.photos.errors.${code ?? "generic"}`, { name, max: MAX_PHOTOS });
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files];
    const problems: string[] = [];
    for (const file of list) {
      if (imagesRef.current.length >= MAX_PHOTOS) {
        problems.push(t("wizard.photos.errors.too_many", { max: MAX_PHOTOS }));
        break;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        problems.push(t("wizard.photos.errors.too_large", { name: file.name }));
        continue;
      }
      setUploading({ name: file.name, progress: 0 });
      try {
        const blob = await resizeForUpload(file);
        const image = await uploadImage(draft.id, blob, (p) => setUploading({ name: file.name, progress: p }));
        const next = [...imagesRef.current, image];
        imagesRef.current = next;
        onImages(next);
      } catch (error) {
        problems.push(messageFor(error, file.name));
      }
    }
    setUploading(null);
    setErrors(problems);
  };

  const applyOrder = async (next: Images) => {
    const previous = imagesRef.current;
    onImages(next);
    try {
      await reorderImages(draft.id, next.map((i) => i.id));
    } catch (error) {
      onImages(previous);
      setErrors([messageFor(error, "")]);
    }
  };

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= images.length) return;
    const next = [...images];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item!);
    void applyOrder(next);
  };

  const remove = async (imageId: number) => {
    const previous = imagesRef.current;
    onImages(previous.filter((i) => i.id !== imageId));
    try {
      await deleteImage(draft.id, imageId);
    } catch (error) {
      onImages(previous);
      setErrors([messageFor(error, "")]);
    }
  };

  const onDropItem = (e: DragEvent, targetId: number) => {
    e.preventDefault();
    if (dragId === null || dragId === targetId) return;
    const from = images.findIndex((i) => i.id === dragId);
    const to = images.findIndex((i) => i.id === targetId);
    const next = [...images];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setDragId(null);
    void applyOrder(next);
  };

  const onDropFiles = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    void addFiles(e.dataTransfer.files);
  };

  const required = photosRequired(draft.category);
  return (
    <section className={card} aria-labelledby="photos-title" onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()} onDrop={onDropFiles}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="photos-title" className="text-lg font-semibold">
          {t("wizard.photos.heading")}
        </h2>
        <span className="text-sm text-muted">{t("wizard.photos.count", { count: images.length, max: MAX_PHOTOS })}</span>
      </div>
      <p className="mb-3 text-sm text-muted">{t("wizard.photos.hint", { max: MAX_PHOTOS })}</p>
      {images.length === 0 && <p className="mb-3 text-sm font-medium">{required ? t("wizard.photos.required") : t("wizard.photos.landOptional")}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button type="button" className={secondaryButton} disabled={!!uploading || images.length >= MAX_PHOTOS} onClick={() => inputRef.current?.click()}>
        {t("wizard.photos.add")}
      </button>

      <div aria-live="polite" className="mt-3">
        {uploading && (
          <div className="flex flex-col gap-1">
            <span className="text-sm">{t("wizard.photos.uploading", { name: uploading.name })}</span>
            <progress max={1} value={uploading.progress} className="h-2 w-full max-w-sm accent-primary" />
          </div>
        )}
        {errors.map((e, i) => (
          <p key={i} className="text-sm text-error-text">
            {e}
          </p>
        ))}
      </div>

      {images.length > 0 && (
        <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img, i) => (
            <li
              key={img.id}
              draggable
              onDragStart={() => setDragId(img.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => dragId !== null && e.preventDefault()}
              onDrop={(e) => onDropItem(e, img.id)}
              className={`flex flex-col overflow-hidden rounded-xl border bg-card ${dragId === img.id ? "border-primary-text opacity-60" : "border-border"}`}
            >
              <div className="relative aspect-[4/3]">
                <img src={img.thumbnailUrl} alt={t("wizard.photos.photo", { n: i + 1 })} className="size-full cursor-grab object-cover" draggable={false} />
                {i === 0 && <span className="absolute start-2 top-2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-on-primary">{t("wizard.photos.cover")}</span>}
              </div>
              <div className="flex items-center justify-between gap-1 p-1.5">
                <div className="flex gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t("wizard.photos.moveEarlier")} — ${t("wizard.photos.photo", { n: i + 1 })}`} className="rounded-md px-2 py-1 text-sm hover:bg-background disabled:opacity-40">
                    <Arrow back />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label={`${t("wizard.photos.moveLater")} — ${t("wizard.photos.photo", { n: i + 1 })}`} className="rounded-md px-2 py-1 text-sm hover:bg-background disabled:opacity-40">
                    <Arrow />
                  </button>
                </div>
                <button type="button" onClick={() => void remove(img.id)} aria-label={`${t("wizard.photos.delete")} — ${t("wizard.photos.photo", { n: i + 1 })}`} className="rounded-md px-2 py-1 text-sm text-error-text hover:bg-background">
                  {t("wizard.photos.delete")}
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Points toward the start (earlier) or end (later) of the reading direction. */
function Arrow({ back }: { back?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-4 ${back ? "ltr:rotate-180" : "rtl:rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
