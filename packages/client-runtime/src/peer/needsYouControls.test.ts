import { AuthAccessWriteScope, type PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { alertsControlState, needsYouCardCopy } from "./needsYouControls.ts";

type Alerts = NonNullable<NonNullable<PeerHubStatus["needsYou"]>["alerts"]>;
const status = (alerts: Alerts) => ({ needsYou: { alerts, staleInputs: [] } });
const owner = [AuthAccessWriteScope];

describe("the Phone alerts explanation", () => {
  it("says what T3 Connect is the first time it names it, in each delivery state", () => {
    const words = {
      "not-linked":
        "Link this computer to T3 Connect, Peer’s relay. A direct connection alone cannot send Phone alerts.",
      "publishing-off":
        "Turn on agent activity publishing for this computer in T3 Connect, Peer’s relay.",
      ready:
        "Titles only, sent to your phone through T3 Connect, Peer’s relay. Alerts follow its notification and quiet switches. Turn them on for one computer.",
    } as const;
    for (const delivery of ["not-linked", "publishing-off", "ready"] as const) {
      expect(alertsControlState(status({ enabled: false, delivery }), owner).explanation).toBe(
        words[delivery],
      );
    }
  });

  it("names the product Peer, never T3 Code", () => {
    for (const delivery of ["not-linked", "publishing-off", "ready"] as const) {
      for (const scopes of [owner, []]) {
        expect(
          alertsControlState(status({ enabled: true, delivery }), scopes).explanation,
        ).not.toContain("T3 Code");
      }
    }
    expect(alertsControlState(null, owner).explanation).toBe(
      "Update Peer on this computer to use Phone alerts.",
    );
  });

  it("leaves a person who does not own the computer with who may change it", () => {
    expect(alertsControlState(status({ enabled: false, delivery: "ready" }), [])).toMatchObject({
      state: "no-permission",
      disabled: true,
      explanation: "Only this computer’s owner can change Phone alerts.",
    });
  });
});

describe("the card copy of an owner's call", () => {
  it("tells the owner to accept or decline, and a lead that they decide for the owner", () => {
    expect(needsYouCardCopy({ kind: "owner-call", onBehalf: false })).toEqual({
      label: "Owner's call",
      guidance: "Accept or decline, with a note for the agent.",
    });
    expect(needsYouCardCopy({ kind: "owner-call", onBehalf: true })).toEqual({
      label: "Owner's call",
      guidance: "As a lead you can decide for the owner. The record says you did.",
    });
  });
});
