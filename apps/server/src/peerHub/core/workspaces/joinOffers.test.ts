import { describe, expect, it } from "vite-plus/test";
import { splitJoinable } from "./joinOffers.ts";
const domain = (slug: string) => ({
  slug,
  name: slug,
  allowedDomains: ["acme.test"],
  joinReason: "domain" as const,
});
describe("safe domain joining", () => {
  it("keeps the holder automatic and non-holders as offers", () => {
    const offer = {
      slug: "other",
      name: "Other",
      domain: "acme.test",
      holder: { slug: "acme", name: "Acme", verified: true },
    };
    const result = splitJoinable(
      { email: "a@acme.test", workspaces: [], joinable: [domain("acme")], domainOffers: [offer] },
      new Set(),
    );
    expect(result.autoJoin.map((w) => w.slug)).toEqual(["acme"]);
    expect(result.offers).toEqual([offer]);
  });
  it("older Hubs with ambiguous domain matches cannot auto-join any", () => {
    const result = splitJoinable(
      { email: "a@acme.test", workspaces: [], joinable: [domain("one"), domain("two")] },
      new Set(),
    );
    expect(result.autoJoin).toEqual([]);
    expect(result.joinable).toEqual([]);
    expect(result.offers.map((w) => w.slug)).toEqual(["one", "two"]);
    expect(result.offers[0]?.holder).toBeUndefined();
  });
  it("never automatically accepts an invitation or a workspace left here", () => {
    const result = splitJoinable(
      {
        email: "a@acme.test",
        workspaces: [],
        joinable: [domain("acme"), { ...domain("invited"), joinReason: "invite" }],
      },
      new Set(["acme"]),
    );
    expect(result.autoJoin).toEqual([]);
    expect(result.joinable).toHaveLength(2);
  });
  it("invalid ids do not hide older Hub ambiguity or reach filesystem paths", () => {
    const result = splitJoinable(
      { email: "a@acme.test", workspaces: [], joinable: [domain("acme"), domain("../unsafe")] },
      new Set(),
    );
    expect(result.autoJoin).toEqual([]);
    expect(result.offers.map((w) => w.slug)).toEqual(["acme"]);
  });
});
