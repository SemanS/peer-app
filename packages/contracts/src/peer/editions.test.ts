import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PeerHubEdition, editionLabel } from "./editions.ts";

const decodeEdition = Schema.decodeUnknownSync(PeerHubEdition);

describe("Hub edition protocol", () => {
  it("represents unlimited interactions explicitly and never guesses an old Hub's edition", () => {
    const free = decodeEdition({
      id: "free",
      memberLimit: 2,
      members: 2,
      interactionLimit: null,
    });
    expect(editionLabel(free)).toBe("Free · 2/2 people · unlimited interactions");
    expect(editionLabel(undefined)).toContain("Edition unknown");
  });
  it("can display an operator's newer edition without accepting malformed capacity", () => {
    expect(
      editionLabel({ id: "enterprise", memberLimit: 25, members: 9, interactionLimit: null }),
    ).toContain("enterprise · 9/25 people");
    expect(() =>
      decodeEdition({
        id: "team",
        memberLimit: -1,
        members: 0,
        interactionLimit: null,
      }),
    ).toThrow();
  });
});
