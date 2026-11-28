import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildIco } from "./generate-icons";

describe("buildIco", () => {
  it("writes an ICO directory pointing at each PNG", () => {
    const a = Buffer.from("\x89PNG-a");
    const b = Buffer.from("\x89PNG-bb");
    const ico = buildIco([
      { size: 16, data: a },
      { size: 256, data: b },
    ]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[6 + 16]).toBe(0); // 256 is stored as 0
    const off = (i: number) => ico.readUInt32LE(6 + 16 * i + 12);
    const len = (i: number) => ico.readUInt32LE(6 + 16 * i + 8);
    expect(ico.subarray(off(0), off(0) + len(0))).toEqual(a);
    expect(ico.subarray(off(1), off(1) + len(1))).toEqual(b);
  });
});

describe("committed icons", () => {
  const pub = path.resolve(import.meta.dirname, "..", "public");

  it("favicon.ico holds 16, 32 and 48 px PNGs", () => {
    const ico = readFileSync(path.join(pub, "favicon.ico"));
    const sizes = [0, 1, 2].map((i) => ico[6 + 16 * i]);
    expect(ico.readUInt16LE(4)).toBe(3);
    expect(sizes).toEqual([16, 32, 48]);
    for (let i = 0; i < 3; i++) {
      const o = ico.readUInt32LE(6 + 16 * i + 12);
      expect(ico.subarray(o, o + 4).toString("hex")).toBe("89504e47");
    }
  });

  it("the web manifest lists the icons with brand colours", () => {
    const m = JSON.parse(readFileSync(path.join(pub, "site.webmanifest"), "utf8"));
    expect(m.name).toBe("AQAR");
    expect(m.theme_color).toBe("#154e75");
    expect(m.background_color).toBe("#f7f4ef");
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["any", "192x192", "512x512"]);
  });
});
