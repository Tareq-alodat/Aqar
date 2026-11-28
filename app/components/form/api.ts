import { PHOTO_MAX_EDGE } from "~/shared/constants";
import type { DraftView, MissingField, SaveStep, SubmitInput } from "~/shared/schemas/listingForm";

/** Client for /api/v1/my/listings (submit wizard). Errors carry the API's error code. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly missing?: MissingField[],
  ) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/my/listings${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: string; missing?: MissingField[] };
  if (!res.ok) throw new ApiError(res.status, json.error ?? "generic", json.missing);
  return json as T;
}

export type FieldErrors = Record<string, string>;

export const saveDraftStep = (id: number, input: SaveStep) => call<{ draft: DraftView; fieldErrors: FieldErrors }>("PATCH", `/${id}`, input);
export const deleteDraft = (id: number) => call<void>("DELETE", `/${id}`);
export const deleteImage = (id: number, imageId: number) => call<void>("DELETE", `/${id}/images/${imageId}`);
export const reorderImages = (id: number, ids: number[]) => call<void>("PUT", `/${id}/images/order`, { ids });
export const submitDraft = (id: number, input: SubmitInput) => call<{ id: number; status: "pending" }>("POST", `/${id}/submit`, input);

export type UploadedImage = DraftView["images"][number];

/** Uploads one photo with progress (fetch has no upload progress, so XHR). */
export function uploadImage(id: number, file: Blob, onProgress: (fraction: number) => void): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1/my/listings/${id}/images`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let json: { image?: UploadedImage; error?: string } = {};
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status === 201 && json.image) resolve(json.image);
      else reject(new ApiError(xhr.status, json.error ?? "generic"));
    };
    xhr.onerror = () => reject(new ApiError(0, "network"));
    const form = new FormData();
    form.append("image", file, "photo");
    xhr.send(form);
  });
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Resizes a photo in the browser before upload (SPEC §4.4): longest edge ≤ 2000 px,
 * EXIF orientation applied, re-encoded as JPEG. Re-encoding through a canvas also
 * drops EXIF (including GPS) before the file leaves the device. The server checks
 * and re-encodes again regardless.
 */
export async function resizeForUpload(file: File): Promise<Blob> {
  if (!ACCEPTED.includes(file.type)) throw new ApiError(415, "image_unsupported");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ApiError(415, "image_invalid");
  }
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ApiError(0, "generic");
  // White behind transparent PNGs (JPEG has no transparency).
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new ApiError(0, "generic");
  return blob;
}
