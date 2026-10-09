import { describe, expect, it } from "vite-plus/test";
import { describeOffer, domainStateLabel } from "./peerDomainOffers.ts";
const offer = { slug: "other", name: "Other", domain: "acme.test" };
describe("domain decisions", () => {
  it("explains verified and unverified holders and membership consequences", () => {
    for (const verified of [true, false]) {
      const message = describeOffer({
        ...offer,
        holder: { slug: "acme", name: "Acme", verified },
      }).message;
      expect(message).toContain("Acme holds it");
      expect(message.includes("proved it through DNS")).toBe(verified);
      expect(message).toContain("admins decide which projects, tools and shared capacity");
      expect(message).toContain("members see the work you report");
    }
  });
  it("does not invent a creator and describes undecided domains", () => {
    expect(describeOffer(offer).message).toContain("no workspace holds that domain yet");
    expect(describeOffer(offer).message).not.toContain("Created by");
    expect(
      describeOffer({ ...offer, createdBy: "a@acme.test", createdAt: "2026-10-09" }).message,
    ).toContain("Created by a@acme.test on 2026-10-09");
  });
  it("labels all claim states", () => {
    expect(domainStateLabel("verified", "acme.test")).toBe("@acme.test: verified through DNS");
    expect(domainStateLabel("claimed", "acme.test")).toBe("@acme.test: claimed");
    expect(domainStateLabel("listed", "acme.test")).toBe("@acme.test: listed only");
  });
});
