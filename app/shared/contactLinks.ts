/** Links for the proxy contact number and sharing (SPEC §8, §10). */

/** `tel:` link for an E.164 number. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** WhatsApp chat with the number, message pre-filled (wa.me wants digits only). */
export function whatsappChatHref(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/** WhatsApp "share to…" link (no recipient). */
export function whatsappShareHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Readable form of an E.164 number for display: +962 6 500 0001 / +962 79 123 4567. */
export function formatPhone(phone: string): string {
  const m = /^\+962(7[789])(\d{3})(\d{4})$/.exec(phone) ?? /^\+962([2356])(\d{3})(\d{4})$/.exec(phone);
  return m ? `+962 ${m[1]} ${m[2]} ${m[3]}` : phone;
}
