import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { looksLikeVisitorId, newVisitorId, visitorCookie, visitorHash } from "./viewService";

describe("visitor ids", () => {
  it("are 128-bit base64url and recognised", () => {
    const id = newVisitorId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(looksLikeVisitorId(id)).toBe(true);
    for (const bad of [undefined, "", "short", "x".repeat(23), "a b".padEnd(22, "c"), 42]) expect(looksLikeVisitorId(bad)).toBe(false);
  });

  it("cookie is first-party, httpOnly, Lax, one year; Secure over https", () => {
    const c = visitorCookie("abc", false);
    expect(c).toMatch(/^aqar_vid=abc;/);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=31536000");
    expect(c).not.toContain("Secure");
    expect(visitorCookie("abc", true)).toContain("Secure");
  });
});

describe("visitorHash", () => {
  const secret = randomBytes(32);
  const id = newVisitorId();

  it("uses the cookie when valid, else the IP; never contains either", () => {
    const byCookie = visitorHash({ cookieId: id, ip: "1.2.3.4" }, secret);
    expect(byCookie).toBe(visitorHash({ cookieId: id, ip: "5.6.7.8" }, secret));
    expect(byCookie).toMatch(/^[0-9a-f]{64}$/);
    expect(byCookie).not.toContain(id);

    const byIp = visitorHash({ cookieId: "forged", ip: "1.2.3.4" }, secret);
    expect(byIp).toBe(visitorHash({ ip: "1.2.3.4" }, secret));
    expect(byIp).not.toBe(visitorHash({ ip: "1.2.3.5" }, secret));
  });

  it("depends on the secret", () => {
    expect(visitorHash({ ip: "1.2.3.4" }, secret)).not.toBe(visitorHash({ ip: "1.2.3.4" }, randomBytes(32)));
  });
});
