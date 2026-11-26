/** Arabic-Indic (٠-٩, U+0660) and Persian/Urdu (۰-۹, U+06F0) digits → Western (0-9). */
export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}
