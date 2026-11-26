import { describe, expect, it } from "vitest";
import { createAuthCookies } from "./authCookies";

const now = new Date("2026-12-01T10:00:00Z");
const tokens = { accessToken: "a.b.c", refreshToken: "r".repeat(43), refreshExpiresAt: new Date(now.getTime() + 3600_000) };

describe("auth cookies", () => {
  it("are HttpOnly, SameSite=Lax, Path=/; Secure with __Host- over https", () => {
    const secure = createAuthCookies({ secure: true });
    expect(secure.names).toEqual({ access: "__Host-aqar_at", refresh: "__Host-aqar_rt" });
    const [access, refresh] = secure.issue(tokens, now);
    for (const c of [access!, refresh!]) {
      expect(c).toMatch(/HttpOnly/);
      expect(c).toMatch(/SameSite=Lax/);
      expect(c).toMatch(/Path=\//);
      expect(c).toMatch(/Secure/);
      expect(c).not.toMatch(/Domain=/);
    }
    expect(access).toMatch(/Max-Age=900/);
    expect(refresh).toMatch(/Max-Age=3600/);
  });

  it("drop Secure and the prefix over plain http (development)", () => {
    const dev = createAuthCookies({ secure: false });
    expect(dev.names).toEqual({ access: "aqar_at", refresh: "aqar_rt" });
    expect(dev.issue(tokens, now).join("\n")).not.toMatch(/Secure/);
  });

  it("read both from a Cookie header and clear them", () => {
    const c = createAuthCookies({ secure: false });
    expect(c.read("theme=dark; aqar_at=a.b.c; aqar_rt=xyz")).toEqual({ access: "a.b.c", refresh: "xyz" });
    expect(c.read(undefined)).toEqual({});
    const cleared = c.clear();
    expect(cleared).toHaveLength(2);
    for (const v of cleared) expect(v).toMatch(/Max-Age=0/);
  });
});
