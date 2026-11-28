import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { InvalidStorageKeyError, LocalDiskStorage } from "./storageService";

const root = mkdtempSync(path.join(tmpdir(), "aqar-storage-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("LocalDiskStorage", () => {
  const storage = new LocalDiskStorage(root);

  it("stores under the root and returns the public URL", async () => {
    const url = await storage.put("listings/7/abc-123.webp", Buffer.from("x"), "image/webp");
    expect(url).toBe("/uploads/listings/7/abc-123.webp");
    expect(readFileSync(path.join(root, "listings", "7", "abc-123.webp"), "utf8")).toBe("x");
  });

  it("never overwrites an existing file", async () => {
    await storage.put("listings/7/once.webp", Buffer.from("a"), "image/webp");
    await expect(storage.put("listings/7/once.webp", Buffer.from("b"), "image/webp")).rejects.toThrow();
    expect(readFileSync(path.join(root, "listings", "7", "once.webp"), "utf8")).toBe("a");
  });

  it("refuses keys that could escape the root or are not generated names", async () => {
    for (const key of ["../evil.webp", "listings/../../evil.webp", "/abs.webp", "Listings/A.webp", "listings/7/x", "listings//x.webp", "a\\b.webp"]) {
      await expect(storage.put(key, Buffer.from("x"), "image/webp")).rejects.toBeInstanceOf(InvalidStorageKeyError);
    }
  });

  it("deletes its own URLs and ignores others", async () => {
    const url = await storage.put("listings/8/del.webp", Buffer.from("x"), "image/webp");
    const file = path.join(root, "listings", "8", "del.webp");
    expect(existsSync(file)).toBe(true);
    await storage.deleteUrl(url);
    expect(existsSync(file)).toBe(false);
    await storage.deleteUrl(url); // already gone: no error

    const outside = path.join(root, "..", `aqar-outside-${Date.now()}.txt`);
    writeFileSync(outside, "keep");
    await storage.deleteUrl("/uploads/../" + path.basename(outside));
    await storage.deleteUrl("https://example.com/uploads/listings/8/x.webp");
    await storage.deleteUrl("/brand/aqar-logo.svg");
    expect(existsSync(outside)).toBe(true);
    rmSync(outside);
  });
});
