import { describe, expect, it } from "vitest";
import { publicOwnerName } from "./listingService";

describe("publicOwnerName", () => {
  it("shows only the first name of individuals", () => {
    expect(publicOwnerName("أحمد العمري", "owner")).toBe("أحمد");
    expect(publicOwnerName("  Rana   Yousef Haddad ", "owner")).toBe("Rana");
    expect(publicOwnerName("Khaled\tAl-Nabulsi", "owner")).toBe("Khaled");
    expect(publicOwnerName("Mona", "owner")).toBe("Mona");
    // Admins listing a property are individuals too.
    expect(publicOwnerName("مدير النظام", "admin")).toBe("مدير");
  });

  it("keeps the full name of agents", () => {
    expect(publicOwnerName("سامي الخطيب", "agent")).toBe("سامي الخطيب");
    expect(publicOwnerName(" Sami Al-Khatib ", "agent")).toBe("Sami Al-Khatib");
  });
});
