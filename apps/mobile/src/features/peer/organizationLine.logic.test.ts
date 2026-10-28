import { describe, expect, it } from "vite-plus/test";

import { organizationLine } from "./organizationLine.logic";

const projects = [{ project: { id: "webshop", name: "Webshop" } }] as never;

describe("organizationLine", () => {
  it("says the person's role, and that it is their only organization", () => {
    expect(organizationLine({ role: "admin", projects }, 1)).toBe(
      "Your organization · You’re an admin",
    );
    expect(organizationLine({ role: "owner", projects }, 2)).toBe("You own it");
  });

  it("names the projects a limited member is on, by name where the phone knows it", () => {
    expect(organizationLine({ role: "member", projects, limitedTo: ["webshop"] }, 1)).toBe(
      "Your organization · You’re a member on Webshop only",
    );
    expect(
      organizationLine({ role: "member", projects, limitedTo: ["webshop", "billing"] }, 2),
    ).toBe("You’re a member on Webshop and billing only");
    expect(organizationLine({ role: "member", projects, limitedTo: [] }, 2)).toBe(
      "You’re a member",
    );
  });
});
