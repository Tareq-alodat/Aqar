import { describe, expect, it } from "vitest";
import { safeNextPath } from "./nextPath";

const FALLBACK = "/ar/jo/map";

describe("safeNextPath", () => {
  it.each([
    ["/en/jo/map", "/en/jo/map"],
    ["/ar/jo/map?minPrice=100#list", "/ar/jo/map?minPrice=100#list"],
    ["/ar/../en/jo/map", "/en/jo/map"],
  ])("accepts %j", (input, expected) => {
    expect(safeNextPath(input, FALLBACK)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.example/x",
    "//evil.example/x",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/ar/jo/map\nSet-Cookie: x=1",
    "ar/jo/map",
    "/ar/login",
    "/en/register/",
    `/${"a".repeat(3000)}`,
  ])("rejects %j", (input) => {
    expect(safeNextPath(input, FALLBACK)).toBe(FALLBACK);
  });
});
