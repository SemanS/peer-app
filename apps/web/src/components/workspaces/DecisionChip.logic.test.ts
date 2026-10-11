import type { PeerCoordinationState, PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  decisionChip,
  eventChip,
  overlapChip,
  pathRulesText,
  projectDecision,
  projectPolicyLine,
} from "./DecisionChip.logic";

type Coordination = Pick<PeerCoordinationState, "enabled" | "policy" | "policies">;

const coordination = (extra: Partial<Coordination> = {}): Coordination => ({
  enabled: true,
  policy: "ask",
  policies: { acme: { booking: "coordinate" }, other: {} },
  ...extra,
});

const statusOf = (extra: { coordination?: Partial<Coordination>; resources?: object } = {}) =>
  ({
    coordination: coordination(extra.coordination),
    ...(extra.resources === undefined ? {} : { resources: extra.resources }),
  }) as unknown as Pick<PeerHubStatus, "coordination" | "resources">;

describe("what decided a request, as a chip", () => {
  it("says the project's policy, a path rule and this computer's default in the design's words", () => {
    expect(decisionChip({ policy: "coordinate", source: "project" }, "Booking", "ask")).toEqual({
      policy: "coordinate",
      source: "Booking's policy",
      warn: false,
      by: "project",
    });
    expect(
      decisionChip(
        { policy: "coordinate", source: "project", pattern: "payments/**" },
        "Booking",
        "ask",
      ),
    ).toMatchObject({ source: "payments/** in Booking", by: "project" });
    expect(decisionChip({ policy: "ask", source: "client" }, "Camp-bot", "ask")).toEqual({
      policy: "ask",
      source: "your computer, Camp-bot has no policy",
      warn: false,
      by: "computer",
    });
  });

  it("turns amber and says so when the project's path rules were not applied", () => {
    expect(
      decisionChip(
        { policy: "coordinate", source: "project", pathRulesOff: true },
        "Booking",
        "ask",
      ),
    ).toEqual({
      policy: "coordinate",
      source: "Booking's policy · path rules were off",
      warn: true,
      by: "project",
    });
    // Off, though a computer's default decided: the rules were still not looked at.
    expect(
      decisionChip({ policy: "ask", source: "client", pathRulesOff: true }, "Camp-bot", "ask"),
    ).toMatchObject({
      warn: true,
      source: "your computer, Camp-bot has no policy · path rules were off",
    });
  });

  it("does not call another computer's default this one's", () => {
    // The Hub records the default of the computer that asked; this one's is another policy.
    expect(decisionChip({ policy: "notify", source: "client" }, "Camp-bot", "ask")).toEqual({
      policy: "notify",
      source: "another computer's default, Camp-bot has no policy",
      warn: false,
      by: "another",
    });
    // The project decides for everyone, whoever asked.
    expect(decisionChip({ policy: "notify", source: "project" }, "Booking", "ask").by).toBe(
      "project",
    );
    // Without this computer's default there is nothing to tell them apart by.
    expect(decisionChip({ policy: "notify", source: "client" }, "Camp-bot", undefined).by).toBe(
      "computer",
    );
  });
});

describe("what decides in a project, worked out here", () => {
  it("is the project's own policy where the Hub named one, else this computer's default", () => {
    expect(projectDecision(coordination(), "acme", "booking")).toEqual({
      policy: "coordinate",
      source: "project",
    });
    expect(projectDecision(coordination(), "acme", "camp")).toEqual({
      policy: "ask",
      source: "client",
    });
  });

  it("knows nothing of a workspace whose view was not read, rather than call it the computer's", () => {
    expect(projectDecision(coordination(), "elsewhere", "booking")).toBeUndefined();
    expect(projectDecision({ policy: "ask" }, "acme", "booking")).toBeUndefined();
  });

  it("keeps projects of the same id in different workspaces apart", () => {
    const both = coordination({ policies: { acme: { app: "notify" }, other: { app: "ask" } } });
    expect(projectDecision(both, "acme", "app")?.policy).toBe("notify");
    expect(projectDecision(both, "other", "app")?.policy).toBe("ask");
  });
});

describe("the chip of an overlap and of an event", () => {
  const overlap = { workspace: "acme", project: "camp" };

  it("takes what the Hub recorded, and works the rest out for a Hub that records none", () => {
    const recorded = { policy: "coordinate", source: "project", pattern: "docs/**" } as const;
    expect(
      overlapChip(coordination(), { ...overlap, decision: recorded }, "Camp-bot"),
    ).toMatchObject({
      policy: "coordinate",
      source: "docs/** in Camp-bot",
    });
    expect(overlapChip(coordination(), overlap, "Camp-bot")).toMatchObject({
      policy: "ask",
      source: "your computer, Camp-bot has no policy",
      by: "computer",
    });
    expect(
      overlapChip(coordination(), { workspace: "acme", project: "booking" }, "Booking"),
    ).toMatchObject({ policy: "coordinate", source: "Booking's policy", by: "project" });
  });

  it("has no chip while neither the Hub nor this computer knows what decided", () => {
    expect(overlapChip({ policy: "ask" }, overlap, "Camp-bot")).toBeNull();
  });

  it("gives an event a chip only where the Hub named its decision", () => {
    expect(eventChip(undefined, "Booking", "ask")).toBeNull();
    expect(
      eventChip({ policy: "notify", source: "project", pattern: "docs/**" }, "Booking", "ask"),
    ).toMatchObject({
      policy: "notify",
      source: "docs/** in Booking",
    });
  });
});

describe("a project's policy line in Work", () => {
  const booking = { id: "booking", name: "Booking" };
  const camp = { id: "camp", name: "Camp-bot" };

  it("says the project's policy and sends its Settings, with its path rules counted", () => {
    const line = projectPolicyLine(
      statusOf({
        resources: { held: [], pathRules: [{ workspace: "acme", project: "booking", count: 3 }] },
      }),
      "acme",
      booking,
    );
    expect(line).toEqual({
      chip: { policy: "coordinate", source: "from Booking", warn: false, by: "project" },
      rules: 3,
      change: { label: "Settings", page: "project" },
    });
  });

  it("says this computer's default and sends its Change when the project sets none", () => {
    expect(projectPolicyLine(statusOf(), "acme", camp)).toEqual({
      chip: { policy: "ask", source: "from your computer", warn: false, by: "computer" },
      rules: 0,
      change: { label: "Change", page: "computer" },
    });
  });

  it("counts no rules while resources says nothing of them, and shows nothing it does not know", () => {
    expect(projectPolicyLine(statusOf(), "acme", booking)?.rules).toBe(0);
    // Coordination off here: the policy does not apply to this computer's agents.
    expect(
      projectPolicyLine(statusOf({ coordination: { enabled: false } }), "acme", booking),
    ).toBeNull();
    // An environment from before policies were reported, or a workspace not read yet.
    expect(
      projectPolicyLine(statusOf({ coordination: { policies: undefined } }), "acme", booking),
    ).toBeNull();
    expect(projectPolicyLine(statusOf(), "elsewhere", booking)).toBeNull();
  });

  it("counts path rules in words", () => {
    expect(pathRulesText(1)).toBe("1 path rule");
    expect(pathRulesText(3)).toBe("3 path rules");
  });
});
