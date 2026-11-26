import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    // Jordan: 07XXXXXXXX
    ["JO", "0791234567", "+962791234567"],
    ["JO", "079 123 4567", "+962791234567"],
    ["JO", "٠٧٩١٢٣٤٥٦٧", "+962791234567"],
    ["JO", "+962 79 123 4567", "+962791234567"],
    ["JO", "00962791234567", "+962791234567"],
    ["JO", "+962 0791234567", "+962791234567"],
    ["JO", "+962-(79)-123.4567", "+962791234567"],
    // Kuwait: 8 digits, no trunk prefix
    ["KW", "51234567", "+96551234567"],
    ["KW", "5123 4567", "+96551234567"],
    ["KW", "+965 5123 4567", "+96551234567"],
    ["KW", "0096551234567", "+96551234567"],
    // Saudi Arabia: 05XXXXXXXX
    ["SA", "0512345678", "+966512345678"],
    ["SA", "+966 51 234 5678", "+966512345678"],
    ["SA", "00966512345678", "+966512345678"],
    ["SA", "+9660512345678", "+966512345678"],
    // UAE: 05XXXXXXXX
    ["AE", "0501234567", "+971501234567"],
    ["AE", "+971 50 123 4567", "+971501234567"],
    ["AE", "00971501234567", "+971501234567"],
    ["AE", "‎+971 50 123 4567‏", "+971501234567"],
  ])("%s %j → %s", (country, input, expected) => {
    expect(normalizePhone(input, country)).toBe(expected);
  });

  it("accepts international numbers from another country as they are", () => {
    expect(normalizePhone("+966 51 234 5678", "JO")).toBe("+966512345678");
    expect(normalizePhone("00447700900123", "KW")).toBe("+447700900123");
  });

  it.each([
    ["JO", "791234567"], // missing trunk 0
    ["JO", "0612345678"], // not 07
    ["JO", "07912345678"], // too long
    ["KW", "0512345678"],
    ["KW", "5123456"],
    ["SA", "512345678"],
    ["AE", "0412345678"],
    ["JO", "+12"],
    ["JO", "+962abc"],
    ["JO", ""],
  ])("rejects %s %j", (country, input) => {
    expect(() => normalizePhone(input, country)).toThrow("Invalid phone number");
  });

  it("does not echo the input in errors", () => {
    expect(() => normalizePhone("0612345678", "JO")).toThrow(/^Invalid phone number$/);
  });

  it("rejects a country without phone rules", () => {
    expect(() => normalizePhone("0791234567", "XX")).toThrow("No phone rules");
  });
});
