import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    // Jordan mobile: 07[789]XXXXXXX, with or without the leading 0
    ["JO", "0791234567", "+962791234567"],
    ["JO", "0771234567", "+962771234567"],
    ["JO", "0781234567", "+962781234567"],
    ["JO", "791234567", "+962791234567"],
    ["JO", "79 123 4567", "+962791234567"],
    ["JO", "079 123 4567", "+962791234567"],
    ["JO", "٠٧٩١٢٣٤٥٦٧", "+962791234567"],
    ["JO", "+962 79 123 4567", "+962791234567"],
    ["JO", "00962791234567", "+962791234567"],
    ["JO", "+962 0791234567", "+962791234567"],
    ["JO", "+962-(79)-123.4567", "+962791234567"],
    // Jordan landline: 0[2356]XXXXXXX
    ["JO", "065123456", "+96265123456"],
    ["JO", "06 512 3456", "+96265123456"],
    ["JO", "027123456", "+96227123456"],
    ["JO", "032123456", "+96232123456"],
    ["JO", "053123456", "+96253123456"],
    ["JO", "+962 6 512 3456", "+96265123456"],
    ["JO", "00962 6 5123456", "+96265123456"],
    ["JO", "+962 065123456", "+96265123456"],
    // Kuwait: 8 digits, no trunk prefix
    ["KW", "51234567", "+96551234567"],
    ["KW", "5123 4567", "+96551234567"],
    ["KW", "+965 5123 4567", "+96551234567"],
    ["KW", "0096551234567", "+96551234567"],
    // Saudi Arabia: 05XXXXXXXX or 5XXXXXXXX
    ["SA", "0512345678", "+966512345678"],
    ["SA", "512345678", "+966512345678"],
    ["SA", "+966 51 234 5678", "+966512345678"],
    ["SA", "00966512345678", "+966512345678"],
    ["SA", "+9660512345678", "+966512345678"],
    // UAE: 05XXXXXXXX or 5XXXXXXXX
    ["AE", "0501234567", "+971501234567"],
    ["AE", "501234567", "+971501234567"],
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
    ["JO", "0761234567"], // 076 is not a Jordanian mobile range
    ["JO", "761234567"],
    ["JO", "+962761234567"], // same rule when typed internationally
    ["JO", "00962751234567"],
    ["JO", "65123456"], // landline without the leading 0
    ["JO", "0412345678"], // 04 is not an area code
    ["JO", "045123456"],
    ["JO", "07912345678"], // too long
    ["JO", "079123456"], // too short
    ["JO", "+9626512345"], // landline too short
    ["KW", "0512345678"],
    ["KW", "5123456"],
    ["SA", "0412345678"],
    ["SA", "41234567"],
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
