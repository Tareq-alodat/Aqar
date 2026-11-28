/** Arabic-Indic (٠-٩, U+0660) and Persian/Urdu (۰-۹, U+06F0) digits → Western (0-9). */
export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Wraps text that must read left-to-right (version codes, numbers with
 * dashes) in Unicode isolates (LRI … PDI), so it keeps its order inside
 * Arabic sentences built by `t()` interpolation.
 */
export function ltrIsolate(text: string): string {
  return `⁦${text}⁩`;
}
