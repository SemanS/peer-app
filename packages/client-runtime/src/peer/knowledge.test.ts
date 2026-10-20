import type { PeerChallengeRow, PeerKnowledgeChallenge } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { challengeOffers, challengeStaged, challengeWho, servesChallenges } from "./knowledge.ts";

const challenge: PeerKnowledgeChallenge = {
  id: "ch1",
  project: "app",
  entry: "prices",
  reason: "decimals now",
  sources: [],
  finders: 2,
  people: ["ana@acme.test"],
  status: "open",
  firstAt: "2026-10-18T10:00:00Z",
  lastAt: "2026-10-18T10:00:00Z",
};
const current = {
  title: "Prices are integer cents",
  kind: "decision",
  file: ".ai/decisions/prices.md",
  summary: "",
  body: "",
};
const row = (over: Partial<PeerKnowledgeChallenge> = {}, here = true): PeerChallengeRow => ({
  challenge: { ...challenge, ...over },
  current: here ? current : null,
  changed: false,
});
const can = {
  replace: { available: false, reason: "This needs kontext 0.3.0 or newer here." },
  retire: { available: true, reason: null },
};
const ids = (offers: ReadonlyArray<{ readonly id: string }>) => offers.map((offer) => offer.id);

describe("what a challenge row offers", () => {
  it("offers web every action of an open challenge, with why one is unavailable", () => {
    const offers = challengeOffers(row(), can, { surface: "web", me: "bob@acme.test" });
    expect(ids(offers)).toEqual(["second", "dismiss", "replace", "retire", "resolve"]);
    expect(offers.find((offer) => offer.id === "replace")?.unavailable).toContain("0.3.0");
    expect(offers.find((offer) => offer.id === "retire")?.unavailable).toBeNull();
  });
  it("offers the phone second, dismiss and resolve only", () => {
    expect(ids(challengeOffers(row(), can, { surface: "mobile" }))).toEqual([
      "second",
      "dismiss",
      "resolve",
    ]);
    expect(challengeOffers(row({ status: "dismissed" }), can, { surface: "mobile" })).toEqual([]);
  });
  it("seconds once per person", () => {
    const mine = challengeOffers(row(), can, { surface: "web", me: "ana@acme.test" });
    expect(mine[0]?.unavailable).toBe("You seconded it.");
  });
  it("offers web Still holds first on a drift challenge where the Hub takes confirmations", () => {
    const drift = { head: "a".repeat(40), commits: [], paths: ["src/price.ts"] };
    const confirm = { available: true, reason: null };
    expect(ids(challengeOffers(row({ drift }), { ...can, confirm }, { surface: "web" }))).toEqual([
      "confirm",
      "second",
      "dismiss",
      "replace",
      "retire",
      "resolve",
    ]);
    // Not on a person's challenge, nor before revision 3, nor on the phone.
    expect(ids(challengeOffers(row(), { ...can, confirm }, { surface: "web" }))).not.toContain(
      "confirm",
    );
    expect(ids(challengeOffers(row({ drift }), can, { surface: "web" }))).not.toContain("confirm");
    expect(
      ids(challengeOffers(row({ drift }), { ...can, confirm }, { surface: "mobile" })),
    ).not.toContain("confirm");
  });
  it("offers only Resolve for an entry the checkout does not have", () => {
    expect(ids(challengeOffers(row({}, false), can, { surface: "web" }))).toEqual(["resolve"]);
  });
  it("lets a dismissed or resolving challenge be opened again, and a resolved one rest", () => {
    expect(ids(challengeOffers(row({ status: "dismissed" }), can, { surface: "web" }))).toEqual([
      "reopen",
    ]);
    expect(ids(challengeOffers(row({ status: "resolving" }), can, { surface: "web" }))).toEqual([
      "reopen",
      "dismiss",
      "resolve",
    ]);
    expect(challengeOffers(row({ status: "resolved" }), can, { surface: "web" })).toEqual([]);
  });
});

describe("challenge wording and support", () => {
  it("says who disputes an entry", () => {
    expect(challengeWho(challenge)).toBe("2 agents on their own · 1 person");
    expect(challengeWho({ ...challenge, finders: 0, people: [] })).toBe(
      "An agent that had heard of it",
    );
    const drift = { head: "a".repeat(40), commits: [], paths: [] };
    expect(challengeWho({ ...challenge, finders: 0, people: [], drift })).toBe("Its code changed");
  });
  it("says what a resolving challenge staged", () => {
    const staged = (kind: string) => ({
      ...challenge,
      status: "resolving" as const,
      resolvedAs: { path: ".ai/x.md", title: "X", kind },
    });
    expect(challengeStaged(staged("confirmed"))).toBe("Confirmation staged");
    expect(challengeStaged(staged("decision"))).toBe("Replacement staged");
  });
  it("needs a Hub that serves knowledge at revision 2", () => {
    expect(servesChallenges({ hub: { features: { knowledge: 2 } } })).toBe(true);
    expect(servesChallenges({ hub: { features: { knowledge: 1 } } })).toBe(false);
    expect(servesChallenges({})).toBe(false);
  });
});
