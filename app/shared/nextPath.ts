const BASE = "http://aqar.invalid";

/**
 * A `?next=` redirect target, accepted only as a path on this site (no open
 * redirects): must start with a single `/`, no backslashes or control
 * characters, and must not leave the origin once resolved. Login/register
 * pages are not valid targets.
 */
export function safeNextPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  // eslint-disable-next-line no-control-regex
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  if (/^\/(ar|en)\/(login|register)\/?$/.test(url.pathname)) return fallback;
  return url.pathname + url.search + url.hash;
}
